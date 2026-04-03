import { NextRequest, NextResponse } from 'next/server';

const MLB_API = 'https://statsapi.mlb.com/api/v1';

async function fetchJSON(url: string, noCache = false) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    ...(noCache ? { cache: 'no-store' } : { next: { revalidate: 300 } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const season   = searchParams.get('season') ?? new Date().getFullYear().toString();

  if (!playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 });

  try {
    // ── 1. Player bio ────────────────────────────────────────────────────────
    const personData = await fetchJSON(`${MLB_API}/people/${playerId}`).catch(() => null);
    const person = personData?.people?.[0];

    // ── 2. Season totals (try MLB → AAA → Low-A) ────────────────────────────
    const [mlbSeason, aaaSeason, lowASeason] = await Promise.all([
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=season&group=hitting&season=${season}&sportId=1`).catch(() => null),
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=season&group=hitting&season=${season}&sportId=11`).catch(() => null),
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=season&group=hitting&season=${season}&sportId=14`).catch(() => null),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pickSplit = (d: any) => d?.stats?.[0]?.splits?.[0];
    const seasonSplit = pickSplit(mlbSeason) ?? pickSplit(aaaSeason) ?? pickSplit(lowASeason);
    const seasonStat  = seasonSplit?.stat ?? null;
    const team: string | null = seasonSplit?.team?.abbreviation ?? seasonSplit?.team?.name ?? null;

    // ── 3. Game log (all levels) ─────────────────────────────────────────────
    const [mlbLog, aaaLog, lowALog] = await Promise.all([
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=gameLog&group=hitting&season=${season}&sportId=1`).catch(() => null),
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=gameLog&group=hitting&season=${season}&sportId=11`).catch(() => null),
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=gameLog&group=hitting&season=${season}&sportId=14`).catch(() => null),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allSplits: any[] = [
      ...(mlbLog?.stats?.[0]?.splits ?? []),
      ...(aaaLog?.stats?.[0]?.splits ?? []),
      ...(lowALog?.stats?.[0]?.splits ?? []),
    ];

    const games = allSplits.map(s => ({
      date:     s.date || s.game?.gameDate?.slice(0, 10) || '',
      opponent: s.opponent?.abbreviation ?? s.opponent?.name ?? '?',
      isHome:   s.isHome ?? false,
      ab:       Number(s.stat?.atBats       ?? 0),
      h:        Number(s.stat?.hits         ?? 0),
      hr:       Number(s.stat?.homeRuns     ?? 0),
      rbi:      Number(s.stat?.rbi          ?? 0),
      bb:       Number(s.stat?.baseOnBalls  ?? 0),
      k:        Number(s.stat?.strikeOuts   ?? 0),
      doubles:  Number(s.stat?.doubles      ?? 0),
      triples:  Number(s.stat?.triples      ?? 0),
      pa:       Number(s.stat?.plateAppearances ?? 0),
      sb:       Number(s.stat?.stolenBases  ?? 0),
      gamePk:   s.game?.gamePk ?? null,
    })).filter(g => g.date).sort((a, b) => b.date.localeCompare(a.date));

    // ── 4. Statcast season (MLB only) ────────────────────────────────────────
    let statcast: { avgEv: number|null; barrelPct: number|null; hardHitPct: number|null; avgBatSpeed: number|null } | null = null;
    try {
      const savantUrl = `https://baseballsavant.mlb.com/leaderboard/custom?year=${season}&type=batter&filter=&min=1&player_id=${playerId}&selections=exit_velocity_avg,barrel_batted_rate,hard_hit_percent,bat_speed&chart=false`;
      const savantJson = await fetchJSON(savantUrl, true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row: any = savantJson?.leaderboard?.[0];
      if (row) {
        statcast = {
          avgEv:       row.exit_velocity_avg   != null ? Math.round(Number(row.exit_velocity_avg)  * 10) / 10 : null,
          barrelPct:   row.barrel_batted_rate   != null ? Math.round(Number(row.barrel_batted_rate) * 10) / 10 : null,
          hardHitPct:  row.hard_hit_percent     != null ? Math.round(Number(row.hard_hit_percent)   * 10) / 10 : null,
          avgBatSpeed: row.bat_speed            != null ? Math.round(Number(row.bat_speed)          * 10) / 10 : null,
        };
      }
    } catch { /* non-fatal */ }

    // ── 5. Build totals ──────────────────────────────────────────────────────
    const ab  = Number(seasonStat?.atBats          ?? 0);
    const h   = Number(seasonStat?.hits            ?? 0);
    const bb  = Number(seasonStat?.baseOnBalls     ?? 0);
    const hbp = Number(seasonStat?.hitByPitch      ?? 0);
    const sf  = Number(seasonStat?.sacFlies        ?? 0);
    const pa  = Number(seasonStat?.plateAppearances ?? (ab + bb + hbp + sf));

    return NextResponse.json({
      playerId:      parseInt(playerId),
      playerName:    person?.fullName    ?? null,
      playerHeight:  person?.height      ?? null,
      playerWeight:  person?.weight      ?? null,
      playerBirthDate: person?.birthDate ?? null,
      playerBatSide: person?.batSide?.code  ?? null,
      playerPitchHand: person?.pitchHand?.code ?? null,
      season,
      team,
      totals: seasonStat ? {
        pa, ab, h,
        hr:      Number(seasonStat.homeRuns    ?? 0),
        rbi:     Number(seasonStat.rbi         ?? 0),
        bb,
        k:       Number(seasonStat.strikeOuts  ?? 0),
        doubles: Number(seasonStat.doubles     ?? 0),
        triples: Number(seasonStat.triples     ?? 0),
        sb:      Number(seasonStat.stolenBases ?? 0),
        avg:     seasonStat.avg ?? (ab > 0 ? (h / ab).toFixed(3) : '.000'),
        obp:     seasonStat.obp ?? null,
        slg:     seasonStat.slg ?? null,
        ops:     seasonStat.ops ?? null,
      } : null,
      games,
      statcast,
    });

  } catch (err) {
    console.error('player-season error:', err);
    return NextResponse.json({ error: 'Failed to fetch season data' }, { status: 500 });
  }
}
