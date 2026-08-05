import { NextRequest, NextResponse } from 'next/server';
import { fetchHandSplitStatcast } from '@/app/lib/statcastHandSplits';

/**
 * GET /api/season-stats?playerId=809092&year=2026
 *
 * Fetches hitting season stats from the MLB Stats API across all sport levels
 * and combines them when a player appeared at multiple levels (e.g. MLB + AAA).
 * Counting stats are summed; rate stats are recomputed from the combined totals.
 * Also fetches vs LHP / vs RHP splits for the same level(s).
 */

type RawStat = Record<string, unknown>;

function sumCounting(stats: RawStat[]) {
  let ab = 0, h = 0, hr = 0, rbi = 0, bb = 0, k = 0, g = 0;
  let pa = 0, sb = 0, doubles = 0, triples = 0, hbp = 0, sf = 0;
  for (const s of stats) {
    ab      += Number(s.atBats           ?? 0);
    h       += Number(s.hits             ?? 0);
    hr      += Number(s.homeRuns         ?? 0);
    rbi     += Number(s.rbi              ?? 0);
    bb      += Number(s.baseOnBalls      ?? 0);
    k       += Number(s.strikeOuts       ?? 0);
    g       += Number(s.gamesPlayed      ?? 0);
    pa      += Number(s.plateAppearances ?? 0);
    sb      += Number(s.stolenBases      ?? 0);
    doubles += Number(s.doubles          ?? 0);
    triples += Number(s.triples          ?? 0);
    hbp     += Number(s.hitByPitch       ?? 0);
    sf      += Number(s.sacFlies         ?? 0);
  }
  return { ab, h, hr, rbi, bb, k, g, pa, sb, doubles, triples, hbp, sf };
}

function ratesFromCounting(c: ReturnType<typeof sumCounting>) {
  const singles = c.h - c.doubles - c.triples - c.hr;
  const tb = singles + 2 * c.doubles + 3 * c.triples + 4 * c.hr;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const fmt = (n: number) => n.toFixed(3).replace(/^0\./, '.');

  const avg = c.ab > 0 ? r3(c.h / c.ab) : 0;
  const obpNum = c.ab + c.bb + c.hbp + c.sf;
  const obp = obpNum > 0 ? r3((c.h + c.bb + c.hbp) / obpNum) : 0;
  const slg = c.ab > 0 ? r3(tb / c.ab) : 0;
  const ops = r3(obp + slg);
  return { avg: fmt(avg), obp: fmt(obp), slg: fmt(slg), ops: fmt(ops) };
}

