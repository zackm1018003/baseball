import { NextRequest, NextResponse } from 'next/server';
import { resolveTeamAbbr } from '@/lib/resolve-team-abbr';

export const maxDuration = 60;

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
    return text.startsWith('﻿') ? text.slice(1) : text;
  } finally {
    clearTimeout(timer);
  }
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
  SI: 'Sinker',
  FC: 'Cutter',
  SL: 'Slider',
  ST: 'Sweeper',
  SV: 'Slurve',
  CH: 'Changeup',
  FS: 'Splitter',
  CU: 'Curveball',
  KC: 'Knuckle Curve',
  KN: null,
  EP: null,
};

function checkBarrel(ev: number, la: number): boolean {
  if (isNaN(ev) || isNaN(la) || ev < 98) return false;
  const delta = Math.min(ev, 116) - 98;
  return la >= Math.max(8, 26 - delta) && la <= Math.min(50, 30 + delta);
}

// ─── IP helpers ───────────────────────────────────────────────────────────────

function parseIpToOuts(ip: string): number {
  if (!ip) return 0;
  const parts = ip.split('.');
  return (parseInt(parts[0]) || 0) * 3 + (parseInt(parts[1]) || 0);
}

function outsToIp(outs: number): string {
  const full = Math.floor(outs / 3);
  const partial = outs % 3;
  return `${full}.${partial}`;
}

// ─── Statcast aggregation ─────────────────────────────────────────────────────

