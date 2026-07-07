import { NextRequest, NextResponse } from 'next/server';

const MLB_API = 'https://statsapi.mlb.com/api/v1';

const SPORT_LEVEL: Record<number, string> = {
  1: 'MLB', 11: 'AAA', 12: 'AA', 13: 'High-A', 14: 'Low-A',
  22: 'CBB', 23: 'CBB',
};

async function fetchJSON(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// GET /api/pitcher-game-log?name=Taylor+Rabe
//   → returns { people: [{id, fullName, team, position}] }
//
// GET /api/pitcher-game-log?playerId=123456&season=2026
//   → returns { playerName, outings: [{date, opponent, team, ip, h, er, bb, k, hr, pitches, bf, level}] }

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name');
  const playerId = searchParams.get('playerId');
  const seasonParam = searchParams.get('season');
  const season = seasonParam ? parseInt(seasonParam) : new Date().getFullYear();

  // ── Name search ───────────────────────────────────────────────────────────
  if (name && !playerId) {
    try {
      const data = await fetchJSON(
        `${MLB_API}/people/search?names=${encodeURIComponent(name)}&season=${season}`
      );
      const people = (data.people ?? []).map((p: Record<string, unknown>) => {
        const currentTeam = p.currentTeam as Record<string, unknown> | undefined;
        const primaryPosition = p.primaryPosition as Record<string, unknown> | undefined;
        return {
          id: p.id,
          fullName: p.fullName,
          team: currentTeam?.name ?? null,
          teamAbbr: currentTeam?.abbreviation ?? null,
          position: primaryPosition?.abbreviation ?? null,
        };
      });
      return NextResponse.json({ people });
    } catch {
      return NextResponse.json({ people: [] });
    }
  }

  // ── Game log for a specific player ───────────────────────────────────────
  if (!playerId) {
    return NextResponse.json({ error: 'name or playerId required' }, { status: 400 });
  }

  let playerName: string | null = null;
  try {
    const bio = await fetchJSON(`${MLB_API}/people/${playerId}`);
    playerName = bio?.people?.[0]?.fullName ?? null;
  } catch { /* non-fatal */ }

  const SPORT_IDS = [1, 11, 12, 13, 14, 22, 23];

  type Outing = {
    date: string; opponent: string; team: string | null; ip: string;
    h: number; er: number; bb: number; k: number; hr: number;
    pitches: number; bf: number; level: string; gamePk?: number; isHome?: boolean | null;
  };

  const outings: Outing[] = [];
  const seenPks = new Set<number>();

  await Promise.allSettled(
    SPORT_IDS.map(async (sportId) => {
      try {
        const data = await fetchJSON(
          `${MLB_API}/people/${playerId}/stats?stats=gameLog&group=pitching&season=${season}&sportId=${sportId}`
        );
        const splits: Record<string, unknown>[] = (data?.stats ?? []).flatMap(
          (s: Record<string, unknown>) => (s.splits as Record<string, unknown>[]) ?? []
        );
        for (const s of splits) {
          const game = s.game as Record<string, unknown> | undefined;
          const gType = game?.gameType as string | undefined;
          if (gType && gType !== 'R') continue;
          const pk = game?.gamePk as number | undefined;
          if (pk && seenPks.has(pk)) continue;
          if (pk) seenPks.add(pk);

          const stat = s.stat as Record<string, unknown> | undefined;
          const opponent = s.opponent as Record<string, unknown> | undefined;
          const team = s.team as Record<string, unknown> | undefined;

          outings.push({
            date: (s.date as string) || (game?.gameDate as string | undefined)?.slice(0, 10) || '',
            opponent: (opponent?.abbreviation as string) || (opponent?.name as string) || '?',
            team: (team?.abbreviation as string) || (team?.name as string) || null,
            ip: (stat?.inningsPitched as string) || '0',
            h: (stat?.hits as number) ?? 0,
            er: (stat?.earnedRuns as number) ?? 0,
            bb: (stat?.baseOnBalls as number) ?? 0,
            k: (stat?.strikeOuts as number) ?? 0,
            hr: (stat?.homeRuns as number) ?? 0,
            pitches: (stat?.numberOfPitches as number) ?? 0,
            bf: (stat?.battersFaced as number) ?? 0,
            level: SPORT_LEVEL[sportId] ?? 'Unknown',
            gamePk: pk,
            isHome: (s.isHome as boolean) ?? null,
          });
        }
      } catch { /* skip sport ID if no data */ }
    })
  );

  outings.sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ playerName, outings });
}