// Combine one or more raw split stats (across levels) into a single display object.
function combineSplit(stats: RawStat[]) {
  if (stats.length === 0) return null;
  if (stats.length === 1) {
    const s = stats[0];
    return {
      avg: s.avg, obp: s.obp, slg: s.slg, ops: s.ops,
      hr: Number(s.homeRuns ?? 0), rbi: Number(s.rbi ?? 0),
      bb: Number(s.baseOnBalls ?? 0), k: Number(s.strikeOuts ?? 0),
      pa: Number(s.plateAppearances ?? 0), ab: Number(s.atBats ?? 0),
    };
  }
  const c = sumCounting(stats);
  const rates = ratesFromCounting(c);
  return { ...rates, hr: c.hr, rbi: c.rbi, bb: c.bb, k: c.k, pa: c.pa, ab: c.ab };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const year = searchParams.get('year') || String(new Date().getFullYear());
  const sportIdParam = searchParams.get('sportId');
  const includeSplits = searchParams.get('splits') !== '0';

  if (!playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 });

  const base =
    `https://statsapi.mlb.com/api/v1/people/${playerId}/stats` +
    `?stats=season&group=hitting&season=${year}`;
  const splitsBase =
    `https://statsapi.mlb.com/api/v1/people/${playerId}/stats` +
    `?stats=statSplits&group=hitting&season=${year}&sitCodes=vl,vr`;

  // When the game's sportId is known, fetch only that level.
  // Otherwise fall back to fetching all levels and combining them.
  const sportIds = sportIdParam ? [parseInt(sportIdParam)] : [1, 11, 12, 13, 14, 16, 17];

  try {
    const results = await Promise.all(
      sportIds.map(sportId =>
        fetch(`${base}&sportId=${sportId}`, { next: { revalidate: 1800 } })
          .then(r => r.json())
          .then((d: { stats?: { splits?: { stat: RawStat }[] }[] }) => ({
            sportId,
            stat: d.stats?.[0]?.splits?.[0]?.stat ?? null,
          }))
          .catch(() => ({ sportId, stat: null as RawStat | null }))
      )
    );

    const withData = results.filter(r => r.stat !== null);
    if (withData.length === 0) return NextResponse.json({});

    // vs LHP / vs RHP splits — skipped entirely when splits=0 (the daily card no longer
    // shows these, so there's no reason to pay for the extra MLB API + Savant CSV calls).
    let vsLHP: ReturnType<typeof combineSplit> = null;
    let vsRHP: ReturnType<typeof combineSplit> = null;
    if (includeSplits) {
      const splitResults = await Promise.all(
        withData.map(({ sportId }) =>
          fetch(`${splitsBase}&sportId=${sportId}`, { next: { revalidate: 1800 } })
            .then(r => r.json())
            .then((d: { stats?: { splits?: { split?: { code?: string }; stat: RawStat }[] }[] }) => {
              const splits = d.stats?.[0]?.splits ?? [];
              return {
                vl: splits.find(s => s.split?.code === 'vl')?.stat ?? null,
                vr: splits.find(s => s.split?.code === 'vr')?.stat ?? null,
              };
            })
            .catch(() => ({ vl: null as RawStat | null, vr: null as RawStat | null }))
        )
      );
      vsLHP = combineSplit(splitResults.map(r => r.vl).filter((s): s is RawStat => s !== null));
      vsRHP = combineSplit(splitResults.map(r => r.vr).filter((s): s is RawStat => s !== null));

      // Barrel% / Contact% / xwOBA vs LHP / RHP from Savant pitch-level CSV (primary level
      // only — Statcast coverage doesn't meaningfully differ across levels in one season).
      const primarySportId = withData[0].sportId;
      const handStatcast = await fetchHandSplitStatcast(playerId, year, primarySportId);
      const emptyHand = { barrelPct: null, contactPct: null, xwoba: null, bip: 0, swings: 0 };
      if (vsLHP) vsLHP = { ...vsLHP, ...(handStatcast.vsLHP ?? emptyHand) };
      if (vsRHP) vsRHP = { ...vsRHP, ...(handStatcast.vsRHP ?? emptyHand) };
    }

    // Single level — return directly
    if (withData.length === 1) {
      const s = withData[0].stat!;
      return NextResponse.json({
        avg: s.avg, obp: s.obp, slg: s.slg, ops: s.ops,
        hr: s.homeRuns, rbi: s.rbi, bb: s.baseOnBalls, k: s.strikeOuts,
        g: s.gamesPlayed, pa: s.plateAppearances, sb: s.stolenBases,
        hits: s.hits, ab: s.atBats, doubles: s.doubles, triples: s.triples,
        sportId: withData[0].sportId,
        vsLHP, vsRHP,
      });
    }

    // Multiple levels — sum counting stats, recompute rate stats
    const c = sumCounting(withData.map(r => r.stat!));
    const rates = ratesFromCounting(c);

    return NextResponse.json({
      ...rates,
      hr: c.hr, rbi: c.rbi, bb: c.bb, k: c.k, g: c.g, pa: c.pa, sb: c.sb,
      hits: c.h, ab: c.ab, doubles: c.doubles, triples: c.triples,
      sportId: withData[0].sportId, // primary level (highest in hierarchy)
      vsLHP, vsRHP,
    });

  } catch (e) {
    console.warn('[season-stats]', e);
    return NextResponse.json({});
  }
}
