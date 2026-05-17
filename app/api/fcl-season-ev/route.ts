import { NextRequest, NextResponse } from 'next/server';

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

const empty = { avgEv: null as number | null, maxEv: null as number | null, ev90: null as number | null, bipCount: 0 };

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

    // Step 2: fetch each game feed concurrently (limit to 20 most recent to cap latency)
    const recent = gamePks.slice(-20);
    const batterIdNum = Number(batterId);

    const gameEvArrays = await Promise.all(
      recent.map(async (gamePk) => {
        try {
          const feedUrl = `${MLB_11}/game/${gamePk}/feed/live`;
          const res = await fetch(feedUrl, { next: { revalidate: 1800 } });
          if (!res.ok) return [];
          const feed = await res.json();
          const allPlays: Record<string, unknown>[] = feed.liveData?.plays?.allPlays ?? [];

          const evs: number[] = [];
          for (const ab of allPlays) {
            const matchup = ab.matchup as Record<string, unknown> | undefined;
            const batter  = matchup?.batter as Record<string, unknown> | undefined;
            if (Number(batter?.id) !== batterIdNum) continue;

            const events = ab.playEvents as Record<string, unknown>[] | undefined ?? [];
            for (const ev of events) {
              if (!ev.isPitch) continue;
              const hd = ev.hitData as Record<string, unknown> | undefined;
              const det = ev.details as Record<string, unknown> | undefined;
              if (!det?.isInPlay) continue;
              const ls = hd?.launchSpeed as number | undefined;
              if (ls && ls > 0) evs.push(ls);
            }
          }
          return evs;
        } catch {
          return [];
        }
      })
    );

    // Step 3: aggregate
    const allEvs = gameEvArrays.flat();

    if (allEvs.length === 0) {
      return NextResponse.json(empty);
    }

    allEvs.sort((a, b) => b - a); // descending

    const maxEv = allEvs[0];
    const avgEv = allEvs.reduce((s, v) => s + v, 0) / allEvs.length;

    // EV90 = average of top 10%, need ≥2 BIP
    let ev90: number | null = null;
    if (allEvs.length >= 2) {
      const top10Count = Math.max(1, Math.round(allEvs.length * 0.1));
      ev90 = allEvs.slice(0, top10Count).reduce((s, v) => s + v, 0) / top10Count;
    }

    return NextResponse.json({
      avgEv:    Math.round(avgEv * 10) / 10,
      maxEv:    Math.round(maxEv * 10) / 10,
      ev90:     ev90 !== null ? Math.round(ev90 * 10) / 10 : null,
      bipCount: allEvs.length,
      games:    recent.length,
    }, { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' } });

  } catch (e) {
    console.warn('[fcl-season-ev]', e);
    return NextResponse.json(empty);
  }
}
