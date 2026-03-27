import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/daily-hitters?date=2025-04-15
 *
 * Returns all batters who appeared in MLB games on a given date,
 * with their game line (AB, H, HR, RBI, BB, K, 2B, 3B, SB).
 *
 * Uses MLB Stats API schedule + live feed boxscore for batting stats.
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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');
  const leagueParam = searchParams.get('league') ?? 'mlb'; // 'mlb' | 'aaa'
  const isAAA = leagueParam === 'aaa';

  const targetDate = dateParam || new Date().toISOString().slice(0, 10);
  const isToday = targetDate === new Date().toISOString().slice(0, 10);
  const season = parseInt(targetDate.slice(0, 4));

  try {
    // ── 1. Fetch schedule
    const sportIds = isAAA ? '11' : '1,22,23,51';
    const scheduleUrl = `${MLB_API}/schedule?startDate=${targetDate}&endDate=${targetDate}&sportId=${sportIds}`;
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

    // For AAA: batted ball data mined from live feed play-by-play
    const liveHitData: Record<number, { barrels: number; hardHit95: number; maxEv: number }> = {};

    const allHitterIds: number[] = [];

    // Collect basic game info
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
          const h = Number(bStats.hits ?? 0);
          // Only include if player actually batted (AB > 0 or had a PA)
          const bb = Number(bStats.baseOnBalls ?? 0);
          const hbp = Number(bStats.hitByPitch ?? 0);
          const sf = Number(bStats.sacFlies ?? 0);
          const sh = Number(bStats.sacBunts ?? 0);
          const pa = ab + bb + hbp + sf + sh;
          if (pa === 0) return null;
          return {
            ab,
            h,
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
          if (!stats) continue; // skip non-batters (pitchers listed but didn't bat)
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

        // For AAA: mine play-by-play for batted ball data (EV/LA) since Statcast doesn't cover AAA
        if (isAAA) {
          const allPlays: Record<string, unknown>[] = (feed?.liveData?.plays?.allPlays ?? []) as Record<string, unknown>[];
          for (const play of allPlays) {
            const batterId = Number(((play.matchup as Record<string, unknown>)?.batter as Record<string, unknown>)?.id ?? NaN);
            if (isNaN(batterId)) continue;
            const events = (play.playEvents as Record<string, unknown>[]) ?? [];
            for (const ev of events) {
              const hd = ev.hitData as Record<string, unknown> | undefined;
              if (!hd) continue;
              const ls = Number(hd.launchSpeed ?? NaN);
              const la = Number(hd.launchAngle ?? NaN);
              if (isNaN(ls) || ls <= 0) continue;
              if (!liveHitData[batterId]) liveHitData[batterId] = { barrels: 0, hardHit95: 0, maxEv: -1 };
              if (ls > liveHitData[batterId].maxEv) liveHitData[batterId].maxEv = ls;
              if (ls >= 95) liveHitData[batterId].hardHit95++;
              // Use barrel formula since Stats API has no is_barrel flag
              if (!isNaN(la) && ls >= 98) {
                const delta = Math.min(ls, 116) - 98;
                if (la >= Math.max(8, 26 - delta) && la <= Math.min(50, 30 + delta)) {
                  liveHitData[batterId].barrels++;
                }
              }
            }
          }
        }
      } catch {
        // Non-fatal — skip games we can't fetch
      }
    }));

    if (allHitterIds.length === 0) {
      return NextResponse.json({ date: targetDate, games, hitters: [] });
    }

    // ── 3. For past dates: batch-fetch game logs for missing stats
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

            for (const sportId of [1, 17]) {
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
          } catch {
            // Non-fatal
          }
        }));
      }
    }

    // ── 4. Fetch Statcast /gf for each game to get today's bat speed / max EV / barrels per batter
    //       (MLB only — Statcast does not cover AAA)
    const statcastByPlayer: Record<number, { batSpeeds: number[]; maxEv: number; barrels: number; hardHit95: number }> = {};

    if (!isAAA) {
      const uniqueGamePks = [...new Set(allHitterIds.map(pid => hitterMeta[pid]?.gamePk).filter(Boolean))];
      await Promise.all(uniqueGamePks.map(async (gamePk) => {
        try {
          const gf = await fetchJSON(`https://baseballsavant.mlb.com/gf?game_pk=${gamePk}`, true);
          const evArray = (gf?.exit_velocity ?? []) as Record<string, unknown>[];
          for (const ev of evArray) {
            const pid = Number(ev.batter ?? NaN);
            if (isNaN(pid)) continue;
            if (!statcastByPlayer[pid]) statcastByPlayer[pid] = { batSpeeds: [], maxEv: -1, barrels: 0, hardHit95: 0 };
            const bs = Number(ev.batSpeed ?? NaN);
            if (!isNaN(bs) && bs >= 50) statcastByPlayer[pid].batSpeeds.push(bs);
            const launchSpd = Number(ev.launch_speed ?? ev.hit_speed ?? NaN);
            if (!isNaN(launchSpd) && launchSpd > statcastByPlayer[pid].maxEv) statcastByPlayer[pid].maxEv = launchSpd;
            if (Number(ev.is_barrel) === 1) statcastByPlayer[pid].barrels++;
            if (!isNaN(launchSpd) && launchSpd >= 95) statcastByPlayer[pid].hardHit95++;
          }
        } catch { /* non-fatal */ }
      }));
    }

    // ── 5. Build response
    const hitters = allHitterIds.map(pid => {
      const meta = hitterMeta[pid];
      const line = feedStats[pid] ?? gameLogs[pid] ?? null;
      const sc = statcastByPlayer[pid];
      const lhd = liveHitData[pid];
      const avgBatSpeed = sc && sc.batSpeeds.length > 0
        ? Math.round((sc.batSpeeds.reduce((a, b) => a + b, 0) / sc.batSpeeds.length) * 10) / 10
        : null;
      const maxEv = sc && sc.maxEv > 0
        ? Math.round(sc.maxEv * 10) / 10
        : lhd && lhd.maxEv > 0 ? Math.round(lhd.maxEv * 10) / 10 : null;
      const barrels = sc ? sc.barrels : lhd ? lhd.barrels : null;
      const hardHit95 = sc ? sc.hardHit95 : lhd ? lhd.hardHit95 : null;
      return {
        playerId: pid,
        name: meta.name,
        team: meta.teamAbbr,
        opponent: meta.opponentAbbr,
        isHome: meta.isHome,
        gamePk: meta.gamePk,
        line,
        batSpeed: avgBatSpeed,
        maxEv,
        barrels,
        hardHit95,
      };
    }).filter(h => h.line !== null)
      .sort((a, b) => {
        // Sort by H desc, then HR desc
        const hDiff = (b.line?.h ?? 0) - (a.line?.h ?? 0);
        if (hDiff !== 0) return hDiff;
        return (b.line?.hr ?? 0) - (a.line?.hr ?? 0);
      });

    return NextResponse.json({ date: targetDate, games, hitters });

  } catch (err) {
    console.error('daily-hitters route error:', err);
    return NextResponse.json({ error: 'Failed to fetch daily hitter data' }, { status: 500 });
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _parseIp(ip: string): number {
  return parseIp(ip);
}
