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
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
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

// ── Baselines ─────────────────────────────────────────────────────────────────

// General MLB baselines (same as clientMLBBaseline in PercentileProfile.tsx)
const MLB = {
  ev90:      { mean: 107.0, std: 3.5 },
  xwoba:     { mean: 0.315, std: 0.044 },
  chasePct:  { mean: 27.5,  std: 6.5 },
  zSwingPct: { mean: 68.0,  std: 8.5 },
  zoneWhiff: { mean: 16.0,  std: 7.0 },
  avgLaHard: { mean: 13.5,  std: 8.0 },
};

// Rough Statcast baselines for MiLB full-season hitters
const MILB_SC = {
  ev90:      { mean: 104.5, std: 3.5 },
  xwoba:     { mean: 0.290, std: 0.050 },
  chasePct:  { mean: 31.0,  std: 7.5 },
  zoneWhiff: { mean: 19.0,  std: 7.5 },
};

// Traditional stat baselines as proxies for the above axes in MiLB comp pool
const MILB_TRAD = {
  iso:   { mean: 0.145, std: 0.055 }, // proxy for ev90
  obp:   { mean: 0.325, std: 0.048 }, // proxy for xwoba
  bbPct: { mean: 9.0,   std: 3.5 },  // proxy for chasePct (high BB% = good discipline)
  kPct:  { mean: 24.0,  std: 7.0 },  // proxy for zoneWhiff (low K% = good contact)
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

  try {
    let comp: CompResult | null = null;

    if (sportId === 1) {
      // Radar axes: [ev90, xwoba, chasePct, zSwingPct, zoneWhiff, avgLaHard]
      const playerPcts: (number | null)[] = [
        !isNaN(ev90)      ? normalPct(ev90,      MLB.ev90.mean,      MLB.ev90.std,      true)  : null,
        !isNaN(xwoba)     ? normalPct(xwoba,     MLB.xwoba.mean,     MLB.xwoba.std,     true)  : null,
        !isNaN(chasePct)  ? normalPct(chasePct,  MLB.chasePct.mean,  MLB.chasePct.std,  false) : null,
        !isNaN(zSwingPct) ? normalPct(zSwingPct, MLB.zSwingPct.mean, MLB.zSwingPct.std, true)  : null,
        !isNaN(zoneWhiff) ? normalPct(zoneWhiff, MLB.zoneWhiff.mean, MLB.zoneWhiff.std, false) : null,
        !isNaN(avgLaHard) ? normalPct(avgLaHard, MLB.avgLaHard.mean, MLB.avgLaHard.std, true)  : null,
      ];
      comp = await findMLBComp(playerId, season, playerPcts);
    } else {
      // For MiLB: convert Statcast metrics to proxy percentiles using general MiLB baselines
      // Axes 0 (ev90), 1 (xwoba), 2 (chasePct), 4 (zoneWhiff) have proxies; 3 and 5 are skipped
      const playerPcts: (number | null)[] = [
        !isNaN(ev90)      ? normalPct(ev90,      MILB_SC.ev90.mean,      MILB_SC.ev90.std,      true)  : null,
        !isNaN(xwoba)     ? normalPct(xwoba,     MILB_SC.xwoba.mean,     MILB_SC.xwoba.std,     true)  : null,
        !isNaN(chasePct)  ? normalPct(chasePct,  MILB_SC.chasePct.mean,  MILB_SC.chasePct.std,  false) : null,
        null,
        !isNaN(zoneWhiff) ? normalPct(zoneWhiff, MILB_SC.zoneWhiff.mean, MILB_SC.zoneWhiff.std, false) : null,
        null,
      ];
      const bornYear = !isNaN(age) ? season - Math.round(age) : null;
      comp = await findMiLBComp(playerId, bornYear, season, sportId, playerPcts);
    }

    return NextResponse.json({ comp });
  } catch (e) {
    console.error('player-comps error:', e);
    return NextResponse.json({ comp: null });
  }
}

// ── MLB comp ──────────────────────────────────────────────────────────────────

async function findMLBComp(
  excludeId: string,
  season: number,
  playerPcts: (number | null)[]
): Promise<CompResult | null> {
  const years = [season, season - 1, season - 2, season - 3, season - 4].filter(y => y >= 2017);

  const fetched = await Promise.allSettled(
    years.map(yr =>
      fetchText(
        `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${yr}&position=&team=&min=50&csv=true`
      ).then(text => ({ yr, text }))
    )
  );

  let bestComp: CompResult | null = null;
  let bestSim = -1;

  for (const r of fetched) {
    if (r.status !== 'fulfilled') continue;
    const { yr, text } = r.value;
    if (!text.includes('player_id')) continue;

    for (const row of parseCSV(text)) {
      const pid = (row.player_id ?? '').trim();
      if (!pid || pid === excludeId) continue;
      const pa = parseInt(row.pa ?? '0');
      if (pa < 50) continue;
      const xwobaVal = parseFloat(row.est_woba ?? row.xwoba ?? '');
      if (isNaN(xwobaVal)) continue;

      // Only xwOBA available from this leaderboard (axis 1)
      const candPcts: (number | null)[] = [
        null,
        normalPct(xwobaVal, MLB.xwoba.mean, MLB.xwoba.std, true),
        null, null, null, null,
      ];

      const sim = similarity(playerPcts, candPcts);
      if (sim > bestSim) {
        bestSim = sim;
        const first = (row.first_name ?? '').trim();
        const last  = (row.last_name  ?? row.player_name ?? '').trim();
        bestComp = {
          playerId: parseInt(pid),
          playerName: first ? `${first} ${last}` : last,
          season: yr,
          age: row.player_age ? parseInt(row.player_age) : null,
          team: null,
          similarity: sim,
        };
      }
    }
  }

  return bestComp;
}

