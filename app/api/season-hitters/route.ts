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
  const leagueParam = searchParams.get('league') ?? 'mlb';
  const season = searchParams.get('season') ?? new Date().getFullYear().toString();

  const sportId = leagueParam === 'aaa' ? '11' : leagueParam === 'low-a' ? '14' : '1';
  const isMLB = leagueParam === 'mlb';

  try {
    // ── 1. Fetch season hitting stats from MLB Stats API
    const statsUrl = `${MLB_API}/stats?stats=season&group=hitting&season=${season}&sportId=${sportId}&limit=2000`;
    const data = await fetchJSON(statsUrl);
    const splits = (data?.stats?.[0]?.splits ?? []) as Array<Record<string, unknown>>;

    // ── 2. For MLB: fetch Statcast season leaderboard from Baseball Savant
    const statcastMap: Record<number, {
      avgEv: number | null;
      barrelPct: number | null;
      hardHitPct: number | null;
      avgBatSpeed: number | null;
    }> = {};

    if (isMLB) {
      try {
        const savantUrl = `https://baseballsavant.mlb.com/leaderboard/custom?year=${season}&type=batter&filter=&min=1&selections=exit_velocity_avg,barrel_batted_rate,hard_hit_percent,bat_speed&chart=false`;
        const savantData = await fetchJSON(savantUrl, true);
        const leaderboard = (savantData?.leaderboard ?? []) as Array<Record<string, unknown>>;
        for (const row of leaderboard) {
          const pid = Number(row.player_id ?? NaN);
          if (isNaN(pid)) continue;
          statcastMap[pid] = {
            avgEv:        row.exit_velocity_avg   != null ? Math.round(Number(row.exit_velocity_avg)   * 10) / 10 : null,
            barrelPct:    row.barrel_batted_rate   != null ? Math.round(Number(row.barrel_batted_rate)  * 10) / 10 : null,
            hardHitPct:   row.hard_hit_percent     != null ? Math.round(Number(row.hard_hit_percent)    * 10) / 10 : null,
            avgBatSpeed:  row.bat_speed            != null ? Math.round(Number(row.bat_speed)           * 10) / 10 : null,
          };
        }
      } catch {
        // Statcast is non-fatal — continue without it
      }
    }

    // ── 3. Build response
    const hitters = splits.map((split) => {
      const player = split.player as Record<string, unknown>;
      const team   = split.team   as Record<string, unknown> | undefined;
      const stat   = split.stat   as Record<string, unknown>;

      const playerId = Number(player?.id ?? 0);
      const ab  = Number(stat.atBats          ?? 0);
      const h   = Number(stat.hits            ?? 0);
      const bb  = Number(stat.baseOnBalls     ?? 0);
      const hbp = Number(stat.hitByPitch      ?? 0);
      const sf  = Number(stat.sacFlies        ?? 0);
      const sh  = Number(stat.sacBunts        ?? 0);
      const pa  = Number(stat.plateAppearances ?? (ab + bb + hbp + sf + sh));
      const sc  = statcastMap[playerId];

      return {
        playerId,
        name:        String(player?.fullName ?? `Player ${playerId}`),
        team:        String(team?.abbreviation ?? team?.name ?? '?'),
        pa,
        ab,
        h,
        avg:         stat.avg  != null ? String(stat.avg)  : ab > 0 ? (h / ab).toFixed(3) : '.000',
        hr:          Number(stat.homeRuns    ?? 0),
        rbi:         Number(stat.rbi         ?? 0),
        bb,
        k:           Number(stat.strikeOuts  ?? 0),
        doubles:     Number(stat.doubles     ?? 0),
        triples:     Number(stat.triples     ?? 0),
        sb:          Number(stat.stolenBases ?? 0),
        obp:         stat.obp != null ? String(stat.obp) : null,
        slg:         stat.slg != null ? String(stat.slg) : null,
        ops:         stat.ops != null ? String(stat.ops) : null,
        avgEv:       sc?.avgEv       ?? null,
        barrelPct:   sc?.barrelPct   ?? null,
        hardHitPct:  sc?.hardHitPct  ?? null,
        avgBatSpeed: sc?.avgBatSpeed ?? null,
      };
    }).filter(h => h.pa >= 1);

    return NextResponse.json({ season, hitters });

  } catch (err) {
    console.error('season-hitters route error:', err);
    return NextResponse.json({ error: 'Failed to fetch season hitter data' }, { status: 500 });
  }
}
