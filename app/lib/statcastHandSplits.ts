// Lightweight Barrel% / Contact% vs LHP / vs RHP, derived from Savant's pitch-by-pitch
// CSV (p_throws column = pitcher throwing hand). Shared by /api/player-season and
// /api/season-stats so both cards' platoon-split rows show the same numbers.

const SAVANT_CSV = 'https://baseballsavant.mlb.com/statcast_search/csv';

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { values.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  values.push(cur.trim());
  return values;
}

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

function checkBarrel(ev: number, la: number): boolean {
  if (isNaN(ev) || isNaN(la) || ev < 98) return false;
  const delta = Math.min(ev, 116) - 98;
  return la >= Math.max(8, 26 - delta) && la <= Math.min(50, 30 + delta);
}

export interface HandStatcast {
  barrelPct: number | null;
  contactPct: number | null;
  xwoba: number | null;
  bip: number;      // balls in play — sample size for barrelPct
  swings: number;   // sample size for contactPct
}

function computeHandStatcast(rows: Record<string, string>[]): HandStatcast | null {
  if (rows.length === 0) return null;
  let swings = 0, whiffs = 0, battedBalls = 0, barrels = 0;
  let xwobaSum = 0, paCount = 0;
  for (const row of rows) {
    const desc = (row.description || '').toLowerCase();
    const isWhiff = desc === 'swinging_strike' || desc === 'swinging_strike_blocked' || desc === 'foul_tip';
    const isSwing = isWhiff || desc.includes('foul') || desc === 'hit_into_play';
    if (isSwing) swings++;
    if (isWhiff) whiffs++;
    if (desc === 'hit_into_play') {
      const ev = parseFloat(row.launch_speed);
      const la = parseFloat(row.launch_angle);
      if (!isNaN(ev)) {
        battedBalls++;
        const isBarrel = row.launch_speed_angle ? Number(row.launch_speed_angle) === 6 : checkBarrel(ev, la);
        if (isBarrel) barrels++;
      }
      const xwoba = parseFloat(row.estimated_woba_using_speedangle);
      if (!isNaN(xwoba)) xwobaSum += xwoba;
    }
    // PA-ending pitches (events field set) — xwOBA denominator, same approach as aggregateCsv
    if ((row.events || '').trim()) paCount++;
  }
  const pct = (n: number, d: number): number | null => d > 0 ? Math.round(n / d * 1000) / 10 : null;
  const r3  = (n: number) => Math.round(n * 1000) / 1000;
  return {
    barrelPct:  pct(barrels, battedBalls),
    contactPct: pct(swings - whiffs, swings),
    xwoba:      paCount > 0 && xwobaSum > 0 ? r3(xwobaSum / paCount) : null,
    bip:        battedBalls,
    swings,
  };
}

/**
 * Fetches Savant pitch-level CSV for a batter/season and returns Barrel% / Contact%
 * split by pitcher-throwing-hand. sportId=1 (MLB) queries the standard endpoint;
 * any other sportId adds &minors=true. Returns nulls when Savant has no coverage
 * (small-sample / non-Hawk-Eye MiLB parks) rather than throwing.
 */
export async function fetchHandSplitStatcast(
  playerId: string, season: string, sportId: number | null
): Promise<{ vsLHP: HandStatcast | null; vsRHP: HandStatcast | null }> {
  const empty = { vsLHP: null, vsRHP: null };
  try {
    const minors = sportId != null && sportId !== 1 ? '&minors=true' : '';
    const url = `${SAVANT_CSV}?all=true&type=details&batters_lookup%5B%5D=${playerId}&player_type=batter&hfSea=${season}%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0${minors}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://baseballsavant.mlb.com/' },
      cache: 'no-store',
    });
    if (!res.ok) return empty;
    let text = await res.text();
    if (text.startsWith('﻿')) text = text.slice(1);
    if (!text.includes('pitch_type')) return empty;

    const pidStr = String(playerId).trim();
    const rows = parseCSV(text).filter(r =>
      String(r.batter ?? '').trim() === pidStr && (r.game_type ?? 'R') === 'R'
    );
    const lhpRows = rows.filter(r => (r.p_throws ?? '').trim().toUpperCase() === 'L');
    const rhpRows = rows.filter(r => (r.p_throws ?? '').trim().toUpperCase() === 'R');
    return {
      vsLHP: computeHandStatcast(lhpRows),
      vsRHP: computeHandStatcast(rhpRows),
    };
  } catch {
    return empty;
  }
}
