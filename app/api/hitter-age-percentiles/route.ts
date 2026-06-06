import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/hitter-age-percentiles?playerId=X&age=22&season=2026
 *
 * Returns percentile ranks for 6 scout-report metrics vs same-age peers:
 *   Avg LA 95+, EV 90, Chase%, xwOBA, Z-Swing%, Zone Whiff%
 *
 * Player values: fetched from /api/player-season (Statcast pitch data)
 * Percentile comparison:
 *   - xwOBA: Savant expected-stats leaderboard filtered to same age (via MLB people API)
 *   - EV 90:  Savant EV leaderboard ev50 (proxy) filtered to same age
 *   - Discipline stats: age-calibrated normal-distribution baselines
 */

export const maxDuration = 60;
export const dynamic     = 'force-dynamic';

// ─── Cache ────────────────────────────────────────────────────────────────────
interface LBCache { ts: number; ev: EvRow[]; xwoba: XwobaRow[] }
const LB_CACHE: Partial<Record<string, LBCache>> = {};
const LB_TTL = 6 * 3_600_000; // 6 h

interface EvRow    { pid: string; ev50: number | null; age: number | null }
interface XwobaRow { pid: string; xwoba: number | null }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const hdr = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/"/g, ''));
    const row: Record<string, string> = {};
    hdr.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
}
const nn = (s: string | undefined) => { const v = parseFloat(s ?? ''); return isNaN(v) ? null : v; };

function pctRank(val: number, pop: number[], higher = true): number {
  const sorted = [...pop].sort((a, b) => a - b);
  const rank = sorted.filter(v => v < val).length + sorted.filter(v => v === val).length * 0.5;
  const p = Math.round((rank / sorted.length) * 100);
  return Math.max(1, Math.min(99, higher ? p : 100 - p));
}

// Normal-distribution CDF approximation (used for baseline-based percentiles)
function normalPct(val: number, mean: number, std: number, higher = true): number {
  if (std === 0) return 50;
  const z  = (val - mean) / std;
  const az = Math.abs(z) / Math.SQRT2;
  const t  = 1 / (1 + 0.3275911 * az);
  const p  = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - p * Math.exp(-az * az);
  const cdf = 0.5 * (1 + (z >= 0 ? 1 : -1) * erf);
  const pct = Math.round(Math.max(1, Math.min(99, cdf * 100)));
  return higher ? pct : 100 - pct;
}

// Age-calibrated baselines for discipline + LA stats.
// Younger players (18–20): higher chase, higher zone whiff, lower z-swing.
// Older / MLB-ready (26+): approach MLB population norms.
function ageBaseline(age: number): {
  avgLaHard: { mean: number; std: number };
  chasePct:  { mean: number; std: number };
  zSwingPct: { mean: number; std: number };
  zoneWhiff: { mean: number; std: number };
} {
  // Linear interpolation from prospect (age 18) to MLB-vet (age 28) norms
  const t = Math.max(0, Math.min(1, (age - 18) / 10));
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    avgLaHard: { mean: lerp(10.0, 13.5), std: 8.5 },
    chasePct:  { mean: lerp(33.0, 27.5), std: lerp(8.0, 6.5)  },
    zSwingPct: { mean: lerp(62.0, 68.0), std: lerp(10.0, 8.5) },
    zoneWhiff: { mean: lerp(22.0, 15.0), std: lerp(8.5, 6.5)  },
  };
}

