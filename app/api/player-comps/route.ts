import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 25;
export const dynamic = 'force-dynamic';

const MLB_API = 'https://statsapi.mlb.com/api/v1';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://baseballsavant.mlb.com/' },
      next: { revalidate: 3600 },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text.startsWith('﻿') ? text.slice(1) : text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJSON(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 3600 },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map(line => {
    const values: string[] = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { values.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    values.push(cur.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

function normalPct(val: number, mean: number, std: number, higher: boolean): number {
  if (isNaN(val) || std === 0) return 50;
  const z = (val - mean) / std;
  const az = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * az);
  const p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - p * Math.exp(-az * az);
  const cdf = 0.5 * (1 + (z >= 0 ? 1 : -1) * erf);
  const pct = Math.round(Math.max(1, Math.min(99, cdf * 100)));
  return higher ? pct : 100 - pct;
}

function similarity(a: (number | null)[], b: (number | null)[]): number {
  let sumSq = 0, count = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] != null && b[i] != null) {
      const diff = a[i]! - b[i]!;
      sumSq += diff * diff;
      count++;
    }
  }
  if (count === 0) return 0;
  return Math.round(Math.max(0, 100 - Math.sqrt(sumSq / count)));
}

// "695578 Wood, James" → "James Wood"
function parseName(raw: string): string {
  const clean = raw.replace(/^\d+\s+/, '').trim();
  if (clean.includes(',')) {
    const idx   = clean.indexOf(',');
    const last  = clean.slice(0, idx).trim();
    const first = clean.slice(idx + 1).trim();
    return `${first} ${last}`;
  }
  return clean;
}

// ── Baselines ─────────────────────────────────────────────────────────────────

const MLB = {
  xwoba:     { mean: 0.315, std: 0.044 },
  chasePct:  { mean: 27.5,  std: 6.5  },
  zSwingPct: { mean: 68.0,  std: 8.5  },
  zoneWhiff: { mean: 16.0,  std: 7.0  },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface Cand {
  pid: string; rawName: string; yr: number;
  xwoba: number | null; chasePct: number | null; zSwingPct: number | null; zoneWhiff: number | null;
  age: number | null;
}

interface CompResult {
  playerId: number; playerName: string; season: number;
  age: number | null; team: string | null; similarity: number;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const playerId  = sp.get('playerId') ?? '';
  const season    = parseInt(sp.get('season') ?? String(new Date().getFullYear()));
  const sportId   = parseInt(sp.get('sportId') ?? '1');
  const age       = parseFloat(sp.get('age') ?? 'NaN');

  const ev90      = parseFloat(sp.get('ev90')      ?? 'NaN');
  const xwoba     = parseFloat(sp.get('xwoba')     ?? 'NaN');
  const chasePct  = parseFloat(sp.get('chasePct')  ?? 'NaN');
  const zSwingPct = parseFloat(sp.get('zSwingPct') ?? 'NaN');
  const zoneWhiff = parseFloat(sp.get('zoneWhiff') ?? 'NaN');
  const avgLaHard = parseFloat(sp.get('avgLaHard') ?? 'NaN');

  if (!playerId) return NextResponse.json({ comp: null });

  // Player's radar percentiles (Statcast-based, axes 0-5)
  const playerPcts: (number | null)[] = [
    null, // axis 0 (ev90) — grouped search doesn't give EV, skip
    !isNaN(xwoba)     ? normalPct(xwoba,     MLB.xwoba.mean,    MLB.xwoba.std,    true)  : null,
    !isNaN(chasePct)  ? normalPct(chasePct,  MLB.chasePct.mean, MLB.chasePct.std, false) : null,
    !isNaN(zSwingPct) ? normalPct(zSwingPct, MLB.zSwingPct.mean,MLB.zSwingPct.std,true)  : null,
    !isNaN(zoneWhiff) ? normalPct(zoneWhiff, MLB.zoneWhiff.mean,MLB.zoneWhiff.std,false) : null,
    null, // axis 5 (avgLaHard) — not in grouped search
  ];

  try {
    const isMLB    = sportId === 1;
    const ageRange = (!isMLB && !isNaN(age))
      ? { min: Math.floor(age) - 4, max: Math.ceil(age) + 4 }
      : null;
    const maxYears = isMLB ? 5 : 7;

    const comp = await findComp(playerId, season, playerPcts, ageRange, maxYears);
    return NextResponse.json({ comp });
  } catch (e) {
    console.error('player-comps error:', e);
    return NextResponse.json({ comp: null });
  }
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

// Statcast grouped-search CSV — one row per qualified batter per season.
// This is the same URL that was confirmed working earlier this session.
async function fetchGroupedYear(yr: number): Promise<Cand[]> {
  const url =
    `https://baseballsavant.mlb.com/statcast_search/csv?all=true&player_type=batter` +
    `&hfSea=${yr}%7C&hfGT=R%7C&game_date_gt=&game_date_lt=` +
    `&min_pitches=0&min_results=0&min_pas=100&type=details&group_by=name&csv=true`;

  const text  = await fetchText(url);
  const rows  = parseCSV(text);
  const cands: Cand[] = [];

  for (const row of rows) {
    const pid = (row.batter ?? '').trim();
    if (!pid || parseInt(row.pa ?? '0') < 100) continue;

    const xwoba    = parseFloat(row.estimated_woba_using_speedangle ?? '');
    const chasePct = parseFloat(row.out_zone_swing_percent          ?? '');
    const zSwing   = parseFloat(row.in_zone_swing_percent           ?? '');
    const zContact = parseFloat(row.in_zone_contact_percent         ?? '');

    if (isNaN(xwoba)) continue; // need at minimum xwOBA

    cands.push({
      pid, yr,
      rawName:   row.player_name ?? pid,
      xwoba,
      chasePct:  isNaN(chasePct) ? null : chasePct,
      zSwingPct: isNaN(zSwing)   ? null : zSwing,
      zoneWhiff: isNaN(zContact) ? null : 100 - zContact, // zone whiff = 100 − zone contact%
      age: null,
    });
  }

  return cands;
}

// Expected-statistics CSV — clean first_name / last_name per player_id.
async function fetchExpNames(yr: number): Promise<Record<string, string>> {
  const url =
    `https://baseballsavant.mlb.com/leaderboard/expected_statistics` +
    `?type=batter&year=${yr}&position=&team=&min=50&csv=true`;
  const text  = await fetchText(url);
  const names: Record<string, string> = {};
  for (const row of parseCSV(text)) {
    const pid   = (row.player_id  ?? '').trim();
    const first = (row.first_name ?? '').trim();
    const last  = (row.last_name  ?? '').trim();
    if (pid && first && last) names[pid] = `${first} ${last}`;
  }
  return names;
}

// MLB Stats API people batch — birth dates for a small set of player IDs.
// No `fields` param so we get the full person object (birthDate included).
async function fetchBirthYears(pids: string[]): Promise<Record<string, number>> {
  if (!pids.length) return {};
  const result: Record<string, number> = {};
  const batches: string[][] = [];
  for (let i = 0; i < pids.length; i += 50) batches.push(pids.slice(i, i + 50));
  const settled = await Promise.allSettled(
    batches.map(b => fetchJSON(`${MLB_API}/people?personIds=${b.join(',')}`))
  );
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const p of ((r.value as Record<string, unknown>)?.people ?? []) as Record<string, unknown>[]) {
      const id = Number(p.id);
      const bd = p.birthDate as string | undefined;
      if (id && bd) result[String(id)] = parseInt(bd.slice(0, 4));
    }
  }
  return result;
}

