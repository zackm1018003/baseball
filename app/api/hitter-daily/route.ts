import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

/**
 * GET /api/hitter-daily?playerId=592450&date=2025-04-15
 *
 * Returns:
 *   - gameLine: that game's traditional hitting line (AB, H, HR, RBI, BB, K, etc.)
 *   - pitchData: every pitch the batter saw, with location + outcome
 *   - gameInfo: opponent, date, home/away, gamePk
 */

const MLB_API = 'https://statsapi.mlb.com/api/v1';
const SAVANT_BASE = 'https://baseballsavant.mlb.com/statcast_search/csv';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchJSON(url: string, noCache = false) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    ...(noCache ? { cache: 'no-store' } : { next: { revalidate: 300 } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://baseballsavant.mlb.com/',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    const text = await res.text();
    return text.startsWith('\uFEFF') ? text.slice(1) : text;
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePitcherNames(ids: string[]): Promise<Record<string, string>> {
  const validIds = ids.filter(id => /^\d+$/.test(id));
  if (validIds.length === 0) return {};
  try {
    const data = await fetchJSON(`${MLB_API}/people?personIds=${validIds.join(',')}`);
    const result: Record<string, string> = {};
    for (const p of (data?.people ?? [])) {
      result[String(p.id)] = p.fullName || String(p.id);
    }
    return result;
  } catch { return {}; }
}

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values: string[] = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { values.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    values.push(cur.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

const PITCH_TYPE_MAP: Record<string, string | null> = {
  FF: '4-Seam Fastball',
  FA: '4-Seam Fastball',
  SI: 'Sinker',
  FC: 'Cutter',
  FS: 'Splitter',
  FO: 'Splitter',
  SL: 'Slider',
  ST: 'Sweeper',
  SV: 'Slurve',
  CH: 'Changeup',
  CU: 'Curveball',
  CS: 'Curveball',
  KC: 'Knuckle Curve',
  KN: null,
  EP: null,
  PO: null,
  IN: null,
  AB: null,
  NP: null,
};

function checkBarrel(ev: number, la: number): boolean {
  if (isNaN(ev) || isNaN(la) || ev < 98) return false;
  const delta = Math.min(ev, 116) - 98;
  return la >= Math.max(8, 26 - delta) && la <= Math.min(50, 30 + delta);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type HitterRawDot = {
  pitchType: string;
  px: number;
  pz: number;
  isWhiff: boolean;
  isBarrel: boolean;
  isSwing: boolean;   // any swing (whiff, foul, or in-play)
  isTake: boolean;    // no swing (ball or called strike)
  exitVelo: number | null;
};

export type HitterHitDot = {
  hcX: number;
  hcY: number;
  result: string;     // e.g. 'single', 'double', 'home_run', 'field_out', etc.
};

export type HitterPitchTypeStat = {
  name: string;
  count: number;
  swings: number;
  whiffs: number;
  contacts: number;  // swings - whiffs
  inZone: number;
};

export type AtBatPitch = {
  pitchNum: number;
  pitchType: string;
  velo: number | null;
  hBreak: number | null;   // inches
  ivBreak: number | null;  // inches
  description: string;
  exitVelo: number | null;
  launchAngle: number | null;
};

export type AtBat = {
  atBatNum: number;
  pitcherName: string;
  result: string;
  pitches: AtBatPitch[];
};

// ─── Aggregation — Savant CSV ─────────────────────────────────────────────────

function aggregateHitterCsv(rows: Record<string, string>[]) {
  const rawDots: HitterRawDot[] = [];
  const hitDots: HitterHitDot[] = [];
  const groups: Record<string, HitterPitchTypeStat> = {};
  let totalPitches = 0;

  for (const row of rows) {
    const rawType = row.pitch_type;
    const mapped = PITCH_TYPE_MAP[rawType];
    if (mapped === null || mapped === undefined) continue;

    totalPitches++;

    const desc = (row.description || '').toLowerCase();
    const isWhiff = desc === 'swinging_strike' || desc === 'swinging_strike_blocked' || desc === 'foul_tip';
    const isSwing = isWhiff || desc.includes('foul') || desc === 'hit_into_play' || desc.includes('hit_into_play');
    const isTake = !isSwing;

    const exitVeloRaw = parseFloat(row.launch_speed);
    const launchAngle = parseFloat(row.launch_angle);
    const isBarrel = isSwing && !isWhiff && checkBarrel(exitVeloRaw, launchAngle);

    const pxRaw = parseFloat(row.plate_x);
    const pzRaw = parseFloat(row.plate_z);

    if (!isNaN(pxRaw) && !isNaN(pzRaw)) {
      rawDots.push({
        pitchType: mapped,
        px: pxRaw,
        pz: pzRaw,
        isWhiff,
        isBarrel,
        isSwing,
        isTake,
        exitVelo: !isNaN(exitVeloRaw) ? exitVeloRaw : null,
      });
    }

    // Spray chart: capture landing location for balls in play
    if (desc === 'hit_into_play') {
      const hcX = parseFloat(row.hc_x);
      const hcY = parseFloat(row.hc_y);
      const events = (row.events || '').trim();
      if (events && !isNaN(hcX) && !isNaN(hcY)) {
        hitDots.push({ hcX, hcY, result: events });
      }
    }

    if (!groups[mapped]) {
      groups[mapped] = { name: mapped, count: 0, swings: 0, whiffs: 0, contacts: 0, inZone: 0 };
    }
    const g = groups[mapped];
    g.count++;
    if (isSwing) g.swings++;
    if (isWhiff) g.whiffs++;
    if (isSwing && !isWhiff) g.contacts++;
    if (!isNaN(pxRaw) && !isNaN(pzRaw) && Math.abs(pxRaw) <= 0.708 && pzRaw >= 1.5 && pzRaw <= 3.5) {
      g.inZone++;
    }
  }

  const pitchTypes = Object.values(groups).sort((a, b) => b.count - a.count);

  // ── At-bat breakdown ──────────────────────────────────────────────────────
  const abMap: Record<number, AtBat> = {};
  const SKIP = ['NP', 'PO', 'IN', 'AB'];
  for (const row of rows) {
    const rawType = row.pitch_type;
    if (!rawType || SKIP.includes(rawType)) continue;
    const abNum = parseInt(row.at_bat_number);
    if (isNaN(abNum)) continue;

    const mapped = PITCH_TYPE_MAP[rawType];
    const displayType = (typeof mapped === 'string' ? mapped : null) ?? rawType;

    if (!abMap[abNum]) {
      // row.player_name = batter when player_type=batter; use pitcher ID instead
      abMap[abNum] = { atBatNum: abNum, pitcherName: row.pitcher || 'Unknown', result: '', pitches: [] };
    }
    const events = (row.events || '').trim();
    if (events) abMap[abNum].result = events;

    const pitchNum = parseInt(row.pitch_number);
    const velo  = parseFloat(row.release_speed);
    const pfxX  = parseFloat(row.pfx_x);  // feet
    const pfxZ  = parseFloat(row.pfx_z);  // feet
    const ev    = parseFloat(row.launch_speed);
    const la    = parseFloat(row.launch_angle);

    abMap[abNum].pitches.push({
      pitchNum:    isNaN(pitchNum) ? abMap[abNum].pitches.length + 1 : pitchNum,
      pitchType:   displayType,
      velo:        !isNaN(velo)  ? Math.round(velo * 10) / 10  : null,
      hBreak:      !isNaN(pfxX)  ? Math.round(pfxX * 12 * 10) / 10 : null,
      ivBreak:     !isNaN(pfxZ)  ? Math.round(pfxZ * 12 * 10) / 10 : null,
      description: row.description || '',
      exitVelo:    !isNaN(ev)    ? Math.round(ev * 10) / 10   : null,
      launchAngle: !isNaN(la)    ? Math.round(la * 10) / 10   : null,
    });
  }
  const atBats = Object.values(abMap).sort((a, b) => a.atBatNum - b.atBatNum);
  for (const ab of atBats) ab.pitches.sort((p, q) => p.pitchNum - q.pitchNum);

  return { totalPitches, rawDots, pitchTypes, atBats, hitDots };
}

// ─── Aggregation — Savant /gf ─────────────────────────────────────────────────

function aggregateHitterGf(pitches: Record<string, unknown>[]) {
  const rawDots: HitterRawDot[] = [];
  const hitDots: HitterHitDot[] = [];
  const groups: Record<string, HitterPitchTypeStat> = {};
  let totalPitches = 0;

  for (const pitch of pitches) {
    const rawType = String(pitch.pitch_type ?? '');
    const mapped = PITCH_TYPE_MAP[rawType];
    if (mapped === null || mapped === undefined) continue;

    totalPitches++;

    const desc = String(pitch.description ?? pitch.call_name ?? '').toLowerCase();
    const isWhiff = desc === 'swinging strike' || desc === 'swinging strike (blocked)' || desc.includes('swinging strike') || desc === 'foul tip';
    const isSwing = isWhiff || desc.includes('foul') || desc.includes('in play') || desc.includes('hit into play');
    const isTake = !isSwing;

    const exitVeloRaw = Number(pitch.launch_speed ?? pitch.hit_speed ?? NaN);
    const launchAngle = Number(pitch.launch_angle ?? NaN);
    const isBarrel = isSwing && !isWhiff && checkBarrel(exitVeloRaw, launchAngle);

    const pxRaw = Number(pitch.px);
    const pzRaw = Number(pitch.pz);

    if (!isNaN(pxRaw) && !isNaN(pzRaw)) {
      rawDots.push({
        pitchType: mapped,
        px: pxRaw,
        pz: pzRaw,
        isWhiff,
        isBarrel,
        isSwing,
        isTake,
        exitVelo: !isNaN(exitVeloRaw) ? exitVeloRaw : null,
      });
    }

    // Spray chart: capture landing location for balls in play
    const isInPlay = desc.includes('in play') || desc.includes('hit into play');
    if (isInPlay) {
      const hcX = Number(pitch.hc_x ?? NaN);
      const hcY = Number(pitch.hc_y ?? NaN);
      const events = String(pitch.events ?? '').trim();
      if (events && !isNaN(hcX) && !isNaN(hcY) && hcX > 0) {
        hitDots.push({ hcX, hcY, result: events });
      }
    }

    if (!groups[mapped]) {
      groups[mapped] = { name: mapped, count: 0, swings: 0, whiffs: 0, contacts: 0, inZone: 0 };
    }
    const g = groups[mapped];
    g.count++;
    if (isSwing) g.swings++;
    if (isWhiff) g.whiffs++;
    if (isSwing && !isWhiff) g.contacts++;
    if (!isNaN(pxRaw) && !isNaN(pzRaw) && Math.abs(pxRaw) <= 0.708 && pzRaw >= 1.5 && pzRaw <= 3.5) {
      g.inZone++;
    }
  }

  const pitchTypes = Object.values(groups).sort((a, b) => b.count - a.count);

  // ── At-bat breakdown ──────────────────────────────────────────────────────
  const abMap: Record<number, AtBat> = {};
  const SKIP_GF = ['NP', 'PO', 'IN', 'AB'];
  for (const pitch of pitches) {
    const rawType = String(pitch.pitch_type ?? '');
    if (!rawType || SKIP_GF.includes(rawType)) continue;
    const abNum = parseInt(String(pitch.at_bat_number ?? pitch.ab_number ?? ''));
    if (isNaN(abNum)) continue;

    const mapped = PITCH_TYPE_MAP[rawType];
    const displayType = (typeof mapped === 'string' ? mapped : null) ?? rawType;

    if (!abMap[abNum]) {
      const pitcherName = String(pitch.player_name ?? pitch.pitcher_name ?? 'Unknown');
      abMap[abNum] = { atBatNum: abNum, pitcherName, result: '', pitches: [] };
    }
    const events = String(pitch.events ?? '').trim();
    if (events) abMap[abNum].result = events;

    const pitchNum = parseInt(String(pitch.pitch_number ?? ''));
    const velo  = Number(pitch.release_speed ?? pitch.start_speed ?? NaN);
    const pfxX  = Number(pitch.pfx_x ?? NaN);
    const pfxZ  = Number(pitch.pfx_z ?? NaN);
    const ev    = Number(pitch.launch_speed ?? pitch.hit_speed ?? NaN);
    const la    = Number(pitch.launch_angle ?? NaN);

    abMap[abNum].pitches.push({
      pitchNum:    isNaN(pitchNum) ? abMap[abNum].pitches.length + 1 : pitchNum,
      pitchType:   displayType,
      velo:        !isNaN(velo)  ? Math.round(velo * 10) / 10  : null,
      hBreak:      !isNaN(pfxX)  ? Math.round(pfxX * 12 * 10) / 10 : null,
      ivBreak:     !isNaN(pfxZ)  ? Math.round(pfxZ * 12 * 10) / 10 : null,
      description: String(pitch.description ?? pitch.call_name ?? ''),
      exitVelo:    !isNaN(ev)    ? Math.round(ev * 10) / 10   : null,
      launchAngle: !isNaN(la)    ? Math.round(la * 10) / 10   : null,
    });
  }
  const atBats = Object.values(abMap).sort((a, b) => a.atBatNum - b.atBatNum);
  for (const ab of atBats) ab.pitches.sort((p, q) => p.pitchNum - q.pitchNum);

  return { totalPitches, rawDots, pitchTypes, atBats, hitDots };
}

// ─── Collect hitter pitches from /gf by scanning all pitchers ────────────────

async function fetchGfHitterData(gamePk: number, playerId: string) {
  try {
    const gf = await fetchJSON(`https://baseballsavant.mlb.com/gf?game_pk=${gamePk}`, true);
    const pidStr = String(playerId);
    const allPitches: Record<string, unknown>[] = [];

    const homePitchers = (gf?.home_pitchers ?? {}) as Record<string, Record<string, unknown>[]>;
    const awayPitchers = (gf?.away_pitchers ?? {}) as Record<string, Record<string, unknown>[]>;

    for (const pitcherPitches of [...Object.values(homePitchers), ...Object.values(awayPitchers)]) {
      if (!Array.isArray(pitcherPitches)) continue;
      for (const pitch of pitcherPitches) {
        const batterId = String(pitch.batter ?? pitch.batter_id ?? '');
        if (batterId === pidStr) allPitches.push(pitch);
      }
    }

    if (allPitches.length === 0) return null;
    console.log(`[GF Hitter] gamePk=${gamePk} pid=${pidStr} pitches=${allPitches.length}`);
    return aggregateHitterGf(allPitches);
  } catch (e) {
    console.warn('[GF Hitter] fetch failed:', e);
    return null;
  }
}

// ─── Aggregation — Stats API live feed (college/non-MLB games) ────────────────

async function fetchStatsApiHitterData(gamePk: number, playerId: string) {
  try {
    const feed = await fetchJSON(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`, true);
    const allPlays: Record<string, unknown>[] = feed?.liveData?.plays?.allPlays ?? [];
    const pidNum = parseInt(playerId);
    const rawDots: HitterRawDot[] = [];
    const hitDots: HitterHitDot[] = [];
    const groups: Record<string, HitterPitchTypeStat> = {};
    let totalPitches = 0;
    const abMap: Record<number, AtBat> = {};

    for (const play of allPlays) {
      const matchup = play.matchup as Record<string, unknown> | undefined;
      if ((matchup?.batter as Record<string, unknown>)?.id !== pidNum) continue;
      const abNum = Number(play.atBatIndex ?? 0) + 1;
      const pitcherName = String((matchup?.pitcher as Record<string, unknown>)?.fullName ?? 'Unknown');
      const resultStr = String((play.result as Record<string, unknown>)?.eventType ?? '');
      if (!abMap[abNum]) abMap[abNum] = { atBatNum: abNum, pitcherName, result: resultStr, pitches: [] };
      if (resultStr) abMap[abNum].result = resultStr;

      for (const event of ((play.playEvents as Record<string, unknown>[]) ?? [])) {
        if (!event.isPitch) continue;
        const pd = event.pitchData as Record<string, unknown> | undefined;
        const coords = (pd?.coordinates as Record<string, unknown>) ?? {};
        const details = event.details as Record<string, unknown> | undefined;
        const hd = event.hitData as Record<string, unknown> | undefined;
        const rawType = String((details?.type as Record<string, unknown>)?.code ?? '');
        const mapped = PITCH_TYPE_MAP[rawType];
        if (mapped === null || mapped === undefined) continue;

        totalPitches++;
        const desc = String(details?.description ?? '').toLowerCase();
        const isWhiff = desc.includes('swinging strike') || desc === 'foul tip';
        const isSwing = isWhiff || desc.includes('foul') || desc.includes('in play') || desc.includes('hit');
        const isTake = !isSwing;
        const ev = Number(hd?.launchSpeed ?? NaN);
        const la = Number(hd?.launchAngle ?? NaN);
        const isBarrel = isSwing && !isWhiff && checkBarrel(ev, la);
        const pxRaw = Number(coords.pX ?? NaN);
        const pzRaw = Number(coords.pZ ?? NaN);

        if (!isNaN(pxRaw) && !isNaN(pzRaw)) {
          rawDots.push({ pitchType: mapped, px: pxRaw, pz: pzRaw, isWhiff, isBarrel, isSwing, isTake, exitVelo: !isNaN(ev) ? ev : null });
        }
        // Spray chart: capture landing location for balls in play
        if (isSwing && !isWhiff && hd) {
          const hitCoords = (hd.coordinates as Record<string, unknown>) ?? {};
          const hcX = Number(hitCoords.coordX ?? NaN);
          const hcY = Number(hitCoords.coordY ?? NaN);
          if (!isNaN(hcX) && !isNaN(hcY) && hcX > 0 && resultStr) {
            hitDots.push({ hcX, hcY, result: resultStr });
          }
        }
        if (!groups[mapped]) groups[mapped] = { name: mapped, count: 0, swings: 0, whiffs: 0, contacts: 0, inZone: 0 };
        const g = groups[mapped];
        g.count++;
        if (isSwing) g.swings++;
        if (isWhiff) g.whiffs++;
        if (isSwing && !isWhiff) g.contacts++;
        if (!isNaN(pxRaw) && !isNaN(pzRaw) && Math.abs(pxRaw) <= 0.708 && pzRaw >= 1.5 && pzRaw <= 3.5) g.inZone++;

        const velo = Number(pd?.startSpeed ?? NaN);
        const pfxX = Number(coords.pfxX ?? NaN);
        const pfxZ = Number(coords.pfxZ ?? NaN);
        const pitchNum = Number(event.pitchNumber ?? abMap[abNum].pitches.length + 1);
        abMap[abNum].pitches.push({
          pitchNum,
          pitchType: mapped,
          velo: !isNaN(velo) ? Math.round(velo * 10) / 10 : null,
          hBreak: !isNaN(pfxX) ? Math.round(pfxX * 12 * 10) / 10 : null,
          ivBreak: !isNaN(pfxZ) ? Math.round(pfxZ * 12 * 10) / 10 : null,
          description: String(details?.description ?? ''),
          exitVelo: !isNaN(ev) ? Math.round(ev * 10) / 10 : null,
          launchAngle: !isNaN(la) ? Math.round(la * 10) / 10 : null,
        });
      }
    }

    if (totalPitches === 0) return null;
    const pitchTypes = Object.values(groups).sort((a, b) => b.count - a.count);
    const atBats = Object.values(abMap).sort((a, b) => a.atBatNum - b.atBatNum);
    for (const ab of atBats) ab.pitches.sort((p, q) => p.pitchNum - q.pitchNum);
    console.log(`[StatsApi Hitter] gamePk=${gamePk} pid=${playerId} pitches=${totalPitches}`);
    return { totalPitches, rawDots, pitchTypes, atBats, hitDots };
  } catch (e) {
    console.warn('[StatsApi Hitter] fetch failed:', e);
    return null;
  }
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const dateParam = searchParams.get('date');

  if (!playerId) {
    return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  }

  const targetDate = dateParam || new Date().toISOString().slice(0, 10);
  const isToday = targetDate === new Date().toISOString().slice(0, 10);
  const season = parseInt(targetDate.slice(0, 4));
  const isSpringOrExhibition = parseInt(targetDate.slice(5, 7)) <= 3;

  try {
    // ── 1. Player bio ────────────────────────────────────────────────────────
    let playerName: string | null = null;
    let playerHeight: string | null = null;
    let playerWeight: number | null = null;
    let playerBirthDate: string | null = null;
    let playerPitchHand: string | null = null;
    let playerBatSide: string | null = null;

    try {
      const personData = await fetchJSON(`${MLB_API}/people/${playerId}`, isToday);
      const person = personData?.people?.[0];
      playerName = person?.fullName ?? null;
      playerHeight = person?.height ?? null;
      playerWeight = person?.weight ?? null;
      playerBirthDate = person?.birthDate ?? null;
      playerPitchHand = person?.pitchHand?.code ?? null;
      playerBatSide = person?.batSide?.code ?? null;
    } catch { /* non-fatal */ }

    // ── 2. Hitting game log ──────────────────────────────────────────────────
    const gameLogUrl = `${MLB_API}/people/${playerId}/stats?stats=gameLog&group=hitting&season=${season}&sportId=1&hydrate=person`;
    const gameLogData = await fetchJSON(gameLogUrl, isToday);

    const splits: {
      date?: string;
      stat: {
        atBats?: number; hits?: number; homeRuns?: number; rbi?: number;
        baseOnBalls?: number; strikeOuts?: number; doubles?: number; triples?: number;
        plateAppearances?: number; stolenBases?: number;
      };
      team?: { name?: string; abbreviation?: string; id?: number };
      opponent?: { name?: string; abbreviation?: string; id?: number };
      isHome?: boolean;
      game?: { gamePk?: number; gameDate?: string };
    }[] = gameLogData?.stats?.[0]?.splits ?? [];

    const availableDates = splits
      .map(s => ({
        date: s.date || s.game?.gameDate?.slice(0, 10) || '',
        opponent: s.opponent?.abbreviation || s.opponent?.name || '?',
        ab: s.stat?.atBats ?? 0,
        h: s.stat?.hits ?? 0,
        hr: s.stat?.homeRuns ?? 0,
        k: s.stat?.strikeOuts ?? 0,
        gamePk: s.game?.gamePk,
      }))
      .filter(d => d.date)
      .sort((a, b) => b.date.localeCompare(a.date));

    const matchedSplit = splits.find(s => {
      const splitDate = s.date || s.game?.gameDate?.slice(0, 10) || '';
      return splitDate === targetDate || splitDate.startsWith(targetDate);
    });

    // ── 3. Spring Training fallback (live game feed) ─────────────────────────
    if (!matchedSplit) {
      try {
        const scheduleData = await fetchJSON(
          `${MLB_API}/schedule?startDate=${targetDate}&endDate=${targetDate}&sportId=1,22`,
          isToday
        );
        const scheduledGames = scheduleData?.dates?.[0]?.games ?? [];

        for (const g of scheduledGames) {
          try {
            const feed = await fetchJSON(`https://statsapi.mlb.com/api/v1.1/game/${g.gamePk}/feed/live`, isToday);
            const homeBox = feed?.liveData?.boxscore?.teams?.home;
            const awayBox = feed?.liveData?.boxscore?.teams?.away;
            const homeBatters: number[] = homeBox?.batters ?? [];
            const awayBatters: number[] = awayBox?.batters ?? [];
            const pid = parseInt(playerId);
            const isHome = homeBatters.includes(pid);
            const isAway = awayBatters.includes(pid);
            if (!isHome && !isAway) continue;

            const box = isHome ? homeBox : awayBox;
            const playerData = box?.players?.[`ID${pid}`];
            const bStats = playerData?.gameStats?.batting ?? playerData?.stats?.batting;
            if (!bStats) continue;

            const homeTeam = feed?.gameData?.teams?.home;
            const awayTeam = feed?.gameData?.teams?.away;
            const myTeam = isHome ? homeTeam : awayTeam;
            const oppTeam = isHome ? awayTeam : homeTeam;

            const stGameLine = {
              date: targetDate,
              ab: bStats.atBats ?? 0,
              h: bStats.hits ?? 0,
              hr: bStats.homeRuns ?? 0,
              rbi: bStats.rbi ?? 0,
              bb: bStats.baseOnBalls ?? 0,
              k: bStats.strikeOuts ?? 0,
              doubles: bStats.doubles ?? 0,
              triples: bStats.triples ?? 0,
              pa: bStats.plateAppearances ?? 0,
              sb: bStats.stolenBases ?? 0,
            };
            const stGameInfo = {
              gamePk: g.gamePk,
              opponent: oppTeam?.abbreviation || oppTeam?.teamName || null,
              opponentFull: oppTeam?.name || null,
              team: myTeam?.abbreviation || null,
              isHome,
              date: targetDate,
            };

            // Statcast for spring training
            let stPitchData = null;
            try {
              stPitchData = await fetchGfHitterData(g.gamePk, playerId);
              if (!stPitchData) {
                const savantUrl = `${SAVANT_BASE}?all=true&type=details&batters_lookup%5B%5D=${playerId}&player_type=batter&game_date_gt=${targetDate}&game_date_lt=${targetDate}&hfGT=S%7CE%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`;
                const csvText = await fetchText(savantUrl);
                if (csvText.includes('pitch_type')) {
                  const rows = parseCSV(csvText);
                  const pidStr = String(playerId).trim();
                  const gpStr = String(g.gamePk).trim();
                  const filtered = rows.filter(r => r.game_pk?.trim() === gpStr && r.batter?.trim() === pidStr);
                  if (filtered.length > 0) stPitchData = aggregateHitterCsv(filtered);
                }
              }
              // Resolve pitcher IDs → names for CSV path
              if (stPitchData?.atBats?.length) {
                const ids = [...new Set(stPitchData.atBats.map(ab => ab.pitcherName))];
                if (ids.some(id => /^\d+$/.test(id))) {
                  const nameMap = await resolvePitcherNames(ids);
                  for (const ab of stPitchData.atBats) {
                    ab.pitcherName = nameMap[ab.pitcherName] || `#${ab.pitcherName}`;
                  }
                }
              }
              // Final fallback: Stats API live feed (college/non-Savant games)
              if (!stPitchData) {
                stPitchData = await fetchStatsApiHitterData(g.gamePk, playerId);
              }
            } catch (e) { console.warn('[ST Hitter Statcast] error:', e); }

            return NextResponse.json({
              playerId: parseInt(playerId),
              playerName, playerHeight, playerWeight, playerBirthDate, playerPitchHand, playerBatSide,
              date: targetDate, gameLine: stGameLine, gameInfo: stGameInfo, pitchData: stPitchData, availableDates,
            });
          } catch { continue; }
        }
      } catch { /* fall through */ }

      return NextResponse.json({
        error: `No game found for this hitter on ${targetDate}.`,
        playerName, playerHeight, playerWeight, playerBirthDate, playerPitchHand, playerBatSide,
        availableDates,
      }, { status: 404 });
    }

    // ── 4. Build game line & info ─────────────────────────────────────────────
    const stat = matchedSplit.stat;
    const gamePk = matchedSplit.game?.gamePk ?? null;

    const gameLine = {
      date: targetDate,
      ab: stat.atBats ?? 0,
      h: stat.hits ?? 0,
      hr: stat.homeRuns ?? 0,
      rbi: stat.rbi ?? 0,
      bb: stat.baseOnBalls ?? 0,
      k: stat.strikeOuts ?? 0,
      doubles: stat.doubles ?? 0,
      triples: stat.triples ?? 0,
      pa: stat.plateAppearances ?? 0,
      sb: stat.stolenBases ?? 0,
    };

    const gameInfo = {
      gamePk: gamePk ?? null,
      opponent: matchedSplit.opponent?.abbreviation || matchedSplit.opponent?.name || null,
      opponentFull: matchedSplit.opponent?.name || null,
      team: matchedSplit.team?.abbreviation || null,
      isHome: matchedSplit.isHome ?? null,
      date: targetDate,
    };

    // ── 5. Statcast pitch-by-pitch ────────────────────────────────────────────
    let pitchData = null;
    try {
      const savantUrl = isSpringOrExhibition
        ? `${SAVANT_BASE}?all=true&type=details&batters_lookup%5B%5D=${playerId}&player_type=batter&game_date_gt=${targetDate}&game_date_lt=${targetDate}&hfGT=S%7CE%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`
        : `${SAVANT_BASE}?all=true&type=details&batters_lookup%5B%5D=${playerId}&player_type=batter&game_date_gt=${targetDate}&game_date_lt=${targetDate}&hfSea=${season}%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`;

      try {
        const csvText = await fetchText(savantUrl);
        if (csvText.includes('pitch_type')) {
          const rows = parseCSV(csvText);
          const pidStr = String(playerId).trim();
          const gpStr = gamePk ? String(gamePk).trim() : null;
          const filtered = rows.filter(r => {
            const pkMatch = gpStr ? r.game_pk?.trim() === gpStr : true;
            return pkMatch && r.batter?.trim() === pidStr;
          });
          if (filtered.length > 0) pitchData = aggregateHitterCsv(filtered);
        }
      } catch (csvErr) {
        console.warn('[Hitter CSV] fetch failed:', csvErr);
      }

      // Fall back to /gf if CSV empty (same-day game)
      if (!pitchData && gamePk) {
        pitchData = await fetchGfHitterData(gamePk, playerId);
      }
      // Last resort: Stats API live feed (college/non-Savant games)
      if (!pitchData && gamePk) {
        pitchData = await fetchStatsApiHitterData(gamePk, playerId);
      }

      // Resolve pitcher IDs → names (CSV stores numeric pitcher ID, not name)
      if (pitchData?.atBats?.length) {
        const ids = [...new Set(pitchData.atBats.map(ab => ab.pitcherName))];
        if (ids.some(id => /^\d+$/.test(id))) {
          const nameMap = await resolvePitcherNames(ids);
          for (const ab of pitchData.atBats) {
            ab.pitcherName = nameMap[ab.pitcherName] || `#${ab.pitcherName}`;
          }
        }
      }
    } catch (e) {
      console.warn('Hitter Statcast fetch failed:', e);
    }

    return NextResponse.json({
      playerId: parseInt(playerId),
      playerName, playerHeight, playerWeight, playerBirthDate, playerPitchHand, playerBatSide,
      date: targetDate, gameLine, gameInfo, pitchData, availableDates,
    });

  } catch (err) {
    console.error('hitter-daily route error:', err);
    return NextResponse.json({ error: 'Failed to fetch hitter data' }, { status: 500 });
  }
}
