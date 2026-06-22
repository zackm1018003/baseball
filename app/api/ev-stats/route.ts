import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/ev-stats?playerId=592450&year=2026
 *
 * Fetches all of a player's pitches from Baseball Savant's statcast CSV
 * endpoint, filters to balls in play with launch_speed data, then computes:
 *   - avgEv     : average exit velocity
 *   - maxEv     : maximum exit velocity
 *   - ev90      : average of the top-10% hardest-hit balls (EV90)
 *   - barrels   : total barrel count
 *   - barrelPct : barrels / BIP × 100
 *
 * Tries MLB regular-season data first; if empty, retries without a game-type
 * filter so that MiLB Statcast data (AAA/AA parks with tracking) is included.
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

  const empty = { avgEv: null, maxEv: null, ev90: null, barrels: null, barrelPct: null };

  function isBarrel(ev: number, la: number): boolean {
    if (isNaN(la) || ev < 98) return false;
    const delta = Math.min(ev, 116) - 98;
    return la >= Math.max(8, 26 - delta) && la <= Math.min(50, 30 + delta);
  }

  // Parse a CSV row, handling quoted fields
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

  async function fetchSavantCsv(gameTypeFilter: string): Promise<string | null> {
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
    if (csv.trimStart().startsWith('<')) return null; // HTML bot-detection page
    return csv;
  }

  function parseCsv(csv: string) {
    const lines = csv.split('\n').filter(l => l.trim());
    if (lines.length < 2) return null;

    const headers      = parseRow(lines[0]);
    const evIdx        = headers.indexOf('launch_speed');
    const laIdx        = headers.indexOf('launch_angle');
    const typeIdx      = headers.indexOf('type');       // 'X' = ball in play
    const gameTypeIdx  = headers.indexOf('game_type');  // 'R' = regular season
    const gameDateIdx  = headers.indexOf('game_date');  // 'YYYY-MM-DD'

    if (evIdx === -1) return null;

    const evs: number[] = [];
    let barrels = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      // The hfSeas URL param is unreliable — enforce year boundary via game_date
      if (gameDateIdx !== -1 && !cols[gameDateIdx].startsWith(year)) continue;
      // Only regular-season games (R); skip spring training (S) and exhibition (E)
      if (gameTypeIdx !== -1 && cols[gameTypeIdx] !== 'R') continue;
      if (typeIdx !== -1 && cols[typeIdx] !== 'X') continue;
      const ev = parseFloat(cols[evIdx]);
      if (!isNaN(ev) && ev > 0 && ev <= 130) {
        evs.push(ev);
        if (laIdx !== -1) {
          const la = parseFloat(cols[laIdx]);
          if (!isNaN(la) && isBarrel(ev, la)) barrels++;
        }
      }
    }

    if (evs.length === 0) return null;

    evs.sort((a, b) => b - a);
    const avgEv = evs.reduce((s, v) => s + v, 0) / evs.length;
    const maxEv = evs[0];
    const barrelPct = Math.round((barrels / evs.length) * 1000) / 10;
    let ev90: number | null = null;
    if (evs.length >= 10) {
      const top10Count = Math.max(1, Math.round(evs.length * 0.1));
      ev90 = evs.slice(0, top10Count).reduce((s, v) => s + v, 0) / top10Count;
    }

    return {
      avgEv:     Math.round(avgEv * 10) / 10,
      maxEv:     Math.round(maxEv * 10) / 10,
      ev90:      ev90 !== null ? Math.round(ev90 * 10) / 10 : null,
      barrels,
      barrelPct,
      bipCount:  evs.length,
      evs:       evs.map(v => Math.round(v * 10) / 10),
    };
  }

  try {
    // 1. Try MLB regular-season only first
    const mlbCsv = await fetchSavantCsv('&hfGT=R%7C');
    if (mlbCsv) {
      const result = parseCsv(mlbCsv);
      if (result) {
        console.log(`[ev-stats] MLB pid=${playerId} bip=${result.bipCount} barrels=${result.barrels} ev90=${result.ev90}`);
        return NextResponse.json(result);
      }
    }

    // 2. No MLB data — try without game-type filter to pick up MiLB Statcast parks
    const allCsv = await fetchSavantCsv('');
    if (allCsv) {
      const result = parseCsv(allCsv);
      if (result) {
        console.log(`[ev-stats] MiLB pid=${playerId} bip=${result.bipCount} barrels=${result.barrels} ev90=${result.ev90}`);
        return NextResponse.json(result);
      }
    }

    console.log(`[ev-stats] no Savant data for player ${playerId}`);
    return NextResponse.json(empty);
  } catch (e) {
    console.warn('[ev-stats route]', e);
    return NextResponse.json(empty);
  }
}
