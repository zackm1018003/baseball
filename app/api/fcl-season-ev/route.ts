import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60; // full season may need up to ~60s for many concurrent fetches

/**
 * GET /api/fcl-season-ev?batterId=123456&season=2026
 *
 * Aggregates exit-velocity stats for an FCL/ACL/MiLB player across their
 * entire season game log, since Baseball Savant has no MiLB data.
 *
 * Steps:
 *  1. Fetch the player's game log (?stats=gameLog) to get all gamePks
 *  2. For each game, fetch the MLB live feed and pull launchSpeed for
 *     any ball-in-play pitch by the specified batter
 *  3. Aggregate: maxEv, avgEv, ev90 (avg of top 10%)
 *
 * Results cached for 30 minutes.
 */

const MLB_BASE = 'https://statsapi.mlb.com/api/v1';
const MLB_11   = 'https://statsapi.mlb.com/api/v1.1';

// Sanity cap — real exit velocities never exceed ~130 mph; anything above is a bad data point
const EV_MAX_VALID = 130;

const empty = {
  avgEv: null as number | null, maxEv: null as number | null,
  ev90: null as number | null, barrels: null as number | null,
  barrelPct: null as number | null, bipCount: 0,
};

function isBarrel(ev: number, la: number): boolean {
  if (ev < 98) return false;
  if (la >= 26 && la <= 30) return true;
  if (la > 30 && la <= 50) return ev >= 98 + (la - 30) * 2;
  if (la >= 8  && la < 26)  return ev >= 98 + (26 - la) * 2;
  return false;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const batterId = searchParams.get('batterId');
  const season   = searchParams.get('season') ?? String(new Date().getFullYear());

  if (!batterId) {
    return NextResponse.json({ error: 'batterId required' }, { status: 400 });
  }

  try {
    // Step 1: fetch game log for the player (try sportId=16 for FCL/ACL, fallback to others)
    const sportIds = [16, 14, 13, 12, 11, 1];
    let gamePks: number[] = [];

    for (const sportId of sportIds) {
      const logUrl = `${MLB_BASE}/people/${batterId}/stats?stats=gameLog&group=hitting&season=${season}&sportId=${sportId}`;
      try {
        const logRes = await fetch(logUrl, { next: { revalidate: 1800 } });
        if (!logRes.ok) continue;
        const logData = await logRes.json();
        const splits = logData.stats?.[0]?.splits ?? [];
        if (splits.length > 0) {
          gamePks = splits
            .filter((s: { game?: { gamePk?: number } }) => s.game?.gamePk)
            .map((s: { game: { gamePk: number } }) => s.game.gamePk);
          break; // found the right sport level
        }
      } catch { /* try next */ }
    }

    if (gamePks.length === 0) {
      return NextResponse.json(empty);
    }

    // Step 2: fetch all game feeds concurrently (no arbitrary cap — full season accuracy)
    const recent = gamePks;
    const batterIdNum = Number(batterId);

    const gameBipArrays = await Promise.all(
      recent.map(async (gamePk) => {
        try {
          const feedUrl = `${MLB_11}/game/${gamePk}/feed/live`;
          const res = await fetch(feedUrl, { next: { revalidate: 1800 } });
          if (!res.ok) return [] as Array<{ ev: number; la: number | null }>;
          const feed = await res.json();
          const allPlays: Record<string, unknown>[] = feed.liveData?.plays?.allPlays ?? [];

          const bips: Array<{ ev: number; la: number | null; isHR: boolean }> = [];
          for (const ab of allPlays) {
            const matchup = ab.matchup as Record<string, unknown> | undefined;
            const batter  = matchup?.batter as Record<string, unknown> | undefined;
            if (Number(batter?.id) !== batterIdNum) continue;

            // At-bat result tells us what happened on the ball in play
            const result = ab.result as Record<string, unknown> | undefined;
            const eventName = ((result?.event as string) ?? '').toLowerCase();
            const isHR = eventName === 'home run';

            const events = ab.playEvents as Record<string, unknown>[] | undefined ?? [];
            for (const ev of events) {
              if (!ev.isPitch) continue;
              const hd = ev.hitData as Record<string, unknown> | undefined;
              const det = ev.details as Record<string, unknown> | undefined;
              if (!det?.isInPlay) continue;
              const ls = hd?.launchSpeed as number | undefined;
              const la = hd?.launchAngle as number | undefined;
              if (ls && ls > 0 && ls <= EV_MAX_VALID) bips.push({ ev: ls, la: la ?? null, isHR });
            }
          }
          return bips;
        } catch {
          return [] as Array<{ ev: number; la: number | null }>;
        }
      })
    );

    // Step 3: aggregate
    const allBips = gameBipArrays.flat();

    if (allBips.length === 0) {
      return NextResponse.json(empty);
    }

    const allEvs = allBips.map(b => b.ev);
    allEvs.sort((a, b) => b - a); // descending

    const maxEv = allEvs[0];
    const avgEv = allEvs.reduce((s, v) => s + v, 0) / allEvs.length;
    // Barrel detection: use full formula when LA is available.
    // When LA is missing (common in MiLB feeds), a home run with EV ≥ 98 is
    // virtually always a barrel (they satisfy the required LA range), so count it.
    const barrels = allBips.filter(b => {
      if (b.la !== null) return isBarrel(b.ev, b.la!);
      return b.isHR && b.ev >= 98;
    }).length;
    const barrelPct = Math.round((barrels / allBips.length) * 1000) / 10;

    // EV90 = average of top 10%, need ≥2 BIP
    let ev90: number | null = null;
    if (allEvs.length >= 2) {
      const top10Count = Math.max(1, Math.round(allEvs.length * 0.1));
      ev90 = allEvs.slice(0, top10Count).reduce((s, v) => s + v, 0) / top10Count;
    }

    return NextResponse.json({
      avgEv:     Math.round(avgEv * 10) / 10,
      maxEv:     Math.round(maxEv * 10) / 10,
      ev90:      ev90 !== null ? Math.round(ev90 * 10) / 10 : null,
      barrels,
      barrelPct,
      bipCount:  allBips.length,
      games:     recent.length,
    }, { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' } });

  } catch (e) {
    console.warn('[fcl-season-ev]', e);
    return NextResponse.json(empty);
  }
}
