import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/season-stats?playerId=809092&year=2026
 *
 * Fetches hitting season stats from the MLB Stats API across all sport levels
 * and combines them when a player appeared at multiple levels (e.g. MLB + AAA).
 * Counting stats are summed; rate stats are recomputed from the combined totals.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const year = searchParams.get('year') || String(new Date().getFullYear());
  const sportIdParam = searchParams.get('sportId');

  if (!playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 });

  const base =
    `https://statsapi.mlb.com/api/v1/people/${playerId}/stats` +
    `?stats=season&group=hitting&season=${year}`;

  // When the game's sportId is known, fetch only that level.
  // Otherwise fall back to fetching all levels and combining them.
  const sportIds = sportIdParam ? [parseInt(sportIdParam)] : [1, 11, 12, 13, 14, 16, 17];

  try {
    const results = await Promise.all(
      sportIds.map(sportId =>
        fetch(`${base}&sportId=${sportId}`, { next: { revalidate: 1800 } })
          .then(r => r.json())
          .then((d: { stats?: { splits?: { stat: Record<string, unknown> }[] }[] }) => ({
            sportId,
            stat: d.stats?.[0]?.splits?.[0]?.stat ?? null,
          }))
          .catch(() => ({ sportId, stat: null as null }))
      )
    );

    const withData = results.filter(r => r.stat !== null);
    if (withData.length === 0) return NextResponse.json({});

    // Single level — return directly
    if (withData.length === 1) {
      const s = withData[0].stat!;
      return NextResponse.json({
        avg: s.avg, obp: s.obp, slg: s.slg, ops: s.ops,
        hr: s.homeRuns, rbi: s.rbi, bb: s.baseOnBalls, k: s.strikeOuts,
        g: s.gamesPlayed, pa: s.plateAppearances, sb: s.stolenBases,
        hits: s.hits, ab: s.atBats, doubles: s.doubles, triples: s.triples,
        sportId: withData[0].sportId,
      });
    }

    // Multiple levels — sum counting stats, recompute rate stats
    let ab = 0, h = 0, hr = 0, rbi = 0, bb = 0, k = 0, g = 0;
    let pa = 0, sb = 0, doubles = 0, triples = 0, hbp = 0, sf = 0;

    for (const { stat: s } of withData) {
      ab      += Number(s!.atBats           ?? 0);
      h       += Number(s!.hits             ?? 0);
      hr      += Number(s!.homeRuns         ?? 0);
      rbi     += Number(s!.rbi              ?? 0);
      bb      += Number(s!.baseOnBalls      ?? 0);
      k       += Number(s!.strikeOuts       ?? 0);
      g       += Number(s!.gamesPlayed      ?? 0);
      pa      += Number(s!.plateAppearances ?? 0);
      sb      += Number(s!.stolenBases      ?? 0);
      doubles += Number(s!.doubles          ?? 0);
      triples += Number(s!.triples          ?? 0);
      hbp     += Number(s!.hitByPitch       ?? 0);
      sf      += Number(s!.sacFlies         ?? 0);
    }

    const singles = h - doubles - triples - hr;
    const tb = singles + 2 * doubles + 3 * triples + 4 * hr;
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const fmt = (n: number) => n.toFixed(3).replace(/^0\./, '.');

    const avg = ab > 0 ? r3(h / ab) : 0;
    const obpNum = ab + bb + hbp + sf;
    const obp = obpNum > 0 ? r3((h + bb + hbp) / obpNum) : 0;
    const slg = ab > 0 ? r3(tb / ab) : 0;
    const ops = r3(obp + slg);

    return NextResponse.json({
      avg: fmt(avg), obp: fmt(obp), slg: fmt(slg), ops: fmt(ops),
      hr, rbi, bb, k, g, pa, sb, hits: h, ab, doubles, triples,
      sportId: withData[0].sportId, // primary level (highest in hierarchy)
    });

  } catch (e) {
    console.warn('[season-stats]', e);
    return NextResponse.json({});
  }
}
