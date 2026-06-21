import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/bat-speed?playerId=592450&year=2026
 *
 * Fetches a player's pitch-level Statcast CSV from Baseball Savant and
 * computes average bat speed + fast swing % (≥ 75 mph) from the bat_speed column.
 * Uses the same CSV endpoint as ev-stats so it reliably bypasses bot-detection.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const year = searchParams.get('year') || String(new Date().getFullYear());

  if (!playerId) {
    return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  }

  const empty = { avgBatSpeed: null, fastSwingPct: null };

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

  async function fetchCsv(gameTypeFilter: string): Promise<string | null> {
    const url =
      `https://baseballsavant.mlb.com/statcast_search/csv` +
      `?hfSeas=${year}%7C&player_type=batter${gameTypeFilter}` +
      `&batters_lookup%5B%5D=${playerId}&type=batter&all=true`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/csv,*/*',
        'Referer': 'https://baseballsavant.mlb.com/',
      },
      next: { revalidate: 3600 },
    });

    if (!res.ok) return null;
    const csv = await res.text();
    if (csv.trimStart().startsWith('<')) return null;
    return csv;
  }

  function parseCsv(csv: string) {
    const lines = csv.split('\n').filter(l => l.trim());
    if (lines.length < 2) return null;

    const headers     = parseRow(lines[0]);
    const bsIdx       = headers.indexOf('bat_speed');
    const gameTypeIdx = headers.indexOf('game_type');
    const gameDateIdx = headers.indexOf('game_date');
    const descIdx     = headers.indexOf('description');

    if (bsIdx === -1) {
      console.warn('[bat-speed] bat_speed column not found in CSV');
      return null;
    }

    const swingSpeeds: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      if (gameDateIdx !== -1 && !cols[gameDateIdx].startsWith(year)) continue;
      if (gameTypeIdx !== -1 && cols[gameTypeIdx] !== 'R') continue;
      // Only count pitches with a swing (description contains 'swing', 'hit', 'foul', etc.)
      const desc = descIdx !== -1 ? cols[descIdx] : '';
      const isSwing = /swing|foul|hit_into_play|swinging/.test(desc);
      if (!isSwing) continue;
      const bs = parseFloat(cols[bsIdx]);
      if (!isNaN(bs) && bs >= 40) swingSpeeds.push(bs);
    }

    if (swingSpeeds.length === 0) return null;

    const avg = swingSpeeds.reduce((s, v) => s + v, 0) / swingSpeeds.length;
    const fastCount = swingSpeeds.filter(v => v >= 75).length;
    const fastPct = (fastCount / swingSpeeds.length) * 100;

    console.log(`[bat-speed] pid=${playerId} year=${year} swings=${swingSpeeds.length} avg=${avg.toFixed(1)} fast%=${fastPct.toFixed(1)}`);

    return {
      avgBatSpeed:  Math.round(avg * 10) / 10,
      fastSwingPct: Math.round(fastPct * 10) / 10,
    };
  }

  try {
    // Try MLB regular-season first
    const mlbCsv = await fetchCsv('&hfGT=R%7C');
    if (mlbCsv) {
      const result = parseCsv(mlbCsv);
      if (result) return NextResponse.json(result);
    }

    // Fallback: no game-type filter (picks up MiLB tracked parks)
    const allCsv = await fetchCsv('');
    if (allCsv) {
      const result = parseCsv(allCsv);
      if (result) return NextResponse.json(result);
    }

    console.log(`[bat-speed] no bat_speed data for player ${playerId}`);
    return NextResponse.json(empty);
  } catch (e) {
    console.warn('[bat-speed route]', e);
    return NextResponse.json(empty);
  }
}
