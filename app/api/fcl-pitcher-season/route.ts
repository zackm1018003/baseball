import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

/**
 * GET /api/fcl-pitcher-season?playerId=XXXXX&season=2026
 *
 * Returns a season-aggregate view for an FCL/ACL pitcher:
 *   - playerInfo
 *   - aggregatedGameLine (G, IP, H, ER, BB, K, HR, ERA)
 *   - pitchData  (combined rawDots + pitchTypes from ALL games via Stats API live feed)
 *   - outings    (individual game log rows for the outings table)
 */

const MLB_API = 'https://statsapi.mlb.com/api/v1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchJSON(url: string, noCache = false) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    ...(noCache ? { cache: 'no-store' } : { next: { revalidate: 300 } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

function parseHeightToInches(height: string | null): number {
  if (!height) return 72;
  const m = height.match(/(\d+)'\s*(\d+)/);
  if (!m) return 72;
  return parseInt(m[1]) * 12 + parseInt(m[2]);
}

function parseIpToOuts(ip: string): number {
  if (!ip) return 0;
  const parts = ip.split('.');
  return (parseInt(parts[0]) || 0) * 3 + (parseInt(parts[1]) || 0);
}

function outsToIp(outs: number): string {
  const full = Math.floor(outs / 3);
  const partial = outs % 3;
  return `${full}.${partial}`;
}

// ─── Pitch type map ───────────────────────────────────────────────────────────

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

function checkBarrel(ev: number, la: number): boolean {
  if (isNaN(ev) || isNaN(la) || ev < 98) return false;
  const delta = Math.min(ev, 116) - 98;
  return la >= Math.max(8, 26 - delta) && la <= Math.min(50, 30 + delta);
}

// ─── Core aggregation (GF / Stats API pitch objects) ─────────────────────────

type GfPitch = Record<string, unknown>;

function aggregateGfStatcast(pitches: GfPitch[], heightIn = 72, throws: 'L' | 'R' = 'R', isStatsApi = false) {
  const x0Vals = pitches.map(p => Number(p.x0)).filter(v => !isNaN(v) && v !== 0);
  const avgX0 = x0Vals.length > 0 ? x0Vals.reduce((a, b) => a + b, 0) / x0Vals.length : 0;
  const hbSign = avgX0 > 0 ? -1 : 1;

  const groups: Record<string, {
    velos: number[]; spins: number[];
    hBreaks: number[]; vBreaks: number[];
    vaas: number[]; haas: number[]; count: number; swings: number; whiffs: number; inZone: number; barrels: number;
    hRels: number[]; vRels: number[]; extensions: number[];
  }> = {};

  const rawDots: {
    hb: number; ivb: number; pitchType: string;
    px: number | null; pz: number | null;
    isWhiff: boolean; isSwing: boolean; isBarrel: boolean; batterSide: string | null;
    velo: number | null; spin: number | null;
    vaa: number | null; haa: number | null;
    hRel: number | null; vRel: number | null; extension: number | null;
  }[] = [];

  const allHRelsGf: number[] = [];
  const allVRelsGf: number[] = [];

  let totalPitches = 0;
  let strikes = 0;
  let swingAndMisses = 0;
  let relPosSource = 'none';

  for (const pitch of pitches) {
    const rawType = String(pitch.pitch_type ?? '');
    const mapped = PITCH_TYPE_MAP[rawType];
    if (mapped === null || mapped === undefined) continue;

    totalPitches++;

    const desc = String(pitch.description ?? pitch.call_name ?? '').toLowerCase();
    const isStrike = desc.includes('strike') || desc.includes('foul') || desc.includes('in play');
    const isWhiff = desc === 'swinging strike' || desc === 'swinging strike (blocked)' ||
      desc.includes('swinging strike') || desc === 'foul tip';
    const isSwing = isWhiff || desc.includes('foul') || desc.includes('in play') || desc.includes('hit into play');

    if (isStrike) strikes++;
    if (isWhiff) swingAndMisses++;

    if (!groups[mapped]) {
      groups[mapped] = {
        velos: [], spins: [], hBreaks: [], vBreaks: [], vaas: [], haas: [],
        count: 0, swings: 0, whiffs: 0, inZone: 0, barrels: 0,
        hRels: [], vRels: [], extensions: [],
      };
    }
    const g = groups[mapped];
    g.count++;
    if (isSwing) g.swings++;
    if (isWhiff) g.whiffs++;

    const velo = Number(pitch.start_speed);
    if (!isNaN(velo) && velo > 0) g.velos.push(velo);

    const spin = Number(pitch.spin_rate);
    if (!isNaN(spin) && spin > 0) g.spins.push(spin);

    const pfxX = Number(pitch.pfxX);
    // pfxX is already in inches for Stats API data; isStatsApi controls whether to skip *12
    const hBreakIn = !isNaN(pfxX) ? pfxX * hbSign * (isStatsApi ? 1 : 12) : NaN;
    // Only push non-zero values — zero means no tracking data for that pitch/game
    if (!isNaN(hBreakIn) && Math.abs(hBreakIn) > 0.1) g.hBreaks.push(hBreakIn);

    const ivbIn = Number(pitch.inducedBreakZ);
    if (!isNaN(ivbIn) && Math.abs(ivbIn) > 0.1) g.vBreaks.push(ivbIn);

    const pxRaw = Number(pitch.px);
    const pzRaw = Number(pitch.pz);
    const pxVal = !isNaN(pxRaw) ? pxRaw : null;
    const pzVal = !isNaN(pzRaw) ? pzRaw : null;

    const batterSide = String(pitch.stand ?? pitch.batter_side ?? '').trim() || null;
    const exitVelo = Number(pitch.launch_speed ?? NaN);
    const launchAngle = Number(pitch.launch_angle ?? NaN);
    const isBarrel = checkBarrel(exitVelo, launchAngle);
    if (isBarrel) g.barrels++;
    if (!isNaN(pxRaw) && !isNaN(pzRaw) && Math.abs(pxRaw) <= 0.708 && pzRaw >= 1.5 && pzRaw <= 3.5) g.inZone++;

    const ext = Number(pitch.extension);
    if (!isNaN(ext)) g.extensions.push(ext);

    const x0 = Number(pitch.x0);
    const z0 = Number(pitch.z0);
    const vx0 = Number(pitch.vx0);
    const vz0 = Number(pitch.vz0);
    const vy0 = Number(pitch.vy0);
    const ax = Number(pitch.ax);
    const ay = Number(pitch.ay);
    const az = Number(pitch.az);
    const y0ref = Number(pitch.y0);

    const relPosX = Number(pitch.release_pos_x ?? NaN);
    const relPosZ = Number(pitch.release_pos_z ?? NaN);
    let perPitchHRel: number | null = null;
    let perPitchVRel: number | null = null;
    let gotRelPos = false;

    if (!isNaN(relPosX) && !isNaN(relPosZ) && relPosZ > 0) {
      perPitchHRel = -relPosX;
      perPitchVRel = relPosZ;
      g.hRels.push(perPitchHRel);
      g.vRels.push(perPitchVRel);
      allHRelsGf.push(perPitchHRel);
      allVRelsGf.push(perPitchVRel);
      gotRelPos = true;
      relPosSource = 'direct';
    }
    if (!gotRelPos && !isNaN(x0) && !isNaN(z0) && !isNaN(y0ref) &&
        !isNaN(vx0) && !isNaN(vy0) && !isNaN(vz0) &&
        !isNaN(ax) && !isNaN(ay) && !isNaN(az) &&
        !isNaN(ext) && ay !== 0) {
      const yRelease = 60.5 - ext;
      const disc = vy0 * vy0 + 2 * ay * (yRelease - y0ref);
      if (disc >= 0) {
        const t = (-vy0 - Math.sqrt(disc)) / ay;
        const xRel = x0 + vx0 * t + 0.5 * ax * t * t;
        const zRel = z0 + vz0 * t + 0.5 * az * t * t;
        perPitchHRel = -xRel;
        perPitchVRel = zRel;
        g.hRels.push(perPitchHRel);
        g.vRels.push(perPitchVRel);
        allHRelsGf.push(perPitchHRel);
        allVRelsGf.push(perPitchVRel);
        gotRelPos = true;
        relPosSource = 'backprop';
      }
    }
    if (!gotRelPos) {
      if (!isNaN(x0)) { perPitchHRel = -x0; g.hRels.push(-x0); allHRelsGf.push(-x0); }
      if (!isNaN(z0)) { perPitchVRel = z0; g.vRels.push(z0); allVRelsGf.push(z0); }
      relPosSource = 'raw_x0z0';
    }

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

    // Only add dots when both movement values are real (non-zero = tracking data present)
    if (!isNaN(hBreakIn) && Math.abs(hBreakIn) > 0.1 && !isNaN(ivbIn) && Math.abs(ivbIn) > 0.1) {
      rawDots.push({
        hb: hBreakIn, ivb: ivbIn, pitchType: mapped, px: pxVal, pz: pzVal,
        isWhiff, isSwing, isBarrel, batterSide,
        velo: !isNaN(velo) ? velo : null,
        spin: !isNaN(spin) ? spin : null,
        vaa: perPitchVaa, haa: perPitchHaa,
        hRel: perPitchHRel, vRel: perPitchVRel,
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
    velo: number | null; maxVelo: number | null; spin: number | null;
    h_movement: number | null; v_movement: number | null;
    vaa: number | null; haa: number | null; whiff: number | null; whiffs: number; swings: number;
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
      h_movement: r1(avg(g.hBreaks)),
      v_movement: r1(avg(g.vBreaks)),
      vaa: r2(avg(g.vaas)),
      haa: r2(avg(g.haas)),
      whiff: g.swings > 0 ? Math.round((g.whiffs / g.swings) * 1000) / 10 : null,
      whiffs: g.whiffs,
      swings: g.swings,
      zone_pct: g.count > 0 ? Math.round((g.inZone / g.count) * 1000) / 10 : null,
      barrel_pct: g.count > 0 ? Math.round((g.barrels / g.count) * 1000) / 10 : null,
      h_rel: r2(avg(g.hRels)),
      v_rel: r2(avg(g.vRels)),
      extension: r2(avg(g.extensions)),
    });
  }
  pitchTypes.sort((a, b) => b.usage - a.usage);

  const allHRels = rawDots.map(d => d.hRel).filter((v): v is number => v !== null);
  const avgHRel = allHRels.length > 0 ? allHRels.reduce((a, b) => a + b, 0) / allHRels.length : null;
  const inferredThrows: 'L' | 'R' | null = avgHRel !== null ? (avgHRel > 0 ? 'R' : 'L') : null;

  const avgHRelGf = allHRelsGf.length > 0 ? allHRelsGf.reduce((a, b) => a + b, 0) / allHRelsGf.length : null;
  const avgVRelGf = allVRelsGf.length > 0 ? allVRelsGf.reduce((a, b) => a + b, 0) / allVRelsGf.length : null;
  const handSign = (throws === 'L' || (throws !== 'R' && inferredThrows === 'L')) ? -1 : 1;

  let hRelForAngle = avgHRelGf;
  let vRelForAngle = avgVRelGf;
  if (hRelForAngle === null || vRelForAngle === null) {
    const totalCount = pitchTypes.reduce((s, p) => s + p.count, 0);
    if (totalCount > 0) {
      const ptH = pitchTypes.reduce((s, p) => s + (p.h_rel ?? 0) * p.count, 0) / totalCount;
      const ptV = pitchTypes.reduce((s, p) => s + (p.v_rel ?? 0) * p.count, 0) / totalCount;
      if (ptH !== 0 || ptV !== 0) { hRelForAngle = ptH; vRelForAngle = ptV; }
    }
  }

  const gfArmAngle = (hRelForAngle !== null && vRelForAngle !== null && vRelForAngle > 0)
    ? (() => {
        const adjIn = isStatsApi
          ? vRelForAngle * 12 - heightIn * 0.70
          : vRelForAngle * 12 * 0.70;
        if (adjIn <= 0) return null;
        return Math.round(Math.atan2(adjIn, Math.abs(hRelForAngle) * 12) * (180 / Math.PI) * handSign * 10) / 10;
      })()
    : null;

  console.log(`[FCL_SEASON_ARM] src=${relPosSource} n=${allHRelsGf.length} avgH=${hRelForAngle?.toFixed(3)} avgV=${vRelForAngle?.toFixed(3)} => ${gfArmAngle}°`);

  return {
    totalPitches,
    pitchTypes,
    rawDots,
    throws: inferredThrows,
    armAngle: gfArmAngle,
    strikePct: totalPitches > 0 ? Math.round((strikes / totalPitches) * 1000) / 10 : null,
    swingAndMissPct: totalPitches > 0 ? Math.round((swingAndMisses / totalPitches) * 1000) / 10 : null,
    totalWhiffs: swingAndMisses,
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const seasonParam = searchParams.get('season');

  if (!playerId) {
    return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  }

  const season = seasonParam ? parseInt(seasonParam) : new Date().getFullYear();

  // ── 1. Player bio ──────────────────────────────────────────────────────────
  let playerName: string | null = null;
  let playerHeight: string | null = null;
  let playerWeight: number | null = null;
  let playerBirthDate: string | null = null;
  let playerPitchHand: string | null = null;
  let playerBatSide: string | null = null;
  let currentTeamAbbr: string | null = null;
  try {
    const personData = await fetchJSON(`${MLB_API}/people/${playerId}?hydrate=currentTeam`);
    const person = personData?.people?.[0];
    playerName = person?.fullName ?? null;
    playerHeight = person?.height ?? null;
    playerWeight = person?.weight ?? null;
    playerBirthDate = person?.birthDate ?? null;
    playerPitchHand = person?.pitchHand?.code ?? null;
    playerBatSide = person?.batSide?.code ?? null;
    // Resolve currentTeam to an MLB parent org abbreviation by name matching.
    // The currentTeam abbreviation is often empty or an unrecognised MiLB code,
    // so we match against team name fragments (covers both FCL/ACL teams and
    // any MiLB affiliate that might be listed as the player's assigned team).
    const ct = person?.currentTeam;
    const ctName = (ct?.name ?? '').toLowerCase();
    const MLB_NAMES: Record<string, string> = {
      // MLB org names (catch FCL/ACL/DSL team names like "FCL Pirates")
      'angels': 'LAA', 'diamondbacks': 'ARI', 'orioles': 'BAL',
      'red sox': 'BOS', 'cubs': 'CHC', 'reds': 'CIN',
      'guardians': 'CLE', 'rockies': 'COL', 'tigers': 'DET',
      'astros': 'HOU', 'royals': 'KC', 'dodgers': 'LAD',
      'nationals': 'WSH', 'mets': 'NYM', 'athletics': 'OAK',
      'pirates': 'PIT', 'padres': 'SD', 'mariners': 'SEA',
      'giants': 'SF', 'cardinals': 'STL', 'rays': 'TB',
      'rangers': 'TEX', 'blue jays': 'TOR', 'twins': 'MIN',
      'phillies': 'PHI', 'braves': 'ATL', 'white sox': 'CHW',
      'marlins': 'MIA', 'yankees': 'NYY', 'brewers': 'MIL',
      // MiLB affiliate team names (currentTeam may be the assigned affiliate)
      'marauders': 'PIT', 'bradenton': 'PIT', 'altoona': 'PIT',
      'curve': 'PIT', 'indianapolis': 'PIT',
      'baysox': 'BAL', 'norfolk': 'BAL', 'delmarva': 'BAL', 'aberdeen': 'BAL',
      'pawtucket': 'BOS', 'worcester': 'BOS', 'portland': 'BOS', 'greenville': 'BOS', 'salem': 'BOS',
      'scranton': 'NYY', 'somerset': 'NYY', 'hudson valley': 'NYY', 'tampa': 'NYY',
      'buffalo': 'TOR', 'new hampshire': 'TOR', 'vancouver': 'TOR', 'dunedin': 'TOR',
      'durham': 'TB', 'montgomery': 'TB', 'bowling green': 'TB', 'charleston': 'TB',
      'gwinnett': 'ATL', 'mississippi': 'ATL', 'rome': 'ATL', 'augusta': 'ATL',
      'lehigh': 'PHI', 'reading': 'PHI', 'jersey shore': 'PHI', 'clearwater': 'PHI',
      'rochester': 'WSH', 'harrisburg': 'WSH', 'fredericksburg': 'WSH', 'wilmington': 'WSH',
      'syracuse': 'NYM', 'binghamton': 'NYM', 'brooklyn': 'NYM', 'st. lucie': 'NYM',
      'columbus': 'CLE', 'akron': 'CLE', 'lake county': 'CLE', 'lynchburg': 'CLE',
      'toledo': 'DET', 'erie': 'DET', 'west michigan': 'DET', 'lakeland': 'DET',
      'charlotte': 'CHW', 'birmingham': 'CHW', 'winston-salem': 'CHW', 'kannapolis': 'CHW',
      'nashville': 'MIL', 'biloxi': 'MIL', 'wisconsin': 'MIL', 'carolina': 'MIL',
      'memphis': 'STL', 'springfield': 'STL', 'peoria': 'STL', 'palm beach': 'STL',
      'louisville': 'CIN', 'chattanooga': 'CIN', 'dayton': 'CIN',
      'indianapolis indians': 'PIT',
    };
    for (const [fragment, abbr] of Object.entries(MLB_NAMES)) {
      if (ctName.includes(fragment)) { currentTeamAbbr = abbr; break; }
    }
    // Fall back to whatever the API gives us (works if it's an MLB team directly)
    if (!currentTeamAbbr && ct?.abbreviation) currentTeamAbbr = ct.abbreviation;
  } catch { /* non-fatal */ }

  // ── 2. FCL game log (sportId=16) ───────────────────────────────────────────
  interface Outing {
    date: string;
    opponent: string;
    ip: string;
    h: number; er: number; bb: number; k: number; hr: number;
    pitches: number; bf: number;
    gamePk: number | undefined;
    isHome: boolean | null;
    team: string | null;
  }

  let outings: Outing[] = [];
  try {
    const logData = await fetchJSON(
      `${MLB_API}/people/${playerId}/stats?stats=gameLog&group=pitching&season=${season}&sportId=16`
    );
    const splits: unknown[] = logData?.stats?.[0]?.splits ?? [];
    outings = splits.map((s: unknown) => {
      const split = s as {
        date?: string;
        stat?: {
          inningsPitched?: string; hits?: number; earnedRuns?: number;
          baseOnBalls?: number; strikeOuts?: number; homeRuns?: number;
          numberOfPitches?: number; battersFaced?: number;
        };
        team?: { abbreviation?: string; name?: string };
        opponent?: { abbreviation?: string; name?: string };
        isHome?: boolean;
        game?: { gamePk?: number; gameDate?: string };
      };
      return {
        date: split.date || split.game?.gameDate?.slice(0, 10) || '',
        opponent: split.opponent?.abbreviation || split.opponent?.name || '?',
        ip: split.stat?.inningsPitched || '0',
        h: split.stat?.hits ?? 0,
        er: split.stat?.earnedRuns ?? 0,
        bb: split.stat?.baseOnBalls ?? 0,
        k: split.stat?.strikeOuts ?? 0,
        hr: split.stat?.homeRuns ?? 0,
        pitches: split.stat?.numberOfPitches ?? 0,
        bf: split.stat?.battersFaced ?? 0,
        gamePk: split.game?.gamePk,
        isHome: split.isHome ?? null,
        team: split.team?.abbreviation || split.team?.name || null,
      };
    }).filter(o => o.date);

    // If person lookup didn't resolve a team, try the first outing's team name
    if (!currentTeamAbbr) {
      const firstTeamName = (outings[0]?.team ?? '').toLowerCase();
      const MLB_NAMES_GAME: Record<string, string> = {
        'pirates': 'PIT', 'angels': 'LAA', 'diamondbacks': 'ARI', 'orioles': 'BAL',
        'red sox': 'BOS', 'cubs': 'CHC', 'reds': 'CIN', 'guardians': 'CLE',
        'rockies': 'COL', 'tigers': 'DET', 'astros': 'HOU', 'royals': 'KC',
        'dodgers': 'LAD', 'nationals': 'WSH', 'mets': 'NYM', 'athletics': 'OAK',
        'padres': 'SD', 'mariners': 'SEA', 'giants': 'SF', 'cardinals': 'STL',
        'rays': 'TB', 'rangers': 'TEX', 'blue jays': 'TOR', 'twins': 'MIN',
        'phillies': 'PHI', 'braves': 'ATL', 'white sox': 'CHW', 'marlins': 'MIA',
        'yankees': 'NYY', 'brewers': 'MIL',
      };
      for (const [fragment, abbr] of Object.entries(MLB_NAMES_GAME)) {
        if (firstTeamName.includes(fragment)) { currentTeamAbbr = abbr; break; }
      }
    }
  } catch (e) {
    console.warn('[FCL season] game log fetch failed:', e);
  }

  // ── 3. Aggregate game line ─────────────────────────────────────────────────
  const totalOuts = outings.reduce((sum, o) => sum + parseIpToOuts(o.ip), 0);
  const totalH    = outings.reduce((sum, o) => sum + o.h, 0);
  const totalER   = outings.reduce((sum, o) => sum + o.er, 0);
  const totalBB   = outings.reduce((sum, o) => sum + o.bb, 0);
  const totalK    = outings.reduce((sum, o) => sum + o.k, 0);
  const totalHR   = outings.reduce((sum, o) => sum + o.hr, 0);
  const totalPit  = outings.reduce((sum, o) => sum + o.pitches, 0);
  const totalBF   = outings.reduce((sum, o) => sum + o.bf, 0);
  const ipDecimal = totalOuts / 3;
  const era = ipDecimal > 0 ? (totalER / ipDecimal * 9).toFixed(2) : null;

  const aggregatedGameLine = {
    games: outings.length,
    ip: outsToIp(totalOuts),
    h: totalH,
    er: totalER,
    bb: totalBB,
    k: totalK,
    hr: totalHR,
    pitches: totalPit,
    bf: totalBF,
    era,
  };

  // ── 4. Extract pitches from each game's Stats API live feed ────────────────
  const htIn = parseHeightToInches(playerHeight);
  const thr: 'L' | 'R' = (playerPitchHand === 'L' || playerPitchHand === 'R') ? playerPitchHand : 'R';
  const allPitches: GfPitch[] = [];
  const pidNum = parseInt(playerId);

  // Unique game PKs only
  const uniqueGamePks = [...new Set(outings.map(o => o.gamePk).filter((pk): pk is number => pk !== undefined))];

  await Promise.all(uniqueGamePks.map(async (gamePk) => {
    try {
      const feed = await fetchJSON(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`);
      const allPlays: Record<string, unknown>[] = feed?.liveData?.plays?.allPlays ?? [];

      for (const play of allPlays) {
        const matchup = play.matchup as Record<string, unknown> | undefined;
        if ((matchup?.pitcher as Record<string, unknown>)?.id !== pidNum) continue;

        const throwHand = String((matchup?.pitchHand as Record<string, unknown>)?.code ?? 'R');
        // Stats API pfxX: catcher's POV — negate unconditionally (arm-side → positive hb)
        const armSign = throwHand === 'L' ? -1 : -1;
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
          // Prefer breaks.breakVerticalInduced (IVB, inches, gravity-removed) over coords.pfxZ
          // which can be inconsistent across games. Same for horizontal break.
          const brkIVB = Number(breaks.breakVerticalInduced ?? NaN);
          const brkHB  = Number(breaks.breakHorizontal ?? NaN);
          allPitches.push({
            pitch_type: String((details?.type as Record<string, unknown>)?.code ?? ''),
            description: String(details?.description ?? ''),
            call_name: String(details?.description ?? ''),
            start_speed: Number(pd?.startSpeed ?? NaN),
            spin_rate: Number(breaks.spinRate ?? NaN),
            // breaks.breakHorizontal is arm-side-positive for both hands (unlike coords.pfxX which
            // is catcher-POV). For RHP use +1 (no flip needed), for LHP use -1 so that the
            // subsequent hbSign flip in aggregateGfStatcast still makes arm-side positive.
            pfxX: !isNaN(brkHB) ? (throwHand === 'L' ? -1 : 1) * brkHB : (!isNaN(pfxXRaw) ? armSign * pfxXRaw : undefined),
            // breaks.breakVerticalInduced is the canonical IVB in inches; fall back to coords.pfxZ
            inducedBreakZ: !isNaN(brkIVB) ? brkIVB : Number(coords.pfxZ ?? NaN),
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
      console.log(`[FCL_SEASON] gamePk=${gamePk} extracted ${allPitches.length} total pitches so far`);
    } catch (e) {
      console.warn(`[FCL_SEASON] gamePk=${gamePk} fetch failed:`, e);
    }
  }));

  // ── 5. Aggregate all pitches into one dataset ──────────────────────────────
  let pitchData = null;
  if (allPitches.length > 0) {
    pitchData = aggregateGfStatcast(allPitches, htIn, thr, true);
    console.log(`[FCL_SEASON] pid=${playerId} totalPitches=${pitchData.totalPitches} pitchTypes=${pitchData.pitchTypes.length}`);
  }

  return NextResponse.json({
    playerId: parseInt(playerId),
    playerName,
    playerHeight,
    playerWeight,
    playerBirthDate,
    playerPitchHand,
    playerBatSide,
    currentTeamAbbr,
    season,
    aggregatedGameLine,
    pitchData,
    outings,
  });
}
