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
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://baseballsavant.mlb.com/',
      },
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

// ─── Barrel helper ────────────────────────────────────────────────────────────
// MLB definition: EV ≥ 98 mph, LA within expanding window centered ~28°.
// At 98 mph: LA 26–30°. Each additional mph expands range by 1° each side.
// Capped at 116 mph → LA 8–50°.
function checkBarrel(ev: number, la: number): boolean {
  if (isNaN(ev) || isNaN(la) || ev < 98) return false;
  const delta = Math.min(ev, 116) - 98;
  return la >= Math.max(8, 26 - delta) && la <= Math.min(50, 30 + delta);
}

// ─── Statcast aggregation from /gf endpoint (same-day data) ──────────────────
// /gf returns pitch objects keyed differently from the CSV — field names differ.
// pfxX is in feet, catcher's POV (same convention as CSV pfx_x).
// inducedBreakZ is already in inches, gravity-removed (= IVB).
// y0 = release distance from home plate in feet (same as CSV release_pos_y).

type GfPitch = Record<string, unknown>;

function aggregateGfStatcast(pitches: GfPitch[]) {
  const groups: Record<string, {
    velos: number[]; spins: number[]; spinAxes: number[];
    hBreaks: number[]; vBreaks: number[];
    vaas: number[]; haas: number[]; count: number; swings: number; whiffs: number; inZone: number; barrels: number;
    hRels: number[]; vRels: number[]; extensions: number[];
  }> = {};

  const rawDots: { hb: number; ivb: number; pitchType: string; px: number | null; pz: number | null; isWhiff: boolean; isBarrel: boolean; batterSide: string | null; velo: number | null; spin: number | null; spinAxis: number | null; vaa: number | null; haa: number | null; hRel: number | null; vRel: number | null; extension: number | null }[] = [];
  const armAnglesAll: number[] = []; // game-level arm angle, computed from release position

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
    const isWhiff = desc === 'swinging strike' || desc === 'swinging strike (blocked)' || desc.includes('swinging strike') || desc === 'foul tip';
    const isSwing = isWhiff || desc.includes('foul') || desc.includes('in play') || desc.includes('hit into play');

    if (isStrike) strikes++;
    if (isWhiff) swingAndMisses++;

    if (!groups[mapped]) {
      groups[mapped] = { velos: [], spins: [], spinAxes: [], hBreaks: [], vBreaks: [], vaas: [], haas: [], count: 0, swings: 0, whiffs: 0, inZone: 0, barrels: 0, hRels: [], vRels: [], extensions: [] };
    }
    const g = groups[mapped];
    g.count++;
    if (isSwing) g.swings++;
    if (isWhiff) g.whiffs++;

    const velo = Number(pitch.start_speed);
    if (!isNaN(velo) && velo > 0) g.velos.push(velo);

    const spin = Number(pitch.spin_rate);
    if (!isNaN(spin) && spin > 0) g.spins.push(spin);

    const spinAxis = Number(pitch.spin_axis ?? pitch.spin_dir);
    if (!isNaN(spinAxis) && spinAxis > 0) g.spinAxes.push(spinAxis);

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

    const batterSide = String(pitch.stand ?? pitch.batter_side ?? '').trim() || null;
    const exitVelo = Number(pitch.launch_speed ?? pitch.hit_speed ?? NaN);
    const launchAngle = Number(pitch.launch_angle ?? NaN);
    const isBarrel = checkBarrel(exitVelo, launchAngle);
    if (isBarrel) g.barrels++;
    if (!isNaN(pxRaw) && !isNaN(pzRaw) && Math.abs(pxRaw) <= 0.708 && pzRaw >= 1.5 && pzRaw <= 3.5) g.inZone++;

    // Release extension — /gf provides this directly (same as CSV release_extension)
    const ext = Number(pitch.extension);
    if (!isNaN(ext)) g.extensions.push(ext);

    // Kinematic params used for both release position and VAA
    const x0    = Number(pitch.x0);
    const z0    = Number(pitch.z0);
    const vx0   = Number(pitch.vx0);
    const vz0   = Number(pitch.vz0);
    const vy0   = Number(pitch.vy0);
    const ax    = Number(pitch.ax);
    const ay    = Number(pitch.ay);
    const az    = Number(pitch.az);
    const y0ref = Number(pitch.y0); // ≈ 50 ft from plate — trajectory reference, NOT actual release

    // Back-propagate from the 50-ft reference point to the actual release point.
    // x0/z0 are at y0 ≈ 50 ft; the ball was actually released at (60.5 - extension) ft.
    // Solve y0ref + vy0*t + 0.5*ay*t² = yRelease for t < 0 (going backward in time).
    let perPitchHRel: number | null = null;
    let perPitchVRel: number | null = null;
    let gotRelPos = false;
    if (!isNaN(x0) && !isNaN(z0) && !isNaN(y0ref) &&
        !isNaN(vx0) && !isNaN(vy0) && !isNaN(vz0) &&
        !isNaN(ax) && !isNaN(ay) && !isNaN(az) &&
        !isNaN(ext) && ay !== 0) {
      const yRelease = 60.5 - ext; // rubber is 60.5 ft from home plate
      const disc = vy0 * vy0 + 2 * ay * (yRelease - y0ref);
      if (disc >= 0) {
        const t = (-vy0 - Math.sqrt(disc)) / ay; // t < 0, backward to release
        const xRel = x0 + vx0 * t + 0.5 * ax * t * t;
        const zRel = z0 + vz0 * t + 0.5 * az * t * t;
        perPitchHRel = -xRel;
        perPitchVRel = zRel;
        g.hRels.push(perPitchHRel); // arm-side positive (negate: 3B-side is negative for RHP)
        g.vRels.push(perPitchVRel);
        // Arm angle: angle of arm above horizontal, computed from release position.
        // Reference height 4.7 ft ≈ shoulder height during delivery (pivot point for arm angle).
        // Sidearm pitchers (z_release ≈ 4.7) → 0°; overhand → positive; submarine → negative.
        const geoAA = Math.atan2(zRel - 4.7, Math.abs(xRel)) * (180 / Math.PI);
        if (!isNaN(geoAA)) armAnglesAll.push(geoAA);
        gotRelPos = true;
      }
    }
    if (!gotRelPos) {
      // Fallback: use reference-point coords as approximation (slightly off from actual release)
      if (!isNaN(x0)) { perPitchHRel = -x0; g.hRels.push(-x0); }
      if (!isNaN(z0)) { perPitchVRel = z0; g.vRels.push(z0); }
      // Still compute arm angle from reference-point coords — close enough for display
      if (!isNaN(x0) && !isNaN(z0)) {
        const geoAA = Math.atan2(z0 - 4.7, Math.abs(x0)) * (180 / Math.PI);
        if (!isNaN(geoAA)) armAnglesAll.push(geoAA);
      }
    }

    // VAA + HAA using kinematic params — propagate forward from y0ref to home plate
    let perPitchVaa: number | null = null;
    let perPitchHaa: number | null = null;
    if (!isNaN(vz0) && !isNaN(vy0) && !isNaN(ay) && !isNaN(az) && !isNaN(y0ref) && ay !== 0) {
      const yPlate = 1.417;
      const disc = vy0 * vy0 + 2 * ay * (yPlate - y0ref);
      if (disc >= 0) {
        const t = (-vy0 - Math.sqrt(disc)) / ay;
        const vzAtPlate = vz0 + az * t;
        const vyAtPlate = vy0 + ay * t;
        perPitchVaa = Math.atan2(vzAtPlate, Math.abs(vyAtPlate)) * (180 / Math.PI);
        g.vaas.push(perPitchVaa);
        if (!isNaN(vx0) && !isNaN(ax)) {
          const vxAtPlate = vx0 + ax * t;
          perPitchHaa = -Math.atan(vxAtPlate / vyAtPlate) * (180 / Math.PI);
          g.haas.push(perPitchHaa);
        }
      }
    }
    if (!isNaN(hBreakIn) && !isNaN(ivbIn)) {
      rawDots.push({
        hb: hBreakIn, ivb: ivbIn, pitchType: mapped, px: pxVal, pz: pzVal,
        isWhiff, isBarrel, batterSide,
        velo: !isNaN(velo) ? velo : null,
        spin: !isNaN(spin) ? spin : null,
        spinAxis: !isNaN(spinAxis) && spinAxis > 0 ? spinAxis : null,
        vaa: perPitchVaa,
        haa: perPitchHaa,
        hRel: perPitchHRel,
        vRel: perPitchVRel,
        extension: !isNaN(ext) ? ext : null,
      });
    }
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const r1 = (v: number | null) => v !== null ? Math.round(v * 10) / 10 : null;
  const r2 = (v: number | null) => v !== null ? Math.round(v * 100) / 100 : null;

  const countedPitches = Object.values(groups).reduce((s, g) => s + g.count, 0);

  const pitchTypes: {
    name: string; count: number; usage: number;
    velo: number | null; maxVelo: number | null; spin: number | null; spin_axis: number | null;
    h_movement: number | null; v_movement: number | null;
    vaa: number | null; haa: number | null; whiff: number | null; whiffs: number;
    zone_pct: number | null; barrel_pct: number | null;
    h_rel: number | null; v_rel: number | null; extension: number | null;
  }[] = [];

  for (const [name, g] of Object.entries(groups)) {
    const usage = (g.count / countedPitches) * 100;
    if (usage < 1) continue;
    pitchTypes.push({
      name, count: g.count,
      usage: Math.round(usage * 10) / 10,
      velo: r1(avg(g.velos)),
      maxVelo: g.velos.length > 0 ? r1(Math.max(...g.velos)) : null,
      spin: avg(g.spins) !== null ? Math.round(avg(g.spins)!) : null,
      spin_axis: avg(g.spinAxes) !== null ? Math.round(avg(g.spinAxes)!) : null,
      h_movement: r1(avg(g.hBreaks)),
      v_movement: r1(avg(g.vBreaks)),
      vaa: r2(avg(g.vaas)),
      haa: r2(avg(g.haas)),
      whiff: g.swings > 0 ? Math.round((g.whiffs / g.swings) * 1000) / 10 : null,
      whiffs: g.whiffs,
      zone_pct: g.count > 0 ? Math.round((g.inZone / g.count) * 1000) / 10 : null,
      barrel_pct: g.count > 0 ? Math.round((g.barrels / g.count) * 1000) / 10 : null,
      h_rel: r2(avg(g.hRels)),
      v_rel: r2(avg(g.vRels)),
      extension: r2(avg(g.extensions)),
    });
  }

  pitchTypes.sort((a, b) => b.usage - a.usage);

  return {
    totalPitches,
    pitchTypes,
    rawDots,
    armAngle: armAnglesAll.length > 0 ? Math.round(armAnglesAll.reduce((a, b) => a + b, 0) / armAnglesAll.length * 10) / 10 : null,
    strikePct: totalPitches > 0 ? Math.round((strikes / totalPitches) * 1000) / 10 : null,
    swingAndMissPct: totalPitches > 0 ? Math.round((swingAndMisses / totalPitches) * 1000) / 10 : null,
    totalWhiffs: swingAndMisses,
  };
}

