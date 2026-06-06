import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/hitter-age-percentiles?playerId=X&age=22&season=2026
 *
 * Compares a player against same-birth-year peers across:
 *   - MLB-affiliated levels tracked by Savant (MLB, AAA, Low-A Hawk-Eye parks)
 *   - Last 3 seasons combined so the peer pool is large enough to be meaningful
 *
 * Peer comparison metrics: EV 90th (vs ev50 distribution), xwOBA (vs distribution)
 * Discipline metrics: age-calibrated normal-distribution baselines (no real population needed)
 */

export const maxDuration = 60;
export const dynamic     = 'force-dynamic';

// ─── Cache ────────────────────────────────────────────────────────────────────
// allBirthYears: pid → birthYear for every player at any affiliated level (full cohort)
interface LBCache { ts: number; ev: EvRow[]; xwoba: XwobaRow[]; allBirthYears: Record<string, number> }
const LB_CACHE: Partial<Record<string, LBCache>> = {};
const LB_TTL = 6 * 3_600_000; // 6 h

// birthYear replaces age — lets us correctly bin players across seasons
interface EvRow    { pid: string; ev50: number | null; birthYear: number | null }
interface XwobaRow { pid: string; xwoba: number | null; birthYear: number | null }

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

function normalPct(val: number, mean: number, std: number, higher = true): number {
  if (std === 0) return 50;
  const z  = (val - mean) / std;
  const az = Math.abs(z) / Math.SQRT2;
  const t  = 1 / (1 + 0.3275911 * az);
  const p  = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - p * Math.exp(-az * az);
  const cdf = 0.5 * (1 + (z >= 0 ? 1 : -1) * erf);
  return Math.round(Math.max(1, Math.min(99, higher ? cdf * 100 : (1 - cdf) * 100)));
}

function ageBaseline(age: number) {
  const t = Math.max(0, Math.min(1, (age - 18) / 10));
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    avgLaHard: { mean: lerp(10.0, 13.5), std: 8.5 },
    chasePct:  { mean: lerp(33.0, 27.5), std: lerp(8.0, 6.5)  },
    zSwingPct: { mean: lerp(62.0, 68.0), std: lerp(10.0, 8.5) },
    zoneWhiff: { mean: lerp(22.0, 15.0), std: lerp(8.5, 6.5)  },
    xwoba:     { mean: lerp(0.285, 0.315), std: 0.045 },
  };
}

// ─── Leaderboard fetches ──────────────────────────────────────────────────────
async function fetchEvLB(year: string): Promise<EvRow[]> {
  const url = `https://baseballsavant.mlb.com/leaderboard/statcast?type=batter&year=${year}&min=1&sort=avg_hit_speed&sortDir=desc&csv=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://baseballsavant.mlb.com/' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`EV LB ${res.status}`);
  return parseCsv(await res.text())
    .filter(r => r.player_id)
    .map(r => ({ pid: r.player_id.trim(), ev50: nn(r.ev50), birthYear: null }));
}

async function fetchXwobaLB(year: string): Promise<XwobaRow[]> {
  const url = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${year}&position=&team=&min=1&csv=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://baseballsavant.mlb.com/' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`xwOBA LB ${res.status}`);
  return parseCsv(await res.text())
    .filter(r => r.player_id)
    .map(r => ({ pid: r.player_id.trim(), xwoba: nn(r.est_woba ?? r.xwoba), birthYear: null }));
}

// Fetch birth years for all unique pids — returns pid → birthYear map
async function fetchBirthYears(pids: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const uniq = [...new Set(pids)].filter(Boolean);
  for (let i = 0; i < uniq.length; i += 150) {
    try {
      const batch = uniq.slice(i, i + 150);
      const url = `https://statsapi.mlb.com/api/v1/people?personIds=${batch.join(',')}&fields=people,id,birthDate`;
      const d: { people?: { id: number; birthDate?: string }[] } =
        await fetch(url, { next: { revalidate: 86400 } }).then(r => r.json());
      for (const p of (d.people ?? [])) {
        const by = p.birthDate ? parseInt(p.birthDate.slice(0, 4)) : NaN;
        if (!isNaN(by)) result[String(p.id)] = by;
      }
    } catch { /* non-fatal */ }
  }
  return result;
}

