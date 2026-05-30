import { NextResponse } from 'next/server';

/**
 * GET /api/lg-ev-baseline
 *
 * Fetches the Savant batted-ball leaderboard to collect every qualifying
 * MLB batter's player_id, then pulls each player's full-season Statcast CSV
 * in batches of 20 and computes:
 *
 *   ev90      — average of each player's top-10% exit velocities
 *   avgLaHard — average launch angle on balls hit ≥ 95 mph
 *
 * Returns the population mean and std across all qualifying players.
 * Result is cached in module-level memory for 24 h (warm instances).
 * Uses force-dynamic so it never runs at build time.
 */

export const maxDuration = 60;
export const dynamic     = 'force-dynamic'; // never run at build time; only on request

const YEAR       = new Date().getFullYear().toString();
const BATCH_SIZE = 20;   // player IDs per Savant CSV request
const MIN_BIP    = 10;   // minimum balls in play to include a player in ev90
const MIN_HARD   = 10;   // minimum 95+ balls to include in avgLaHard (raised from 3 to prevent tiny samples inflating std)

// ── In-memory cache (warm serverless instances reuse this) ────────────────────
// Next.js cannot cache these 22 MB CSVs (2 MB limit), so we keep the computed
// result in module-level state.  Cold-start latency (~30 s) is accepted; the
// client already shows hardcoded fallback values while waiting.
interface CacheEntry { ts: number; data: unknown }
let _cache: CacheEntry | null = null;
const CACHE_TTL = 86_400_000; // 24 h in ms

// ── CSV helpers ───────────────────────────────────────────────────────────────

function parseRow(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}
function stdDev(arr: number[], m: number): number {
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}
function r1(n: number) { return Math.round(n * 10) / 10; }

// ── Per-batch fetch ───────────────────────────────────────────────────────────

interface PlayerResult {
  ev90:      number | null;
  avgLaHard: number | null;
}

