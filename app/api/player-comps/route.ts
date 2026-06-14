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

// General MLB Statcast baselines (matches clientMLBBaseline in PercentileProfile.tsx)
const MLB = {
  ev90:      { mean: 107.0, std: 3.5 },
  xwoba:     { mean: 0.315, std: 0.044 },
  chasePct:  { mean: 27.5,  std: 6.5 },
  zSwingPct: { mean: 68.0,  std: 8.5 },
  zoneWhiff: { mean: 16.0,  std: 7.0 },
  avgLaHard: { mean: 13.5,  std: 8.0 },
};

// MLB traditional-stat baselines used as proxies for Statcast axes
const PROXY = {
  iso:   { mean: 0.175, std: 0.065 }, // proxy for ev90   (axis 0)
  bbPct: { mean: 8.5,   std: 2.5  }, // proxy for chasePct (axis 2) — higher BB% ≈ lower chase%
  kPct:  { mean: 22.0,  std: 6.0  }, // proxy for zoneWhiff (axis 4) — lower K% ≈ lower zone whiff
};

// ── Types ─────────────────────────────────────────────────────────────────────

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

  // Both MLB and MiLB compare against MLB hitters using MLB-scale baselines.
  const playerPcts: (number | null)[] = [
    !isNaN(ev90)      ? normalPct(ev90,      MLB.ev90.mean,      MLB.ev90.std,      true)  : null,
    !isNaN(xwoba)     ? normalPct(xwoba,     MLB.xwoba.mean,     MLB.xwoba.std,     true)  : null,
    !isNaN(chasePct)  ? normalPct(chasePct,  MLB.chasePct.mean,  MLB.chasePct.std,  false) : null,
    !isNaN(zSwingPct) ? normalPct(zSwingPct, MLB.zSwingPct.mean, MLB.zSwingPct.std, true)  : null,
    !isNaN(zoneWhiff) ? normalPct(zoneWhiff, MLB.zoneWhiff.mean, MLB.zoneWhiff.std, false) : null,
    !isNaN(avgLaHard) ? normalPct(avgLaHard, MLB.avgLaHard.mean, MLB.avgLaHard.std, true)  : null,
  ];

  try {
    const isMLB   = sportId === 1;
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

// ── Comp search ───────────────────────────────────────────────────────────────
//
// Data sources (all fetched in parallel across years):
//   • Savant expected_statistics leaderboard — xwOBA + player name (RELIABLE)
//   • MLB Stats API season hitting stats     — K%, BB%, ISO proxies + team
//
// For MiLB (ageRange set): also batch-fetches birth dates from the MLB Stats API
// people endpoint so the age window can be enforced.

async function findComp(
  excludeId: string,
  season: number,
  playerPcts: (number | null)[],
  ageRange: { min: number; max: number } | null,
  maxYears: number
): Promise<CompResult | null> {
  const years = Array.from({ length: maxYears }, (_, i) => season - i).filter(y => y >= 2017);

  // Fetch both sources for every season in parallel
  const [expFetched, statsFetched] = await Promise.all([
    Promise.allSettled(
      years.map(yr =>
        fetchText(
          `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${yr}&position=&team=&min=50&csv=true`
        ).then(text => ({ yr, text }))
      )
    ),
    Promise.allSettled(
      years.map(yr =>
        fetchJSON(
          `${MLB_API}/stats?stats=season&group=hitting&season=${yr}&sportId=1&limit=600&gameType=R`
        ).then(data => ({ yr, data }))
      )
    ),
  ]);

  // ── Build candidate pool ──────────────────────────────────────────────────
  type Cand = {
    pid: string; name: string; yr: number;
    xwoba: number | null;
    kPct: number | null; bbPct: number | null; iso: number | null;
    team: string | null;
  };
  const pool: Record<string, Cand> = {}; // key = pid:yr

  // Expected statistics → xwOBA + names
  for (const r of expFetched) {
    if (r.status !== 'fulfilled') continue;
    const { yr, text } = r.value;
    for (const row of parseCSV(text)) {
      const pid = (row.player_id ?? '').trim();
      if (!pid || pid === excludeId) continue;
      if (parseInt(row.pa ?? '0') < 50) continue;
      const xwoba = parseFloat(row.est_woba ?? '');
      if (isNaN(xwoba)) continue;
      const first = (row.first_name ?? '').trim();
      const last  = (row.last_name  ?? '').trim();
      const name  = first && last ? `${first} ${last}` : first || last || `Player ${pid}`;
      pool[`${pid}:${yr}`] = { pid, name, yr, xwoba, kPct: null, bbPct: null, iso: null, team: null };
    }
  }

  // MLB Stats API season stats → K%, BB%, ISO, team
  for (const r of statsFetched) {
    if (r.status !== 'fulfilled') continue;
    const { yr, data } = r.value;
    const splits = ((data as Record<string, unknown>)?.stats as unknown[])?.[0] as Record<string, unknown>;
    const rows = (splits?.splits ?? []) as Record<string, unknown>[];
    for (const row of rows) {
      const pid = String((row.player as Record<string, unknown>)?.id ?? '');
      if (!pid || pid === excludeId) continue;
      const stat = row.stat as Record<string, unknown>;
      const pa  = Number(stat?.plateAppearances ?? 0);
      if (pa < 50) continue;
      const k   = Number(stat?.strikeOuts  ?? 0);
      const bb  = Number(stat?.baseOnBalls ?? 0);
      const avg = parseFloat(String(stat?.avg ?? ''));
      const slg = parseFloat(String(stat?.slg ?? ''));
      const team = (row.team as Record<string, unknown>)?.abbreviation as string ?? null;
      const key = `${pid}:${yr}`;
      if (pool[key]) {
        pool[key].kPct  = k  / pa * 100;
        pool[key].bbPct = bb / pa * 100;
        pool[key].iso   = !isNaN(slg) && !isNaN(avg) ? slg - avg : null;
        pool[key].team  = team;
      }
      // (Players in stats but not in expected_stats are skipped — no reliable name)
    }
  }

  const candidates = Object.values(pool);
  if (candidates.length === 0) return null;

  // ── Age filter (MiLB only) ────────────────────────────────────────────────
  let birthYearMap: Record<string, number> = {};
  if (ageRange) {
    const uniquePids = [...new Set(candidates.map(c => c.pid))];
    // Batch in groups of 250 to stay under URL length limits
    const batches: string[][] = [];
    for (let i = 0; i < uniquePids.length; i += 250) batches.push(uniquePids.slice(i, i + 250));
    const batchResults = await Promise.allSettled(
      batches.map(b =>
        fetchJSON(`${MLB_API}/people?personIds=${b.join(',')}&fields=people,id,birthDate`)
      )
    );
    for (const r of batchResults) {
      if (r.status !== 'fulfilled') continue;
      for (const p of ((r.value as Record<string, unknown>)?.people ?? []) as Record<string, unknown>[]) {
        const id = p.id as number;
        const bd = p.birthDate as string;
        if (id && bd) birthYearMap[String(id)] = parseInt(bd.slice(0, 4));
      }
    }
  }

  // ── Find best comp ────────────────────────────────────────────────────────
  let bestComp: CompResult | null = null;
  let bestSim = -1;

  for (const c of candidates) {
    let ageAtSeason: number | null = null;
    if (ageRange) {
      const by = birthYearMap[c.pid];
      if (by == null) continue; // can't verify age
      ageAtSeason = c.yr - by;
      if (ageAtSeason < ageRange.min || ageAtSeason > ageRange.max) continue;
    }

    // Candidate percentiles mapped to radar axes:
    //  axis 0 (ev90)      → ISO proxy
    //  axis 1 (xwoba)     → xwOBA
    //  axis 2 (chasePct)  → BB% proxy (higher BB% ≈ lower chase%)
    //  axis 3 (zSwingPct) → no proxy
    //  axis 4 (zoneWhiff) → K% proxy (lower K% ≈ lower zone whiff%)
    //  axis 5 (avgLaHard) → no proxy
    const candPcts: (number | null)[] = [
      c.iso   != null ? normalPct(c.iso,   PROXY.iso.mean,   PROXY.iso.std,   true)  : null,
      c.xwoba != null ? normalPct(c.xwoba, MLB.xwoba.mean,   MLB.xwoba.std,   true)  : null,
      c.bbPct != null ? normalPct(c.bbPct, PROXY.bbPct.mean, PROXY.bbPct.std, true)  : null,
      null,
      c.kPct  != null ? normalPct(c.kPct,  PROXY.kPct.mean,  PROXY.kPct.std,  false) : null,
      null,
    ];

    const sim = similarity(playerPcts, candPcts);
    if (sim > bestSim) {
      bestSim = sim;
      bestComp = {
        playerId:   parseInt(c.pid),
        playerName: c.name,
        season:     c.yr,
        age:        ageAtSeason ?? (birthYearMap[c.pid] ? c.yr - birthYearMap[c.pid] : null),
        team:       c.team,
        similarity: sim,
      };
    }
  }

  return bestComp;
}