// Fetch pitcher pitches from Savant /gf endpoint for a given gamePk.
// Also fetches the Savant CSV in parallel to supplement spin_axis, which the /gf
// endpoint does not reliably include.
async function fetchGfPitchData(gamePk: number, playerId: string, targetDate: string): Promise<ReturnType<typeof aggregateGfStatcast> | null> {
  try {
    const gfUrl = `https://baseballsavant.mlb.com/gf?game_pk=${gamePk}`;
    const season = parseInt(targetDate.slice(0, 4));
    const isSpringOrExhibition = parseInt(targetDate.slice(5, 7)) <= 3;
    const csvUrl = isSpringOrExhibition
      ? `${SAVANT_BASE}?all=true&type=details&pitchers_lookup%5B%5D=${playerId}&player_type=pitcher&game_date_gt=${targetDate}&game_date_lt=${targetDate}&hfGT=S%7CE%7CW%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`
      : `${SAVANT_BASE}?all=true&type=details&pitchers_lookup%5B%5D=${playerId}&player_type=pitcher&game_date_gt=${targetDate}&game_date_lt=${targetDate}&hfSea=${season}%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`;

    // Fetch GF and Savant CSV in parallel; CSV uses a short timeout so it never blocks
    const [gfResult, csvResult] = await Promise.allSettled([
      fetchJSON(gfUrl, true),
      (async (): Promise<string | null> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000); // 10s timeout
        try {
          const res = await fetch(csvUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://baseballsavant.mlb.com/' },
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!res.ok) return null;
          const text = await res.text();
          return text.startsWith('\uFEFF') ? text.slice(1) : text;
        } finally {
          clearTimeout(timer);
        }
      })(),
    ]);

    if (gfResult.status === 'rejected') throw gfResult.reason;
    const gf = gfResult.value;
    const pidStr = String(playerId);
    const homePitchers = gf?.home_pitchers ?? {};
    const awayPitchers = gf?.away_pitchers ?? {};
    const pitches: GfPitch[] = homePitchers[pidStr] ?? awayPitchers[pidStr] ?? [];
    if (pitches.length === 0) return null;

    // Build spin_axis lookup from CSV: key = "at_bat_number-pitch_number"
    const spinAxisByKey = new Map<string, number>();
    let csvPitchesForGame: Record<string, string>[] = [];
    if (csvResult.status === 'fulfilled' && csvResult.value) {
      try {
        const csvText = csvResult.value;
        if (csvText.includes('pitch_type')) {
          const rows = parseCSV(csvText);
          // The URL already filters by pitcher + date, so we only need to match the pitcher.
          // Dropping the game_pk filter avoids mismatches on international/WBC games where
          // Savant's CSV uses a different game_pk than the MLB Stats API.
          csvPitchesForGame = rows
            .filter(r => r.pitcher?.trim() === pidStr)
            .sort((a, b) => {
              const abDiff = parseInt(a.at_bat_number) - parseInt(b.at_bat_number);
              return abDiff !== 0 ? abDiff : parseInt(a.pitch_number) - parseInt(b.pitch_number);
            });
          for (const row of csvPitchesForGame) {
            const sa = parseFloat(row.spin_axis);
            if (!isNaN(sa) && sa > 0) {
              spinAxisByKey.set(`${row.at_bat_number}-${row.pitch_number}`, sa);
            }
          }
        }
      } catch { /* CSV parsing failed — proceed without spin_axis supplement */ }
    }

    // Supplement GF pitches with spin_axis from CSV via key-based lookup
    let keyMatchCount = 0;
    for (const pitch of pitches) {
      // Skip if GF already has a valid spin_axis
      if (pitch.spin_axis != null && Number(pitch.spin_axis) > 0) continue;
      // Try common field name variants for at-bat and pitch number in the GF payload
      const abNum = pitch.at_bat_number ?? pitch.ab_number ?? pitch.atBatNumber;
      const pitchNum = pitch.pitch_number ?? pitch.pitch_num ?? pitch.pitchNumber;
      if (abNum != null && pitchNum != null) {
        const sa = spinAxisByKey.get(`${abNum}-${pitchNum}`);
        if (sa !== undefined) { pitch.spin_axis = sa; keyMatchCount++; }
      }
    }

    // Positional fallback: if key lookup found nothing but counts match, align by index
    if (keyMatchCount === 0 && csvPitchesForGame.length === pitches.length) {
      for (let i = 0; i < pitches.length; i++) {
        const sa = parseFloat(csvPitchesForGame[i].spin_axis);
        if (!isNaN(sa) && sa > 0) pitches[i].spin_axis = sa;
      }
      console.log(`[GF] gamePk=${gamePk} pid=${pidStr} spin_axis: positional match (${csvPitchesForGame.length} pitches)`);
    } else {
      console.log(`[GF] gamePk=${gamePk} pid=${pidStr} pitches=${pitches.length} spinAxisKeyMatches=${keyMatchCount} csvRows=${csvPitchesForGame.length}`);
    }

    return aggregateGfStatcast(pitches);
  } catch (e) {
    console.warn('[GF] fetch failed:', e);
    return null;
  }
}