// ─── Leaderboard fetches ──────────────────────────────────────────────────────
async function fetchEvLB(year: string): Promise<EvRow[]> {
  const url = `https://baseballsavant.mlb.com/leaderboard/statcast?type=batter&year=${year}&min=1&sort=avg_hit_speed&sortDir=desc&csv=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://baseballsavant.mlb.com/' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`EV LB ${res.status}`);
  const rows = parseCsv(await res.text());
  return rows.filter(r => r.player_id).map(r => ({ pid: r.player_id.trim(), ev50: nn(r.ev50), age: null }));
}

async function fetchXwobaLB(year: string): Promise<XwobaRow[]> {
  const url = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${year}&position=&team=&min=1&csv=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://baseballsavant.mlb.com/' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`xwOBA LB ${res.status}`);
  const rows = parseCsv(await res.text());
  return rows.filter(r => r.player_id).map(r => ({ pid: r.player_id.trim(), xwoba: nn(r.est_woba ?? r.xwoba) }));
}

async function enrichAges(rows: EvRow[]): Promise<void> {
  const ids = rows.map(r => r.pid).filter(Boolean);
  for (let i = 0; i < ids.length; i += 150) {
    try {
      const batch = ids.slice(i, i + 150);
      const url = `https://statsapi.mlb.com/api/v1/people?personIds=${batch.join(',')}&fields=people,id,currentAge`;
      const d: { people?: { id: number; currentAge?: number }[] } = await fetch(url, { next: { revalidate: 86400 } }).then(r => r.json());
      const map: Record<string, number> = {};
      for (const p of (d.people ?? [])) if (p.currentAge != null) map[String(p.id)] = p.currentAge;
      for (const row of rows) if (map[row.pid] != null) row.age = map[row.pid];
    } catch { /* non-fatal */ }
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const playerId = searchParams.get('playerId');
  const age      = parseInt(searchParams.get('age') ?? '0');
  const season   = searchParams.get('season') ?? new Date().getFullYear().toString();

  if (!playerId || !age) return NextResponse.json({ error: 'playerId and age required' }, { status: 400 });

  try {
    // ── 1. Load leaderboard cache ───────────────────────────────────────────
    let lb = LB_CACHE[season];
    if (!lb || Date.now() - lb.ts > LB_TTL) {
      const [evRows, xwobaRows] = await Promise.all([fetchEvLB(season), fetchXwobaLB(season)]);
      await enrichAges(evRows);
      lb = { ts: Date.now(), ev: evRows, xwoba: xwobaRows };
      LB_CACHE[season] = lb;
    }

    // ── 2. Fetch player's own stats from player-season ─────────────────────
    const origin = req.headers.get('x-forwarded-host')
      ? `https://${req.headers.get('x-forwarded-host')}`
      : req.nextUrl.origin;
    const psUrl = `${origin}/api/player-season?playerId=${playerId}&season=${season}`;
    const psData = await fetch(psUrl, { cache: 'no-store' }).then(r => r.json()).catch(() => null);
    const sc = psData?.statcast ?? null;

    // ── 3. Build same-age populations ──────────────────────────────────────
    let evPeers = lb.ev.filter(r => r.age === age);
    if (evPeers.length < 10) evPeers = lb.ev.filter(r => r.age != null && Math.abs(r.age - age) <= 1);
    const peerIds = new Set(evPeers.map(r => r.pid));
    const xwobaPop = lb.xwoba.filter(r => peerIds.has(r.pid) && r.xwoba != null).map(r => r.xwoba!);

    const playerEv   = lb.ev.find(r => r.pid === playerId);
    const playerXw   = lb.xwoba.find(r => r.pid === playerId);
    const evPop      = evPeers.map(r => r.ev50).filter((v): v is number => v != null);
    const baseline   = ageBaseline(age);

    // ── 4. Compute Zone Whiff% from z-swing and z-contact ─────────────────
    // Zone Whiff% = in-zone swings that miss / in-zone pitches
    //             = zSwingPct * (1 - zContactPct/100)
    const zSwing    = sc?.zSwingPct    ?? null;
    const zContact  = sc?.zContactPct  ?? null;
    const zoneWhiff = (zSwing != null && zContact != null)
      ? zSwing * (1 - zContact / 100)
      : (sc?.whiffPct ?? null); // fallback to overall whiff%

    // ── 5. Build 6-metric response ─────────────────────────────────────────
    const M = (label: string, value: number | null, pct: number | null, higherBetter: boolean, note?: string) =>
      ({ label, value, pct, higherBetter, note });

    const metrics = {
      avgLaHard: M('Avg LA 95+', sc?.avgLaHard ?? null,
        sc?.avgLaHard != null ? normalPct(sc.avgLaHard, baseline.avgLaHard.mean, baseline.avgLaHard.std, true) : null,
        true, 'age-calibrated'),

      ev90: M('EV 90th', sc?.ev90 ?? null,
        (sc?.ev90 != null && evPop.length >= 5)
          ? pctRank(sc.ev90, evPop, true)
          : (sc?.ev90 != null && playerEv?.ev50 != null
              ? normalPct(sc.ev90, playerEv.ev50 + 6, 4, true) // rough offset ev50→ev90
              : null),
        true, evPop.length >= 5 ? `${evPeers.length} age-${age} peers` : 'est'),

      chasePct: M('Chase%', sc?.chasePct ?? null,
        sc?.chasePct != null ? normalPct(sc.chasePct, baseline.chasePct.mean, baseline.chasePct.std, false) : null,
        false, 'age-calibrated'),

      xwoba: M('xwOBA', sc?.xwoba ?? (playerXw?.xwoba ?? null),
        (() => {
          const v = sc?.xwoba ?? playerXw?.xwoba ?? null;
          if (v == null) return null;
          if (xwobaPop.length >= 5) return pctRank(v, xwobaPop, true);
          return null;
        })(),
        true, xwobaPop.length >= 5 ? `${xwobaPop.length} age-${age} peers` : undefined),

      zSwingPct: M('Z-Swing%', zSwing,
        zSwing != null ? normalPct(zSwing, baseline.zSwingPct.mean, baseline.zSwingPct.std, true) : null,
        true, 'age-calibrated'),

      zoneWhiff: M('Zone Whiff%', zoneWhiff,
        zoneWhiff != null ? normalPct(zoneWhiff, baseline.zoneWhiff.mean, baseline.zoneWhiff.std, false) : null,
        false, 'age-calibrated'),
    };

    return NextResponse.json({ playerId, age, peerCount: evPeers.length, metrics });

  } catch (err) {
    console.error('[hitter-age-percentiles]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
