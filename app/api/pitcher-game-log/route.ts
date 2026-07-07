import { NextRequest, NextResponse } from 'next/server';

const MLB_API = 'https://statsapi.mlb.com/api/v1';

const SPORT_LEVEL: Record<number, string> = {
  1: 'MLB', 11: 'AAA', 12: 'AA', 13: 'High-A', 14: 'Low-A',
  22: 'CBB', 23: 'CBB',
};

// All sport IDs we want to search players across
const ALL_SPORT_IDS = [1, 11, 12, 13, 14, 22, 23];

async function fetchJSON(url: string, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

interface PersonResult {
  id: number;
  fullName: string;
  team: string | null;
  teamAbbr: string | null;
  position: string | null;
}

// Search via /sports/{sportId}/players — reliable for CBB/MiLB prospects
// who don't appear in the general people/search endpoint.
async function searchSportsPlayers(query: string, sportIds: number[], season: number): Promise<PersonResult[]> {
  const lowerQ = query.toLowerCase();
  const seen = new Set<number>();
  const results: PersonResult[] = [];

  await Promise.allSettled(
    sportIds.map(async (sportId) => {
      try {
        const data = await fetchJSON(
          `${MLB_API}/sports/${sportId}/players?season=${season}&fields=people,id,fullName,primaryPosition,currentTeam`,
          8_000
        );
        for (const p of (data.people ?? []) as Record<string, unknown>[]) {
          const fullName = p.fullName as string | undefined;
          if (!fullName || !fullName.toLowerCase().includes(lowerQ)) continue;
          const id = p.id as number;
          if (seen.has(id)) continue;
          seen.add(id);
          const ct = p.currentTeam as Record<string, unknown> | undefined;
          const pos = p.primaryPosition as Record<string, unknown> | undefined;
          results.push({
            id,
            fullName,
            team: (ct?.name as string) ?? null,
            teamAbbr: (ct?.abbreviation as string) ?? null,
            position: (pos?.abbreviation as string) ?? null,
          });
        }
      } catch { /* sport/season combo might have no data */ }
    })
  );

  return results;
}

// GET /api/pitcher-game-log?name=Taylor+Rabe
//   → returns { people: [{id, fullName, team, position}] }
//
// GET /api/pitcher-game-log?playerId=123456&season=2026
// GET /api/pitcher-game-log?playerId=123456&season=all
//   → returns { playerName, outings: [...] }

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name');
  const playerId = searchParams.get('playerId');
  const seasonParam = searchParams.get('season') ?? 'all';

  // ── Name search ───────────────────────────────────────────────────────────
  if (name && !playerId) {
    const currentYear = new Date().getFullYear();
    let people: PersonResult[] = [];

    // 1. Try the general people/search endpoint (works for MLB/MiLB players)
    try {
      const data = await fetchJSON(
        `${MLB_API}/people/search?names=${encodeURIComponent(name)}`,
        5_000
      );
      people = (data.people ?? []).map((p: Record<string, unknown>) => {
        const ct = p.currentTeam as Record<string, unknown> | undefined;
        const pos = p.primaryPosition as Record<string, unknown> | undefined;
        return {
          id: p.id as number,
          fullName: p.fullName as string,
          team: (ct?.name as string) ?? null,
          teamAbbr: (ct?.abbreviation as string) ?? null,
          position: (pos?.abbreviation as string) ?? null,
        };
      });
    } catch { /* fall through */ }

    // 2. Fallback: search within each sport's player list (catches CBB prospects
    //    and anyone not indexed in people/search)
    if (people.length === 0) {
      const existingIds = new Set(people.map(p => p.id));
      for (const yr of [currentYear, currentYear - 1]) {
        const extra = await searchSportsPlayers(name, ALL_SPORT_IDS, yr);
        for (const p of extra) {
          if (!existingIds.has(p.id)) { people.push(p); existingIds.add(p.id); }
        }
        if (people.length > 0) break;
      }
    }

    return NextResponse.json({ people });
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

  const currentYear = new Date().getFullYear();
  const seasons =
    seasonParam === 'all'
      ? [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4]
      : [parseInt(seasonParam)];

  type Outing = {
    date: string; opponent: string; team: string | null; ip: string;
    h: number; er: number; bb: number; k: number; hr: number;
    pitches: number; bf: number; level: string; season: number;
    gamePk?: number; isHome?: boolean | null;
  };

  const outings: Outing[] = [];
  const seenPks = new Set<number>();

  await Promise.allSettled(
    seasons.flatMap(season =>
      ALL_SPORT_IDS.map(async (sportId) => {
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
              season,
              gamePk: pk,
              isHome: (s.isHome as boolean) ?? null,
            });
          }
        } catch { /* skip */ }
      })
    )
  );

  outings.sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ playerName, outings });
}