function aggregateDayStatcast(rows: Record<string, string>[]) {
  const groups: Record<string, {
    velos: number[]; spins: number[];
    hBreaks: number[]; vBreaks: number[];
    vaas: number[]; haas: number[]; count: number; swings: number; whiffs: number; inZone: number; barrels: number;
    hRels: number[]; vRels: number[]; extensions: number[];
  }> = {};

  const rawDots: { hb: number; ivb: number; pitchType: string; px: number | null; pz: number | null; isWhiff: boolean; isBarrel: boolean; batterSide: string | null; velo: number | null; spin: number | null; vaa: number | null; haa: number | null; hRel: number | null; vRel: number | null; extension: number | null }[] = [];
  const armAngles: number[] = [];

  let totalPitches = 0;
  let strikes = 0;
  let swingAndMisses = 0;

  for (const row of rows) {
    const rawType = row.pitch_type;
    const mapped = PITCH_TYPE_MAP[rawType];
    if (mapped === null || mapped === undefined) continue;

    totalPitches++;

    const desc = (row.description || '').toLowerCase();
    if (desc.includes('strike') || desc.includes('foul') || desc.includes('swinging')) strikes++;
    if (desc.includes('swinging_strike') || desc === 'swinging_strike_blocked') swingAndMisses++;

    if (!groups[mapped]) {
      groups[mapped] = { velos: [], spins: [], hBreaks: [], vBreaks: [], vaas: [], haas: [], count: 0, swings: 0, whiffs: 0, inZone: 0, barrels: 0, hRels: [], vRels: [], extensions: [] };
    }
    const g = groups[mapped];
    g.count++;

    const isSwing = desc.includes('swinging') || desc.includes('foul') || desc.includes('hit_into_play') || desc === 'hit_into_play';
    const isWhiff = desc === 'swinging_strike' || desc === 'swinging_strike_blocked' || desc === 'foul_tip';
    if (isSwing || isWhiff) g.swings++;
    if (isWhiff) g.whiffs++;

    const velo = parseFloat(row.release_speed);
    if (!isNaN(velo)) g.velos.push(velo);

    const spin = parseFloat(row.release_spin_rate);
    if (!isNaN(spin)) g.spins.push(spin);

    const pThrows = (row.p_throws ?? '').trim().toUpperCase();
    const armSign = pThrows === 'L' ? 1 : -1;

    const hRelRaw = parseFloat(row.release_pos_x);
    if (!isNaN(hRelRaw)) g.hRels.push(armSign * hRelRaw);

    const vRelRaw = parseFloat(row.release_pos_z);
    if (!isNaN(vRelRaw)) g.vRels.push(vRelRaw);

    const extRaw = parseFloat(row.release_extension);
    if (!isNaN(extRaw)) g.extensions.push(extRaw);

    const hBreak = parseFloat(row.pfx_x);
    if (!isNaN(hBreak)) g.hBreaks.push(hBreak * armSign * 12);

    const vBreak = parseFloat(row.pfx_z);
    if (!isNaN(vBreak)) g.vBreaks.push(vBreak * 12);

    const pxRaw = parseFloat(row.plate_x);
    const pzRaw = parseFloat(row.plate_z);
    const isWhiffCsv = desc === 'swinging_strike' || desc === 'swinging_strike_blocked';
    const batterSide = (row.stand ?? '').trim() || null;
    const exitVelo = parseFloat(row.launch_speed);
    const launchAngle = parseFloat(row.launch_angle);
    const isBarrel = checkBarrel(exitVelo, launchAngle);
    if (isBarrel) g.barrels++;
    if (!isNaN(pxRaw) && !isNaN(pzRaw) && Math.abs(pxRaw) <= 0.708 && pzRaw >= 1.5 && pzRaw <= 3.5) g.inZone++;

    if (!isNaN(hRelRaw) && !isNaN(vRelRaw)) {
      const geoAA = Math.atan2(vRelRaw - 4.7, Math.abs(hRelRaw)) * (180 / Math.PI);
      if (!isNaN(geoAA)) armAngles.push(geoAA);
    }

    const vz0 = parseFloat(row.vz0);
    const vy0 = parseFloat(row.vy0);
    const vx0 = parseFloat(row.vx0);
    const ay  = parseFloat(row.ay);
    const az  = parseFloat(row.az);
    const ax  = parseFloat(row.ax);
    const yRelease = parseFloat(row.release_pos_y);
    let perPitchVaa: number | null = null;
    let perPitchHaa: number | null = null;
    if (!isNaN(vz0) && !isNaN(vy0) && !isNaN(ay) && !isNaN(az) && !isNaN(yRelease) && ay !== 0) {
      const yPlate = 1.417;
      const disc = vy0 * vy0 + 2 * ay * (yPlate - yRelease);
      if (disc >= 0) {
        const t = (-vy0 - Math.sqrt(disc)) / ay;
        const vzAtPlate = vz0 + az * t;
        const vyAtPlate = vy0 + ay * t;
        perPitchVaa = Math.atan2(vzAtPlate, Math.abs(vyAtPlate)) * (180 / Math.PI);
        g.vaas.push(perPitchVaa);
        if (!isNaN(vx0) && !isNaN(ax)) {
          const vxAtPlate = vx0 + ax * t;
          perPitchHaa = -Math.atan(vxAtPlate / vyAtPlate) * (180 / Math.PI);
          g.haas.push(perPitchHaa);
        }
      }
    }
    if (!isNaN(hBreak) && !isNaN(vBreak)) {
      rawDots.push({
        hb: hBreak * armSign * 12, ivb: vBreak * 12, pitchType: mapped,
        px: !isNaN(pxRaw) ? pxRaw : null,
        pz: !isNaN(pzRaw) ? pzRaw : null,
        isWhiff: isWhiffCsv,
        isBarrel,
        batterSide,
        velo: !isNaN(velo) ? velo : null,
        spin: !isNaN(spin) ? spin : null,
        vaa: perPitchVaa,
        haa: perPitchHaa,
        hRel: !isNaN(hRelRaw) ? armSign * hRelRaw : null,
        vRel: !isNaN(vRelRaw) ? vRelRaw : null,
        extension: !isNaN(extRaw) ? extRaw : null,
      });
    }
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const r1 = (v: number | null) => v !== null ? Math.round(v * 10) / 10 : null;
  const r2 = (v: number | null) => v !== null ? Math.round(v * 100) / 100 : null;

  const countedPitches = Object.values(groups).reduce((s, g) => s + g.count, 0);

  const pitchTypes: {
    name: string; count: number; usage: number;
    velo: number | null; maxVelo: number | null; spin: number | null;
    h_movement: number | null; v_movement: number | null;
    vaa: number | null; haa: number | null; whiff: number | null; whiffs: number;
    zone_pct: number | null; barrel_pct: number | null;
    h_rel: number | null; v_rel: number | null; extension: number | null;
  }[] = [];

  for (const [name, g] of Object.entries(groups)) {
    const usage = (g.count / countedPitches) * 100;
    if (usage < 1) continue;
    pitchTypes.push({
      name, count: g.count,
      usage: Math.round(usage * 10) / 10,
      velo: r1(avg(g.velos)),
      maxVelo: g.velos.length > 0 ? r1(Math.max(...g.velos)) : null,
      spin: avg(g.spins) !== null ? Math.round(avg(g.spins)!) : null,
      h_movement: r1(avg(g.hBreaks)),
      v_movement: r1(avg(g.vBreaks)),
      vaa: r2(avg(g.vaas)),
      haa: r2(avg(g.haas)),
      whiff: g.swings > 0 ? Math.round((g.whiffs / g.swings) * 1000) / 10 : null,
      whiffs: g.whiffs,
      zone_pct: g.count > 0 ? Math.round((g.inZone / g.count) * 1000) / 10 : null,
      barrel_pct: g.count > 0 ? Math.round((g.barrels / g.count) * 1000) / 10 : null,
      h_rel: r2(avg(g.hRels)),
      v_rel: r2(avg(g.vRels)),
      extension: r2(avg(g.extensions)),
    });
  }

  pitchTypes.sort((a, b) => b.usage - a.usage);

  const avgArmAngle = armAngles.length > 0
    ? Math.round(armAngles.reduce((a, b) => a + b, 0) / armAngles.length * 10) / 10
    : null;

  return {
    totalPitches,
    pitchTypes,
    rawDots,
    armAngle: avgArmAngle,
    strikePct: totalPitches > 0 ? Math.round((strikes / totalPitches) * 1000) / 10 : null,
    swingAndMissPct: totalPitches > 0 ? Math.round((swingAndMisses / totalPitches) * 1000) / 10 : null,
    totalWhiffs: swingAndMisses,
  };
}

// ─── Arm angle from Savant leaderboard ────────────────────────────────────────

async function fetchSavantArmAngle(playerId: string, season: number): Promise<number | null> {
  try {
    const url = `https://baseballsavant.mlb.com/leaderboard/pitcher-arm-angles?year=${season}&min=1&pos=all`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    let data: unknown;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        next: { revalidate: 300 },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      data = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const rows = Array.isArray(data) ? data : (data as Record<string, unknown>)?.data;
    if (!Array.isArray(rows)) return null;
    const row = rows.find(
      (r: Record<string, unknown>) =>
        String(r.pitcher) === String(playerId) || String(r.id) === String(playerId)
    );
    const aa = Number(row?.arm_angle);
    return !isNaN(aa) ? Math.round(aa * 10) / 10 : null;
  } catch {
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Outing {
  date: string;
  opponent: string;
  ip: string;
  h: number;
  er: number;
  bb: number;
  k: number;
  hr: number;
  pitches: number;
  bf: number;
  gamePk?: number;
  isHome?: boolean | null;
  team?: string | null;
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const seasonParam = searchParams.get('season');

  if (!playerId) {
    return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  }

  const season = seasonParam ? parseInt(seasonParam) : new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  // Regular season typically starts mid-to-late March
  const seasonStart = `${season}-03-15`;
  const seasonEnd = today > `${season}-11-15` ? `${season}-11-15` : today;

  // ── 1. Player bio ──────────────────────────────────────────────────────────
  let playerName: string | null = null;
  let playerHeight: string | null = null;
  let playerWeight: number | null = null;
  let playerBirthDate: string | null = null;
  let playerPitchHand: string | null = null;
  let playerBatSide: string | null = null;
  try {
    const personData = await fetchJSON(`${MLB_API}/people/${playerId}?hydrate=currentTeam`);
    const person = personData?.people?.[0];
    playerName = person?.fullName ?? null;
    playerHeight = person?.height ?? null;
    playerWeight = person?.weight ?? null;
    playerBirthDate = person?.birthDate ?? null;
    playerPitchHand = person?.pitchHand?.code ?? null;
    playerBatSide = person?.batSide?.code ?? null;
  } catch { /* non-fatal */ }

  // ── 2. Regular season game log ─────────────────────────────────────────────
  let outings: Outing[] = [];

  type StatSplit = {
    date?: string;
    stat: {
      inningsPitched?: string; hits?: number; earnedRuns?: number;
      baseOnBalls?: number; strikeOuts?: number; homeRuns?: number;
      numberOfPitches?: number; battersFaced?: number;
    };
    team?: { abbreviation?: string };
    opponent?: { abbreviation?: string; name?: string };
    isHome?: boolean;
    game?: { gamePk?: number; gameDate?: string };
  };

  const mapSplit = (s: StatSplit): Outing => ({
    date: s.date || s.game?.gameDate?.slice(0, 10) || '',
    opponent: s.opponent?.abbreviation || s.opponent?.name || '?',
    ip: s.stat?.inningsPitched || '0',
    h: s.stat?.hits ?? 0,
    er: s.stat?.earnedRuns ?? 0,
    bb: s.stat?.baseOnBalls ?? 0,
    k: s.stat?.strikeOuts ?? 0,
    hr: s.stat?.homeRuns ?? 0,
    pitches: s.stat?.numberOfPitches ?? 0,
    bf: s.stat?.battersFaced ?? 0,
    gamePk: s.game?.gamePk,
    isHome: s.isHome ?? null,
    team: resolveTeamAbbr(s.team),
  });

  // Fetch from MLB + MiLB levels (same approach as pitcher-daily route).
  // Mirrors daily page: sportId=1 (MLB), 11 (Triple-A), 12 (Double-A), 13 (High-A), 14 (Low-A)
  const debugInfo: Record<string, unknown> = {};
  const SPORT_IDS = [1, 11, 12, 13, 14];

  const allSplitsRaw: (StatSplit & { _sportId?: number })[] = [];

  await Promise.allSettled(
    SPORT_IDS.map(async sportId => {
      try {
        const logData = await fetchJSON(
          `${MLB_API}/people/${playerId}/stats?stats=gameLog&group=pitching&season=${season}&sportId=${sportId}`,
          true
        );
        const splits: StatSplit[] = (logData?.stats ?? []).flatMap(
          (s: { splits?: StatSplit[] }) => s.splits ?? []
        );
        debugInfo[`sportId${sportId}`] = splits.length;
        allSplitsRaw.push(...splits.map(s => ({ ...s, _sportId: sportId })));
      } catch (e) {
        debugInfo[`sportId${sportId}Error`] = String(e);
      }
    })
  );

  // Keep only regular season games (gameType=R); for MiLB, also accept undefined/missing gameType
  // since minor league regular season games may not always carry the gameType field
  const seenPks = new Set<number>();
  for (const s of allSplitsRaw) {
    const gType = (s as unknown as Record<string, unknown>)?.game?.gameType as string | undefined;
    if (gType && gType !== 'R') continue; // skip spring, postseason, etc.
    const pk = s.game?.gamePk;
    if (pk && seenPks.has(pk)) continue;
    if (pk) seenPks.add(pk);
    outings.push(mapSplit(s));
  }

  debugInfo.totalOutings = outings.length;

  outings.sort((a, b) => a.date.localeCompare(b.date));

  if (outings.length === 0) {
    return NextResponse.json({
      error: `No regular season appearances found for ${season}.`,
      playerName, playerHeight, playerWeight, playerBirthDate, playerPitchHand, playerBatSide,
      outings: [],
      _debug: debugInfo,
    }, { status: 404 });
  }

  // ── 3. Aggregate game line totals ──────────────────────────────────────────
  const totalOuts    = outings.reduce((sum, o) => sum + parseIpToOuts(o.ip), 0);
  const totalH       = outings.reduce((sum, o) => sum + o.h, 0);
  const totalER      = outings.reduce((sum, o) => sum + o.er, 0);
  const totalBB      = outings.reduce((sum, o) => sum + o.bb, 0);
  const totalK       = outings.reduce((sum, o) => sum + o.k, 0);
  const totalHR      = outings.reduce((sum, o) => sum + o.hr, 0);
  const totalPitches = outings.reduce((sum, o) => sum + o.pitches, 0);
  const totalBF      = outings.reduce((sum, o) => sum + o.bf, 0);
  const ipDecimal = totalOuts / 3;
  const era = ipDecimal > 0 ? (totalER / ipDecimal * 9).toFixed(2) : null;

  const aggregatedGameLine = {
    ip: outsToIp(totalOuts),
    h: totalH,
    er: totalER,
    bb: totalBB,
    k: totalK,
    hr: totalHR,
    pitches: totalPitches,
    bf: totalBF,
    era,
    games: outings.length,
  };

  // ── 4. Fetch Statcast CSV for regular season ────────────────────────────────
  let pitchData = null;
  try {
    const savantUrl = `${SAVANT_BASE}?all=true&type=details&pitchers_lookup%5B%5D=${playerId}&player_type=pitcher&game_date_gt=${seasonStart}&game_date_lt=${seasonEnd}&hfGT=R%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`;
    const csvText = await fetchText(savantUrl);
    if (csvText.includes('pitch_type')) {
      const rows = parseCSV(csvText);
      const pidStr = String(playerId).trim();
      const gamePks = new Set(
        outings.map(o => o.gamePk?.toString()).filter(Boolean)
      );
      const filtered = rows.filter(r => {
        const pkMatch = gamePks.size > 0 ? gamePks.has(r.game_pk?.trim()) : true;
        return pkMatch && r.pitcher?.trim() === pidStr;
      });
      if (filtered.length > 0) {
        pitchData = aggregateDayStatcast(filtered);
      }
    }
  } catch (e) {
    console.warn('[Season Statcast CSV] fetch failed:', e);
  }

  // ── 5. Arm angle ───────────────────────────────────────────────────────────
  if (pitchData) {
    const savantArmAngle = await fetchSavantArmAngle(playerId, season);
    if (savantArmAngle !== null) {
      pitchData = { ...pitchData, armAngle: savantArmAngle };
    }
  }

  return NextResponse.json({
    playerId: parseInt(playerId),
    playerName,
    playerHeight,
    playerWeight,
    playerBirthDate,
    playerPitchHand,
    playerBatSide,
    season,
    aggregatedGameLine,
    pitchData,
    outings,
  });
}
