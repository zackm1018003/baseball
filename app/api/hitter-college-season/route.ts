import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// ── Date helpers ───────────────────────────────────────────────────────────────

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchDailyData(baseUrl: string, playerId: string, date: string): Promise<any> {
  const url = `${baseUrl}/api/hitter-daily?playerId=${playerId}&date=${date}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok && res.status !== 404) return null;
  let data;
  try { data = await res.json(); } catch { return null; }
  if (data?.error && !data?.playerName && !data?.availableDates?.length) return null;
  return data;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const playerId = searchParams.get('playerId');
  const year     = searchParams.get('year') ?? new Date().getFullYear().toString();

  if (!playerId) {
    return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  }

  const origin = req.headers.get('x-forwarded-host')
    ? `https://${req.headers.get('x-forwarded-host')}`
    : req.nextUrl.origin;

  // ── 1. Probe to get player bio + availableDates ───────────────────────────
  // Try several dates in the target year working backwards from June, when
  // most college seasons end.
  const probeDates = [
    `${year}-06-10`, `${year}-05-20`, `${year}-04-25`,
    `${year}-04-01`, `${year}-03-15`,
    // For current year also try today
    new Date().toISOString().slice(0, 10),
  ];

  let probe = null;
  let availableDates: string[] = [];

  for (const d of probeDates) {
    if (probe) break;
    probe = await fetchDailyData(origin, playerId, d);
    if (probe?.availableDates?.length) {
      availableDates = probe.availableDates as string[];
    }
  }

  // If no availableDates found, walk back 14 days from today as fallback
  if (!probe) {
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i <= 14 && !probe; i++) {
      probe = await fetchDailyData(origin, playerId, addDays(today, -i));
      if (probe?.availableDates?.length) availableDates = probe.availableDates as string[];
    }
  }

  if (!probe) {
    return NextResponse.json({ error: 'Could not load player data.' }, { status: 404 });
  }

  const {
    playerName, playerHeight, playerWeight, playerBirthDate,
    playerBatSide, playerPitchHand,
  } = probe;

  // ── 2. Filter available dates to the requested year ───────────────────────
  const yearDates = availableDates
    .filter(d => d.startsWith(year))
    .sort(); // oldest → newest

  if (yearDates.length === 0) {
    return NextResponse.json({
      error: `No games found for ${year}.`,
      playerName, playerHeight, playerWeight, playerBirthDate,
      playerBatSide, playerPitchHand,
      games: [], totals: null, rawDots: [], hitDots: [], topAtBats: [],
      barrels: 0, barrelPct: null, avgBatSpeed: null, avgEv: null,
      maxEv: null, avgLaHard: null, ev90: null, discipline: null,
      team: null, level: null, season: year,
    }, { status: 200 });
  }

  // ── 3. Fetch every game date in parallel ──────────────────────────────────
  const results = await Promise.all(
    yearDates.map(d => fetchDailyData(origin, playerId, d))
  );

  // ── 4. Aggregate (mirrors hitter-weekly aggregation) ──────────────────────
  const totals = { ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 0,
                   doubles: 0, triples: 0, pa: 0, sb: 0 };
  const allRawDots: unknown[]  = [];
  const allHitDots: unknown[]  = [];
  let batSpeedSum   = 0, batSpeedCount = 0;
  let totalBarrels  = 0, atBatOffset   = 0;
  let team: string | null = null;
  let sportId: number | null = null;
  const allExitVelos: number[] = [];

  // Plate discipline
  let zSwings = 0, zPitches = 0, oSwings = 0, oPitches = 0;
  let zContact = 0, oContact = 0;
  let totalPitchesSeen = 0, totalSwings = 0;
  let laHardSum = 0, laHardCount = 0;

  const SWING_DESCS   = new Set(['swinging_strike','swinging_strike_blocked','foul','foul_tip','hit_into_play','foul_bunt','missed_bunt','bunt_foul_tip','in_play']);
  const CONTACT_DESCS = new Set(['foul','foul_tip','hit_into_play','foul_bunt','bunt_foul_tip','in_play']);
  const HIT_RESULTS   = new Set(['single','double','triple','home_run']);

  const allAtBats: {
    atBatNum: number; pitcherName: string; pitcherHand: string; result: string;
    pitches: unknown[]; date: string; opponent: string | null; isHome: boolean | null;
    maxEv: number | null; isBarrel: boolean; isHit: boolean; score: number;
  }[] = [];

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

    let gameEVSum = 0, gameEVCount = 0, gameBarrels = 0;
    let gameBSSum = 0, gameBSCount = 0;

    if (pd?.atBats?.length) {
      for (const ab of pd.atBats) {
        let abMaxEv: number | null = null;
        let abIsBarrel = false;
        for (const p of ab.pitches ?? []) {
          const desc      = (p.description || '').toLowerCase().replace(/ /g, '_');
          const isSwing   = SWING_DESCS.has(desc) || desc.startsWith('in_play,');
          const isContact = CONTACT_DESCS.has(desc) || desc.startsWith('in_play,');

          totalPitchesSeen++;
          if (isSwing) totalSwings++;

          if (p.exitVelo != null) {
            gameEVSum += p.exitVelo; gameEVCount++;
            allExitVelos.push(p.exitVelo);
            if (abMaxEv === null || p.exitVelo > abMaxEv) abMaxEv = p.exitVelo;
            if (p.exitVelo >= 95 && p.launchAngle != null) {
              laHardSum += p.launchAngle; laHardCount++;
            }
          }
          if (p.isBarrel) { gameBarrels++; totalBarrels++; abIsBarrel = true; }
          if (p.batSpeed != null && p.batSpeed >= 40) {
            gameBSSum += p.batSpeed; gameBSCount++;
            batSpeedSum += p.batSpeed; batSpeedCount++;
          }
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

    if (pd?.rawDots?.length) {
      for (const dot of pd.rawDots) {
        allRawDots.push({ ...(dot as object), atBatNum: (dot as { atBatNum: number }).atBatNum + atBatOffset });
      }
    }
    if (pd?.hitDots?.length) allHitDots.push(...pd.hitDots);

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
      avgEv:       gameEVCount  ? Math.round(gameEVSum  / gameEVCount  * 10) / 10 : null,
      barrels:     gameBarrels,
      avgBatSpeed: gameBSCount  ? Math.round(gameBSSum  / gameBSCount  * 10) / 10 : null,
      gamePk:      gi?.gamePk ?? null,
    });
  }

  // Newest first for display
  games.reverse();

  // Top 4 at-bats by quality score
  allAtBats.sort((a, b) => b.score - a.score);
  const topAtBats = allAtBats.slice(0, 4);

  // EV90 = avg of top 10%
  const ev90 = (() => {
    if (allExitVelos.length < 2) return null;
    const sorted = [...allExitVelos].sort((a, b) => b - a);
    const top10Count = Math.max(1, Math.round(sorted.length * 0.1));
    return Math.round(sorted.slice(0, top10Count).reduce((s, v) => s + v, 0) / top10Count * 10) / 10;
  })();

  // Level from sportId
  const levelMap: Record<number, string> = {
    1: 'MLB', 11: 'AAA', 12: 'AA', 13: 'High-A', 14: 'Low-A', 16: 'FCL', 17: 'ACL',
  };
  const level = sportId != null ? (levelMap[sportId] ?? null) : null;

  return NextResponse.json({
    playerId: parseInt(playerId),
    playerName, playerHeight, playerWeight, playerBirthDate,
    playerBatSide, playerPitchHand,
    season: year, team, level,
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
    ev90,
    discipline: {
      swingPct:    totalPitchesSeen ? Math.round(totalSwings / totalPitchesSeen * 1000) / 10 : null,
      zSwingPct:   zPitches  ? Math.round(zSwings  / zPitches  * 1000) / 10 : null,
      chasePct:    oPitches  ? Math.round(oSwings  / oPitches  * 1000) / 10 : null,
      zContactPct: zSwings   ? Math.round(zContact / zSwings   * 1000) / 10 : null,
      oContactPct: oSwings   ? Math.round(oContact / oSwings   * 1000) / 10 : null,
    },
  });
}