async function fetchBatch(ids: string[]): Promise<Map<string, PlayerResult>> {
  const out = new Map<string, PlayerResult>();
  if (ids.length === 0) return out;

  const idPart = ids.map(id => `batters_lookup%5B%5D=${id}`).join('&');
  const url =
    `https://baseballsavant.mlb.com/statcast_search/csv` +
    `?hfSeas=${YEAR}%7C&player_type=batter&hfGT=R%7C` +
    `&${idPart}&type=batter&all=true`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/csv,*/*',
        Referer: 'https://baseballsavant.mlb.com/',
      },
      cache: 'no-store', // 22 MB responses exceed Next.js 2 MB data-cache limit
    });
    if (!res.ok) return out;

    const csv = await res.text();
    if (csv.trimStart().startsWith('<')) return out; // bot-block HTML

    const lines = csv.split('\n').filter(l => l.trim());
    if (lines.length < 2) return out;

    const hdr        = parseRow(lines[0]);
    const batterIdx  = hdr.indexOf('batter');
    const evIdx      = hdr.indexOf('launch_speed');
    const laIdx      = hdr.indexOf('launch_angle');
    const typeIdx    = hdr.indexOf('type');
    const dateIdx    = hdr.indexOf('game_date');
    const gtIdx      = hdr.indexOf('game_type');

    if (batterIdx === -1 || evIdx === -1) return out;

    // Accumulate per-player
    const acc = new Map<string, { evs: number[]; laSum: number; laCount: number }>();

    for (let i = 1; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      const pid  = cols[batterIdx] ?? '';
      if (!pid || !ids.includes(pid)) continue;
      if (dateIdx  !== -1 && !cols[dateIdx]?.startsWith(YEAR)) continue;
      if (gtIdx    !== -1 && cols[gtIdx] !== 'R') continue;
      if (typeIdx  !== -1 && cols[typeIdx] !== 'X') continue;  // balls in play only

      const ev = parseFloat(cols[evIdx]);
      if (isNaN(ev) || ev <= 0 || ev > 130) continue;

      if (!acc.has(pid)) acc.set(pid, { evs: [], laSum: 0, laCount: 0 });
      const p = acc.get(pid)!;
      p.evs.push(ev);

      if (ev >= 95 && laIdx !== -1) {
        const la = parseFloat(cols[laIdx]);
        if (!isNaN(la)) { p.laSum += la; p.laCount++; }
      }
    }

    // Compute ev90 / avgLaHard per player
    for (const [pid, p] of acc) {
      let ev90: number | null = null;
      if (p.evs.length >= MIN_BIP) {
        const sorted      = [...p.evs].sort((a, b) => b - a);   // descending
        const top10Count  = Math.max(1, Math.round(sorted.length * 0.1));
        ev90 = r1(sorted.slice(0, top10Count).reduce((s, v) => s + v, 0) / top10Count);
      }
      const avgLaHard = p.laCount >= MIN_HARD
        ? r1(p.laSum / p.laCount)
        : null;
      out.set(pid, { ev90, avgLaHard });
    }
  } catch {
    // silently skip failed batches
  }

  return out;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET() {
  // Serve cached result when available (warm instance)
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) {
    return NextResponse.json(_cache.data);
  }

  try {
    // 1. Fetch leaderboard — sort by attempts desc so most-qualified come first
    const lbUrl =
      `https://baseballsavant.mlb.com/leaderboard/statcast` +
      `?type=batter&year=${YEAR}&min=100&sort=attempts&sortDir=desc&csv=true`;

    const lbRes = await fetch(lbUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://baseballsavant.mlb.com/',
      },
      cache: 'no-store',
    });
    if (!lbRes.ok) throw new Error(`Leaderboard fetch failed: ${lbRes.status}`);

    const lbCsv   = await lbRes.text();
    const lbLines = lbCsv.split('\n').filter(l => l.trim());
    if (lbLines.length < 2) throw new Error('Empty leaderboard');

    const lbHdr   = parseRow(lbLines[0]);
    const pidIdx  = lbHdr.indexOf('player_id');
    if (pidIdx === -1) throw new Error('player_id column missing');

    const playerIds: string[] = [];
    for (let i = 1; i < lbLines.length; i++) {
      const id = parseRow(lbLines[i])[pidIdx]?.trim();
      if (id && /^\d+$/.test(id)) playerIds.push(id);
    }
    if (playerIds.length === 0) throw new Error('No player IDs found');

    // 2. Fetch individual CSVs in batches, stop before timeout
    const allEv90:      number[] = [];
    const allAvgLaHard: number[] = [];
    const deadline = Date.now() + 50_000;   // stop at 50 s to leave room for response

    for (let i = 0; i < playerIds.length; i += BATCH_SIZE) {
      if (Date.now() > deadline) break;
      const batch   = playerIds.slice(i, i + BATCH_SIZE);
      const results = await fetchBatch(batch);
      for (const r of results.values()) {
        if (r.ev90      != null) allEv90.push(r.ev90);
        if (r.avgLaHard != null) allAvgLaHard.push(r.avgLaHard);
      }
    }

    if (allEv90.length === 0) throw new Error('No valid ev90 data computed');

    const ev90Mean   = mean(allEv90);
    const ev90Std    = stdDev(allEv90, ev90Mean);
    const laHardMean = allAvgLaHard.length > 0 ? mean(allAvgLaHard) : null;
    const laHardStd  = allAvgLaHard.length > 0 ? stdDev(allAvgLaHard, laHardMean!) : null;

    const result = {
      year: YEAR,
      playersProcessed: playerIds.length,
      ev90: {
        mean: r1(ev90Mean),
        std:  r1(ev90Std),
        n:    allEv90.length,
      },
      avgLaHard: laHardMean != null ? {
        mean: r1(laHardMean),
        std:  r1(laHardStd!),
        n:    allAvgLaHard.length,
      } : null,
    };
    _cache = { ts: Date.now(), data: result };
    return NextResponse.json(result);

  } catch (e) {
    console.error('[lg-ev-baseline]', e);
    // Fall back to empirically derived values so the pages always get a response
    return NextResponse.json({
      year: YEAR,
      fallback: true,
      ev90:      { mean: 107.0, std: 3.5, n: 0 },
      avgLaHard: { mean: 13.5,  std: 8.0, n: 0 },
    });
  }
}
