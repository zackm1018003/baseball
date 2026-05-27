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

function ipToOuts(ip: string): number {
  const parts = (ip || '0').split('.');
  const innings = parseInt(parts[0]) || 0;
  const extra   = parseInt(parts[1] || '0');
  return innings * 3 + extra;
}

function outsToIp(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

// ── Internal fetch ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchDailyData(baseUrl: string, playerId: string, date: string): Promise<any> {
  const url = `${baseUrl}/api/pitcher-daily?playerId=${playerId}&date=${date}`;
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

  // ── 1. Probe to get availableDates ────────────────────────────────────────
  const probeDates = [
    `${year}-06-10`, `${year}-05-20`, `${year}-04-25`,
    `${year}-04-01`, `${year}-03-15`,
    new Date().toISOString().slice(0, 10),
  ];

  let probe = null;
  let availableDates: string[] = [];

  for (const d of probeDates) {
    if (probe) break;
    probe = await fetchDailyData(origin, playerId, d);
    if (probe?.availableDates?.length) availableDates = probe.availableDates as string[];
  }

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

  const { playerName, playerHeight, playerWeight, playerBirthDate,
          playerPitchHand, playerBatSide } = probe;

  // ── 2. Filter to requested year ───────────────────────────────────────────
  const yearDates = availableDates.filter(d => d.startsWith(year)).sort();

  if (yearDates.length === 0) {
    return NextResponse.json({
      error: `No games found for ${year}.`,
      playerName, playerHeight, playerWeight, playerBirthDate,
      playerPitchHand, playerBatSide,
      games: [], totals: null, pitchTypes: [], rawDots: [],
      team: null, season: year,
    }, { status: 200 });
  }

  // ── 3. Fetch every game date in parallel ──────────────────────────────────
  const results = await Promise.all(
    yearDates.map(d => fetchDailyData(origin, playerId, d))
  );

  // ── 4. Aggregate ──────────────────────────────────────────────────────────
  let totalOuts    = 0;
  let h = 0, er = 0, bb = 0, k = 0, hr = 0, totalPitches = 0, bf = 0;
  let strikePctSum = 0, strikePctCount = 0;
  let whiffPctSum  = 0, whiffPctCount  = 0;
  let team: string | null = null;

  const allRawDots: unknown[] = [];

  // Per-pitch-type running totals keyed by name
  const ptGroups: Record<string, {
    count: number;
    veloSum: number; veloCount: number; maxVelo: number | null;
    spinSum: number; spinCount: number;
    hbSum: number;  hbCount: number;
    vbSum: number;  vbCount: number;
    whiffs: number; swings: number;
    inZoneApprox: number; // zone_pct/100 * count
  }> = {};

  const games: {
    date: string; dateShort: string; opponent: string | null;
    opponentFull: string | null; isHome: boolean | null;
    ip: string; h: number; er: number; bb: number; k: number;
    hr: number; pitches: number; bf: number; gamePk: number | null;
  }[] = [];

  for (const data of results) {
    if (!data?.gameLine) continue;
    const gl = data.gameLine;
    const gi = data.gameInfo;
    const pd = data.pitchData;

    const outs = ipToOuts(gl.ip || '0');
    totalOuts    += outs;
    h            += gl.h      ?? 0;
    er           += gl.er     ?? 0;
    bb           += gl.bb     ?? 0;
    k            += gl.k      ?? 0;
    hr           += gl.hr     ?? 0;
    totalPitches += gl.pitches ?? 0;
    bf           += gl.bf     ?? 0;

    if (!team && gi?.team) team = gi.team;

    if (pd?.strikePct     != null) { strikePctSum += pd.strikePct;     strikePctCount++; }
    if (pd?.swingAndMissPct != null) { whiffPctSum += pd.swingAndMissPct; whiffPctCount++; }

    if (pd?.rawDots?.length) allRawDots.push(...pd.rawDots);

    if (pd?.pitchTypes?.length) {
      for (const pt of pd.pitchTypes) {
        if (!ptGroups[pt.name]) {
          ptGroups[pt.name] = {
            count: 0, veloSum: 0, veloCount: 0, maxVelo: null,
            spinSum: 0, spinCount: 0, hbSum: 0, hbCount: 0,
            vbSum: 0, vbCount: 0, whiffs: 0, swings: 0, inZoneApprox: 0,
          };
        }
        const g = ptGroups[pt.name];
        g.count  += pt.count;
        if (pt.velo != null)       { g.veloSum += pt.velo * pt.count; g.veloCount += pt.count; }
        if (pt.maxVelo != null)    { g.maxVelo = g.maxVelo === null ? pt.maxVelo : Math.max(g.maxVelo, pt.maxVelo); }
        if (pt.spin != null)       { g.spinSum += pt.spin * pt.count; g.spinCount += pt.count; }
        if (pt.h_movement != null) { g.hbSum += pt.h_movement * pt.count; g.hbCount += pt.count; }
        if (pt.v_movement != null) { g.vbSum += pt.v_movement * pt.count; g.vbCount += pt.count; }
        g.whiffs       += pt.whiffs ?? 0;
        g.swings       += pt.swings ?? 0;
        if (pt.zone_pct != null)   g.inZoneApprox += (pt.zone_pct / 100) * pt.count;
      }
    }

    games.push({
      date:         gl.date,
      dateShort:    formatDateShort(gl.date),
      opponent:     gi?.opponent     ?? null,
      opponentFull: gi?.opponentFull ?? null,
      isHome:       gi?.isHome       ?? null,
      ip:           gl.ip     ?? '0',
      h:            gl.h      ?? 0,
      er:           gl.er     ?? 0,
      bb:           gl.bb     ?? 0,
      k:            gl.k      ?? 0,
      hr:           gl.hr     ?? 0,
      pitches:      gl.pitches ?? 0,
      bf:           gl.bf     ?? 0,
      gamePk:       gi?.gamePk ?? null,
    });
  }

  // Newest first
  games.reverse();

  // ── 5. Finalize pitch types ───────────────────────────────────────────────
  const totalCount = Object.values(ptGroups).reduce((s, g) => s + g.count, 0);
  const pitchTypes = Object.entries(ptGroups)
    .map(([name, g]) => ({
      name,
      count:       g.count,
      usage:       totalCount > 0 ? Math.round(g.count / totalCount * 1000) / 10 : 0,
      velo:        g.veloCount > 0 ? Math.round(g.veloSum  / g.veloCount  * 10) / 10 : null,
      maxVelo:     g.maxVelo,
      spin:        g.spinCount > 0 ? Math.round(g.spinSum  / g.spinCount) : null,
      h_movement:  g.hbCount   > 0 ? Math.round(g.hbSum   / g.hbCount   * 10) / 10 : null,
      v_movement:  g.vbCount   > 0 ? Math.round(g.vbSum   / g.vbCount   * 10) / 10 : null,
      whiff:       g.swings    > 0 ? Math.round(g.whiffs  / g.swings    * 1000) / 10 : null,
      whiffs:      g.whiffs,
      swings:      g.swings,
      zone_pct:    g.count     > 0 ? Math.round(g.inZoneApprox / g.count * 1000) / 10 : null,
    }))
    .sort((a, b) => b.count - a.count);

  // ── 6. Season-level computed stats ────────────────────────────────────────
  const ip    = outsToIp(totalOuts);
  const era   = totalOuts > 0 ? Math.round(er * 27 / totalOuts * 100) / 100 : null;
  const whip  = totalOuts > 0 ? Math.round((bb + h) * 3 / totalOuts * 100) / 100 : null;
  const kPct  = bf > 0       ? Math.round(k  / bf * 1000) / 10 : null;
  const bbPct = bf > 0       ? Math.round(bb / bf * 1000) / 10 : null;
  const k9    = totalOuts > 0 ? Math.round(k  * 27 / totalOuts * 10) / 10 : null;
  const bb9   = totalOuts > 0 ? Math.round(bb * 27 / totalOuts * 10) / 10 : null;
  const h9    = totalOuts > 0 ? Math.round(h  * 27 / totalOuts * 10) / 10 : null;

  return NextResponse.json({
    playerId: parseInt(playerId),
    playerName, playerHeight, playerWeight, playerBirthDate,
    playerPitchHand, playerBatSide,
    season: year, team,
    games,
    pitchTypes,
    rawDots: allRawDots,
    totals: {
      games:   games.length,
      ip, totalOuts, h, er, bb, k, hr, bf,
      era, whip, kPct, bbPct, k9, bb9, h9,
      strikePct:      strikePctCount > 0 ? Math.round(strikePctSum / strikePctCount * 10) / 10 : null,
      swingAndMissPct: whiffPctCount > 0 ? Math.round(whiffPctSum  / whiffPctCount  * 10) / 10 : null,
    },
  });
}