// ── Comp search ───────────────────────────────────────────────────────────────
//
// Strategy:
//   1. Fetch grouped-search CSV for all seasons in parallel (discipline metrics).
//   2. Fetch expected-statistics CSV for all seasons in parallel (clean names).
//   3. Score every candidate against the player's radar profile.
//   4. Sort by score, take top 150.
//   5. For MiLB (ageRange set): batch-fetch birth years for those 150 unique IDs,
//      then walk the sorted list and return the first candidate that passes the
//      age filter.  For MLB: return top result immediately.

async function findComp(
  excludeId: string,
  season: number,
  playerPcts: (number | null)[],
  ageRange: { min: number; max: number } | null,
  maxYears: number
): Promise<CompResult | null> {
  const years = Array.from({ length: maxYears }, (_, i) => season - i).filter(y => y >= 2017);

  // Kick off all fetches in parallel
  const [groupedResults, expResults] = await Promise.all([
    Promise.allSettled(years.map(yr => fetchGroupedYear(yr))),
    Promise.allSettled(years.map(yr => fetchExpNames(yr))),
  ]);

  // Build name lookup
  const nameMap: Record<string, string> = {};
  for (const r of expResults) {
    if (r.status === 'fulfilled') Object.assign(nameMap, r.value);
  }

  // Collect candidates
  const candidates: (Cand & { sim: number })[] = [];
  for (const r of groupedResults) {
    if (r.status !== 'fulfilled') continue;
    for (const c of r.value) {
      if (c.pid === excludeId) continue;
      const candPcts: (number | null)[] = [
        null,
        c.xwoba    != null ? normalPct(c.xwoba,    MLB.xwoba.mean,    MLB.xwoba.std,    true)  : null,
        c.chasePct != null ? normalPct(c.chasePct, MLB.chasePct.mean, MLB.chasePct.std, false) : null,
        c.zSwingPct!= null ? normalPct(c.zSwingPct,MLB.zSwingPct.mean,MLB.zSwingPct.std,true)  : null,
        c.zoneWhiff!= null ? normalPct(c.zoneWhiff,MLB.zoneWhiff.mean,MLB.zoneWhiff.std,false) : null,
        null,
      ];
      candidates.push({ ...c, sim: similarity(playerPcts, candPcts) });
    }
  }

  if (!candidates.length) return null;

  // Sort best-first
  candidates.sort((a, b) => b.sim - a.sim);

  // MLB: no age filter — return best
  if (!ageRange) {
    const best = candidates[0];
    const name = nameMap[best.pid] ?? parseName(best.rawName);
    return { playerId: parseInt(best.pid), playerName: name, season: best.yr, age: null, team: null, similarity: best.sim };
  }

  // MiLB: fetch birth years for the top 150 unique player IDs, then age-filter
  const top    = candidates.slice(0, 150);
  const unique = [...new Set(top.map(c => c.pid))];
  const births = await fetchBirthYears(unique);

  for (const c of top) {
    const by = births[c.pid];
    if (by == null) continue;
    const playerAge = c.yr - by;
    if (playerAge < ageRange.min || playerAge > ageRange.max) continue;
    const name = nameMap[c.pid] ?? parseName(c.rawName);
    return { playerId: parseInt(c.pid), playerName: name, season: c.yr, age: playerAge, team: null, similarity: c.sim };
  }

  return null;
}