// Fetch all players registered at a given MLB-affiliated level for a season.
// The /sports/{sportId}/players endpoint returns people objects including birthDate.
// sportIds: 1=MLB, 11=AAA, 12=AA, 13=High-A, 14=Low-A
async function fetchLevelBirthYears(sportId: number, year: string): Promise<Record<string, number>> {
  const url = `https://statsapi.mlb.com/api/v1/sports/${sportId}/players?season=${year}&fields=people,id,birthDate`;
  const data = await fetch(url, { next: { revalidate: 3600 } }).then(r => r.json()).catch(() => null);
  const result: Record<string, number> = {};
  for (const p of (data?.people ?? []) as { id?: number; birthDate?: string }[]) {
    if (!p.id || !p.birthDate) continue;
    const by = parseInt(p.birthDate.slice(0, 4));
    if (!isNaN(by)) result[String(p.id)] = by;
  }
  return result;
}

// Build 3-year cache:
//  • Savant leaderboards (MLB/AAA/Low-A Hawk-Eye) → EV + xwOBA distributions
//  • MLB Stats API for all affiliated levels (1,11,12,13,14) → full cohort birth years
async function buildCache(season: string): Promise<LBCache> {
  const years   = [season, String(+season - 1), String(+season - 2)];
  const levels  = [1, 11, 12, 13, 14]; // MLB, AAA, AA, High-A, Low-A

  // Fetch Savant leaderboards + all-level player rosters in parallel
  const [evPerYear, xwobaPerYear, levelBYMaps] = await Promise.all([
    Promise.all(years.map(y => fetchEvLB(y).catch(() => [] as EvRow[]))),
    Promise.all(years.map(y => fetchXwobaLB(y).catch(() => [] as XwobaRow[]))),
    Promise.all(
      years.flatMap(y => levels.map(sid => fetchLevelBirthYears(sid, y).catch(() => ({} as Record<string,number>))))
    ),
  ]);

  // Merge all birth-year maps from every level/year into one master map
  const allBirthYears: Record<string, number> = {};
  for (const m of levelBYMaps) Object.assign(allBirthYears, m);

  // Flatten Savant rows, fill in birth years from the master map
  const allEv    = evPerYear.flat();
  const allXwoba = xwobaPerYear.flat();

  // Also pick up any Savant pids not covered by the level endpoint (edge cases)
  const savantOnlyPids = [
    ...allEv.map(r => r.pid),
    ...allXwoba.map(r => r.pid),
  ].filter(pid => !(pid in allBirthYears));
  if (savantOnlyPids.length) {
    const extra = await fetchBirthYears(savantOnlyPids);
    Object.assign(allBirthYears, extra);
  }

  for (const r of allEv)    r.birthYear = allBirthYears[r.pid] ?? null;
  for (const r of allXwoba) r.birthYear = allBirthYears[r.pid] ?? null;

  // Deduplicate Savant rows: keep most-recent season per player (years desc = first seen)
  const seenEv = new Set<string>(), dedupEv: EvRow[] = [];
  for (const r of allEv)    { if (!seenEv.has(r.pid))    { seenEv.add(r.pid);    dedupEv.push(r); } }
  const seenXw = new Set<string>(), dedupXw: XwobaRow[] = [];
  for (const r of allXwoba) { if (!seenXw.has(r.pid))    { seenXw.add(r.pid);    dedupXw.push(r); } }

  return { ts: Date.now(), ev: dedupEv, xwoba: dedupXw, allBirthYears };
}