// ── MiLB comp ─────────────────────────────────────────────────────────────────

async function findMiLBComp(
  excludeId: string,
  bornYear: number | null,
  season: number,
  sportId: number,
  playerPcts: (number | null)[]
): Promise<CompResult | null> {
  const minYear = Math.max(2018, season - 7);
  const years = Array.from({ length: season - minYear + 1 }, (_, i) => minYear + i);

  const yearData = await Promise.allSettled(
    years.map(async yr => {
      const [rosterData, statsData] = await Promise.all([
        fetchJSON(`${MLB_API}/sports/${sportId}/players?season=${yr}`),
        fetchJSON(`${MLB_API}/stats?stats=season&group=hitting&season=${yr}&sportId=${sportId}&limit=1000&gameType=R`),
      ]);
      return { yr, rosterData, statsData };
    })
  );

  let bestComp: CompResult | null = null;
  let bestSim = -1;

  for (const result of yearData) {
    if (result.status !== 'fulfilled') continue;
    const { yr, rosterData, statsData } = result.value;

    // Birth date map from roster
    const people = ((rosterData as Record<string, unknown>)?.people ?? []) as Record<string, unknown>[];
    const bioMap: Record<number, { name: string; bd: string }> = {};
    for (const p of people) {
      const id = p.id as number;
      const bd = p.birthDate as string;
      if (id && bd) bioMap[id] = { name: p.fullName as string, bd };
    }

    // Target birth year for players in this historical season who were the same age
    const targetBY = bornYear != null ? yr - (season - bornYear) : null;

    const stats0 = ((statsData as Record<string, unknown>)?.stats as unknown[])?.[0] as Record<string, unknown>;
    const splits = stats0?.splits;
    if (!Array.isArray(splits)) continue;

    for (const split of splits as Record<string, unknown>[]) {
      const player = split.player as Record<string, unknown>;
      const pid = player?.id as number;
      if (!pid || String(pid) === excludeId) continue;

      const bio = bioMap[pid];

      if (targetBY != null) {
        if (!bio?.bd) continue; // can't age-filter without birth date
        const born = parseInt(bio.bd.slice(0, 4));
        if (Math.abs(born - targetBY) > 1) continue;
      }

      const stat = split.stat as Record<string, unknown>;
      const pa = Number(stat?.plateAppearances ?? 0);
      if (pa < 60) continue;

      const k   = Number(stat?.strikeOuts ?? 0);
      const bb  = Number(stat?.baseOnBalls ?? 0);
      const avg = parseFloat(String(stat?.avg ?? ''));
      const obp = parseFloat(String(stat?.obp ?? ''));
      const slg = parseFloat(String(stat?.slg ?? ''));

      const kPct  = pa > 0 ? k / pa * 100 : null;
      const bbPct = pa > 0 ? bb / pa * 100 : null;
      const iso   = !isNaN(slg) && !isNaN(avg) ? slg - avg : null;

      // Proxy percentiles mapped to radar axes [ev90, xwoba, chasePct, -, zoneWhiff, -]
      const candPcts: (number | null)[] = [
        iso   != null                  ? normalPct(iso,   MILB_TRAD.iso.mean,   MILB_TRAD.iso.std,   true)  : null,
        !isNaN(obp) && obp > 0         ? normalPct(obp,   MILB_TRAD.obp.mean,   MILB_TRAD.obp.std,   true)  : null,
        bbPct != null                  ? normalPct(bbPct, MILB_TRAD.bbPct.mean, MILB_TRAD.bbPct.std, true)  : null,
        null,
        kPct  != null                  ? normalPct(kPct,  MILB_TRAD.kPct.mean,  MILB_TRAD.kPct.std,  false) : null,
        null,
      ];

      const sim = similarity(playerPcts, candPcts);
      if (sim > bestSim) {
        bestSim = sim;
        const born = bio?.bd ? parseInt(bio.bd.slice(0, 4)) : null;
        bestComp = {
          playerId: pid,
          playerName: bio?.name ?? String(player?.fullName ?? ''),
          season: yr,
          age: born ? yr - born : null,
          team: (split.team as Record<string, unknown>)?.abbreviation as string ?? null,
          similarity: sim,
        };
      }
    }
  }

  return bestComp;
}
