import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/daily-pitchers?date=2025-04-15
 *
 * Returns all pitchers who appeared in MLB games on a given date,
 * with their game line (IP, H, ER, BB, K, HR, pitches) and player info.
 *
 * Uses MLB Stats API schedule endpoint with hydrate=boxscore to get
 * pitcher IDs, then fetches each pitcher's game log for the stat line.
 */

const MLB_API = 'https://statsapi.mlb.com/api/v1';

async function fetchJSON(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');

  // Default to yesterday
  const targetDate = dateParam || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  // Derive season from date
  const season = parseInt(targetDate.slice(0, 4));

  try {
    // ── 1. Fetch schedule (no boxscore hydration — it omits pitchers for ST games)
    const scheduleUrl = `${MLB_API}/schedule?startDate=${targetDate}&endDate=${targetDate}&sportId=1`;
    const scheduleData = await fetchJSON(scheduleUrl);

    const dates = scheduleData?.dates ?? [];
    if (dates.length === 0) {
      return NextResponse.json({ date: targetDate, games: [], pitchers: [] });
    }

    const games: {
      gamePk: number;
      homeTeam: string;
      awayTeam: string;
      homeScore: number;
      awayScore: number;
      status: string;
    }[] = [];

    // Map: playerId → { name, teamAbbr, gamePk, isHome, opponentAbbr }
    const pitcherMeta: Record<number, {
      name: string;
      teamAbbr: string;
      opponentAbbr: string;
      gamePk: number;
      isHome: boolean;
    }> = {};

    const allPitcherIds: number[] = [];

    // Collect basic game info first
    const gamePks: { gamePk: number; homeAbbr: string; awayAbbr: string; homeScore: number; awayScore: number; status: string }[] = [];

    for (const dateObj of dates) {
      for (const game of (dateObj.games ?? [])) {
        const gamePk: number = game.gamePk;
        const status: string = game.status?.detailedState ?? game.status?.abstractGameState ?? 'Unknown';
        const homeTeam = game.teams?.home;
        const awayTeam = game.teams?.away;
        const homeAbbr: string = homeTeam?.team?.abbreviation ?? homeTeam?.team?.name ?? '?';
        const awayAbbr: string = awayTeam?.team?.abbreviation ?? awayTeam?.team?.name ?? '?';
        const homeScore: number = homeTeam?.score ?? 0;
        const awayScore: number = awayTeam?.score ?? 0;
        games.push({ gamePk, homeTeam: homeAbbr, awayTeam: awayAbbr, homeScore, awayScore, status });
        gamePks.push({ gamePk, homeAbbr, awayAbbr, homeScore, awayScore, status });
      }
    }

    // ── 2. Fetch each game's live feed to get pitcher IDs (schedule hydrate misses ST games)
    await Promise.all(gamePks.map(async ({ gamePk, homeAbbr, awayAbbr }) => {
      try {
        const feedUrl = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
        const feed = await fetchJSON(feedUrl);
        const homeBox = feed?.liveData?.boxscore?.teams?.home;
        const awayBox = feed?.liveData?.boxscore?.teams?.away;

        const homePitchers: number[] = homeBox?.pitchers ?? [];
        const awayPitchers: number[] = awayBox?.pitchers ?? [];
        const playersMap = homeBox?.players ?? {};
        const awayPlayersMap = awayBox?.players ?? {};

        for (const pid of homePitchers) {
          if (!pid || allPitcherIds.includes(pid)) continue;
          allPitcherIds.push(pid);
          const playerData = playersMap[`ID${pid}`];
          pitcherMeta[pid] = {
            name: playerData?.person?.fullName ?? `Player ${pid}`,
            teamAbbr: homeAbbr,
            opponentAbbr: awayAbbr,
            gamePk,
            isHome: true,
          };
        }

        for (const pid of awayPitchers) {
          if (!pid || allPitcherIds.includes(pid)) continue;
          allPitcherIds.push(pid);
          const playerData = awayPlayersMap[`ID${pid}`];
          pitcherMeta[pid] = {
            name: playerData?.person?.fullName ?? `Player ${pid}`,
            teamAbbr: awayAbbr,
            opponentAbbr: homeAbbr,
            gamePk,
            isHome: false,
          };
        }
      } catch {
        // Non-fatal — skip games we can't fetch
      }
    }));

    if (allPitcherIds.length === 0) {
      return NextResponse.json({ date: targetDate, games, pitchers: [] });
    }

    // ── 2. Batch-fetch game logs for all pitchers ─────────────────────────────
    // MLB Stats API supports comma-separated player IDs
    // Fetch in batches of 50 to stay within URL length limits
    const BATCH = 50;
    const gameLogs: Record<number, {
      ip: string; h: number; er: number; bb: number;
      k: number; hr: number; pitches: number; bf: number;
    }> = {};

    for (let i = 0; i < allPitcherIds.length; i += BATCH) {
      const batch = allPitcherIds.slice(i, i + BATCH);

      // Fetch individually — MLB Stats API doesn't support batch game logs in one call
      await Promise.all(batch.map(async (pid) => {
        try {
          const url = `${MLB_API}/people/${pid}/stats?stats=gameLog&group=pitching&season=${season}&sportId=1`;
          const data = await fetchJSON(url);
          const splits = data?.stats?.[0]?.splits ?? [];

          // Find the split matching our target date
          const split = splits.find((s: { date?: string; game?: { gameDate?: string } }) => {
            const d = s.date || s.game?.gameDate?.slice(0, 10) || '';
            return d === targetDate || d.startsWith(targetDate);
          });

          if (split) {
            const stat = split.stat;
            gameLogs[pid] = {
              ip: stat.inningsPitched ?? '0',
              h: stat.hits ?? 0,
              er: stat.earnedRuns ?? 0,
              bb: stat.baseOnBalls ?? 0,
              k: stat.strikeOuts ?? 0,
              hr: stat.homeRuns ?? 0,
              pitches: stat.numberOfPitches ?? 0,
              bf: stat.battersFaced ?? 0,
            };
          }
        } catch {
          // Non-fatal — pitcher just won't have a stat line
        }
      }));
    }

    // ── 3. Build response ─────────────────────────────────────────────────────
    const pitchers = allPitcherIds.map(pid => {
      const meta = pitcherMeta[pid];
      const line = gameLogs[pid] ?? null;
      return {
        playerId: pid,
        name: meta.name,
        team: meta.teamAbbr,
        opponent: meta.opponentAbbr,
        isHome: meta.isHome,
        gamePk: meta.gamePk,
        line,
      };
    }).sort((a, b) => {
      // Sort starters (more IP) first, then relievers
      const ipA = parseIp(a.line?.ip ?? '0');
      const ipB = parseIp(b.line?.ip ?? '0');
      return ipB - ipA;
    });

    return NextResponse.json({ date: targetDate, games, pitchers });

  } catch (err) {
    console.error('daily-pitchers route error:', err);
    return NextResponse.json({ error: 'Failed to fetch daily pitcher data' }, { status: 500 });
  }
}

function parseIp(ip: string): number {
  if (!ip) return 0;
  const parts = ip.split('.');
  const full = parseInt(parts[0]) || 0;
  const outs = parseInt(parts[1]) || 0;
  return full + outs / 3;
}
