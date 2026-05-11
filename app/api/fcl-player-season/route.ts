import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BASE   = 'https://statsapi.mlb.com/api/v1';
const BASE11 = 'https://statsapi.mlb.com/api/v1.1';

async function mlb(path: string) {
  const r = await fetch(`${BASE}${path}`, {
    cache: 'no-store',
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${path}`);
  return r.json();
}
async function mlb11(path: string) {
  const r = await fetch(`${BASE11}${path}`, {
    cache: 'no-store',
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${path}`);
  return r.json();
}

function isBarrel(ls: number, la: number): boolean {
  if (isNaN(la) || ls < 98) return false;
  const delta = Math.min(ls, 116) - 98;
  return la >= Math.max(8, 26 - delta) && la <= Math.min(50, 30 + delta);
}

export interface BarrelEvent {
  date: string;
  opponent: string;
  pitcherName: string;
  result: string;
  ev: number;
  la: number;
  distance: number | null;
  hitX: number | null;
  hitY: number | null;
  pitchType: string | null;
  gamePk: number;
}

export interface BIPEvent {
  result: string;
  ev: number;
  la: number;
  hitX: number | null;
  hitY: number | null;
  distance: number | null;
  trajectory: string | null;
  pitchType: string | null;
  isBarrel: boolean;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const batterId   = searchParams.get('batterId');
  const leagueParam = (searchParams.get('league') ?? 'rookie').toLowerCase();
  const season     = searchParams.get('season') ?? String(new Date().getFullYear());

  if (!batterId) return NextResponse.json({ error: 'batterId required' }, { status: 400 });

  // sport IDs: FCL=16, ACL=17; rookie = both
  const sportIds = leagueParam === 'acl' ? [17] : leagueParam === 'fcl' ? [16] : [16, 17];

  try {
    // ── 1. Parallel: bio + season stats + game logs ──────────────────────────
    const [bioData, ...statPages] = await Promise.all([
      mlb(`/people/${batterId}?fields=people,fullName,height,weight,birthDate,batSide,pitchHand`),
      ...sportIds.flatMap(sid => [
        mlb(`/people/${batterId}/stats?stats=season&group=hitting&season=${season}&sportId=${sid}`),
        mlb(`/people/${batterId}/stats?stats=gameLog&group=hitting&season=${season}&sportId=${sid}`),
      ]),
    ]);

    // ── 2. Aggregate season stats (may span FCL + ACL) ────────────────────────
    let totalAB=0, totalH=0, totalHR=0, totalRBI=0, totalBB=0, totalK=0;
    let totalDoubles=0, totalTriples=0, totalSB=0, totalHBP=0, totalSF=0, totalSH=0;
    let totalGames = 0;
    const gamePkSet = new Set<number>();

    for (let i = 0; i < statPages.length; i += 2) {
      // even index = season, odd index = game log
      const seasonPage  = statPages[i];
      const gameLogPage = statPages[i + 1];

      const seasonSplit = seasonPage?.stats?.[0]?.splits?.[0]?.stat ?? {};
      totalAB      += Number(seasonSplit.atBats      ?? 0);
      totalH       += Number(seasonSplit.hits        ?? 0);
      totalHR      += Number(seasonSplit.homeRuns    ?? 0);
      totalRBI     += Number(seasonSplit.rbi         ?? 0);
      totalBB      += Number(seasonSplit.baseOnBalls ?? 0);
      totalK       += Number(seasonSplit.strikeOuts  ?? 0);
      totalDoubles += Number(seasonSplit.doubles     ?? 0);
      totalTriples += Number(seasonSplit.triples     ?? 0);
      totalSB      += Number(seasonSplit.stolenBases ?? 0);
      totalHBP     += Number(seasonSplit.hitByPitch  ?? 0);
      totalSF      += Number(seasonSplit.sacFlies    ?? 0);
      totalSH      += Number(seasonSplit.sacBunts    ?? 0);
      totalGames   += Number(seasonSplit.gamesPlayed ?? 0);

      for (const split of (gameLogPage?.stats?.[0]?.splits ?? [])) {
        const gk = split.game?.gamePk;
        if (gk) gamePkSet.add(Number(gk));
      }
    }

    const pa = totalAB + totalBB + totalHBP + totalSF + totalSH;
    const obpNum = pa > 0 ? (totalH + totalBB + totalHBP) / pa : 0;
    const tb = (totalH - totalDoubles - totalTriples - totalHR)
             + totalDoubles * 2 + totalTriples * 3 + totalHR * 4;
    const slgNum = totalAB > 0 ? tb / totalAB : 0;

    const seasonStats = {
      games: totalGames, pa, ab: totalAB, h: totalH, hr: totalHR, rbi: totalRBI,
      bb: totalBB, k: totalK, doubles: totalDoubles, triples: totalTriples, sb: totalSB,
      avg: totalAB > 0 ? (totalH / totalAB).toFixed(3) : '.000',
      obp: obpNum.toFixed(3),
      slg: slgNum.toFixed(3),
      ops: (obpNum + slgNum).toFixed(3),
    };

    // ── 3. Fetch game feeds (only the games this player appeared in) ──────────
    const gamePks = [...gamePkSet];
    const barrelEvents: BarrelEvent[] = [];
    const allBIP: BIPEvent[] = [];
    let bip = 0, hardHit = 0, totalEv = 0, evCount = 0, maxEv = 0, barrels = 0;

    const BATCH = 15;
    for (let i = 0; i < gamePks.length; i += BATCH) {
      const batch = gamePks.slice(i, i + BATCH);
      const feeds = await Promise.all(
        batch.map(gk => mlb11(`/game/${gk}/feed/live`).catch(() => null))
      );

      for (let fi = 0; fi < feeds.length; fi++) {
        const feed = feeds[fi];
        const gamePk = batch[fi];
        if (!feed) continue;

        const gd = feed.gameData as Record<string, Record<string, Record<string, string>>>;
        const awayAbbr = gd?.teams?.away?.abbreviation ?? '?';
        const homeAbbr = gd?.teams?.home?.abbreviation ?? '?';
        const dateStr  = (gd?.datetime as unknown as Record<string, string>)?.officialDate
                      ?? (gd?.datetime as unknown as Record<string, string>)?.dateTime?.slice(0, 10)
                      ?? '';

        const allPlays = (feed.liveData?.plays?.allPlays ?? []) as Record<string, unknown>[];
        for (const play of allPlays) {
          const matchup = play.matchup as Record<string, Record<string, unknown>> | undefined;
          if (Number(matchup?.batter?.id) !== Number(batterId)) continue;

          const about    = play.about as Record<string, unknown>;
          const isTop    = about?.isTopInning as boolean;
          const opponent = isTop ? homeAbbr : awayAbbr;
          const result   = (play.result as Record<string, string>)?.event ?? '';
          const pitcher  = matchup?.pitcher as Record<string, unknown>;
          const pitcherName = String(pitcher?.fullName ?? '');

          for (const ev of ((play.playEvents as Record<string, unknown>[]) ?? [])) {
            const hd = ev.hitData as Record<string, unknown> | undefined;
            if (!hd) continue;
            const ls = Number(hd.launchSpeed ?? NaN);
            const la = Number(hd.launchAngle ?? NaN);
            if (isNaN(ls) || ls <= 0) continue;

            bip++;
            totalEv += ls;
            evCount++;
            if (ls > maxEv) maxEv = ls;
            if (ls >= 95) hardHit++;

            const barrel = isBarrel(ls, la);
            if (barrel) barrels++;

            const coords = hd.coordinates as Record<string, number> | undefined;
            const hitX = coords?.coordX ?? null;
            const hitY = coords?.coordY ?? null;
            const dist = (hd.totalDistance as number) ?? null;
            const traj = (hd.trajectory as string) ?? null;

            const det     = ev.details as Record<string, Record<string, string>> | undefined;
            const ptName  = det?.type?.description ?? null;
            const ptCode  = det?.type?.code ?? null;
            const pitchType = ptName ?? ptCode ?? null;

            allBIP.push({ result, ev: ls, la, hitX, hitY, distance: dist, trajectory: traj, pitchType, isBarrel: barrel });

            if (barrel) {
              barrelEvents.push({ date: dateStr, opponent, pitcherName, result, ev: ls, la, distance: dist, hitX, hitY, pitchType, gamePk });
            }
          }
        }
      }
    }

    barrelEvents.sort((a, b) => a.date.localeCompare(b.date));

    const bio = (bioData.people as Record<string, unknown>[])?.[0] ?? {};

    return NextResponse.json({
      batterId: Number(batterId),
      playerName: bio.fullName as string ?? `Player ${batterId}`,
      league: leagueParam,
      season,
      bio: {
        height:    bio.height    as string | undefined,
        weight:    bio.weight    as number | undefined,
        birthDate: bio.birthDate as string | undefined,
        batSide:   (bio.batSide  as Record<string, string>)?.code,
        pitchHand: (bio.pitchHand as Record<string, string>)?.code,
      },
      seasonStats,
      barrelStats: {
        barrels,
        barrelPct:  bip > 0 ? Math.round((barrels / bip) * 1000) / 10 : null,
        hardHit95:  hardHit,
        maxEv:      maxEv > 0 ? maxEv : null,
        avgEv:      evCount > 0 ? Math.round((totalEv / evCount) * 10) / 10 : null,
        bip,
      },
      barrelEvents,
      allBIP,
    });
  } catch (e) {
    console.error('[fcl-player-season]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
