import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 25;
export const dynamic = 'force-dynamic';

const MLB_API = 'https://statsapi.mlb.com/api/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

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

// ── Baselines ─────────────────────────────────────────────────────────────────

const MLB = {
  ev90:      { mean: 107.0, std: 3.5  },
  xwoba:     { mean: 0.315, std: 0.044 },
  chasePct:  { mean: 27.5,  std: 6.5  },
  zSwingPct: { mean: 68.0,  std: 8.5  },
  zoneWhiff: { mean: 16.0,  std: 7.0  },
  avgLaHard: { mean: 13.5,  std: 8.0  },
};

// Traditional-stat proxies for Savant axes when Statcast data unavailable
const PROXY = {
  iso:   { mean: 0.175, std: 0.065 }, // axis 0 (ev90)
  bbPct: { mean: 8.5,   std: 2.5   }, // axis 2 (chasePct) — higher BB% ≈ lower chase%
  kPct:  { mean: 22.0,  std: 6.0   }, // axis 4 (zoneWhiff) — lower K% ≈ lower zone whiff%
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface Cand {
  pid: string; name: string; yr: number;
  xwoba: number | null; ev: number | null; age: number | null;
  kPct: number | null; bbPct: number | null; iso: number | null;
  team: string | null;
}

interface CompResult {
  playerId: number;
  playerName: string;
  season: number;
  age: number | null;
  team: string | null;
  similarity: number;
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

  const playerPcts: (number | null)[] = [
    !isNaN(ev90)      ? normalPct(ev90,      MLB.ev90.mean,      MLB.ev90.std,      true)  : null,
    !isNaN(xwoba)     ? normalPct(xwoba,     MLB.xwoba.mean,     MLB.xwoba.std,     true)  : null,
    !isNaN(chasePct)  ? normalPct(chasePct,  MLB.chasePct.mean,  MLB.chasePct.std,  false) : null,
    !isNaN(zSwingPct) ? normalPct(zSwingPct, MLB.zSwingPct.mean, MLB.zSwingPct.std, true)  : null,
    !isNaN(zoneWhiff) ? normalPct(zoneWhiff, MLB.zoneWhiff.mean, MLB.zoneWhiff.std, false) : null,
    !isNaN(avgLaHard) ? normalPct(avgLaHard, MLB.avgLaHard.mean, MLB.avgLaHard.std, true)  : null,
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

// ── Per-year data fetch ───────────────────────────────────────────────────────
//
// Three parallel sources per year:
//   1. Savant statcast leaderboard  → player_id, name, player_age, avg_hit_speed, est_woba
//   2. Savant expected_statistics   → player_id, name, est_woba (fallback for xwOBA)
//   3. MLB Stats API season stats   → K%, BB%, ISO (discipline proxies), team
//
// player_age comes directly from the statcast leaderboard so no batch people
// call is needed for age filtering.

async function fetchYearCandidates(yr: number): Promise<Cand[]> {
  const [scRes, expRes, statsRes] = await Promise.allSettled([
    fetchText(
      `https://baseballsavant.mlb.com/leaderboard/statcast?min=50&year=${yr}&position=&team=&type=batter&csv=true`
    ),
    fetchText(
      `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${yr}&position=&team=&min=50&csv=true`
    ),
    fetchJSON(
      `${MLB_API}/stats?stats=season&group=hitting&season=${yr}&sportId=1&limit=600&gameType=R`
    ),
  ]);

  // ── Statcast leaderboard (primary) ──
  const scMap: Record<string, Partial<Cand>> = {};
  if (scRes.status === 'fulfilled') {
    for (const row of parseCSV(scRes.value)) {
      const pid = (row.player_id ?? '').trim();
      if (!pid || parseInt(row.pa ?? '0') < 50) continue;
      const first  = (row.first_name ?? '').trim();
      const last   = (row.last_name  ?? '').trim();
      const name   = first && last ? `${first} ${last}` : first || last || `Player ${pid}`;
      // Try multiple column name variants defensively
      const ageRaw = row.player_age ?? row.age ?? '';
      const evRaw  = row.avg_hit_speed ?? row.exit_velocity_avg ?? row.avg_ev ?? '';
      const xwRaw  = row.est_woba ?? row.xwoba ?? row.estimated_woba ?? '';
      const age    = parseInt(ageRaw);
      const ev     = parseFloat(evRaw);
      const xwoba  = parseFloat(xwRaw);
      scMap[pid] = {
        pid, yr, name,
        age:   isNaN(age)   ? null : age,
        ev:    isNaN(ev)    ? null : ev,
        xwoba: isNaN(xwoba) ? null : xwoba,
        kPct: null, bbPct: null, iso: null, team: null,
      };
    }
  }

  // ── Expected statistics (xwOBA + name fallback) ──
  const expMap: Record<string, { name: string; xwoba: number }> = {};
  if (expRes.status === 'fulfilled') {
    for (const row of parseCSV(expRes.value)) {
      const pid = (row.player_id ?? '').trim();
      if (!pid || parseInt(row.pa ?? '0') < 50) continue;
      const xwoba = parseFloat(row.est_woba ?? '');
      if (isNaN(xwoba)) continue;
      const first = (row.first_name ?? '').trim();
      const last  = (row.last_name  ?? '').trim();
      expMap[pid] = {
        name:  first && last ? `${first} ${last}` : first || last || `Player ${pid}`,
        xwoba,
      };
    }
  }

  // ── Merge into candidate list ──
  const allPids = new Set([...Object.keys(scMap), ...Object.keys(expMap)]);
  const candMap: Record<string, Cand> = {};

  for (const pid of allPids) {
    const sc  = scMap[pid];
    const exp = expMap[pid];
    const xwoba = sc?.xwoba ?? exp?.xwoba ?? null;
    if (xwoba == null) continue; // need at least xwOBA to score similarity
    candMap[pid] = {
      pid, yr,
      name:  sc?.name  ?? exp?.name  ?? `Player ${pid}`,
      age:   sc?.age   ?? null,
      ev:    sc?.ev    ?? null,
      xwoba,
      kPct: null, bbPct: null, iso: null, team: null,
    };
  }

  // ── MLB Stats API — discipline proxies & team ──
  if (statsRes.status === 'fulfilled') {
    const data  = statsRes.value as Record<string, unknown>;
    const stats = (data?.stats as unknown[]) ?? [];
    const splits = ((stats[0] as Record<string, unknown>)?.splits as unknown[]) ?? [];
    for (const raw of splits) {
      const s   = raw as Record<string, unknown>;
      const pid = String((s.player as Record<string, unknown>)?.id ?? '');
      if (!pid || !candMap[pid]) continue;
      const stat = s.stat as Record<string, unknown>;
      const pa   = Number(stat?.plateAppearances ?? 0);
      if (pa < 50) continue;
      const k  = Number(stat?.strikeOuts  ?? 0);
      const bb = Number(stat?.baseOnBalls ?? 0);
      const avg = parseFloat(String(stat?.avg ?? ''));
      const slg = parseFloat(String(stat?.slg ?? ''));
      candMap[pid].kPct  = k  / pa * 100;
      candMap[pid].bbPct = bb / pa * 100;
      candMap[pid].iso   = !isNaN(slg) && !isNaN(avg) ? slg - avg : null;
      candMap[pid].team  = (s.team as Record<string, unknown>)?.abbreviation as string ?? null;
    }
  }

  return Object.values(candMap);
}

// ── Comp search ───────────────────────────────────────────────────────────────

async function findComp(
  excludeId: string,
  season: number,
  playerPcts: (number | null)[],
  ageRange: { min: number; max: number } | null,
  maxYears: number
): Promise<CompResult | null> {
  const years = Array.from({ length: maxYears }, (_, i) => season - i).filter(y => y >= 2017);

  const yearResults = await Promise.allSettled(years.map(yr => fetchYearCandidates(yr)));

  const candidates: Cand[] = [];
  for (const r of yearResults) {
    if (r.status !== 'fulfilled') continue;
    for (const c of r.value) {
      if (c.pid === excludeId) continue;
      candidates.push(c);
    }
  }

  if (candidates.length === 0) return null;

  let bestComp: CompResult | null = null;
  let bestSim = -1;

  for (const c of candidates) {
    // Age filter (MiLB only — ageRange null means MLB, skip filter)
    if (ageRange) {
      if (c.age == null) continue; // statcast leaderboard didn't have player_age for this row
      if (c.age < ageRange.min || c.age > ageRange.max) continue;
    }

    // Candidate percentiles mapped to radar axes:
    //  axis 0 (ev90)      → avg_hit_speed (Savant EV) or ISO proxy
    //  axis 1 (xwoba)     → xwOBA
    //  axis 2 (chasePct)  → BB% proxy
    //  axis 3 (zSwingPct) → no proxy
    //  axis 4 (zoneWhiff) → K% proxy
    //  axis 5 (avgLaHard) → no proxy
    const ev0 = c.ev   != null ? normalPct(c.ev,    MLB.ev90.mean,      MLB.ev90.std,      true)  :
                c.iso  != null ? normalPct(c.iso,   PROXY.iso.mean,     PROXY.iso.std,     true)  : null;
    const candPcts: (number | null)[] = [
      ev0,
      c.xwoba != null ? normalPct(c.xwoba, MLB.xwoba.mean,     MLB.xwoba.std,     true)  : null,
      c.bbPct != null ? normalPct(c.bbPct, PROXY.bbPct.mean,   PROXY.bbPct.std,   true)  : null,
      null,
      c.kPct  != null ? normalPct(c.kPct,  PROXY.kPct.mean,    PROXY.kPct.std,    false) : null,
      null,
    ];

    const sim = similarity(playerPcts, candPcts);
    if (sim > bestSim) {
      bestSim = sim;
      bestComp = {
        playerId:   parseInt(c.pid),
        playerName: c.name,
        season:     c.yr,
        age:        c.age,
        team:       c.team,
        similarity: sim,
      };
    }
  }

  return bestComp;
}
