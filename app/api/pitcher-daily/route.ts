import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pitcher-daily?playerId=675911&date=2025-04-15
 *
 * Returns:
 *   - gameLine: that game's traditional pitching line (IP, H, ER, BB, K, HR, pitches, strikes)
 *   - pitchData: per-pitch-type breakdown from Statcast for that date
 *   - gameInfo: opponent, date, result (W/L/ND), game pk
 */

const MLB_API = 'https://statsapi.mlb.com/api/v1';
const SAVANT_BASE = 'https://baseballsavant.mlb.com/statcast_search/csv';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchJSON(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 300 }, // cache 5 min
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchText(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values: string[] = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { values.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    values.push(cur.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

const PITCH_TYPE_MAP: Record<string, string | null> = {
  FF: '4-Seam Fastball',
  SI: 'Sinker',
  FC: 'Cutter',
  SL: 'Slider',
  ST: 'Sweeper',
  SV: 'Slurve',
  CH: 'Changeup',
  FS: 'Splitter',
  CU: 'Curveball',
  KC: 'Knuckle Curve',
  KN: null,
  EP: null,
};

// ─── Statcast aggregation for one day ─────────────────────────────────────────

function aggregateDayStatcast(rows: Record<string, string>[]) {
  const groups: Record<string, {
    velos: number[]; spins: number[];
    hBreaks: number[]; vBreaks: number[];
    vaas: number[]; count: number;
  }> = {};

  let totalPitches = 0;
  let strikes = 0;
  let swingAndMisses = 0;

  for (const row of rows) {
    const rawType = row.pitch_type;
    const mapped = PITCH_TYPE_MAP[rawType];
    if (mapped === null || mapped === undefined) continue;

    totalPitches++;

    // Strike tracking
    const desc = (row.description || '').toLowerCase();
    if (desc.includes('strike') || desc.includes('foul') || desc.includes('swinging')) strikes++;
    if (desc.includes('swinging_strike') || desc === 'swinging_strike_blocked') swingAndMisses++;

    if (!groups[mapped]) {
      groups[mapped] = { velos: [], spins: [], hBreaks: [], vBreaks: [], vaas: [], count: 0 };
    }
    const g = groups[mapped];
    g.count++;

    const velo = parseFloat(row.release_speed);
    if (!isNaN(velo)) g.velos.push(velo);

    const spin = parseFloat(row.release_spin_rate);
    if (!isNaN(spin)) g.spins.push(spin);

    const hBreak = parseFloat(row.pfx_x);
    if (!isNaN(hBreak)) g.hBreaks.push(hBreak * 12);

    const vBreak = parseFloat(row.pfx_z);
    if (!isNaN(vBreak)) g.vBreaks.push(vBreak * 12);

    const vz0 = parseFloat(row.vz0);
    const vy0 = parseFloat(row.vy0);
    if (!isNaN(vz0) && !isNaN(vy0) && vy0 !== 0) {
      g.vaas.push(Math.atan2(vz0, Math.abs(vy0)) * (180 / Math.PI));
    }
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const r1 = (v: number | null) => v !== null ? Math.round(v * 10) / 10 : null;
  const r2 = (v: number | null) => v !== null ? Math.round(v * 100) / 100 : null;

  const countedPitches = Object.values(groups).reduce((s, g) => s + g.count, 0);

  const pitchTypes: {
    name: string;
    count: number;
    usage: number;
    velo: number | null;
    spin: number | null;
    h_movement: number | null;
    v_movement: number | null;
    vaa: number | null;
  }[] = [];

  for (const [name, g] of Object.entries(groups)) {
    const usage = (g.count / countedPitches) * 100;
    if (usage < 1) continue;
    pitchTypes.push({
      name,
      count: g.count,
      usage: Math.round(usage * 10) / 10,
      velo: r1(avg(g.velos)),
      spin: avg(g.spins) !== null ? Math.round(avg(g.spins)!) : null,
      h_movement: r1(avg(g.hBreaks)),
      v_movement: r1(avg(g.vBreaks)),
      vaa: r2(avg(g.vaas)),
    });
  }

  pitchTypes.sort((a, b) => b.usage - a.usage);

  return {
    totalPitches,
    pitchTypes,
    strikePct: totalPitches > 0 ? Math.round((strikes / totalPitches) * 1000) / 10 : null,
    swingAndMissPct: totalPitches > 0 ? Math.round((swingAndMisses / totalPitches) * 1000) / 10 : null,
  };
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const dateParam = searchParams.get('date'); // YYYY-MM-DD

  if (!playerId) {
    return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  }

  // Default to yesterday if no date provided
  const targetDate = dateParam || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  // Derive season from the target date
  const season = parseInt(targetDate.slice(0, 4));

  try {
    // ── 1. Fetch game log from MLB Stats API ──────────────────────────────────
    const gameLogUrl = `${MLB_API}/people/${playerId}/stats?stats=gameLog&group=pitching&season=${season}&sportId=1`;
    const gameLogData = await fetchJSON(gameLogUrl);
    const splits: {
      date?: string;
      stat: {
        inningsPitched?: string;
        hits?: number;
        earnedRuns?: number;
        baseOnBalls?: number;
        strikeOuts?: number;
        homeRuns?: number;
        numberOfPitches?: number;
        strikes?: number;
        battersFaced?: number;
        era?: string;
      };
      team?: { name?: string; abbreviation?: string; id?: number };
      opponent?: { name?: string; abbreviation?: string; id?: number };
      isHome?: boolean;
      game?: { gamePk?: number; gameDate?: string };
    }[] = gameLogData?.stats?.[0]?.splits ?? [];

    // Find the split matching our target date
    const matchedSplit = splits.find(s => {
      const splitDate = s.date || s.game?.gameDate?.slice(0, 10) || '';
      return splitDate === targetDate || splitDate.startsWith(targetDate);
    });

    // Also build a list of all available game dates for the date picker
    const availableDates = splits
      .map(s => ({
        date: s.date || s.game?.gameDate?.slice(0, 10) || '',
        opponent: s.opponent?.abbreviation || s.opponent?.name || '?',
        ip: s.stat?.inningsPitched || '0',
        er: s.stat?.earnedRuns ?? 0,
        k: s.stat?.strikeOuts ?? 0,
        gamePk: s.game?.gamePk,
      }))
      .filter(d => d.date)
      .sort((a, b) => b.date.localeCompare(a.date));  // newest first

    if (!matchedSplit) {
      return NextResponse.json({
        error: 'No game found for that pitcher on that date',
        availableDates,
      }, { status: 404 });
    }

    const stat = matchedSplit.stat;
    const gamePk = matchedSplit.game?.gamePk;

    const gameLine = {
      date: targetDate,
      ip: stat.inningsPitched ?? '0',
      h: stat.hits ?? 0,
      er: stat.earnedRuns ?? 0,
      bb: stat.baseOnBalls ?? 0,
      k: stat.strikeOuts ?? 0,
      hr: stat.homeRuns ?? 0,
      pitches: stat.numberOfPitches ?? 0,
      strikes: stat.strikes ?? 0,
      bf: stat.battersFaced ?? 0,
      era: stat.era ?? null,
    };

    const gameInfo = {
      gamePk: gamePk ?? null,
      opponent: matchedSplit.opponent?.abbreviation || matchedSplit.opponent?.name || null,
      opponentFull: matchedSplit.opponent?.name || null,
      team: matchedSplit.team?.abbreviation || null,
      isHome: matchedSplit.isHome ?? null,
      date: targetDate,
    };

    // ── 2. Fetch Statcast pitch-by-pitch for this game ────────────────────────
    let pitchData = null;
    try {
      // Savant uses strictly-greater-than / strictly-less-than, so shift dates by 1 day
      const dayBefore = new Date(targetDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayAfter = new Date(targetDate);
      dayAfter.setDate(dayAfter.getDate() + 1);
      const gtDate = dayBefore.toISOString().slice(0, 10);
      const ltDate = dayAfter.toISOString().slice(0, 10);

      const savantUrl = `${SAVANT_BASE}?all=true&type=details&player_id=${playerId}&player_type=pitcher&game_date_gt=${gtDate}&game_date_lt=${ltDate}&hfGT=&hfSea=${season}%7C&team=&position=&hfRO=&home_road=&hfFlag=&metric_1=&hfInn=&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0&type=details`;

      const csvText = await fetchText(savantUrl);
      if (csvText.includes('pitch_type')) {
        const rows = parseCSV(csvText);
        // Filter to only pitches from this specific game using game_pk if available
        const filtered = gamePk
          ? rows.filter(r => r.game_pk === String(gamePk) || !r.game_pk)
          : rows;
        if (filtered.length > 0) {
          pitchData = aggregateDayStatcast(filtered);
        }
      }
    } catch (e) {
      // Statcast not available — non-fatal, return game line only
      console.warn('Statcast fetch failed:', e);
    }

    return NextResponse.json({
      playerId: parseInt(playerId),
      date: targetDate,
      gameLine,
      gameInfo,
      pitchData,
      availableDates,
    });

  } catch (err) {
    console.error('pitcher-daily route error:', err);
    return NextResponse.json({ error: 'Failed to fetch pitcher data' }, { status: 500 });
  }
}
