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

async function fetchJSON(url: string, noCache = false) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    ...(noCache ? { cache: 'no-store' } : { next: { revalidate: 300 } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// Extract whiffs + hardest pitch velocity per pitcher from a /gf game feed response
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
  const dateParam   = searchParams.get('date');
  const leagueParam = searchParams.get('league') ?? 'mlb';

  const isAAA    = leagueParam === 'aaa';
  const isLowA   = leagueParam === 'low-a';
  const isCBB    = leagueParam === 'cbb';
  const isFCL    = leagueParam === 'fcl';
  const isDSL    = leagueParam === 'dsl';
  const isMinors = isAAA || isLowA || isFCL || isDSL;
  const sportIds = isAAA ? '11' : isLowA ? '14' : isCBB ? '22,23' : (isFCL || isDSL) ? '16' : '1,51';
  // leagueId filtering keeps FCL/DSL separate (both are sportId=16)
  const leagueIdFilter = isFCL ? '&leagueId=124' : isDSL ? '&leagueId=130' : '';

  // Default to today
  const targetDate = dateParam || new Date().toISOString().slice(0, 10);

  // Are we fetching today? If so, use live feed stats instead of game logs
  const isToday = targetDate === new Date().toISOString().slice(0, 10);

  // Derive season from date
  const season = parseInt(targetDate.slice(0, 4));

  try {
    // ── 1. Fetch schedule (no boxscore hydration — it omits pitchers for ST games)
    const scheduleUrl = `${MLB_API}/schedule?startDate=${targetDate}&endDate=${targetDate}&sportId=${sportIds}${leagueIdFilter}`;
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
    }[] = [];

    // Map: playerId → { name, teamAbbr, gamePk, isHome, opponentAbbr }
    const pitcherMeta: Record<number, {
      name: string;
      teamAbbr: string;
      opponentAbbr: string;
      gamePk: number;
      isHome: boolean;
    }> = {};

    // Stats extracted from the live feed boxscore (works for all dates — gameStats.pitching has game-specific stats)
    const feedStats: Record<number, {
      ip: string; h: number; er: number; bb: number;
      k: number; hr: number; pitches: number; bf: number;
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
        const sportId: number = homeTeam?.team?.sport?.id ?? awayTeam?.team?.sport?.id ?? game.sport?.id ?? 1;
        games.push({ gamePk, homeTeam: homeAbbr, awayTeam: awayAbbr, homeScore, awayScore, status, sportId });
        gamePks.push({ gamePk, homeAbbr, awayAbbr, homeScore, awayScore, status });
      }
    }

    // Whiffs + top velo extracted from the MLB Stats API live feed play-by-play
    // (used as primary source for WBC/non-Savant games, fallback for all games)
    const liveWhiffsByPid: Record<number, number> = {};
    const liveSpeedsByPid: Record<number, number[]> = {};

    // ── 2. Fetch each game's live feed to get pitcher IDs (schedule hydrate misses ST games)
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
          // gameStats = this game only (live); stats = season cumulative
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

        // ── Also extract whiffs + velocity from play-by-play (works for all games incl. WBC) ──
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
      } catch {
        // Non-fatal — skip games we can't fetch
      }
    }));

    if (allPitcherIds.length === 0) {
      return NextResponse.json({ date: targetDate, games, pitchers: [] });
    }

    // ── 3. Fetch /gf for each unique gamePk (whiff/velocity) + people ages in parallel ──
    // Baseball Savant only covers MLB — skip for minor league requests
    const whiffsByPid: Record<number, number> = {};
    const velocityByPid: Record<number, number> = {};
    const ageByPid: Record<number, number | null> = {};
    const gfFetch = isMinors ? Promise.resolve() : (async () => {
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
    })();

    // Batch-fetch player ages from people API (runs in parallel with /gf)
    const ageFetch = (async () => {
      const PEOPLE_BATCH = 100;
      for (let i = 0; i < allPitcherIds.length; i += PEOPLE_BATCH) {
        const batch = allPitcherIds.slice(i, i + PEOPLE_BATCH);
        try {
          const url = `${MLB_API}/people?personIds=${batch.join(',')}&fields=people,id,currentAge`;
          const data = await fetchJSON(url);
          for (const person of (data?.people ?? [])) {
            ageByPid[person.id] = person.currentAge ?? null;
          }
        } catch { /* non-fatal */ }
      }
    })();

    await Promise.all([gfFetch, ageFetch]);

    // ── 5. For past dates: batch-fetch game logs only for pitchers still missing stats
    //       Try sportId=1 (regular season) then sportId=17 (Spring Training) as fallback
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

            // Try the appropriate level first, then Spring Training as fallback
            const sportIdOrder = isAAA ? [11, 17] : isLowA ? [14, 17] : [1, 17];
            for (const sportId of sportIdOrder) {
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
                break; // found it, stop trying
              }
            }
          } catch {
            // Non-fatal
          }
        }));
      }
    }

    // ── 6. Build response ─────────────────────────────────────────────────────
    const pitchers = allPitcherIds.map(pid => {
      const meta = pitcherMeta[pid];
      // Prefer feed stats (from live feed boxscore, works for all dates), fall back to game log API
      const line = feedStats[pid] ?? gameLogs[pid] ?? null;
      return {
        playerId: pid,
        name: meta.name,
        team: meta.teamAbbr,
        opponent: meta.opponentAbbr,
        isHome: meta.isHome,
        gamePk: meta.gamePk,
        age: ageByPid[pid] ?? null,
        line,
        // Prefer Savant data (more accurate for MLB); fall back to live feed (covers WBC/all games)
        whiffs: whiffsByPid[pid] ?? liveWhiffsByPid[pid] ?? null,
        velocity: velocityByPid[pid] ?? (liveSpeedsByPid[pid]?.length ? Math.max(...liveSpeedsByPid[pid]) : null),
        whiffPct: (() => {
          const w = whiffsByPid[pid] ?? liveWhiffsByPid[pid] ?? null;
          const p = line?.pitches ?? 0;
          return w != null && p > 0 ? Math.round((w / p) * 1000) / 10 : null;
        })(),
      };
    }).sort((a, b) => {
      // Sort by whiffs desc (null/0 pitchers go to bottom), then by IP as tiebreaker
      const wA = a.whiffs ?? -1;
      const wB = b.whiffs ?? -1;
      if (wB !== wA) return wB - wA;
      return parseIp(b.line?.ip ?? '0') - parseIp(a.line?.ip ?? '0');
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
