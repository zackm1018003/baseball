import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// ── Date helpers ──────────────────────────────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ── Internal fetch ────────────────────────────────────────────────────────────

async function fetchDailyData(baseUrl: string, playerId: string, date: string) {
  const url = `${baseUrl}/api/hitter-daily?playerId=${playerId}&date=${date}`;
  const res = await fetch(url, { cache: 'no-store' });
  // A 404 still carries playerName + availableDates — allow it through as a valid probe
  if (!res.ok && res.status !== 404) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  // Only reject if truly no player data at all
  if (data?.error && !data?.playerName && !data?.availableDates?.length) return null;
  return data;
}

// ── Sport ID → level string ───────────────────────────────────────────────────

function sportIdToLevel(id: number | null): string | null {
  switch (id) {
    case 1:  return 'MLB';
    case 11: return 'AAA';
    case 12: return 'AA';
    case 13: return 'High-A';
    case 14: return 'Low-A';
    case 16: return 'FCL';
    case 17: return 'ACL';
    default: return null; // Spring Breakout (21), DSL (22), etc. → fall back to MLB baselines
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const playerId   = searchParams.get('playerId');
  const lastNParam = searchParams.get('lastN');
  const lastN      = Math.min(Math.max(parseInt(lastNParam ?? '7') || 7, 7), 28);

  if (!playerId) {
    return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  }

  // Determine base URL for internal API calls
  const origin = req.headers.get('x-forwarded-host')
    ? `https://${req.headers.get('x-forwarded-host')}`
    : req.nextUrl.origin;

  // Window: rolling last N days ending today
  const today     = new Date().toISOString().slice(0, 10);
  const weekStart = addDays(today, -(lastN - 1));
  const weekEnd   = today;

  // ── 1. Get player bio via probe ────────────────────────────────────────────
  // Walk back from today until we find any response with player bio (covers
  // players who haven't played yet this window).
  let probe = null;
  for (let i = 0; i <= 7 && !probe; i++) {
    probe = await fetchDailyData(origin, playerId, addDays(today, -i));
  }

  if (!probe) {
    return NextResponse.json({ error: 'Could not load player data.' }, { status: 404 });
  }

  const {
    playerName, playerHeight, playerWeight, playerBirthDate,
    playerBatSide, playerPitchHand,
  } = probe;

  // ── 2. Try every day in the window in parallel ─────────────────────────────
  // Don't rely on availableDates — it only covers the regular-season game log
  // and misses Spring Training, exhibition, etc.
  const windowDates: string[] = [];
  for (let i = 0; i < lastN; i++) windowDates.push(addDays(weekStart, i));

  // ── 3. Fetch full detail for each date in parallel ─────────────────────────
  const results = await Promise.all(
    windowDates.map(d => fetchDailyData(origin, playerId, d))
  );

  // ── 4. Aggregate ───────────────────────────────────────────────────────────
  const totals = { ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 0,
                   doubles: 0, triples: 0, pa: 0, sb: 0 };
  const allRawDots: unknown[]  = [];
  const allHitDots: unknown[]  = [];
  let   batSpeedSum   = 0;
  let   batSpeedCount = 0;
  let   totalBarrels  = 0;
  let   atBatOffset   = 0;
  let   team: string | null = null;
  let   sportId: number | null = null;
  const allExitVelos: number[] = [];

  // Plate discipline counters
  let zSwings = 0, zPitches = 0;   // in-zone swings / total in-zone pitches
  let oSwings = 0, oPitches = 0;   // out-of-zone swings / total out-of-zone pitches
  let zContact = 0;                 // in-zone swings that made contact
  let oContact = 0;                 // out-of-zone swings that made contact
  let totalPitchesSeen = 0;         // all pitches (for overall swing%)
  let totalSwings      = 0;
  let laHardSum        = 0;         // sum of launch angles for 95+ EV balls
  let laHardCount      = 0;

  const SWING_DESCS    = new Set(['swinging_strike','swinging_strike_blocked','foul','foul_tip','hit_into_play','foul_bunt','missed_bunt','bunt_foul_tip','in_play']);
  const CONTACT_DESCS  = new Set(['foul','foul_tip','hit_into_play','foul_bunt','bunt_foul_tip','in_play']);

  // All at-bats collected across the week for ranking
  const allAtBats: {
    atBatNum: number; pitcherName: string; pitcherHand: string; result: string;
    pitches: unknown[];
    date: string; opponent: string | null; isHome: boolean | null;
    maxEv: number | null; isBarrel: boolean; isHit: boolean; score: number;
  }[] = [];

  const HIT_RESULTS = new Set(['single','double','triple','home_run']);

  const games: {
    date: string; dateShort: string; opponent: string | null;
    opponentFull: string | null; isHome: boolean | null;
    ab: number; h: number; hr: number; rbi: number; bb: number;
    k: number; pa: number; sb: number;
    avgEv: number | null; barrels: number; avgBatSpeed: number | null;
    gamePk: number | null;
  }[] = [];

  for (const data of results) {
    if (!data?.gameLine) continue;
    const gl = data.gameLine;
    const gi = data.gameInfo;
    const pd = data.pitchData;

    // Totals
    totals.ab      += gl.ab      ?? 0;
    totals.h       += gl.h       ?? 0;
    totals.hr      += gl.hr      ?? 0;
    totals.rbi     += gl.rbi     ?? 0;
    totals.bb      += gl.bb      ?? 0;
    totals.k       += gl.k       ?? 0;
    totals.doubles += gl.doubles ?? 0;
    totals.triples += gl.triples ?? 0;
    totals.pa      += gl.pa      ?? 0;
    totals.sb      += gl.sb      ?? 0;

    if (!team && gi?.team) team = gi.team;
    if (sportId === null && gi?.sportId != null) sportId = gi.sportId;

    // Per-game Statcast aggregates
    let gameEVSum = 0, gameEVCount = 0;
    let gameBarrels = 0;
    let gameBSSum = 0, gameBSCount = 0;

    if (pd?.atBats?.length) {
      for (const ab of pd.atBats) {
        let abMaxEv: number | null = null;
        let abIsBarrel = false;
        for (const p of ab.pitches ?? []) {
          const desc      = (p.description || '').toLowerCase().replace(/ /g,'_');
          // SWING_DESCS covers Statcast CSV snake_case; GF returns "In play, no out" → "in_play,_no_out"
          const isSwing   = SWING_DESCS.has(desc) || desc.startsWith('in_play,');
          const isContact = CONTACT_DESCS.has(desc) || desc.startsWith('in_play,');

          // Overall swing% counters (all pitches, not just zone-tracked)
          totalPitchesSeen++;
          if (isSwing) totalSwings++;

          if (p.exitVelo != null) {
            gameEVSum += p.exitVelo; gameEVCount++;
            allExitVelos.push(p.exitVelo);
            if (abMaxEv === null || p.exitVelo > abMaxEv) abMaxEv = p.exitVelo;
            // Hard-hit launch angle (95+ EV)
            if (p.exitVelo >= 95 && p.launchAngle != null) {
              laHardSum += p.launchAngle; laHardCount++;
            }
          }
          if (p.isBarrel) { gameBarrels++; totalBarrels++; abIsBarrel = true; }
          if (p.batSpeed != null && p.batSpeed >= 40) {
            gameBSSum += p.batSpeed; gameBSCount++;
            batSpeedSum += p.batSpeed; batSpeedCount++;
          }
          // Zone-based plate discipline
          if (p.zone != null) {
            const inZone = p.zone >= 1 && p.zone <= 9;
            if (inZone) {
              zPitches++;
              if (isSwing) { zSwings++; if (isContact) zContact++; }
            } else if (p.zone >= 11 && p.zone <= 14) {
              oPitches++;
              if (isSwing) { oSwings++; if (isContact) oContact++; }
            }
          }
        }
        const isHit = HIT_RESULTS.has(ab.result ?? '');
        const isHardHit = abMaxEv !== null && abMaxEv >= 95;
        // Quality score: barrel=1000+EV, hit=500+EV, hard contact=200+EV, else EV
        const score = abIsBarrel ? 1000 + (abMaxEv ?? 0)
                    : isHit     ? 500  + (abMaxEv ?? 0)
                    : isHardHit ? 200  + (abMaxEv ?? 0)
                    : (abMaxEv ?? 0);
        allAtBats.push({
          atBatNum: ab.atBatNum, pitcherName: ab.pitcherName,
          pitcherHand: ab.pitcherHand, result: ab.result,
          pitches: ab.pitches,
          date: gl.date, opponent: gi?.opponent ?? null, isHome: gi?.isHome ?? null,
          maxEv: abMaxEv, isBarrel: abIsBarrel, isHit, score,
        });
      }
    }

    // Merge rawDots with offset so atBatNums stay globally unique
    if (pd?.rawDots?.length) {
      for (const dot of pd.rawDots) {
        allRawDots.push({ ...(dot as object), atBatNum: (dot as { atBatNum: number }).atBatNum + atBatOffset });
      }
    }
    if (pd?.hitDots?.length) {
      allHitDots.push(...pd.hitDots);
    }

    // Advance offset by max atBatNum in this game
    const maxAB = pd?.atBats?.length
      ? Math.max(...pd.atBats.map((a: { atBatNum: number }) => a.atBatNum))
      : 0;
    atBatOffset += maxAB + 1;

    games.push({
      date:         gl.date,
      dateShort:    formatDateShort(gl.date),
      opponent:     gi?.opponent     ?? null,
      opponentFull: gi?.opponentFull ?? null,
      isHome:       gi?.isHome       ?? null,
      ab: gl.ab ?? 0, h: gl.h ?? 0, hr: gl.hr ?? 0,
      rbi: gl.rbi ?? 0, bb: gl.bb ?? 0, k: gl.k ?? 0,
      pa: gl.pa ?? 0, sb: gl.sb ?? 0,
      avgEv:       gameEVCount ? Math.round(gameEVSum / gameEVCount * 10) / 10 : null,
      barrels:     gameBarrels,
      avgBatSpeed: gameBSCount ? Math.round(gameBSSum / gameBSCount * 10) / 10 : null,
      gamePk:      gi?.gamePk ?? null,
    });
  }

  // Newest game first
  games.reverse();

  // Top 5 at-bats by quality score
  allAtBats.sort((a, b) => b.score - a.score);
  const topAtBats = allAtBats.slice(0, 4);

  return NextResponse.json({
    playerId: parseInt(playerId),
    playerName, playerHeight, playerWeight, playerBirthDate,
    playerBatSide, playerPitchHand,
    weekStart, weekEnd,
    games,
    topAtBats,
    totals,
    rawDots:     allRawDots,
    hitDots:     allHitDots,
    barrels:     totalBarrels,
    barrelPct:   allExitVelos.length > 0 ? Math.round(totalBarrels / allExitVelos.length * 1000) / 10 : null,
    avgBatSpeed: batSpeedCount ? Math.round(batSpeedSum / batSpeedCount * 10) / 10 : null,
    avgEv:       allExitVelos.length > 0 ? Math.round(allExitVelos.reduce((s,v)=>s+v,0) / allExitVelos.length * 10) / 10 : null,
    maxEv:       allExitVelos.length > 0 ? Math.round(Math.max(...allExitVelos) * 10) / 10 : null,
    avgLaHard:   laHardCount > 0 ? Math.round(laHardSum / laHardCount * 10) / 10 : null,
    ev90: (() => {
      if (allExitVelos.length < 2) return null;
      const sorted = [...allExitVelos].sort((a, b) => b - a);
      const top10Count = Math.max(1, Math.round(sorted.length * 0.1));
      const avg = sorted.slice(0, top10Count).reduce((s, v) => s + v, 0) / top10Count;
      return Math.round(avg * 10) / 10;
    })(),
    discipline: {
      swingPct:    totalPitchesSeen ? Math.round(totalSwings   / totalPitchesSeen * 1000) / 10 : null,
      zSwingPct:   zPitches  ? Math.round(zSwings  / zPitches  * 1000) / 10 : null,
      chasePct:    oPitches  ? Math.round(oSwings  / oPitches  * 1000) / 10 : null,
      zContactPct: zSwings   ? Math.round(zContact / zSwings   * 1000) / 10 : null,
      oContactPct: oSwings   ? Math.round(oContact / oSwings   * 1000) / 10 : null,
    },
    team,
    level: sportIdToLevel(sportId),
  });
}
