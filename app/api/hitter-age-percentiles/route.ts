import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/hitter-age-percentiles?playerId=X&age=22&season=2026
 *
 * Computes same-age percentile ranks for 5 EV/quality stats by:
 *  1. Fetching the Savant EV leaderboard (avg EV, ev50, brl%, hard hit%, sweet spot%)
 *  2. Fetching expected stats (est_woba / xwOBA)
 *  3. Fetching ages for all players via MLB Stats API in batches
 *  4. Filtering to same age (±0 years, or ±1 if fewer than 10 peers)
 *  5. Computing percentile rank for each stat
 *
 * Discipline stats (whiff%, chase%) are returned as-is (values only, no same-age rank)
 * because per-pitch zone data for the full same-age population is unavailable.
 */

export const maxDuration = 60;
export const dynamic     = 'force-dynamic';

// ─── Module-level cache (warm Vercel instances) ────────────────────────────────
interface Cache { ts: number; ev: EvaluatedRow[]; xwoba: XwobaRow[] }
const CACHE: Partial<Record<string, Cache>> = {};
const TTL = 6 * 3_600_000; // 6 hours

// ─── Types ────────────────────────────────────────────────────────────────────
interface EvaluatedRow {
  playerId: string;
  avgEv:     number | null;
  ev50:      number | null;
  brlPct:    number | null;
  hardHitPct:number | null;
  sweetSpot: number | null;
  maxEv:     number | null;
  age:       number | null; // filled after MLB API join
}

interface XwobaRow {
  playerId: string;
  xwoba:    number | null;
  pa:       number | null;
}

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