// Fetch pitcher pitches from Stats API live game feed (for college/non-MLB games without Savant data)
async function fetchStatsApiPitcherData(gamePk: number, playerId: string): Promise<ReturnType<typeof aggregateGfStatcast> | null> {
  try {
    const feed = await fetchJSON(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`, true);
    const allPlays: Record<string, unknown>[] = feed?.liveData?.plays?.allPlays ?? [];
    const pidNum = parseInt(playerId);
    const pitches: GfPitch[] = [];

    for (const play of allPlays) {
      const matchup = play.matchup as Record<string, unknown> | undefined;
      if ((matchup?.pitcher as Record<string, unknown>)?.id !== pidNum) continue;
      const throwHand = String((matchup?.pitchHand as Record<string, unknown>)?.code ?? 'R');
      const armSign = throwHand === 'L' ? 1 : -1;
      const batSide = String((matchup?.batSide as Record<string, unknown>)?.code ?? '');
      const result = play.result as Record<string, unknown> | undefined;

      for (const event of ((play.playEvents as Record<string, unknown>[]) ?? [])) {
        if (!event.isPitch) continue;
        const pd = event.pitchData as Record<string, unknown> | undefined;
        const coords = (pd?.coordinates as Record<string, unknown>) ?? {};
        const breaks = (pd?.breaks as Record<string, unknown>) ?? {};
        const details = event.details as Record<string, unknown> | undefined;
        const hd = event.hitData as Record<string, unknown> | undefined;
        const pfxXRaw = Number(coords.pfxX ?? NaN);
        pitches.push({
          pitch_type: String((details?.type as Record<string, unknown>)?.code ?? ''),
          description: String(details?.description ?? ''),
          call_name: String(details?.description ?? ''),
          start_speed: Number(pd?.startSpeed ?? NaN),
          spin_rate: Number(breaks.spinRate ?? NaN),
          // Stats API pfxX is catcher's POV; flip to pitcher's POV (arm-side positive)
          pfxX: !isNaN(pfxXRaw) ? armSign * pfxXRaw : undefined,
          // Stats API pfxZ is feet (IVB); aggregateGfStatcast expects inches via inducedBreakZ
          inducedBreakZ: Number(coords.pfxZ ?? NaN) * 12,
          px: Number(coords.pX ?? NaN),
          pz: Number(coords.pZ ?? NaN),
          x0: Number(coords.x0 ?? NaN),
          y0: Number(coords.y0 ?? NaN),
          z0: Number(coords.z0 ?? NaN),
          vx0: Number(coords.vX0 ?? NaN),
          vy0: Number(coords.vY0 ?? NaN),
          vz0: Number(coords.vZ0 ?? NaN),
          ax: Number(coords.aX ?? NaN),
          ay: Number(coords.aY ?? NaN),
          az: Number(coords.aZ ?? NaN),
          extension: Number(pd?.extension ?? NaN),
          stand: batSide,
          launch_speed: Number(hd?.launchSpeed ?? NaN),
          launch_angle: Number(hd?.launchAngle ?? NaN),
          at_bat_number: Number(play.atBatIndex ?? 0) + 1,
          pitch_number: Number(event.pitchNumber ?? NaN),
          events: String(result?.eventType ?? ''),
          batter: (matchup?.batter as Record<string, unknown>)?.id,
        });
      }
    }

    if (pitches.length === 0) return null;
    console.log(`[StatsApi Pitcher] gamePk=${gamePk} pid=${playerId} pitches=${pitches.length}`);
    return aggregateGfStatcast(pitches);
  } catch (e) {
    console.warn('[StatsApi Pitcher] fetch failed:', e);
    return null;
  }
}

// Fetch arm angle directly from Savant's pitcher-arm-angles leaderboard (seasonal aggregate)
async function fetchSavantArmAngle(playerId: string, season: number): Promise<number | null> {
  try {
    const url = `https://baseballsavant.mlb.com/leaderboard/pitcher-arm-angles?year=${season}&min=1&pos=all`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000); // 5s timeout
    let data: unknown;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        next: { revalidate: 300 },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      data = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const rows = Array.isArray(data) ? data : (data as Record<string, unknown>)?.data;
    if (!Array.isArray(rows)) return null;
    const row = rows.find(
      (r: Record<string, unknown>) =>
        String(r.pitcher) === String(playerId) || String(r.id) === String(playerId)
    );
    const aa = Number(row?.arm_angle);
    return !isNaN(aa) ? Math.round(aa * 10) / 10 : null;
  } catch {
    return null;
  }
}

// ─── Statcast aggregation for one day ─────────────────────────────────────────

function aggregateDayStatcast(rows: Record<string, string>[]) {
  const groups: Record<string, {
    velos: number[]; spins: number[]; spinAxes: number[];
    hBreaks: number[]; vBreaks: number[];
    vaas: number[]; haas: number[]; count: number; swings: number; whiffs: number; inZone: number; barrels: number;
    hRels: number[]; vRels: number[]; extensions: number[];
  }> = {};

  // Individual pitch dots for the movement chart: {hb, ivb, pitchType}
  const rawDots: { hb: number; ivb: number; pitchType: string; px: number | null; pz: number | null; isWhiff: boolean; isBarrel: boolean; batterSide: string | null; velo: number | null; spin: number | null; spinAxis: number | null; vaa: number | null; haa: number | null; hRel: number | null; vRel: number | null; extension: number | null }[] = [];
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
      groups[mapped] = { velos: [], spins: [], spinAxes: [], hBreaks: [], vBreaks: [], vaas: [], haas: [], count: 0, swings: 0, whiffs: 0, inZone: 0, barrels: 0, hRels: [], vRels: [], extensions: [] };
    }
    const g = groups[mapped];
    g.count++;

    // Per-pitch-type swing/whiff tracking
    const isSwing = desc.includes('swinging') || desc.includes('foul') || desc.includes('hit_into_play') || desc === 'hit_into_play';
    const isWhiff = desc === 'swinging_strike' || desc === 'swinging_strike_blocked' || desc === 'foul_tip';
    if (isSwing || isWhiff) g.swings++;
    if (isWhiff) g.whiffs++;

    const velo = parseFloat(row.release_speed);
    if (!isNaN(velo)) g.velos.push(velo);

    const spin = parseFloat(row.release_spin_rate);
    if (!isNaN(spin)) g.spins.push(spin);

    const spinAxis = parseFloat(row.spin_axis);
    if (!isNaN(spinAxis) && spinAxis > 0) g.spinAxes.push(spinAxis);

    // Sign multiplier so arm-side is always positive for both LHP and RHP.
    // pfx_x / release_pos_x are in catcher's POV: positive = toward 1B.
    // RHP arm side = 3B = negative in catcher coords → multiply by -1.
    // LHP arm side = 1B = positive in catcher coords → keep as-is.
    const pThrows = (row.p_throws ?? '').trim().toUpperCase();
    const armSign = pThrows === 'L' ? 1 : -1;

    // Release position and extension (CSV columns in feet)
    const hRelRaw = parseFloat(row.release_pos_x);
    if (!isNaN(hRelRaw)) g.hRels.push(armSign * hRelRaw);

    const vRelRaw = parseFloat(row.release_pos_z);
    if (!isNaN(vRelRaw)) g.vRels.push(vRelRaw);

    const extRaw = parseFloat(row.release_extension);
    if (!isNaN(extRaw)) g.extensions.push(extRaw);

    const hBreak = parseFloat(row.pfx_x);
    if (!isNaN(hBreak)) g.hBreaks.push(hBreak * armSign * 12);

    const vBreak = parseFloat(row.pfx_z);
    if (!isNaN(vBreak)) g.vBreaks.push(vBreak * 12);

    // Collect raw dot for movement chart + location chart
    const pxRaw = parseFloat(row.plate_x);
    const pzRaw = parseFloat(row.plate_z);
    const isWhiffCsv = desc === 'swinging_strike' || desc === 'swinging_strike_blocked';
    const batterSide = (row.stand ?? '').trim() || null;
    const exitVelo = parseFloat(row.launch_speed);
    const launchAngle = parseFloat(row.launch_angle);
    const isBarrel = checkBarrel(exitVelo, launchAngle);
    if (isBarrel) g.barrels++;
    if (!isNaN(pxRaw) && !isNaN(pzRaw) && Math.abs(pxRaw) <= 0.708 && pzRaw >= 1.5 && pzRaw <= 3.5) g.inZone++;

    // Compute arm angle geometrically from release position.
    // Reference height 4.7 ft ≈ shoulder height during delivery (pivot point for arm angle).
    // Sidearm pitchers (z_release ≈ 4.7) → 0°; overhand → positive; submarine → negative.
    if (!isNaN(hRelRaw) && !isNaN(vRelRaw)) {
      const geoAA = Math.atan2(vRelRaw - 4.7, Math.abs(hRelRaw)) * (180 / Math.PI);
      if (!isNaN(geoAA)) armAngles.push(geoAA);
    }

    // VAA + HAA: approach angles at home plate using kinematic equations.
    // Savant coords: vy0 < 0 (toward plate), ay < 0 (drag), az includes gravity.
    // Find time to reach front of plate (y = 1.417 ft) from release (y = vy0*0 + release_pos_y).
    // t = (-vy0 - sqrt(vy0² + 2*ay*(y_plate - y_release))) / ay
    const vz0 = parseFloat(row.vz0);
    const vy0 = parseFloat(row.vy0);
    const vx0 = parseFloat(row.vx0);
    const ay  = parseFloat(row.ay);
    const az  = parseFloat(row.az);
    const ax  = parseFloat(row.ax);
    const yRelease = parseFloat(row.release_pos_y);
    let perPitchVaa: number | null = null;
    let perPitchHaa: number | null = null;
    if (!isNaN(vz0) && !isNaN(vy0) && !isNaN(ay) && !isNaN(az) && !isNaN(yRelease) && ay !== 0) {
      const yPlate = 1.417;
      const disc = vy0 * vy0 + 2 * ay * (yPlate - yRelease);
      if (disc >= 0) {
        const t = (-vy0 - Math.sqrt(disc)) / ay;
        const vzAtPlate = vz0 + az * t;
        const vyAtPlate = vy0 + ay * t;
        perPitchVaa = Math.atan2(vzAtPlate, Math.abs(vyAtPlate)) * (180 / Math.PI);
        g.vaas.push(perPitchVaa);
        if (!isNaN(vx0) && !isNaN(ax)) {
          const vxAtPlate = vx0 + ax * t;
          perPitchHaa = -Math.atan(vxAtPlate / vyAtPlate) * (180 / Math.PI);
          g.haas.push(perPitchHaa);
        }
      }
    }
    if (!isNaN(hBreak) && !isNaN(vBreak)) {
      rawDots.push({
        hb: hBreak * armSign * 12, ivb: vBreak * 12, pitchType: mapped,
        px: !isNaN(pxRaw) ? pxRaw : null,
        pz: !isNaN(pzRaw) ? pzRaw : null,
        isWhiff: isWhiffCsv,
        isBarrel,
        batterSide,
        velo: !isNaN(velo) ? velo : null,
        spin: !isNaN(spin) ? spin : null,
        spinAxis: !isNaN(spinAxis) && spinAxis > 0 ? spinAxis : null,
        vaa: perPitchVaa,
        haa: perPitchHaa,
        hRel: !isNaN(hRelRaw) ? armSign * hRelRaw : null,
        vRel: !isNaN(vRelRaw) ? vRelRaw : null,
        extension: !isNaN(extRaw) ? extRaw : null,
      });
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
    maxVelo: number | null;
    spin: number | null;
    spin_axis: number | null;
    h_movement: number | null;
    v_movement: number | null;
    vaa: number | null;
    haa: number | null;
    whiff: number | null;
    whiffs: number;
    zone_pct: number | null;
    barrel_pct: number | null;
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
      maxVelo: g.velos.length > 0 ? r1(Math.max(...g.velos)) : null,
      spin: avg(g.spins) !== null ? Math.round(avg(g.spins)!) : null,
      spin_axis: avg(g.spinAxes) !== null ? Math.round(avg(g.spinAxes)!) : null,
      h_movement: r1(avg(g.hBreaks)),
      v_movement: r1(avg(g.vBreaks)),
      vaa: r2(avg(g.vaas)),
      haa: r2(avg(g.haas)),
      whiff: g.swings > 0 ? Math.round((g.whiffs / g.swings) * 1000) / 10 : null,
      whiffs: g.whiffs,
      zone_pct: g.count > 0 ? Math.round((g.inZone / g.count) * 1000) / 10 : null,
      barrel_pct: g.count > 0 ? Math.round((g.barrels / g.count) * 1000) / 10 : null,
      h_rel: r2(avg(g.hRels)),
      v_rel: r2(avg(g.vRels)),
      extension: r2(avg(g.extensions)),
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
    let playerHeight: string | null = null;
    let playerWeight: number | null = null;
    let playerBirthDate: string | null = null;
    let playerPitchHand: string | null = null;
    let playerBatSide: string | null = null;
    try {
      const personData = await fetchJSON(`${MLB_API}/people/${playerId}`, isToday);
      const person = personData?.people?.[0];
      playerName = person?.fullName ?? null;
      playerHeight = person?.height ?? null;
      playerWeight = person?.weight ?? null;
      playerBirthDate = person?.birthDate ?? null;
      playerPitchHand = person?.pitchHand?.code ?? null;
      playerBatSide = person?.batSide?.code ?? null;
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
        const scheduleUrl = `${MLB_API}/schedule?startDate=${targetDate}&endDate=${targetDate}&sportId=1,22,23,51`;
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
              stPitchData = await fetchGfPitchData(stGameInfo.gamePk, playerId, targetDate);
            }
            // 2. Fall back to CSV if /gf had no data
            if (!stPitchData) {
              const savantUrl = `${SAVANT_BASE}?all=true&type=details&pitchers_lookup%5B%5D=${playerId}&player_type=pitcher&game_date_gt=${targetDate}&game_date_lt=${targetDate}&hfGT=S%7CE%7CW%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`;
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
            // Final fallback: Stats API live feed (college/non-Savant games)
            if (!stPitchData && stGameInfo.gamePk) {
              stPitchData = await fetchStatsApiPitcherData(stGameInfo.gamePk, playerId);
            }
          } catch (e) { console.warn('[ST Statcast] error:', e); }

          if (stPitchData) {
            const stArmAngle = await fetchSavantArmAngle(playerId, season);
            if (stArmAngle !== null) stPitchData = { ...stPitchData, armAngle: stArmAngle };
          }
          return NextResponse.json({
            playerId: parseInt(playerId),
            playerName,
            playerHeight,
            playerWeight,
            playerBirthDate,
            playerPitchHand,
            playerBatSide,
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
        playerName,
        playerHeight,
        playerWeight,
        playerBirthDate,
        playerPitchHand,
        playerBatSide,
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
    // Strategy: try Savant CSV first (has all fields: hRel/vRel/Ext/armAngle).
    // NOTE: do NOT include game_pk in the CSV URL — Savant ignores pitchers_lookup
    // when game_pk is present, returning only a header row. Filter by game_pk in code.
    // Fall back to /gf only if CSV has no data yet (same-day games).
   let pitchData = null;
    try {
      const isSpringOrExhibition = parseInt(targetDate.slice(5, 7)) <= 3;
      const savantUrl = isSpringOrExhibition
        ? `${SAVANT_BASE}?all=true&type=details&pitchers_lookup%5B%5D=${playerId}&player_type=pitcher&game_date_gt=${targetDate}&game_date_lt=${targetDate}&hfGT=S%7CE%7CW%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`
        : `${SAVANT_BASE}?all=true&type=details&pitchers_lookup%5B%5D=${playerId}&player_type=pitcher&game_date_gt=${targetDate}&game_date_lt=${targetDate}&hfSea=${season}%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`;

      // For today's games, prefer /gf first — it's live and won't have partial data
      if (isToday && gamePk) {
        pitchData = await fetchGfPitchData(gamePk, playerId, targetDate);
      }

      // For past dates, or if /gf returned nothing, try CSV
      if (!pitchData) {
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
              pitchData = aggregateDayStatcast(filtered);
            }
          }
        } catch (csvErr) {
          console.warn('[Statcast CSV] fetch failed:', csvErr);
        }
      }

      // Final fallback: /gf for past dates where CSV also had nothing
      if (!pitchData && gamePk && !isToday) {
        pitchData = await fetchGfPitchData(gamePk, playerId, targetDate);
      }
      // Last resort: Stats API live feed (college/non-Savant games)
      if (!pitchData && gamePk) {
        pitchData = await fetchStatsApiPitcherData(gamePk, playerId);
      }
   } catch (e) {
      console.warn('Statcast fetch failed:', e);
    }

     
    // Arm angle: Savant leaderboard is the authoritative source (uses Hawk-Eye body tracking).
    // The daily geometric approximation is kept as a fallback for players not on the leaderboard
    // (spring training, rookies, minor leaguers, etc.).
    if (pitchData) {
      const savantArmAngle = await fetchSavantArmAngle(playerId, season);
      if (savantArmAngle !== null) {
        pitchData = { ...pitchData, armAngle: savantArmAngle };
      }
      // If leaderboard has nothing, the geometrically computed value (from daily release position)
      // already sits in pitchData.armAngle from the aggregation step — no further action needed.
    }

    return NextResponse.json({
      playerId: parseInt(playerId),
      playerName,
      playerHeight,
      playerWeight,
      playerBirthDate,
      playerPitchHand,
      playerBatSide,
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
