import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Returns Monday of the week containing `date` (YYYY-MM-DD) */
function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

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
  if (!res.ok) return null;
  const data = await res.json();
  if (data?.error) return null;
  return data;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const playerId  = searchParams.get('playerId');
  const weekParam = searchParams.get('weekStart'); // optional override

  if (!playerId) {
    return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  }

  // Determine base URL for internal API calls
  const origin = req.headers.get('x-forwarded-host')
    ? `https://${req.headers.get('x-forwarded-host')}`
    : req.nextUrl.origin;

  // Week bounds
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = weekParam || getMondayOf(today);
  const weekEnd   = addDays(weekStart, 6);

  // ── 1. Get availableDates via a single hitter-daily call ───────────────────
  // Try weekEnd first; if no game that day fall back to today so we still get
  // the availableDates list
  const probe = await fetchDailyData(origin, playerId, weekEnd) ||
                await fetchDailyData(origin, playerId, today);

  if (!probe) {
    return NextResponse.json({ error: 'Could not load player data.' }, { status: 404 });
  }

  const {
    playerName, playerHeight, playerWeight, playerBirthDate,
    playerBatSide, playerPitchHand, availableDates = [],
  } = probe;

  // ── 2. Find which dates in this week have games ────────────────────────────
  const weekDates = (availableDates as { date: string }[])
    .map(d => d.date)
    .filter(d => d >= weekStart && d <= weekEnd)
    .sort(); // ascending

  if (weekDates.length === 0) {
    return NextResponse.json({
      playerId: parseInt(playerId),
      playerName, playerHeight, playerWeight, playerBirthDate,
      playerBatSide, playerPitchHand,
      weekStart, weekEnd,
      games: [], totals: null,
      rawDots: [], hitDots: [],
      barrels: 0, avgBatSpeed: null,
      team: null,
    });
  }

  // ── 3. Fetch full detail for each game date in parallel ────────────────────
  const results = await Promise.all(
    weekDates.map(d => fetchDailyData(origin, playerId, d))
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
  const allExitVelos: number[] = [];

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

    // Per-game Statcast aggregates
    let gameEVSum = 0, gameEVCount = 0;
    let gameBarrels = 0;
    let gameBSSum = 0, gameBSCount = 0;

    if (pd?.atBats?.length) {
      for (const ab of pd.atBats) {
        let abMaxEv: number | null = null;
        let abIsBarrel = false;
        for (const p of ab.pitches ?? []) {
          if (p.exitVelo != null) { gameEVSum += p.exitVelo; gameEVCount++; allExitVelos.push(p.exitVelo); if (abMaxEv === null || p.exitVelo > abMaxEv) abMaxEv = p.exitVelo; }
          if (p.isBarrel) { gameBarrels++; totalBarrels++; abIsBarrel = true; }
          if (p.batSpeed != null && p.batSpeed >= 40) {
            gameBSSum += p.batSpeed; gameBSCount++;
            batSpeedSum += p.batSpeed; batSpeedCount++;
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

  // Top 4 at-bats by quality score
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
    avgBatSpeed: batSpeedCount ? Math.round(batSpeedSum / batSpeedCount * 10) / 10 : null,
    ev90: (() => {
      if (!allExitVelos.length) return null;
      const sorted = [...allExitVelos].sort((a, b) => a - b);
      const idx = Math.floor(sorted.length * 0.9);
      return Math.round(sorted[Math.min(idx, sorted.length - 1)] * 10) / 10;
    })(),
    team,
  });
}
