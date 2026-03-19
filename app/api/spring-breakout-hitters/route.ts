import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/spring-breakout-hitters?date=2025-03-19
 *
 * Returns all batters who appeared in Spring Breakout (sportId=17) games on a given date,
 * with their game line (AB, H, HR, RBI, BB, K, 2B, 3B, SB) and Statcast exit velocity
 * from Baseball Savant's /gf live feed endpoint.
 */

const MLB_API = 'https://statsapi.mlb.com/api/v1';

async function fetchJSON(url: string, noCache = false) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    ...(noCache ? { cache: 'no-store' } : { next: { revalidate: 300 } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// Extract per-batter exit velocity from Savant /gf response
function extractBatterEvData(gf: Record<string, unknown>): Record<string, { avgEv: number; maxEv: number; hardHits: number; balls: number }> {
  const result: Record<string, { avgEv: number; maxEv: number; hardHits: number; balls: number }> = {};

  for (const side of ['home_batters', 'away_batters'] as const) {
    const sideData = gf[side] as Record<string, unknown[]> | undefined;
    if (!sideData) continue;
    for (const [bidStr, pitches] of Object.entries(sideData)) {
      const evs: number[] = [];
      for (const pitch of (pitches as Record<string, unknown>[])) {
        const ev = Number(pitch.hit_speed ?? pitch.launch_speed ?? 0);
        if (ev > 0) evs.push(ev);
      }
      if (evs.length > 0) {
        const avgEv = evs.reduce((a, b) => a + b, 0) / evs.length;
        const maxEv = Math.max(...evs);
        const hardHits = evs.filter(v => v >= 95).length;
        result[bidStr] = { avgEv: Math.round(avgEv * 10) / 10, maxEv: Math.round(maxEv * 10) / 10, hardHits, balls: evs.length };
      }
    }
  }
  return result;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');

  const targetDate = dateParam || new Date().toISOString().slice(0, 10);
  const isToday = targetDate === new Date().toISOString().slice(0, 10);
  const season = parseInt(targetDate.slice(0, 4));

  try {
    // ── 1. Fetch Spring Breakout schedule (sportId=21 = Minor League Baseball)
    // Spring Breakout games are Exhibition games (gameType=E) filed under MiLB (sportId=21)
    // with description "Spring Breakout" and prospect team names
    const scheduleUrl = `${MLB_API}/schedule?startDate=${targetDate}&endDate=${targetDate}&sportId=21`;
    const scheduleData = await fetchJSON(scheduleUrl, isToday);

    const dates = scheduleData?.dates ?? [];
    if (dates.length === 0) {
      return NextResponse.json({ date: targetDate, games: [], hitters: [] });
    }

    const games: {
      gamePk: number;
      homeTeam: string;
      awayTeam: string;
      homeScore: number;
      awayScore: number;
      status: string;
      sportId: number;
      seriesDescription?: string;
    }[] = [];

    const hitterMeta: Record<number, {
      name: string;
      teamAbbr: string;
      opponentAbbr: string;
      gamePk: number;
      isHome: boolean;
    }> = {};

    const feedStats: Record<number, {
      ab: number; h: number; hr: number; rbi: number;
      bb: number; k: number; doubles: number; triples: number; sb: number;
    }> = {};

    const allHitterIds: number[] = [];
    const gamePks: { gamePk: number; homeAbbr: string; awayAbbr: string; seriesDescription?: string }[] = [];

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
        const sportId: number = homeTeam?.team?.sport?.id ?? awayTeam?.team?.sport?.id ?? 17;
        const seriesDescription: string = game.seriesDescription ?? game.description ?? '';

        // Only include Spring Breakout games (description contains "Spring Breakout" or team names include "Prospects")
        const isSpringBreakout =
          (game.description || '').toLowerCase().includes('spring breakout') ||
          (game.seriesDescription || '').toLowerCase().includes('spring breakout') ||
          (homeTeam?.team?.name || '').toLowerCase().includes('prospect') ||
          (awayTeam?.team?.name || '').toLowerCase().includes('prospect');

        if (!isSpringBreakout) continue;

        games.push({ gamePk, homeTeam: homeAbbr, awayTeam: awayAbbr, homeScore, awayScore, status, sportId, seriesDescription });
        gamePks.push({ gamePk, homeAbbr, awayAbbr, seriesDescription });
      }
    }

    // ── 2. Fetch each game's live feed to get batter IDs + stats
    await Promise.all(gamePks.map(async ({ gamePk, homeAbbr, awayAbbr }) => {
      try {
        const feedUrl = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
        const feed = await fetchJSON(feedUrl, isToday);
        const homeBox = feed?.liveData?.boxscore?.teams?.home;
        const awayBox = feed?.liveData?.boxscore?.teams?.away;

        const homeBatters: number[] = homeBox?.batters ?? [];
        const awayBatters: number[] = awayBox?.batters ?? [];
        const playersMap = homeBox?.players ?? {};
        const awayPlayersMap = awayBox?.players ?? {};

        const extractBattingStats = (playerData: Record<string, unknown> | undefined) => {
          const bStats = (playerData?.gameStats as Record<string, Record<string, unknown>>)?.batting
            ?? (playerData?.stats as Record<string, Record<string, unknown>>)?.batting;
          if (!bStats) return null;
          const ab = Number(bStats.atBats ?? 0);
          const bb = Number(bStats.baseOnBalls ?? 0);
          const hbp = Number(bStats.hitByPitch ?? 0);
          const sf = Number(bStats.sacFlies ?? 0);
          const sh = Number(bStats.sacBunts ?? 0);
          const pa = ab + bb + hbp + sf + sh;
          if (pa === 0) return null;
          return {
            ab,
            h: Number(bStats.hits ?? 0),
            hr: Number(bStats.homeRuns ?? 0),
            rbi: Number(bStats.rbi ?? 0),
            bb,
            k: Number(bStats.strikeOuts ?? 0),
            doubles: Number(bStats.doubles ?? 0),
            triples: Number(bStats.triples ?? 0),
            sb: Number(bStats.stolenBases ?? 0),
          };
        };

        for (const pid of homeBatters) {
          if (!pid || allHitterIds.includes(pid)) continue;
          const playerData = playersMap[`ID${pid}`];
          const stats = extractBattingStats(playerData as Record<string, unknown>);
          if (!stats) continue;
          allHitterIds.push(pid);
          hitterMeta[pid] = {
            name: (playerData as { person?: { fullName?: string } })?.person?.fullName ?? `Player ${pid}`,
            teamAbbr: homeAbbr,
            opponentAbbr: awayAbbr,
            gamePk,
            isHome: true,
          };
          feedStats[pid] = stats;
        }

        for (const pid of awayBatters) {
          if (!pid || allHitterIds.includes(pid)) continue;
          const playerData = awayPlayersMap[`ID${pid}`];
          const stats = extractBattingStats(playerData as Record<string, unknown>);
          if (!stats) continue;
          allHitterIds.push(pid);
          hitterMeta[pid] = {
            name: (playerData as { person?: { fullName?: string } })?.person?.fullName ?? `Player ${pid}`,
            teamAbbr: awayAbbr,
            opponentAbbr: homeAbbr,
            gamePk,
            isHome: false,
          };
          feedStats[pid] = stats;
        }
      } catch {
        // Non-fatal
      }
    }));

    if (allHitterIds.length === 0) {
      return NextResponse.json({ date: targetDate, games, hitters: [] });
    }

    // ── 3. Fetch Savant /gf for exit velocity data per batter
    const evByBid: Record<number, { avgEv: number; maxEv: number; hardHits: number; balls: number }> = {};
    const uniqueGamePks = [...new Set(allHitterIds.map(pid => hitterMeta[pid]?.gamePk).filter(Boolean))];
    await Promise.all(uniqueGamePks.map(async (gamePk) => {
      try {
        const gfUrl = `https://baseballsavant.mlb.com/gf?game_pk=${gamePk}`;
        const gf = await fetchJSON(gfUrl, isToday);
        const evData = extractBatterEvData(gf as Record<string, unknown>);
        for (const [bidStr, ev] of Object.entries(evData)) {
          evByBid[parseInt(bidStr)] = ev;
        }
      } catch { /* non-fatal */ }
    }));

    // ── 4. For past dates: batch-fetch game logs for missing stats
    const gameLogs: Record<number, {
      ab: number; h: number; hr: number; rbi: number;
      bb: number; k: number; doubles: number; triples: number; sb: number;
    }> = {};

    if (!isToday) {
      const missingPids = allHitterIds.filter(pid => !feedStats[pid]);
      const BATCH = 50;
      for (let i = 0; i < missingPids.length; i += BATCH) {
        const batch = missingPids.slice(i, i + BATCH);
        await Promise.all(batch.map(async (pid) => {
          try {
            const findSplit = (splits: { date?: string; game?: { gameDate?: string }; stat?: Record<string, unknown> }[]) =>
              splits.find(s => {
                const d = s.date || s.game?.gameDate?.slice(0, 10) || '';
                return d === targetDate || d.startsWith(targetDate);
              });

            for (const sportId of [17, 1]) {
              const url = `${MLB_API}/people/${pid}/stats?stats=gameLog&group=hitting&season=${season}&sportId=${sportId}`;
              const data = await fetchJSON(url);
              const splits = data?.stats?.[0]?.splits ?? [];
              const split = findSplit(splits);
              if (split) {
                const stat = split.stat ?? {};
                gameLogs[pid] = {
                  ab: Number(stat.atBats ?? 0),
                  h: Number(stat.hits ?? 0),
                  hr: Number(stat.homeRuns ?? 0),
                  rbi: Number(stat.rbi ?? 0),
                  bb: Number(stat.baseOnBalls ?? 0),
                  k: Number(stat.strikeOuts ?? 0),
                  doubles: Number(stat.doubles ?? 0),
                  triples: Number(stat.triples ?? 0),
                  sb: Number(stat.stolenBases ?? 0),
                };
                break;
              }
            }
          } catch { /* non-fatal */ }
        }));
      }
    }

    // ── 5. Build response
    const hitters = allHitterIds.map(pid => {
      const meta = hitterMeta[pid];
      const line = feedStats[pid] ?? gameLogs[pid] ?? null;
      const ev = evByBid[pid] ?? null;
      return {
        playerId: pid,
        name: meta.name,
        team: meta.teamAbbr,
        opponent: meta.opponentAbbr,
        isHome: meta.isHome,
        gamePk: meta.gamePk,
        line,
        ev,
      };
    }).filter(h => h.line !== null)
      .sort((a, b) => {
        const hDiff = (b.line?.h ?? 0) - (a.line?.h ?? 0);
        if (hDiff !== 0) return hDiff;
        return (b.line?.hr ?? 0) - (a.line?.hr ?? 0);
      });

    return NextResponse.json({ date: targetDate, games, hitters });

  } catch (err) {
    console.error('spring-breakout-hitters route error:', err);
    return NextResponse.json({ error: 'Failed to fetch Spring Breakout hitter data' }, { status: 500 });
  }
}
