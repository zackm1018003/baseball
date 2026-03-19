import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/spring-breakout-pitchers?date=2025-03-19
 *
 * Returns all pitchers who appeared in Spring Breakout (sportId=17) games on a given date,
 * with their game line (IP, H, ER, BB, K, HR, pitches) plus whiff count and max velocity
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

function parseIp(ip: string): number {
  if (!ip) return 0;
  const parts = ip.split('.');
  return (parseInt(parts[0]) || 0) + (parseInt(parts[1]) || 0) / 3;
}

function extractGfData(gf: Record<string, unknown>): {
  whiffs: Record<string, number>;
  velocity: Record<string, number>;
} {
  const whiffs: Record<string, number> = {};
  const velocity: Record<string, number> = {};

  for (const side of ['home_pitchers', 'away_pitchers'] as const) {
    const sideData = gf[side] as Record<string, unknown[]> | undefined;
    if (!sideData) continue;
    for (const [pidStr, pitches] of Object.entries(sideData)) {
      let whiffCount = 0;
      const allSpeeds: number[] = [];

      for (const pitch of (pitches as Record<string, unknown>[])) {
        const desc = String(pitch.description ?? pitch.call_name ?? '').toLowerCase();
        if (desc.includes('swinging strike')) whiffCount++;
        const speed = Number(pitch.start_speed ?? pitch.pitch_speed ?? 0);
        if (speed > 40) allSpeeds.push(speed);
      }

      whiffs[pidStr] = whiffCount;
      if (allSpeeds.length > 0) {
        velocity[pidStr] = Math.max(...allSpeeds);
      }
    }
  }
  return { whiffs, velocity };
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
    const scheduleUrl = `${MLB_API}/schedule?startDate=${targetDate}&endDate=${targetDate}&sportId=21`;
    const scheduleData = await fetchJSON(scheduleUrl, isToday);

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
      sportId: number;
      seriesDescription?: string;
    }[] = [];

    const pitcherMeta: Record<number, {
      name: string;
      teamAbbr: string;
      opponentAbbr: string;
      gamePk: number;
      isHome: boolean;
    }> = {};

    const feedStats: Record<number, {
      ip: string; h: number; er: number; bb: number;
      k: number; hr: number; pitches: number; bf: number;
    }> = {};

    const allPitcherIds: number[] = [];
    const gamePks: { gamePk: number; homeAbbr: string; awayAbbr: string }[] = [];

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
        // Only include Spring Breakout games
        const isSpringBreakout =
          (game.description || '').toLowerCase().includes('spring breakout') ||
          (game.seriesDescription || '').toLowerCase().includes('spring breakout') ||
          (homeTeam?.team?.name || '').toLowerCase().includes('prospect') ||
          (awayTeam?.team?.name || '').toLowerCase().includes('prospect');

        if (!isSpringBreakout) continue;

        games.push({ gamePk, homeTeam: homeAbbr, awayTeam: awayAbbr, homeScore, awayScore, status, sportId, seriesDescription });
        gamePks.push({ gamePk, homeAbbr, awayAbbr });
      }
    }

    // Whiffs + velocity from live play-by-play (fallback when /gf not available)
    const liveWhiffsByPid: Record<number, number> = {};
    const liveSpeedsByPid: Record<number, number[]> = {};

    // ── 2. Fetch each game's live feed to get pitcher IDs + stats
    await Promise.all(gamePks.map(async ({ gamePk, homeAbbr, awayAbbr }) => {
      try {
        const feedUrl = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
        const feed = await fetchJSON(feedUrl, isToday);
        const homeBox = feed?.liveData?.boxscore?.teams?.home;
        const awayBox = feed?.liveData?.boxscore?.teams?.away;

        const homePitchers: number[] = homeBox?.pitchers ?? [];
        const awayPitchers: number[] = awayBox?.pitchers ?? [];
        const playersMap = homeBox?.players ?? {};
        const awayPlayersMap = awayBox?.players ?? {};

        const extractStats = (playerData: Record<string, unknown> | undefined) => {
          const pStats = (playerData?.gameStats as Record<string, Record<string, unknown>>)?.pitching
            ?? (playerData?.stats as Record<string, Record<string, unknown>>)?.pitching;
          if (!pStats) return null;
          return {
            ip: String(pStats.inningsPitched ?? '0'),
            h: Number(pStats.hits ?? 0),
            er: Number(pStats.earnedRuns ?? 0),
            bb: Number(pStats.baseOnBalls ?? 0),
            k: Number(pStats.strikeOuts ?? 0),
            hr: Number(pStats.homeRuns ?? 0),
            pitches: Number(pStats.numberOfPitches ?? 0),
            bf: Number(pStats.battersFaced ?? 0),
          };
        };

        for (const pid of homePitchers) {
          if (!pid || allPitcherIds.includes(pid)) continue;
          allPitcherIds.push(pid);
          const playerData = playersMap[`ID${pid}`];
          pitcherMeta[pid] = {
            name: (playerData as { person?: { fullName?: string } })?.person?.fullName ?? `Player ${pid}`,
            teamAbbr: homeAbbr,
            opponentAbbr: awayAbbr,
            gamePk,
            isHome: true,
          };
          const stats = extractStats(playerData as Record<string, unknown>);
          if (stats && stats.bf > 0) feedStats[pid] = stats;
        }

        for (const pid of awayPitchers) {
          if (!pid || allPitcherIds.includes(pid)) continue;
          allPitcherIds.push(pid);
          const playerData = awayPlayersMap[`ID${pid}`];
          pitcherMeta[pid] = {
            name: (playerData as { person?: { fullName?: string } })?.person?.fullName ?? `Player ${pid}`,
            teamAbbr: awayAbbr,
            opponentAbbr: homeAbbr,
            gamePk,
            isHome: false,
          };
          const statsAway = extractStats(playerData as Record<string, unknown>);
          if (statsAway && statsAway.bf > 0) feedStats[pid] = statsAway;
        }

        // Extract whiffs + velocity from play-by-play (fallback)
        type PlayEvent = { type?: string; details?: { description?: string }; pitchData?: { startSpeed?: number } };
        type Play = { matchup?: { pitcher?: { id?: number } }; playEvents?: PlayEvent[] };
        const allPlays: Play[] = feed?.liveData?.plays?.allPlays ?? [];
        for (const play of allPlays) {
          const pitcherId = play?.matchup?.pitcher?.id;
          if (!pitcherId) continue;
          for (const event of (play?.playEvents ?? [])) {
            if (event?.type !== 'pitch') continue;
            const desc = String(event?.details?.description ?? '').toLowerCase();
            if (desc.includes('swinging strike')) {
              liveWhiffsByPid[pitcherId] = (liveWhiffsByPid[pitcherId] ?? 0) + 1;
            }
            const speed = Number(event?.pitchData?.startSpeed ?? 0);
            if (speed > 40) {
              if (!liveSpeedsByPid[pitcherId]) liveSpeedsByPid[pitcherId] = [];
              liveSpeedsByPid[pitcherId].push(speed);
            }
          }
        }
      } catch { /* non-fatal */ }
    }));

    if (allPitcherIds.length === 0) {
      return NextResponse.json({ date: targetDate, games, pitchers: [] });
    }

    // ── 3. Fetch Savant /gf for whiff counts + velocity
    const whiffsByPid: Record<number, number> = {};
    const velocityByPid: Record<number, number> = {};
    const uniqueGamePks = [...new Set(allPitcherIds.map(pid => pitcherMeta[pid]?.gamePk).filter(Boolean))];
    await Promise.all(uniqueGamePks.map(async (gamePk) => {
      try {
        const gfUrl = `https://baseballsavant.mlb.com/gf?game_pk=${gamePk}`;
        const gf = await fetchJSON(gfUrl, isToday);
        const { whiffs, velocity } = extractGfData(gf as Record<string, unknown>);
        for (const [pidStr, count] of Object.entries(whiffs)) {
          whiffsByPid[parseInt(pidStr)] = count;
        }
        for (const [pidStr, velo] of Object.entries(velocity)) {
          velocityByPid[parseInt(pidStr)] = velo;
        }
      } catch { /* non-fatal */ }
    }));

    // ── 4. For past dates: batch-fetch game logs for pitchers missing stats
    const gameLogs: Record<number, {
      ip: string; h: number; er: number; bb: number;
      k: number; hr: number; pitches: number; bf: number;
    }> = {};

    if (!isToday) {
      const missingPids = allPitcherIds.filter(pid => !feedStats[pid]);
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
              const url = `${MLB_API}/people/${pid}/stats?stats=gameLog&group=pitching&season=${season}&sportId=${sportId}`;
              const data = await fetchJSON(url);
              const splits = data?.stats?.[0]?.splits ?? [];
              const split = findSplit(splits);
              if (split) {
                const stat = split.stat ?? {};
                gameLogs[pid] = {
                  ip: String(stat.inningsPitched ?? '0'),
                  h: Number(stat.hits ?? 0),
                  er: Number(stat.earnedRuns ?? 0),
                  bb: Number(stat.baseOnBalls ?? 0),
                  k: Number(stat.strikeOuts ?? 0),
                  hr: Number(stat.homeRuns ?? 0),
                  pitches: Number(stat.numberOfPitches ?? 0),
                  bf: Number(stat.battersFaced ?? 0),
                };
                break;
              }
            }
          } catch { /* non-fatal */ }
        }));
      }
    }

    // ── 5. Build response
    const pitchers = allPitcherIds.map(pid => {
      const meta = pitcherMeta[pid];
      const line = feedStats[pid] ?? gameLogs[pid] ?? null;
      return {
        playerId: pid,
        name: meta.name,
        team: meta.teamAbbr,
        opponent: meta.opponentAbbr,
        isHome: meta.isHome,
        gamePk: meta.gamePk,
        line,
        whiffs: whiffsByPid[pid] ?? liveWhiffsByPid[pid] ?? null,
        velocity: velocityByPid[pid] ?? (liveSpeedsByPid[pid]?.length ? Math.max(...liveSpeedsByPid[pid]) : null),
      };
    }).sort((a, b) => {
      const wA = a.whiffs ?? -1;
      const wB = b.whiffs ?? -1;
      if (wB !== wA) return wB - wA;
      return parseIp(b.line?.ip ?? '0') - parseIp(a.line?.ip ?? '0');
    });

    return NextResponse.json({ date: targetDate, games, pitchers });

  } catch (err) {
    console.error('spring-breakout-pitchers route error:', err);
    return NextResponse.json({ error: 'Failed to fetch Spring Breakout pitcher data' }, { status: 500 });
  }
}
