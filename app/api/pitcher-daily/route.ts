import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60; // seconds — Vercel Pro allows up to 60s

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

async function fetchJSON(url: string, noCache = false) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    ...(noCache ? { cache: 'no-store' } : { next: { revalidate: 300 } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000); // 50s timeout
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    const text = await res.text();
    // Strip UTF-8 BOM if present
    return text.startsWith('\uFEFF') ? text.slice(1) : text;
  } finally {
    clearTimeout(timer);
  }
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

// ─── Statcast aggregation from /gf endpoint (same-day data) ──────────────────
// /gf returns pitch objects keyed differently from the CSV — field names differ.
// pfxX is in feet, catcher's POV (same convention as CSV pfx_x).
// inducedBreakZ is already in inches, gravity-removed (= IVB).
// y0 = release distance from home plate in feet (same as CSV release_pos_y).

type GfPitch = Record<string, unknown>;

function aggregateGfStatcast(pitches: GfPitch[]) {
  const groups: Record<string, {
    velos: number[]; spins: number[];
    hBreaks: number[]; vBreaks: number[];
    vaas: number[]; count: number; swings: number; whiffs: number;
  }> = {};
  // /gf does not provide release position data

  const rawDots: { hb: number; ivb: number; pitchType: string; px: number | null; pz: number | null; isWhiff: boolean }[] = [];

  let totalPitches = 0;
  let strikes = 0;
  let swingAndMisses = 0;

  for (const pitch of pitches) {
    const rawType = String(pitch.pitch_type ?? '');
    const mapped = PITCH_TYPE_MAP[rawType];
    if (mapped === null || mapped === undefined) continue;

    totalPitches++;

    // description in /gf uses title-case e.g. "Swinging Strike", "Ball", "Foul"
    const desc = String(pitch.description ?? pitch.call_name ?? '').toLowerCase();
    const isStrike = desc.includes('strike') || desc.includes('foul') || desc.includes('in play');
    const isWhiff = desc === 'swinging strike' || desc === 'swinging strike (blocked)' || desc.includes('swinging strike');
    const isSwing = isWhiff || desc.includes('foul') || desc.includes('in play') || desc.includes('hit into play');

    if (isStrike) strikes++;
    if (isWhiff) swingAndMisses++;

    if (!groups[mapped]) {
      groups[mapped] = { velos: [], spins: [], hBreaks: [], vBreaks: [], vaas: [], count: 0, swings: 0, whiffs: 0 };
    }
    const g = groups[mapped];
    g.count++;
    if (isSwing) g.swings++;
    if (isWhiff) g.whiffs++;

    const velo = Number(pitch.start_speed);
    if (!isNaN(velo) && velo > 0) g.velos.push(velo);

    const spin = Number(pitch.spin_rate);
    if (!isNaN(spin) && spin > 0) g.spins.push(spin);

    // pfxX in /gf is in feet, pitcher's POV (positive = arm side) — just convert to inches
    const pfxX = Number(pitch.pfxX);
    const hBreakIn = !isNaN(pfxX) ? pfxX * 12 : NaN;
    if (!isNaN(hBreakIn)) g.hBreaks.push(hBreakIn);

    // inducedBreakZ is already in inches (IVB, gravity removed)
    const ivbIn = Number(pitch.inducedBreakZ);
    if (!isNaN(ivbIn)) g.vBreaks.push(ivbIn);

    // Plate location: px = horizontal (ft, catcher POV: positive = 1B side), pz = height (ft)
    const pxRaw = Number(pitch.px);
    const pzRaw = Number(pitch.pz);
    const pxVal = !isNaN(pxRaw) ? pxRaw : null;
    const pzVal = !isNaN(pzRaw) ? pzRaw : null;

    if (!isNaN(hBreakIn) && !isNaN(ivbIn)) {
      rawDots.push({ hb: hBreakIn, ivb: ivbIn, pitchType: mapped, px: pxVal, pz: pzVal, isWhiff });
    }

    // VAA using kinematic params — y0 = release distance (same as release_pos_y in CSV)
    const vz0 = Number(pitch.vz0);
    const vy0 = Number(pitch.vy0);
    const ay  = Number(pitch.ay);
    const az  = Number(pitch.az);
    const yRelease = Number(pitch.y0);
    if (!isNaN(vz0) && !isNaN(vy0) && !isNaN(ay) && !isNaN(az) && !isNaN(yRelease) && ay !== 0) {
      const yPlate = 1.417;
      const disc = vy0 * vy0 + 2 * ay * (yPlate - yRelease);
      if (disc >= 0) {
        const t = (-vy0 - Math.sqrt(disc)) / ay;
        const vzAtPlate = vz0 + az * t;
        const vyAtPlate = vy0 + ay * t;
        g.vaas.push(Math.atan2(vzAtPlate, Math.abs(vyAtPlate)) * (180 / Math.PI));
      }
    }
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const r1 = (v: number | null) => v !== null ? Math.round(v * 10) / 10 : null;
  const r2 = (v: number | null) => v !== null ? Math.round(v * 100) / 100 : null;

  const countedPitches = Object.values(groups).reduce((s, g) => s + g.count, 0);

  const pitchTypes: {
    name: string; count: number; usage: number;
    velo: number | null; spin: number | null;
    h_movement: number | null; v_movement: number | null;
    vaa: number | null; whiff: number | null; whiffs: number;
    h_rel: number | null; v_rel: number | null; extension: number | null;
  }[] = [];

  for (const [name, g] of Object.entries(groups)) {
    const usage = (g.count / countedPitches) * 100;
    if (usage < 1) continue;
    pitchTypes.push({
      name, count: g.count,
      usage: Math.round(usage * 10) / 10,
      velo: r1(avg(g.velos)),
      spin: avg(g.spins) !== null ? Math.round(avg(g.spins)!) : null,
      h_movement: r1(avg(g.hBreaks)),
      v_movement: r1(avg(g.vBreaks)),
      vaa: r2(avg(g.vaas)),
      whiff: g.swings > 0 ? Math.round((g.whiffs / g.swings) * 1000) / 10 : null,
      whiffs: g.whiffs,
      h_rel: null, // /gf doesn't expose release position
      v_rel: null,
      extension: null,
    });
  }

  pitchTypes.sort((a, b) => b.usage - a.usage);

  return {
    totalPitches,
    pitchTypes,
    rawDots,
    armAngle: null as number | null, // /gf doesn't expose arm_angle
    strikePct: totalPitches > 0 ? Math.round((strikes / totalPitches) * 1000) / 10 : null,
    swingAndMissPct: totalPitches > 0 ? Math.round((swingAndMisses / totalPitches) * 1000) / 10 : null,
    totalWhiffs: swingAndMisses,
  };
}

// Fetch pitcher pitches from Savant /gf endpoint for a given gamePk
async function fetchGfPitchData(gamePk: number, playerId: string): Promise<ReturnType<typeof aggregateGfStatcast> | null> {
  try {
    const gfUrl = `https://baseballsavant.mlb.com/gf?game_pk=${gamePk}`;
    const gf = await fetchJSON(gfUrl, true); // always no-cache
    const pidStr = String(playerId);
    const homePitchers = gf?.home_pitchers ?? {};
    const awayPitchers = gf?.away_pitchers ?? {};
    const pitches: GfPitch[] = homePitchers[pidStr] ?? awayPitchers[pidStr] ?? [];
    if (pitches.length === 0) return null;
    console.log(`[GF] gamePk=${gamePk} pid=${pidStr} pitches=${pitches.length}`);
    return aggregateGfStatcast(pitches);
  } catch (e) {
    console.warn('[GF] fetch failed:', e);
    return null;
  }
}

// ─── Statcast aggregation for one day ─────────────────────────────────────────

function aggregateDayStatcast(rows: Record<string, string>[]) {
  const groups: Record<string, {
    velos: number[]; spins: number[];
    hBreaks: number[]; vBreaks: number[];
    vaas: number[]; count: number; swings: number; whiffs: number;
    hRels: number[]; vRels: number[]; extensions: number[];
  }> = {};

  // Individual pitch dots for the movement chart: {hb, ivb, pitchType}
  const rawDots: { hb: number; ivb: number; pitchType: string; px: number | null; pz: number | null; isWhiff: boolean }[] = [];
  const armAngles: number[] = [];

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
      groups[mapped] = { velos: [], spins: [], hBreaks: [], vBreaks: [], vaas: [], count: 0, swings: 0, whiffs: 0, hRels: [], vRels: [], extensions: [] };
    }
    const g = groups[mapped];
    g.count++;

    // Per-pitch-type swing/whiff tracking
    const isSwing = desc.includes('swinging') || desc.includes('foul') || desc.includes('hit_into_play') || desc === 'hit_into_play';
    const isWhiff = desc === 'swinging_strike' || desc === 'swinging_strike_blocked';
    if (isSwing || isWhiff) g.swings++;
    if (isWhiff) g.whiffs++;

    const velo = parseFloat(row.release_speed);
    if (!isNaN(velo)) g.velos.push(velo);

    const spin = parseFloat(row.release_spin_rate);
    if (!isNaN(spin)) g.spins.push(spin);

    // Release position and extension (CSV columns in feet; convert to feet as-is, display as ft)
    const hRelRaw = parseFloat(row.release_pos_x);
    if (!isNaN(hRelRaw)) g.hRels.push(hRelRaw);

    const vRelRaw = parseFloat(row.release_pos_z);
    if (!isNaN(vRelRaw)) g.vRels.push(vRelRaw);

    const extRaw = parseFloat(row.release_extension);
    if (!isNaN(extRaw)) g.extensions.push(extRaw);

    // pfx_x from Savant is in catcher's POV: positive = toward 1B.
    // Negate so positive = pitcher's arm side (matches season card convention).
    const hBreak = parseFloat(row.pfx_x);
    if (!isNaN(hBreak)) g.hBreaks.push(hBreak * -12);

    const vBreak = parseFloat(row.pfx_z);
    if (!isNaN(vBreak)) g.vBreaks.push(vBreak * 12);

    // Collect raw dot for movement chart + location chart
    const pxRaw = parseFloat(row.plate_x);
    const pzRaw = parseFloat(row.plate_z);
    const isWhiffCsv = desc === 'swinging_strike' || desc === 'swinging_strike_blocked';
    if (!isNaN(hBreak) && !isNaN(vBreak)) {
      rawDots.push({
        hb: hBreak * -12, ivb: vBreak * 12, pitchType: mapped,
        px: !isNaN(pxRaw) ? pxRaw : null,
        pz: !isNaN(pzRaw) ? pzRaw : null,
        isWhiff: isWhiffCsv,
      });
    }

    // Collect arm angle
    const aa = parseFloat(row.arm_angle);
    if (!isNaN(aa)) armAngles.push(aa);

    // VAA: vertical approach angle at home plate using kinematic equations.
    // Savant coords: vy0 < 0 (toward plate), ay < 0 (drag), az includes gravity.
    // Find time to reach front of plate (y = 1.417 ft) from release (y = vy0*0 + release_pos_y).
    // t = (-vy0 - sqrt(vy0² + 2*ay*(y_plate - y_release))) / ay
    const vz0 = parseFloat(row.vz0);
    const vy0 = parseFloat(row.vy0);
    const ay  = parseFloat(row.ay);
    const az  = parseFloat(row.az);
    const yRelease = parseFloat(row.release_pos_y);
    if (!isNaN(vz0) && !isNaN(vy0) && !isNaN(ay) && !isNaN(az) && !isNaN(yRelease) && ay !== 0) {
      const yPlate = 1.417;
      const disc = vy0 * vy0 + 2 * ay * (yPlate - yRelease);
      if (disc >= 0) {
        const t = (-vy0 - Math.sqrt(disc)) / ay;
        const vzAtPlate = vz0 + az * t;
        const vyAtPlate = vy0 + ay * t;
        g.vaas.push(Math.atan2(vzAtPlate, Math.abs(vyAtPlate)) * (180 / Math.PI));
      }
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
    whiff: number | null;
    whiffs: number;
    h_rel: number | null;
    v_rel: number | null;
    extension: number | null;
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
      whiff: g.swings > 0 ? Math.round((g.whiffs / g.swings) * 1000) / 10 : null,
      whiffs: g.whiffs,
      h_rel: r1(avg(g.hRels)),
      v_rel: r1(avg(g.vRels)),
      extension: r1(avg(g.extensions)),
    });
  }

  pitchTypes.sort((a, b) => b.usage - a.usage);

  const avgArmAngle = armAngles.length > 0
    ? Math.round(armAngles.reduce((a, b) => a + b, 0) / armAngles.length * 10) / 10
    : null;

  return {
    totalPitches,
    pitchTypes,
    rawDots,
    armAngle: avgArmAngle,
    strikePct: totalPitches > 0 ? Math.round((strikes / totalPitches) * 1000) / 10 : null,
    swingAndMissPct: totalPitches > 0 ? Math.round((swingAndMisses / totalPitches) * 1000) / 10 : null,
    totalWhiffs: swingAndMisses,
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

  // Default to today if no date provided
  const targetDate = dateParam || new Date().toISOString().slice(0, 10);
  const isToday = targetDate === new Date().toISOString().slice(0, 10);

  // Derive season from the target date
  const season = parseInt(targetDate.slice(0, 4));

  try {
    // ── 1. Fetch player name + game log from MLB Stats API ───────────────────
    const gameLogUrl = `${MLB_API}/people/${playerId}/stats?stats=gameLog&group=pitching&season=${season}&sportId=1&hydrate=person`;
    const gameLogData = await fetchJSON(gameLogUrl, isToday);
    // Also grab player name from the people endpoint (lightweight)
    let playerName: string | null = null;
    try {
      const personData = await fetchJSON(`${MLB_API}/people/${playerId}`, isToday);
      playerName = personData?.people?.[0]?.fullName ?? null;
    } catch { /* non-fatal */ }
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
      // Fall back: try the live game feed for Spring Training / exhibition games
      // The regular gameLog endpoint doesn't return ST stats
      try {
        // Find the game on this date from the schedule
        const scheduleUrl = `${MLB_API}/schedule?startDate=${targetDate}&endDate=${targetDate}&sportId=1`;
        const scheduleData = await fetchJSON(scheduleUrl, isToday);
        const scheduledGames = scheduleData?.dates?.[0]?.games ?? [];

        // Find a game involving this player's team by scanning each game's live feed
        let stGameLine = null;
        let stGameInfo = null;
        for (const g of scheduledGames) {
          try {
            const feedUrl = `https://statsapi.mlb.com/api/v1.1/game/${g.gamePk}/feed/live`;
            const feed = await fetchJSON(feedUrl, isToday);
            const homeBox = feed?.liveData?.boxscore?.teams?.home;
            const awayBox = feed?.liveData?.boxscore?.teams?.away;
            const homePitchers: number[] = homeBox?.pitchers ?? [];
            const awayPitchers: number[] = awayBox?.pitchers ?? [];
            const pid = parseInt(playerId);
            const isHome = homePitchers.includes(pid);
            const isAway = awayPitchers.includes(pid);
            if (!isHome && !isAway) continue;

            const box = isHome ? homeBox : awayBox;
            const oppBox = isHome ? awayBox : homeBox;
            const playerData = box?.players?.[`ID${pid}`];
            // gameStats.pitching = this game only; stats.pitching = season cumulative
            const pStats = playerData?.gameStats?.pitching ?? playerData?.stats?.pitching;
            const playerFullName: string | null = playerData?.person?.fullName ?? null;
            if (!pStats) continue;

            const homeTeam = feed?.gameData?.teams?.home;
            const awayTeam = feed?.gameData?.teams?.away;
            const myTeam = isHome ? homeTeam : awayTeam;
            const oppTeam = isHome ? awayTeam : homeTeam;

            stGameLine = {
              date: targetDate,
              ip: pStats.inningsPitched ?? '0',
              h: pStats.hits ?? 0,
              er: pStats.earnedRuns ?? 0,
              bb: pStats.baseOnBalls ?? 0,
              k: pStats.strikeOuts ?? 0,
              hr: pStats.homeRuns ?? 0,
              pitches: pStats.numberOfPitches ?? 0,
              strikes: pStats.strikes ?? 0,
              bf: pStats.battersFaced ?? 0,
              era: null,
            };
            stGameInfo = {
              gamePk: g.gamePk,
              opponent: oppTeam?.abbreviation || oppTeam?.teamName || null,
              opponentFull: oppTeam?.name || null,
              team: myTeam?.abbreviation || null,
              isHome,
              date: targetDate,
            };
            break;
          } catch { continue; }
        }

        if (stGameLine && stGameInfo) {
          // Try Statcast for Spring Training — first try /gf (same-day), then CSV (past dates)
          let stPitchData = null;
          try {
            // 1. Try /gf endpoint first — available immediately after game
            if (stGameInfo.gamePk) {
              stPitchData = await fetchGfPitchData(stGameInfo.gamePk, playerId);
            }
            // 2. Fall back to CSV if /gf had no data
            if (!stPitchData) {
              const savantUrl = `${SAVANT_BASE}?all=true&type=details&player_id=${playerId}&player_type=pitcher&game_date_gt=${targetDate}&game_date_lt=${targetDate}&hfGT=S%7CE%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`;
              const csvText = await fetchText(savantUrl);
              if (csvText.includes('pitch_type')) {
                const rows = parseCSV(csvText);
                const pidStr = String(playerId).trim();
                const gpStr = stGameInfo.gamePk ? String(stGameInfo.gamePk).trim() : null;
                const filtered = rows.filter(r => {
                  const pkMatch = gpStr ? r.game_pk?.trim() === gpStr : true;
                  return pkMatch && r.pitcher?.trim() === pidStr;
                });
                if (filtered.length > 0) stPitchData = aggregateDayStatcast(filtered);
              }
            }
          } catch (e) { console.warn('[ST Statcast] error:', e); }

          return NextResponse.json({
            playerId: parseInt(playerId),
            playerName: playerName,
            date: targetDate,
            gameLine: stGameLine,
            gameInfo: stGameInfo,
            pitchData: stPitchData,
            availableDates,
          });
        }
      } catch { /* fall through */ }

      return NextResponse.json({
        error: `No game found for this pitcher on ${targetDate}. This may be a Spring Training game — try selecting a date from the 2025 regular season.`,
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
    // Strategy: try /gf first (real-time), always also fetch CSV for release
    // position fields (hRel/vRel/Ext) which /gf doesn't expose.
    let pitchData = null;
    try {
      // 1. Try /gf endpoint — available immediately, works for same-day games
      if (gamePk) {
        pitchData = await fetchGfPitchData(gamePk, playerId);
      }

      // 2. Always fetch CSV — needed for arm_angle, hRel, vRel, Ext
      //    If /gf succeeded, use CSV only to backfill release position fields.
      //    If /gf had no data, use CSV for everything.
      const isSpringOrExhibition = parseInt(targetDate.slice(5, 7)) <= 3;
      const gamePkParam = gamePk ? `&game_pk=${gamePk}` : '';
      const savantUrl = isSpringOrExhibition
        ? `${SAVANT_BASE}?all=true&type=details&player_id=${playerId}&player_type=pitcher&game_date_gt=${targetDate}&game_date_lt=${targetDate}&hfGT=S%7CE%7C${gamePkParam}&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`
        : `${SAVANT_BASE}?all=true&type=details&player_id=${playerId}&player_type=pitcher&game_date_gt=${targetDate}&game_date_lt=${targetDate}&hfSea=${season}%7C${gamePkParam}&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`;

      try {
        const csvText = await fetchText(savantUrl);
        if (csvText.includes('pitch_type')) {
          const rows = parseCSV(csvText);
          const pidStr = String(playerId).trim();
          const gpStr = gamePk ? String(gamePk).trim() : null;
          const filtered = rows.filter(r => {
            const pkMatch = gpStr ? r.game_pk?.trim() === gpStr : true;
            return pkMatch && r.pitcher?.trim() === pidStr;
          });
          if (filtered.length > 0) {
            const csvData = aggregateDayStatcast(filtered);
            if (!pitchData) {
              // /gf had no data — use CSV for everything
              pitchData = csvData;
            } else {
              // /gf had data — merge release position + arm angle from CSV
              pitchData.armAngle = csvData.armAngle ?? pitchData.armAngle;
              for (const pt of pitchData.pitchTypes) {
                const csvPt = csvData.pitchTypes.find(c => c.name === pt.name);
                if (csvPt) {
                  pt.h_rel = csvPt.h_rel;
                  pt.v_rel = csvPt.v_rel;
                  pt.extension = csvPt.extension;
                }
              }
            }
          }
        }
      } catch (csvErr) {
        console.warn('[Statcast CSV] fetch failed:', csvErr);
      }
    } catch (e) {
      console.warn('Statcast fetch failed:', e);
    }

    return NextResponse.json({
      playerId: parseInt(playerId),
      playerName,
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
