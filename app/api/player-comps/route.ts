import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 25;
export const dynamic = 'force-dynamic';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// Parse a player name from various Savant CSV formats.
// Handles: "First Last", "Last, First", "12345 Last, First" (ID prefix).
function parseName(first: string, last: string, fallback: string): string {
  if (first && last) return `${first} ${last}`;
  // Strip a leading numeric ID (e.g. "695578 Wood, James")
  const clean = fallback.replace(/^\d+\s+/, '').trim();
  if (clean.includes(',')) {
    const parts = clean.split(',');
    return `${parts[1].trim()} ${parts[0].trim()}`;
  }
  return clean;
}

// ── Baselines (general MLB) ───────────────────────────────────────────────────
const MLB = {
  ev90:      { mean: 107.0, std: 3.5 },
  xwoba:     { mean: 0.315, std: 0.044 },
  chasePct:  { mean: 27.5,  std: 6.5 },
  zSwingPct: { mean: 68.0,  std: 8.5 },
  zoneWhiff: { mean: 16.0,  std: 7.0 },
  avgLaHard: { mean: 13.5,  std: 8.0 },
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

  // Both MLB and MiLB players compare against MLB hitters using MLB-scale baselines.
  const playerPcts: (number | null)[] = [
    !isNaN(ev90)      ? normalPct(ev90,      MLB.ev90.mean,      MLB.ev90.std,      true)  : null,
    !isNaN(xwoba)     ? normalPct(xwoba,     MLB.xwoba.mean,     MLB.xwoba.std,     true)  : null,
    !isNaN(chasePct)  ? normalPct(chasePct,  MLB.chasePct.mean,  MLB.chasePct.std,  false) : null,
    !isNaN(zSwingPct) ? normalPct(zSwingPct, MLB.zSwingPct.mean, MLB.zSwingPct.std, true)  : null,
    !isNaN(zoneWhiff) ? normalPct(zoneWhiff, MLB.zoneWhiff.mean, MLB.zoneWhiff.std, false) : null,
    !isNaN(avgLaHard) ? normalPct(avgLaHard, MLB.avgLaHard.mean, MLB.avgLaHard.std, true)  : null,
  ];

  try {
    const isMLB = sportId === 1;
    // MiLB: age window ±4 years; MLB: no age restriction.
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
// For each season in the lookback window, fetches two Savant CSVs in parallel:
//   1. Statcast leaderboard  → player_age (reliable), avg_hit_speed, est_woba, player name
//   2. Statcast search grouped by batter → chase%, z-swing%, zone whiff%, xwOBA
// Merges on player_id so the age filter always works.

async function findComp(
  excludeId: string,
  season: number,
  playerPcts: (number | null)[],
  ageRange: { min: number; max: number } | null,
  maxYears: number
): Promise<CompResult | null> {
  const years = Array.from({ length: maxYears }, (_, i) => season - i).filter(y => y >= 2017);

  // Fetch both data sources for every season year in parallel
  const yearData = await Promise.allSettled(
    years.map(async yr => {
      const [lbRes, scRes] = await Promise.allSettled([
        // Statcast leaderboard: reliable source for player_age, avg EV, xwOBA, player name
        fetchText(
          `https://baseballsavant.mlb.com/leaderboard/statcast?min=50&year=${yr}&position=&team=&type=batter&csv=true`
        ),
        // Statcast search grouped by batter: chase%, z-swing%, zone-contact%
        fetchText(
          `https://baseballsavant.mlb.com/statcast_search/csv?all=true&player_type=batter` +
          `&hfSea=${yr}%7C&hfGT=R%7C&game_date_gt=&game_date_lt=` +
          `&min_pitches=0&min_results=0&min_pas=100&type=details&group_by=name&csv=true`
        ),
      ]);
      return { yr, lbRes, scRes };
    })
  );

  type LBRow = { name: string; age: number | null; evAvg: number | null; xwoba: number | null };

  let bestComp: CompResult | null = null;
  let bestSim = -1;

  for (const r of yearData) {
    if (r.status !== 'fulfilled') continue;
    const { yr, lbRes, scRes } = r.value;

    // ── Build leaderboard map: player_id → { age, evAvg, xwoba, name } ──────
    const lbMap: Record<string, LBRow> = {};
    if (lbRes.status === 'fulfilled') {
      for (const row of parseCSV(lbRes.value)) {
        const pid = (row.player_id ?? '').trim();
        if (!pid) continue;
        const age  = row.player_age ? parseInt(row.player_age) : null;
        const name = parseName(
          (row.first_name ?? '').trim(),
          (row.last_name  ?? '').trim(),
          (row.player_name ?? `Player ${pid}`).trim()
        );
        lbMap[pid] = {
          name,
          age: !isNaN(age as number) ? age : null,
          evAvg: parseFloat(row.avg_hit_speed ?? '') || null,
          xwoba: parseFloat(row.est_woba ?? '') || null,
        };
      }
    }

    // ── Process grouped search rows (discipline metrics) ────────────────────
    if (scRes.status === 'fulfilled') {
      for (const row of parseCSV(scRes.value)) {
        const pid = (row.batter ?? '').trim();
        if (!pid || pid === excludeId) continue;
        if (parseInt(row.pa ?? '0') < 100) continue;

        const lb = lbMap[pid];

        // Age filter — relies on leaderboard data; skip if unavailable
        const playerAge = lb?.age ?? null;
        if (ageRange != null) {
          if (playerAge == null) continue;
          if (playerAge < ageRange.min || playerAge > ageRange.max) continue;
        }

        const xwobaVal = parseFloat(row.estimated_woba_using_speedangle ?? '') || lb?.xwoba || NaN;
        if (isNaN(xwobaVal)) continue;

        const cRaw  = parseFloat(row.out_zone_swing_percent ?? row.chase_percent          ?? '');
        const zRaw  = parseFloat(row.in_zone_swing_percent  ?? row.zone_swing_percent     ?? '');
        const zcRaw = parseFloat(row.in_zone_contact_percent ?? '');
        const wRaw  = parseFloat(row.whiff_percent           ?? row.swinging_strike_percent ?? '');
        const evAvg = lb?.evAvg ?? (parseFloat(row.launch_speed ?? row.launch_speed_avg ?? '') || null);

        const chaseVal     = !isNaN(cRaw)  ? cRaw  : null;
        const zswingVal    = !isNaN(zRaw)  ? zRaw  : null;
        const zoneWhiffEst = !isNaN(zcRaw) ? 100 - zcRaw : !isNaN(wRaw) ? wRaw : null;
        const ev90Est      = evAvg && evAvg > 50 ? evAvg * 1.08 : null;

        // Name from leaderboard (reliable); fall back to parsing the search CSV column
        const playerName = lb?.name || parseName(
          '',
          '',
          (row.player_name ?? `Player ${pid}`).trim()
        );

        const candPcts: (number | null)[] = [
          ev90Est      != null ? normalPct(ev90Est,      MLB.ev90.mean,      MLB.ev90.std,      true)  : null,
          normalPct(xwobaVal, MLB.xwoba.mean, MLB.xwoba.std, true),
          chaseVal     != null ? normalPct(chaseVal,     MLB.chasePct.mean,  MLB.chasePct.std,  false) : null,
          zswingVal    != null ? normalPct(zswingVal,    MLB.zSwingPct.mean, MLB.zSwingPct.std, true)  : null,
          zoneWhiffEst != null ? normalPct(zoneWhiffEst, MLB.zoneWhiff.mean, MLB.zoneWhiff.std, false) : null,
          null,
        ];

        const sim = similarity(playerPcts, candPcts);
        if (sim > bestSim) {
          bestSim = sim;
          bestComp = { playerId: parseInt(pid), playerName, season: yr, age: playerAge, team: null, similarity: sim };
        }
      }
    } else if (lbRes.status === 'fulfilled') {
      // Grouped search failed — fall back to leaderboard only (xwOBA + EV, no discipline)
      for (const [pid, lb] of Object.entries(lbMap)) {
        if (pid === excludeId || lb.xwoba == null) continue;
        if (ageRange) {
          if (lb.age == null || lb.age < ageRange.min || lb.age > ageRange.max) continue;
        }
        const ev90Est = lb.evAvg && lb.evAvg > 50 ? lb.evAvg * 1.08 : null;
        const candPcts: (number | null)[] = [
          ev90Est != null ? normalPct(ev90Est, MLB.ev90.mean, MLB.ev90.std, true) : null,
          normalPct(lb.xwoba, MLB.xwoba.mean, MLB.xwoba.std, true),
          null, null, null, null,
        ];
        const sim = similarity(playerPcts, candPcts);
        if (sim > bestSim) {
          bestSim = sim;
          bestComp = { playerId: parseInt(pid), playerName: lb.name, season: yr, age: lb.age, team: null, similarity: sim };
        }
      }
    }
  }

  return bestComp;
}