// ─── Route ────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const playerId = searchParams.get('playerId');
  const age      = parseInt(searchParams.get('age') ?? '0');
  const season   = searchParams.get('season') ?? new Date().getFullYear().toString();

  if (!playerId || !age) return NextResponse.json({ error: 'playerId and age required' }, { status: 400 });

  try {
    // ── 1. Build/reuse leaderboard cache + fetch player stats in parallel ──
    const origin = req.headers.get('x-forwarded-host')
      ? `https://${req.headers.get('x-forwarded-host')}`
      : req.nextUrl.origin;
    // statcastOnly=true: skips the slow live-feed aggregation (30-40 s) so we stay
    // within the 15-second timeout.  The full seasonDiscipline call on the page still
    // runs the live feed for complete season data and will update the radar later.
    const psUrl = `${origin}/api/player-season?playerId=${playerId}&season=${season}&statcastOnly=true`;

    const cachePromise: Promise<LBCache> = (() => {
      const existing = LB_CACHE[season];
      if (existing && Date.now() - existing.ts <= LB_TTL) return Promise.resolve(existing);
      return buildCache(season).then(lb => { LB_CACHE[season] = lb; return lb; });
    })();

    // 15-second timeout — Savant CSV fetch is fast (~5 s) with statcastOnly=true
    const psPromise = Promise.race([
      fetch(psUrl, { cache: 'no-store' }).then(r => r.json()),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 15_000)),
    ]).catch(() => null);

    const [lb, psData] = await Promise.all([cachePromise, psPromise]);
    const sc = (psData as { statcast?: unknown } | null)?.statcast ?? null;

    // ── 2. Build same-birth-year peer populations ─────────────────────────
    // targetBirthYear: a player born this year is exactly `age` during `season`
    const targetBirthYear = parseInt(season) - age;

    // Full cohort: every player at any affiliated level with the right birth year
    const fullPeerCount = Object.values(lb.allBirthYears)
      .filter(by => Math.abs(by - targetBirthYear) <= 1).length;

    // Savant-tracked subset (EV/xwOBA percentile distributions)
    let evPeers = lb.ev.filter(r => r.birthYear != null && Math.abs(r.birthYear - targetBirthYear) <= 1);
    if (evPeers.length < 10) evPeers = lb.ev.filter(r => r.birthYear != null && Math.abs(r.birthYear - targetBirthYear) <= 2);

    const peerBirthYears = new Set(evPeers.map(r => r.birthYear));
    const xwobaPop = lb.xwoba
      .filter(r => r.birthYear != null && peerBirthYears.has(r.birthYear) && r.xwoba != null)
      .map(r => r.xwoba!);

    const playerEv = lb.ev.find(r => r.pid === playerId);
    const playerXw = lb.xwoba.find(r => r.pid === playerId);
    const evPop    = evPeers.map(r => r.ev50).filter((v): v is number => v != null);
    const baseline = ageBaseline(age);

    // ── 3. Compute Zone Whiff% ────────────────────────────────────────────
    const sc2 = sc as Record<string, number | null> | null;
    const zSwing    = sc2?.zSwingPct    ?? null;
    const zContact  = sc2?.zContactPct  ?? null;
    const zoneWhiff = (zSwing != null && zContact != null)
      ? zSwing * (1 - zContact / 100)
      : (sc2?.whiffPct ?? null);

    // ── 4. Build 6-metric response ────────────────────────────────────────
    const M = (label: string, value: number | null, pct: number | null, higherBetter: boolean, note?: string) =>
      ({ label, value, pct, higherBetter, note });

    const peerLabel = `${fullPeerCount} same-age peers (all levels, 3 yrs)`;

    const metrics = {
      avgLaHard: M('Avg LA 95+', sc2?.avgLaHard ?? null,
        sc2?.avgLaHard != null ? normalPct(sc2.avgLaHard, baseline.avgLaHard.mean, baseline.avgLaHard.std, true) : null,
        true, 'age-calibrated'),

      ev90: M('EV 90th', sc2?.ev90 ?? null,
        (sc2?.ev90 != null && evPop.length >= 5)
          ? pctRank(sc2.ev90, evPop, true)
          : (sc2?.ev90 != null && playerEv?.ev50 != null
              ? normalPct(sc2.ev90, playerEv.ev50 + 6, 4, true)
              : null),
        true, evPop.length >= 5 ? peerLabel : 'est'),

      chasePct: M('Chase%', sc2?.chasePct ?? null,
        sc2?.chasePct != null ? normalPct(sc2.chasePct, baseline.chasePct.mean, baseline.chasePct.std, false) : null,
        false, 'age-calibrated'),

      xwoba: M('xwOBA', sc2?.xwoba ?? (playerXw?.xwoba ?? null),
        (() => {
          const v = (sc2?.xwoba ?? playerXw?.xwoba) ?? null;
          if (v == null) return null;
          if (xwobaPop.length >= 5) return pctRank(v, xwobaPop, true);
          return normalPct(v, baseline.xwoba.mean, baseline.xwoba.std, true);
        })(),
        true, xwobaPop.length >= 5 ? peerLabel : 'age-calibrated'),

      zSwingPct: M('Z-Swing%', zSwing,
        zSwing != null ? normalPct(zSwing, baseline.zSwingPct.mean, baseline.zSwingPct.std, true) : null,
        true, 'age-calibrated'),

      zoneWhiff: M('Zone Whiff%', zoneWhiff,
        zoneWhiff != null ? normalPct(zoneWhiff, baseline.zoneWhiff.mean, baseline.zoneWhiff.std, false) : null,
        false, 'age-calibrated'),
    };

    return NextResponse.json({ playerId, age, peerCount: fullPeerCount, metrics });

  } catch (err) {
    console.error('[hitter-age-percentiles]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
