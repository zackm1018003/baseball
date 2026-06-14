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

// L2 distance in percentile space — only uses axes where both sides have a value
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
  const rmse = Math.sqrt(sumSq / count);
  return Math.round(Math.max(0, 100 - rmse));
}

// ── Baselines (general MLB) ───────────────────────────────────────────────────
// Same values as clientMLBBaseline() in PercentileProfile.tsx
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

  // Both MLB and MiLB players are compared against MLB players using MLB baselines.
  // MiLB players get an age window (±4 years) and a longer 7-season lookback.
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

    // MiLB: filter candidates to MLB players whose age at the time was within ±4 of the
    // current player's age; look back 7 seasons instead of 5.
    const ageRange = (!isMLB && !isNaN(age))
      ? { min: Math.floor(age) - 4, max: Math.ceil(age) + 4 }
      : null;
    const maxYears = isMLB ? 5 : 7;

    const comp = await findMLBComp(playerId, season, playerPcts, ageRange, maxYears);
    return NextResponse.json({ comp });
  } catch (e) {
    console.error('player-comps error:', e);
    return NextResponse.json({ comp: null });
  }
}

// ── Comp search ───────────────────────────────────────────────────────────────
// Searches qualified MLB hitters across `maxYears` seasons for the player whose
// percentile profile (on MLB baselines) is closest to `playerPcts`.
// When `ageRange` is set, only considers rows whose player_age falls within it.

async function findMLBComp(
  excludeId: string,
  season: number,
  playerPcts: (number | null)[],
  ageRange: { min: number; max: number } | null,
  maxYears: number
): Promise<CompResult | null> {
  const years = Array.from({ length: maxYears }, (_, i) => season - i).filter(y => y >= 2017);

  // Primary: Savant statcast_search grouped by batter — gives chase%, z-swing%,
  // zone whiff%, avg EV, and xwOBA for every qualified hitter in one aggregated CSV.
  // Fallback: expected_statistics leaderboard (xwOBA only).
  const fetched = await Promise.allSettled(
    years.map(yr =>
      fetchText(
        `https://baseballsavant.mlb.com/statcast_search/csv?all=true&player_type=batter` +
        `&hfSea=${yr}%7C&hfGT=R%7C&game_date_gt=&game_date_lt=` +
        `&min_pitches=0&min_results=0&min_pas=100&type=details&group_by=name&csv=true`
      ).then(text => ({ yr, text, src: 'sc' as const }))
      .catch(() =>
        fetchText(
          `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${yr}&position=&team=&min=50&csv=true`
        ).then(text => ({ yr, text, src: 'exp' as const }))
      )
    )
  );

  let bestComp: CompResult | null = null;
  let bestSim = -1;

  for (const r of fetched) {
    if (r.status !== 'fulfilled') continue;
    const { yr, text, src } = r.value;

    for (const row of parseCSV(text)) {
      let pid: string, playerName: string, playerAge: number | null;
      let xwobaVal: number, chaseVal: number | null, zswingVal: number | null;
      let zoneWhiffEst: number | null, ev90Est: number | null;

      if (src === 'sc') {
        pid = (row.batter ?? '').trim();
        if (!pid || pid === excludeId) continue;
        if (parseInt(row.pa ?? '0') < 100) continue;

        xwobaVal = parseFloat(row.estimated_woba_using_speedangle ?? '');
        if (isNaN(xwobaVal)) continue;

        playerAge = row.player_age ? parseInt(row.player_age) : null;

        // Age filter for MiLB comps
        if (ageRange && playerAge != null) {
          if (playerAge < ageRange.min || playerAge > ageRange.max) continue;
        }

        const cRaw  = parseFloat(row.out_zone_swing_percent ?? row.chase_percent ?? '');
        chaseVal    = !isNaN(cRaw)  ? cRaw  : null;

        const zRaw  = parseFloat(row.in_zone_swing_percent ?? row.zone_swing_percent ?? '');
        zswingVal   = !isNaN(zRaw)  ? zRaw  : null;

        const zcRaw = parseFloat(row.in_zone_contact_percent ?? '');
        const wRaw  = parseFloat(row.whiff_percent ?? row.swinging_strike_percent ?? '');
        zoneWhiffEst = !isNaN(zcRaw) ? 100 - zcRaw : !isNaN(wRaw) ? wRaw : null;

        const evAvg = parseFloat(row.launch_speed ?? row.launch_speed_avg ?? '');
        ev90Est = !isNaN(evAvg) && evAvg > 50 ? evAvg * 1.08 : null;

        const rawName = (row.player_name ?? '').trim();
        const parts   = rawName.split(',');
        playerName = parts.length === 2 ? `${parts[1].trim()} ${parts[0].trim()}` : rawName;

      } else {
        // expected_statistics fallback — xwOBA only
        pid = (row.player_id ?? '').trim();
        if (!pid || pid === excludeId) continue;
        if (parseInt(row.pa ?? '0') < 50) continue;

        xwobaVal = parseFloat(row.est_woba ?? row.xwoba ?? '');
        if (isNaN(xwobaVal)) continue;

        playerAge = row.player_age ? parseInt(row.player_age) : null;

        if (ageRange && playerAge != null) {
          if (playerAge < ageRange.min || playerAge > ageRange.max) continue;
        }

        chaseVal = null; zswingVal = null; zoneWhiffEst = null; ev90Est = null;
        const first = (row.first_name ?? '').trim();
        const last  = (row.last_name ?? row.player_name ?? '').trim();
        playerName  = first ? `${first} ${last}` : last;
      }

      const candPcts: (number | null)[] = [
        ev90Est      != null ? normalPct(ev90Est,      MLB.ev90.mean,      MLB.ev90.std,      true)  : null,
        normalPct(xwobaVal, MLB.xwoba.mean, MLB.xwoba.std, true),
        chaseVal     != null ? normalPct(chaseVal,     MLB.chasePct.mean,  MLB.chasePct.std,  false) : null,
        zswingVal    != null ? normalPct(zswingVal,    MLB.zSwingPct.mean, MLB.zSwingPct.std, true)  : null,
        zoneWhiffEst != null ? normalPct(zoneWhiffEst, MLB.zoneWhiff.mean, MLB.zoneWhiff.std, false) : null,
        null, // avgLaHard — no proxy in aggregated leaderboard
      ];

      const sim = similarity(playerPcts, candPcts);
      if (sim > bestSim) {
        bestSim = sim;
        bestComp = {
          playerId:   parseInt(pid),
          playerName,
          season:     yr,
          age:        playerAge,
          team:       null,
          similarity: sim,
        };
      }
    }
  }

  return bestComp;
}