function n(s: string | undefined): number | null {
  if (!s || s === '' || s === '--') return null;
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

function percentileRank(value: number, population: number[], higherIsBetter = true): number {
  if (population.length === 0) return 50;
  const sorted = [...population].sort((a, b) => a - b);
  const rank = sorted.filter(v => v < value).length + sorted.filter(v => v === value).length * 0.5;
  const pct = Math.round((rank / sorted.length) * 100);
  return higherIsBetter ? Math.min(99, Math.max(1, pct)) : Math.min(99, Math.max(1, 100 - pct));
}

async function fetchEVLeaderboard(year: string): Promise<EvaluatedRow[]> {
  const url = `https://baseballsavant.mlb.com/leaderboard/statcast?type=batter&year=${year}&min=1&sort=avg_hit_speed&sortDir=desc&csv=true`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://baseballsavant.mlb.com/' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`EV leaderboard HTTP ${res.status}`);
  const text = await res.text();
  const rows = parseCsv(text);
  return rows
    .filter(r => r.player_id || r.xMLBAMID)
    .map(r => ({
      playerId:   (r.player_id ?? r.xMLBAMID ?? '').trim(),
      avgEv:      n(r.avg_hit_speed),
      ev50:       n(r.ev50),
      brlPct:     n(r.brl_percent ?? r.barrel_batted_rate),
      hardHitPct: n(r.ev95percent ?? r.hard_hit_percent),
      sweetSpot:  n(r.anglesweetspotpercent ?? r.sweet_spot_percent),
      maxEv:      n(r.max_hit_speed),
      age:        null,
    }));
}

async function fetchXwobaLeaderboard(year: string): Promise<XwobaRow[]> {
  const url = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${year}&position=&team=&min=1&csv=true`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://baseballsavant.mlb.com/' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`xwOBA leaderboard HTTP ${res.status}`);
  const text = await res.text();
  const rows = parseCsv(text);
  return rows
    .filter(r => r.player_id)
    .map(r => ({
      playerId: r.player_id.trim(),
      xwoba:    n(r.est_woba ?? r.xwoba),
      pa:       n(r.pa),
    }));
}

async function enrichWithAges(rows: EvaluatedRow[]): Promise<void> {
  const ids = rows.map(r => r.playerId).filter(Boolean);
  const BATCH = 150;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    try {
      const url = `https://statsapi.mlb.com/api/v1/people?personIds=${batch.join(',')}&fields=people,id,currentAge`;
      const res = await fetch(url, { next: { revalidate: 86400 } });
      if (!res.ok) continue;
      const data: { people?: { id: number; currentAge?: number }[] } = await res.json();
      const ageMap: Record<string, number> = {};
      for (const p of (data.people ?? [])) {
        if (p.currentAge != null) ageMap[String(p.id)] = p.currentAge;
      }
      for (const row of rows) {
        if (ageMap[row.playerId] != null) row.age = ageMap[row.playerId];
      }
    } catch { /* non-fatal */ }
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const playerId = searchParams.get('playerId');
  const age      = parseInt(searchParams.get('age') ?? '0');
  const season   = searchParams.get('season') ?? new Date().getFullYear().toString();

  if (!playerId || !age) {
    return NextResponse.json({ error: 'playerId and age required' }, { status: 400 });
  }

  try {
    // ── 1. Load or refresh cache ────────────────────────────────────────────
    let cached = CACHE[season];
    if (!cached || Date.now() - cached.ts > TTL) {
      const [evRows, xwobaRows] = await Promise.all([
        fetchEVLeaderboard(season),
        fetchXwobaLeaderboard(season),
      ]);
      // Enrich with ages from MLB Stats API
      await enrichWithAges(evRows);
      cached = { ts: Date.now(), ev: evRows, xwoba: xwobaRows };
      CACHE[season] = cached;
    }

    const { ev: evRows, xwoba: xwobaRows } = cached;

    // ── 2. Find the player ──────────────────────────────────────────────────
    const playerEV    = evRows.find(r => r.playerId === String(playerId));
    const playerXwoba = xwobaRows.find(r => r.playerId === String(playerId));

    // ── 3. Filter same-age peers ────────────────────────────────────────────
    // If fewer than 10 peers at exactly this age, broaden to ±1 year
    let peers = evRows.filter(r => r.age === age);
    if (peers.length < 10) {
      peers = evRows.filter(r => r.age != null && Math.abs(r.age - age) <= 1);
    }

    // Build xwOBA map (player_id → xwoba) for age-filtered comparison
    // Since xwOBA rows don't have age, we only compare against peers whose
    // player_id appears in the age-filtered EV rows.
    const peerIds = new Set(peers.map(r => r.playerId));
    const xwobaPeers = xwobaRows
      .filter(r => peerIds.has(r.playerId) && r.xwoba != null)
      .map(r => r.xwoba!);

    // ── 4. Compute percentile ranks ─────────────────────────────────────────
    function pctFor(
      playerVal: number | null,
      pop: (number | null)[],
      higherBetter = true
    ): number | null {
      if (playerVal == null) return null;
      const clean = pop.filter((v): v is number => v != null);
      if (clean.length < 5) return null;
      return percentileRank(playerVal, clean, higherBetter);
    }

    const metrics = {
      avgEv:      { value: playerEV?.avgEv      ?? null, pct: pctFor(playerEV?.avgEv      ?? null, peers.map(r => r.avgEv)),      label: 'Avg EV',      higherBetter: true },
      ev50:       { value: playerEV?.ev50        ?? null, pct: pctFor(playerEV?.ev50        ?? null, peers.map(r => r.ev50)),        label: 'EV 90th',     higherBetter: true },
      brlPct:     { value: playerEV?.brlPct      ?? null, pct: pctFor(playerEV?.brlPct      ?? null, peers.map(r => r.brlPct)),      label: 'Barrel%',     higherBetter: true },
      hardHitPct: { value: playerEV?.hardHitPct  ?? null, pct: pctFor(playerEV?.hardHitPct  ?? null, peers.map(r => r.hardHitPct)),  label: 'Hard Hit%',   higherBetter: true },
      xwoba:      { value: playerXwoba?.xwoba    ?? null, pct: pctFor(playerXwoba?.xwoba    ?? null, xwobaPeers,                     true),               label: 'xwOBA',       higherBetter: true },
      sweetSpot:  { value: playerEV?.sweetSpot   ?? null, pct: pctFor(playerEV?.sweetSpot   ?? null, peers.map(r => r.sweetSpot)),   label: 'Sweet Spot%', higherBetter: true },
    };

    return NextResponse.json({
      playerId,
      age,
      peerCount: peers.length,
      metrics,
    });

  } catch (err) {
    console.error('[hitter-age-percentiles]', err);
    return NextResponse.json({ error: 'Failed to compute percentiles' }, { status: 500 });
  }
}
