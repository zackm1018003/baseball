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
import { resolveTeamAbbr } from '@/lib/resolve-team-abbr';

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
  atBatNum: number;
  pitchNum: number;
};

export type HitterHitDot = {
  hcX: number;
  hcY: number;
  hitDistance: number | null;  // actual hit distance in feet for positioning
  result: string;
  pitchType: string;
  exitVelo: number | null;
  isBarrel: boolean;
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
  batSpeed: number | null;
  exitVelo: number | null;
  launchAngle: number | null;
  hitDistance: number | null;
  hcX: number | null;
  hcY: number | null;
  isBarrel: boolean;
  zone: number | null;     // Statcast zone 1-9 = in zone, 11-14 = out of zone
};

export type AtBat = {
  atBatNum: number;
  pitcherName: string;
  pitcherHand: string;
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
    // launch_speed_angle === '6' is Statcast's official Barrel category
    const isBarrel = isSwing && !isWhiff && (
      row.launch_speed_angle !== undefined && row.launch_speed_angle !== ''
        ? Number(row.launch_speed_angle) === 6
        : checkBarrel(exitVeloRaw, launchAngle)
    );

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
        atBatNum: parseInt(row.at_bat_number ?? '0') || 0,
        pitchNum: parseInt(row.pitch_number ?? '0') || 0,
      });
    }

    // Spray chart: capture landing location for balls in play
    if (desc === 'hit_into_play') {
      const hcX = parseFloat(row.hc_x);
      const hcY = parseFloat(row.hc_y);
      const hdist = parseFloat(row.hit_distance_sc);
      const events = (row.events || '').trim();
      if (events && !isNaN(hcX) && !isNaN(hcY)) {
        hitDots.push({ hcX, hcY, hitDistance: !isNaN(hdist) && hdist > 0 ? hdist : null, result: events, pitchType: mapped, exitVelo: !isNaN(exitVeloRaw) ? exitVeloRaw : null, isBarrel });
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
      abMap[abNum] = { atBatNum: abNum, pitcherName: row.pitcher || 'Unknown', pitcherHand: row.p_throws || '', result: '', pitches: [] };
    }
    const events = (row.events || '').trim();
    if (events) abMap[abNum].result = events;

    const pitchNum = parseInt(row.pitch_number);
    const velo  = parseFloat(row.release_speed);
    const pfxX  = parseFloat(row.pfx_x);  // feet
    const pfxZ  = parseFloat(row.pfx_z);  // feet
    const bs    = parseFloat(row.bat_speed);
    const ev    = parseFloat(row.launch_speed);
    const la    = parseFloat(row.launch_angle);
    const dist  = parseFloat(row.hit_distance_sc);
    const hcXv  = parseFloat(row.hc_x);
    const hcYv  = parseFloat(row.hc_y);
    const zoneV = parseInt(row.zone);

    const abIsBarrel = row.launch_speed_angle !== undefined && row.launch_speed_angle !== ''
      ? Number(row.launch_speed_angle) === 6
      : checkBarrel(ev, la);
    abMap[abNum].pitches.push({
      pitchNum:    isNaN(pitchNum) ? abMap[abNum].pitches.length + 1 : pitchNum,
      pitchType:   displayType,
      velo:        !isNaN(velo)  ? Math.round(velo * 10) / 10  : null,
      hBreak:      !isNaN(pfxX)  ? Math.round(pfxX * 12 * 10) / 10 : null,
      ivBreak:     !isNaN(pfxZ)  ? Math.round(pfxZ * 12 * 10) / 10 : null,
      description: row.description || '',
      batSpeed:    !isNaN(bs)    ? Math.round(bs * 10) / 10   : null,
      exitVelo:    !isNaN(ev)    ? Math.round(ev * 10) / 10   : null,
      launchAngle: !isNaN(la)    ? Math.round(la * 10) / 10   : null,
      hitDistance: !isNaN(dist) && dist > 0 ? Math.round(dist) : null,
      hcX:         !isNaN(hcXv) && hcXv > 0 ? hcXv : null,
      hcY:         !isNaN(hcYv) && hcYv > 0 ? hcYv : null,
      isBarrel:    abIsBarrel,
      zone:        !isNaN(zoneV) ? zoneV : null,
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
  // GF endpoint hc_x/hc_y use ~2.12ft/unit; normalize to Statcast 2.5ft/unit scale
  const GF_SCALE = 2.12 / 2.5; // ≈ 0.848

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
    const isBarrel = isSwing && !isWhiff && (
      pitch.is_barrel !== undefined ? Number(pitch.is_barrel) === 1 : checkBarrel(exitVeloRaw, launchAngle)
    );

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
        atBatNum: parseInt(String(pitch.at_bat_number ?? pitch.ab_number ?? '0')) || 0,
        pitchNum: parseInt(String(pitch.pitch_number ?? '0')) || 0,
      });
    }

    // Spray chart: capture landing location for balls in play
    const isInPlay = desc.includes('in play') || desc.includes('hit into play');
    if (isInPlay) {
      const hcX = Number(pitch.hc_x ?? NaN);
      const hcY = Number(pitch.hc_y ?? NaN);
      const hdist = Number(pitch.hit_distance_sc ?? pitch.hit_distance ?? NaN);
      const events = String(pitch.events ?? '').trim();
      if (events && !isNaN(hcX) && !isNaN(hcY) && hcX > 0) {
        hitDots.push({ hcX, hcY, hitDistance: !isNaN(hdist) && hdist > 0 ? hdist : null, result: events, pitchType: mapped, exitVelo: !isNaN(exitVeloRaw) ? exitVeloRaw : null, isBarrel });
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
      const pitcherHand = String(pitch.p_throws ?? '');
      abMap[abNum] = { atBatNum: abNum, pitcherName, pitcherHand, result: '', pitches: [] };
    }
    const events = String(pitch.events ?? '').trim();
    if (events) abMap[abNum].result = events;

    const pitchNum = parseInt(String(pitch.pitch_number ?? ''));
    const velo  = Number(pitch.release_speed ?? pitch.start_speed ?? NaN);
    const pfxX  = Number(pitch.pfx_x ?? NaN);
    const pfxZ  = Number(pitch.pfx_z ?? NaN);
    const bs    = Number(pitch.bat_speed ?? NaN);
    const ev    = Number(pitch.launch_speed ?? pitch.hit_speed ?? NaN);
    const la    = Number(pitch.launch_angle ?? NaN);
    const dist  = Number(pitch.hit_distance_sc ?? pitch.hit_distance ?? NaN);
    const hcXv  = Number(pitch.hc_x ?? NaN);
    const hcYv  = Number(pitch.hc_y ?? NaN);

    const gfIsBarrel = pitch.is_barrel !== undefined
      ? Number(pitch.is_barrel) === 1
      : checkBarrel(ev, la);
    abMap[abNum].pitches.push({
      pitchNum:    isNaN(pitchNum) ? abMap[abNum].pitches.length + 1 : pitchNum,
      pitchType:   displayType,
      velo:        !isNaN(velo)  ? Math.round(velo * 10) / 10  : null,
      hBreak:      !isNaN(pfxX)  ? Math.round(pfxX * 12 * 10) / 10 : null,
      ivBreak:     !isNaN(pfxZ)  ? Math.round(pfxZ * 12 * 10) / 10 : null,
      description: String(pitch.description ?? pitch.call_name ?? ''),
      batSpeed:    !isNaN(bs)    ? Math.round(bs * 10) / 10   : null,
      exitVelo:    !isNaN(ev)    ? Math.round(ev * 10) / 10   : null,
      launchAngle: !isNaN(la)    ? Math.round(la * 10) / 10   : null,
      hitDistance: !isNaN(dist) && dist > 0 ? Math.round(dist) : null,
      hcX:         !isNaN(hcXv) && hcXv > 0 ? hcXv : null,
      hcY:         !isNaN(hcYv) && hcXv > 0 ? hcYv : null,
      isBarrel:    gfIsBarrel,
      zone:        null,
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

    // Build bat_speed lookup (keyed by play_id) and barrel set (keyed by "ev|la") from exit_velocity
    const batSpeedByPlayId: Record<string, number> = {};
    const evArray = (gf?.exit_velocity ?? []) as Record<string, unknown>[];
    // Barrel set: "roundedEv|roundedLa" for all barrels belonging to this player
    const barrelEvLaSet = new Set<string>();
    let hasStatcastBarrelData = false;
    for (const ev of evArray) {
      const evBatter = String(ev.batter ?? ev.batterId ?? '');
      const pid = String(ev.play_id ?? '');
      const bs = Number(ev.batSpeed ?? NaN);
      if (pid && !isNaN(bs)) batSpeedByPlayId[pid] = bs;
      if (evBatter === pidStr && ev.is_barrel !== undefined) {
        hasStatcastBarrelData = true;
        if (Number(ev.is_barrel) === 1) {
          // Support both snake_case and camelCase field names across /gf response variants
          const ls = Number(ev.launch_speed ?? ev.launchSpeed ?? ev.hit_speed ?? NaN);
          const la = Number(ev.launch_angle ?? ev.launchAngle ?? NaN);
          if (!isNaN(ls) && !isNaN(la)) {
            barrelEvLaSet.add(`${Math.round(ls * 10)}|${Math.round(la * 10)}`);
          }
        }
      }
    }

    const homePitchers = (gf?.home_pitchers ?? {}) as Record<string, Record<string, unknown>[]>;
    const awayPitchers = (gf?.away_pitchers ?? {}) as Record<string, Record<string, unknown>[]>;

    for (const pitcherPitches of [...Object.values(homePitchers), ...Object.values(awayPitchers)]) {
      if (!Array.isArray(pitcherPitches)) continue;
      for (const pitch of pitcherPitches) {
        const batterId = String(pitch.batter ?? pitch.batter_id ?? '');
        if (batterId !== pidStr) continue;
        // Attach bat_speed from play_id lookup
        const playId = String(pitch.play_id ?? '');
        const bs = batSpeedByPlayId[playId];
        // Attach is_barrel by matching (ev, la) against Statcast's barrel set
        let isBarrelOverride: number | undefined;
        if (hasStatcastBarrelData) {
          const pls = Number(pitch.launch_speed ?? pitch.hit_speed ?? NaN);
          const pla = Number(pitch.launch_angle ?? NaN);
          if (!isNaN(pls) && !isNaN(pla)) {
            isBarrelOverride = barrelEvLaSet.has(`${Math.round(pls * 10)}|${Math.round(pla * 10)}`) ? 1 : 0;
          }
        }
        allPitches.push({
          ...pitch,
          ...(bs !== undefined ? { bat_speed: bs } : {}),
          ...(isBarrelOverride !== undefined ? { is_barrel: isBarrelOverride } : {}),
        });
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

async function fetchStatsApiHitterData(gamePk: number, playerId: string, skipBarrels = false) {
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
      const pitcherHand = String((matchup?.pitchHand as Record<string, unknown>)?.code ?? '');
      // Normalize live-feed event type to standard snake_case used everywhere else.
      // MLB Stats API uses camelCase eventType ("homeRun") or human-readable event ("Home Run").
      const playResult = play.result as Record<string, unknown>;
      const rawEvent = String(playResult?.eventType || playResult?.event || '');
      const LIVE_EVENT_MAP: Record<string, string> = {
        homeRun: 'home_run', strikeOut: 'strikeout', fieldOut: 'field_out',
        forceOut: 'force_out', groundedIntoDoublePlay: 'grounded_into_double_play',
        doublePlay: 'double_play', triplePlay: 'triple_play', sacFly: 'sac_fly',
        sacFlyDoublePlay: 'sac_fly_double_play', sacBunt: 'sac_bunt',
        fieldersChoice: 'fielders_choice', fieldersChoiceOut: 'fielders_choice_out',
        intentionalWalk: 'intent_walk', hitByPitch: 'hit_by_pitch',
        catcherInterference: 'catcher_interf', otherOut: 'other_out',
      };
      const resultStr = LIVE_EVENT_MAP[rawEvent] || rawEvent.replace(/\s+/g, '_').toLowerCase();
      if (!abMap[abNum]) abMap[abNum] = { atBatNum: abNum, pitcherName, pitcherHand, result: resultStr, pitches: [] };
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
        const isBarrel = !skipBarrels && isSwing && !isWhiff && checkBarrel(ev, la);
        const pxRaw = Number(coords.pX ?? NaN);
        const pzRaw = Number(coords.pZ ?? NaN);

        const pitchNumber = Number(event.pitchNumber ?? NaN);
        if (!isNaN(pxRaw) && !isNaN(pzRaw)) {
          rawDots.push({ pitchType: mapped, px: pxRaw, pz: pzRaw, isWhiff, isBarrel, isSwing, isTake, exitVelo: !isNaN(ev) ? ev : null, atBatNum: abNum, pitchNum: !isNaN(pitchNumber) ? pitchNumber : 0 });
        }
        // Spray chart: capture landing location for balls in play
        if (isSwing && !isWhiff && hd) {
          const hitCoords = (hd.coordinates as Record<string, unknown>) ?? {};
          const hcX = Number(hitCoords.coordX ?? NaN);
          const hcY = Number(hitCoords.coordY ?? NaN);
          const hdist = Number(hd?.totalDistance ?? NaN);
          if (!isNaN(hcX) && !isNaN(hcY) && hcX > 0 && resultStr) {
            hitDots.push({ hcX, hcY, hitDistance: !isNaN(hdist) && hdist > 0 ? hdist : null, result: resultStr, pitchType: mapped, exitVelo: !isNaN(ev) ? ev : null, isBarrel });
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
        const dist = Number(hd?.totalDistance ?? NaN);
        const pitchNum = Number(event.pitchNumber ?? abMap[abNum].pitches.length + 1);
        const hitCoords2 = (hd?.coordinates as Record<string, unknown>) ?? {};
        const hcXv = Number(hitCoords2.coordX ?? NaN);
        const hcYv = Number(hitCoords2.coordY ?? NaN);
        abMap[abNum].pitches.push({
          pitchNum,
          pitchType: mapped,
          velo: !isNaN(velo) ? Math.round(velo * 10) / 10 : null,
          hBreak: !isNaN(pfxX) ? Math.round(pfxX * 12 * 10) / 10 : null,
          ivBreak: !isNaN(pfxZ) ? Math.round(pfxZ * 12 * 10) / 10 : null,
          description: String(details?.description ?? ''),
          batSpeed: null,
          exitVelo: !isNaN(ev) ? Math.round(ev * 10) / 10 : null,
          launchAngle: !isNaN(la) ? Math.round(la * 10) / 10 : null,
          hitDistance: !isNaN(dist) && dist > 0 ? Math.round(dist) : null,
          hcX: !isNaN(hcXv) && hcXv > 0 ? hcXv : null,
          hcY: !isNaN(hcYv) && hcYv > 0 ? hcYv : null,
          isBarrel: !skipBarrels && checkBarrel(ev, la),
          zone: null,
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

// ─── Merge pitch data from multiple games (doubleheader) ─────────────────────

type PitchDataSet = { totalPitches: number; rawDots: HitterRawDot[]; pitchTypes: HitterPitchTypeStat[]; atBats: AtBat[]; hitDots: HitterHitDot[] };

function mergePitchDataParts(parts: (PitchDataSet | null)[]): PitchDataSet | null {
  const valid = parts.filter((p): p is PitchDataSet => p !== null);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  let abOffset = 0;
  const merged: PitchDataSet = { totalPitches: 0, rawDots: [], hitDots: [], pitchTypes: [], atBats: [] };

  for (const part of valid) {
    merged.totalPitches += part.totalPitches;
    merged.rawDots.push(...part.rawDots.map(d => ({ ...d, atBatNum: d.atBatNum + abOffset })));
    merged.hitDots.push(...part.hitDots);
    merged.atBats.push(...part.atBats.map(ab => ({ ...ab, atBatNum: ab.atBatNum + abOffset })));

    for (const pt of part.pitchTypes) {
      const existing = merged.pitchTypes.find(p => p.name === pt.name);
      if (existing) {
        existing.count    += pt.count;
        existing.swings   += pt.swings;
        existing.whiffs   += pt.whiffs;
        existing.contacts += pt.contacts;
        existing.inZone   += pt.inZone;
      } else {
        merged.pitchTypes.push({ ...pt });
      }
    }
    abOffset += Math.max(0, ...part.atBats.map(ab => ab.atBatNum)) + 1;
  }

  merged.pitchTypes.sort((a, b) => b.count - a.count);
  return merged;
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const dateParam = searchParams.get('date');
  const gamePkParam = searchParams.get('gamePk') ? parseInt(searchParams.get('gamePk')!) : null;

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
    // Also fetch Spring Breakout / MiLB exhibition game logs (sportId=21), AAA (sportId=11), and Low-A (sportId=14)
    let sbSplitsRaw: unknown[] = [];
    let aaaSplitsRaw: unknown[] = [];
    let lowASplitsRaw: unknown[] = [];
    try {
      const sbLogData = await fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=gameLog&group=hitting&season=${season}&sportId=21`, isToday);
      sbSplitsRaw = sbLogData?.stats?.[0]?.splits ?? [];
    } catch { /* non-fatal */ }
    try {
      const aaaLogData = await fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=gameLog&group=hitting&season=${season}&sportId=11`, isToday);
      aaaSplitsRaw = aaaLogData?.stats?.[0]?.splits ?? [];
    } catch { /* non-fatal */ }
    try {
      const lowALogData = await fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=gameLog&group=hitting&season=${season}&sportId=14`, isToday);
      lowASplitsRaw = lowALogData?.stats?.[0]?.splits ?? [];
    } catch { /* non-fatal */ }

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
    }[] = [...(gameLogData?.stats?.[0]?.splits ?? []), ...sbSplitsRaw, ...aaaSplitsRaw, ...lowASplitsRaw] as typeof splits;

    // Build availableDates — deduplicate by date so doubleheaders show as one entry.
    const dateEntryMap = new Map<string, { date: string; opponent: string; ab: number; h: number; hr: number; k: number; gamePk: number | undefined }>();
    for (const s of splits) {
      const date = s.date || s.game?.gameDate?.slice(0, 10) || '';
      if (!date) continue;
      const existing = dateEntryMap.get(date);
      dateEntryMap.set(date, {
        date,
        opponent: s.opponent?.abbreviation || s.opponent?.name || '?',
        ab:  (existing?.ab  ?? 0) + (s.stat?.atBats    ?? 0),
        h:   (existing?.h   ?? 0) + (s.stat?.hits       ?? 0),
        hr:  (existing?.hr  ?? 0) + (s.stat?.homeRuns   ?? 0),
        k:   (existing?.k   ?? 0) + (s.stat?.strikeOuts ?? 0),
        gamePk: s.game?.gamePk,  // keep the latest gamePk for the date
      });
    }
    const availableDates = [...dateEntryMap.values()].sort((a, b) => b.date.localeCompare(a.date));

    // Collect ALL splits for the target date (handles doubleheaders).
    const matchedSplits = splits.filter(s => {
      const splitDate = s.date || s.game?.gameDate?.slice(0, 10) || '';
      return splitDate === targetDate || splitDate.startsWith(targetDate);
    });

    // If a specific gamePk was requested (e.g. from the daily-hitters card link),
    // pin to that game so doubleheader game 2 shows game 2 data not game 1.
    // Fall back to the last (most recent) split when no gamePk is specified.
    const matchedSplit = gamePkParam
      ? (matchedSplits.find(s => s.game?.gamePk === gamePkParam) ?? matchedSplits[matchedSplits.length - 1] ?? null)
      : (matchedSplits[matchedSplits.length - 1] ?? null);

    // When a specific game is pinned, only pull pitch data for that game.
    // Otherwise combine all games on the date (normal doubleheader combined view).
    const allMatchedGamePks = gamePkParam
      ? [gamePkParam].filter(pk => matchedSplits.some(s => s.game?.gamePk === pk) || matchedSplits.length === 0)
      : matchedSplits.map(s => s.game?.gamePk).filter((pk): pk is number => pk != null);

    // Detect if any matched game is Low-A (Trackman data — barrel formula not reliable)
    const isLowAGame = allMatchedGamePks.some(pk =>
      lowASplitsRaw.some((s: unknown) => (s as { game?: { gamePk?: number } })?.game?.gamePk === pk));

    // ── 3a. Live feed fallback — gamePk pinned but not in game log yet ───────
    // This fires when a DH game 2 is still in progress (not yet in the game log)
    // but the user clicked its card from the daily hitters list.
    if (gamePkParam && !matchedSplits.some(s => s.game?.gamePk === gamePkParam)) {
      try {
        const feed = await fetchJSON(`https://statsapi.mlb.com/api/v1.1/game/${gamePkParam}/feed/live`, true);
        const homeBox = feed?.liveData?.boxscore?.teams?.home;
        const awayBox = feed?.liveData?.boxscore?.teams?.away;
        const pid = parseInt(playerId);
        const isHome = ((homeBox?.batters ?? []) as number[]).includes(pid);
        const isAway = !isHome && ((awayBox?.batters ?? []) as number[]).includes(pid);

        if (isHome || isAway) {
          const box = isHome ? homeBox : awayBox;
          const playerData = box?.players?.[`ID${pid}`];
          const bStats = playerData?.gameStats?.batting ?? playerData?.stats?.batting;

          if (bStats) {
            const homeTeam = feed?.gameData?.teams?.home;
            const awayTeam = feed?.gameData?.teams?.away;
            const myTeam = isHome ? homeTeam : awayTeam;
            const oppTeam = isHome ? awayTeam : homeTeam;

            const liveGameLine = {
              date: targetDate,
              ab:      bStats.atBats         ?? 0,
              h:       bStats.hits            ?? 0,
              hr:      bStats.homeRuns        ?? 0,
              rbi:     bStats.rbi             ?? 0,
              bb:      bStats.baseOnBalls     ?? 0,
              k:       bStats.strikeOuts      ?? 0,
              doubles: bStats.doubles         ?? 0,
              triples: bStats.triples         ?? 0,
              pa:      bStats.plateAppearances ?? 0,
              sb:      bStats.stolenBases     ?? 0,
            };
            const liveGameInfo = {
              gamePk:       gamePkParam,
              opponent:     resolveTeamAbbr(oppTeam) || oppTeam?.name || null,
              opponentFull: oppTeam?.name || null,
              team:         resolveTeamAbbr(myTeam),
              isHome,
              date:         targetDate,
            };

            // Fetch pitch data: try GF (has locations + bat speed), fall back to Stats API live feed
            let livePitchData: PitchDataSet | null = null;
            livePitchData = await fetchGfHitterData(gamePkParam, playerId);
            if (!livePitchData) {
              livePitchData = await fetchStatsApiHitterData(gamePkParam, playerId, false);
            }
            // Resolve pitcher IDs → names
            if (livePitchData?.atBats?.length) {
              const ids = [...new Set(livePitchData.atBats.map(ab => ab.pitcherName))];
              if (ids.some(id => /^\d+$/.test(id))) {
                const nameMap = await resolvePitcherNames(ids);
                for (const ab of livePitchData.atBats) {
                  ab.pitcherName = nameMap[ab.pitcherName] || `#${ab.pitcherName}`;
                }
              }
            }

            return NextResponse.json({
              playerId: parseInt(playerId),
              playerName, playerHeight, playerWeight, playerBirthDate, playerPitchHand, playerBatSide,
              date: targetDate, gameLine: liveGameLine, gameInfo: liveGameInfo,
              pitchData: livePitchData, availableDates,
            });
          }
        }
      } catch (e) {
        console.warn('[Live Feed Fallback] gamePk', gamePkParam, 'failed:', e);
        // Fall through to normal flow
      }
    }

    // ── 3. Spring Training fallback (live game feed) ─────────────────────────
    if (matchedSplits.length === 0) {
      try {
        const scheduleData = await fetchJSON(
          `${MLB_API}/schedule?startDate=${targetDate}&endDate=${targetDate}&sportId=1,11,14,21,22,23,51`,
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
              opponent: resolveTeamAbbr(oppTeam) || oppTeam?.name || null,
              opponentFull: oppTeam?.name || null,
              team: resolveTeamAbbr(myTeam),
              isHome,
              date: targetDate,
            };

            // Statcast for spring training
            let stPitchData = null;
            try {
              stPitchData = await fetchGfHitterData(g.gamePk, playerId);
              if (!stPitchData) {
                const savantUrl = `${SAVANT_BASE}?all=true&type=details&batters_lookup%5B%5D=${playerId}&player_type=batter&game_date_gt=${targetDate}&game_date_lt=${targetDate}&hfGT=S%7CE%7CW%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`;
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
    const gamePk = matchedSplit?.game?.gamePk ?? null;

    // When a specific gamePk is pinned (doubleheader card link), show only that
    // game's stats. Otherwise sum all games on the date (normal combined view).
    const statSplits = gamePkParam
      ? matchedSplits.filter(s => s.game?.gamePk === gamePkParam)
      : matchedSplits;
    const effectiveSplits = statSplits.length > 0 ? statSplits : (matchedSplit ? [matchedSplit] : []);

    const gameLine = {
      date:    targetDate,
      ab:      effectiveSplits.reduce((s, x) => s + (x.stat.atBats          ?? 0), 0),
      h:       effectiveSplits.reduce((s, x) => s + (x.stat.hits             ?? 0), 0),
      hr:      effectiveSplits.reduce((s, x) => s + (x.stat.homeRuns         ?? 0), 0),
      rbi:     effectiveSplits.reduce((s, x) => s + (x.stat.rbi              ?? 0), 0),
      bb:      effectiveSplits.reduce((s, x) => s + (x.stat.baseOnBalls      ?? 0), 0),
      k:       effectiveSplits.reduce((s, x) => s + (x.stat.strikeOuts       ?? 0), 0),
      doubles: effectiveSplits.reduce((s, x) => s + (x.stat.doubles          ?? 0), 0),
      triples: effectiveSplits.reduce((s, x) => s + (x.stat.triples          ?? 0), 0),
      pa:      effectiveSplits.reduce((s, x) => s + (x.stat.plateAppearances ?? 0), 0),
      sb:      effectiveSplits.reduce((s, x) => s + (x.stat.stolenBases      ?? 0), 0),
    };

    const gameInfo = {
      gamePk:       gamePk ?? null,
      opponent:     resolveTeamAbbr(matchedSplit?.opponent) || matchedSplit?.opponent?.name || null,
      opponentFull: matchedSplit?.opponent?.name || null,
      team:         resolveTeamAbbr(matchedSplit?.team),
      isHome:       matchedSplit?.isHome ?? null,
      date:         targetDate,
    };

    // ── 5. Statcast pitch-by-pitch ────────────────────────────────────────────
    let pitchData: PitchDataSet | null = null;
    try {
      const regularUrl = `${SAVANT_BASE}?all=true&type=details&batters_lookup%5B%5D=${playerId}&player_type=batter&game_date_gt=${targetDate}&game_date_lt=${targetDate}&hfSea=${season}%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`;
      const springUrl  = `${SAVANT_BASE}?all=true&type=details&batters_lookup%5B%5D=${playerId}&player_type=batter&game_date_gt=${targetDate}&game_date_lt=${targetDate}&hfGT=S%7CE%7CW%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`;
      let primaryCsvText = await fetchText(regularUrl);
      if (!primaryCsvText.includes('pitch_type') || parseCSV(primaryCsvText).length === 0) {
        primaryCsvText = await fetchText(springUrl);
      }

      try {
        if (primaryCsvText.includes('pitch_type')) {
          const allRows = parseCSV(primaryCsvText);
          const pidStr = String(playerId).trim();

          if (allMatchedGamePks.length > 1) {
            // Doubleheader: process each game independently then merge so at-bat
            // numbers don't collide between the two games.
            const parts = allMatchedGamePks.map(pk => {
              const gpStr = String(pk).trim();
              const rows = allRows.filter(r => r.game_pk?.trim() === gpStr && r.batter?.trim() === pidStr);
              return rows.length > 0 ? aggregateHitterCsv(rows) : null;
            });
            pitchData = mergePitchDataParts(parts);
          } else {
            const gpStr = gamePk ? String(gamePk).trim() : null;
            const filtered = allRows.filter(r => {
              const pkMatch = gpStr ? r.game_pk?.trim() === gpStr : true;
              return pkMatch && r.batter?.trim() === pidStr;
            });
            if (filtered.length > 0) pitchData = aggregateHitterCsv(filtered);
          }
        }
      } catch (csvErr) {
        console.warn('[Hitter CSV] fetch failed:', csvErr);
      }

      // Fall back to /gf if CSV empty (same-day in-progress game)
      if (!pitchData) {
        if (allMatchedGamePks.length > 1) {
          const parts = await Promise.all(allMatchedGamePks.map(pk => fetchGfHitterData(pk, playerId)));
          pitchData = mergePitchDataParts(parts);
        } else if (gamePk) {
          pitchData = await fetchGfHitterData(gamePk, playerId);
        }
      }
      // Last resort: Stats API live feed (college/non-Savant games)
      if (!pitchData) {
        if (allMatchedGamePks.length > 1) {
          const parts = await Promise.all(
            allMatchedGamePks.map(pk => fetchStatsApiHitterData(pk, playerId, isLowAGame))
          );
          pitchData = mergePitchDataParts(parts);
        } else if (gamePk) {
          pitchData = await fetchStatsApiHitterData(gamePk, playerId, isLowAGame);
        }
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
