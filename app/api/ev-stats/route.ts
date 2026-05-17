import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/ev-stats?playerId=592450&year=2026
 *
 * Fetches all of a player's pitches from Baseball Savant's statcast CSV
 * endpoint, filters to balls in play with launch_speed data, then computes:
 *   - avgEv  : average exit velocity
 *   - maxEv  : maximum exit velocity
 *   - ev90   : average of the top-10% hardest-hit balls (EV90)
 *
 * Results are cached for 1 hour via Next.js revalidate.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const year = searchParams.get('year') || String(new Date().getFullYear());

  if (!playerId) {
    return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  }

  const empty = { avgEv: null, maxEv: null, ev90: null };

  try {
    // Savant CSV search — returns one row per pitch for the player's season
    const url =
      `https://baseballsavant.mlb.com/statcast_search/csv` +
      `?hfSeas=${year}%7C&player_type=batter&hfGT=R%7C` +
      `&batters_lookup%5B%5D=${playerId}&type=batter&all=true`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/csv,*/*',
        'Referer': 'https://baseballsavant.mlb.com/',
      },
      next: { revalidate: 3600 },
    });

    if (!res.ok) throw new Error(`Savant HTTP ${res.status}`);

    const csv = await res.text();

    // Safety check — Savant sometimes returns HTML on bot detection
    if (csv.trimStart().startsWith('<')) {
      console.warn('[ev-stats] Savant returned HTML instead of CSV');
      return NextResponse.json(empty);
    }

    // Parse CSV — first line is headers
    const lines = csv.split('\n').filter(l => l.trim());
    if (lines.length < 2) return NextResponse.json(empty);

    // Parse header row — handle quoted fields
    const parseRow = (line: string): string[] => {
      const result: string[] = [];
      let cur = '', inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
        else cur += ch;
      }
      result.push(cur);
      return result;
    };

    const headers = parseRow(lines[0]);
    const evIdx = headers.indexOf('launch_speed');
    const typeIdx = headers.indexOf('type'); // 'X' = ball in play

    if (evIdx === -1) {
      console.warn('[ev-stats] launch_speed column not found in CSV');
      return NextResponse.json(empty);
    }

    // Collect exit velocities from balls in play
    const evs: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      if (typeIdx !== -1 && cols[typeIdx] !== 'X') continue; // skip non-BIP
      const ev = parseFloat(cols[evIdx]);
      if (!isNaN(ev) && ev > 0) evs.push(ev);
    }

    if (evs.length === 0) {
      console.log(`[ev-stats] no BIP exit velocities for player ${playerId}`);
      return NextResponse.json(empty);
    }

    evs.sort((a, b) => b - a); // descending

    const avgEv = evs.reduce((s, v) => s + v, 0) / evs.length;
    const maxEv = evs[0];

    // EV90 = average of top 10% hardest-hit balls (need ≥10 BIP)
    let ev90: number | null = null;
    if (evs.length >= 10) {
      const top10Count = Math.max(1, Math.round(evs.length * 0.1));
      ev90 = evs.slice(0, top10Count).reduce((s, v) => s + v, 0) / top10Count;
    }

    console.log(`[ev-stats] pid=${playerId} bip=${evs.length} avgEv=${avgEv.toFixed(1)} maxEv=${maxEv} ev90=${ev90?.toFixed(1)}`);

    return NextResponse.json({
      avgEv: Math.round(avgEv * 10) / 10,
      maxEv: Math.round(maxEv * 10) / 10,
      ev90:  ev90 !== null ? Math.round(ev90 * 10) / 10 : null,
    });
  } catch (e) {
    console.warn('[ev-stats route]', e);
    return NextResponse.json(empty);
  }
}
