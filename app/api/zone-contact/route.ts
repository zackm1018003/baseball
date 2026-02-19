import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface ZoneContactData {
  zone: number;
  pitches: number;
  swings: number;
  contacts: number;
  swingPct: number | null;
  contactPct: number | null;
  xwoba: number | null;
  xwobaN: number;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let field = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { field += line[i++]; }
      }
      fields.push(field);
      if (line[i] === ',') i++;
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) { fields.push(line.slice(i)); break; }
      else { fields.push(line.slice(i, end)); i = end + 1; }
    }
  }
  return fields;
}

// ---------------------------------------------------------------------------
// ZoneDecision+ scoring
// ---------------------------------------------------------------------------
// IN-ZONE (zones 1-9): score each pitch based on the player's xwOBA in that
// zone vs the 0.250 baseline:
//
//   SWING in zone where xwOBA > 0.250:  +1 per 0.001 above 0.250
//   SWING in zone where xwOBA < 0.250:  -1 per 0.001 below 0.250
//   TAKE  in zone where xwOBA > 0.250:  -1 per 0.001 above 0.250
//   TAKE  in zone where xwOBA < 0.250:  +1 per 0.001 below 0.250
//
// OUT-OF-ZONE (Statcast zones 11-19): flat penalty/reward:
//   CHASE (swing out of zone): -1 point per pitch
//   TAKE  (lay off out of zone): +1 point per pitch
//
// rawPerPitch = totalPoints / coveredPitches  (per-pitch average)
//
// Scaled using OPS+-style formula:
//   ZD+ = 100 + ((rawPerPitch - LEAGUE_MEAN) / LEAGUE_STDEV) * 15
//
// Calibration (estimated from typical 2024/2025 MLB zone data):
//   LEAGUE_MEAN  ~ 47   (avg MLB hitter: zone xwOBA ~0.380, z-swing ~68%)
//   LEAGUE_STDEV ~ 30   (spread across the league)

const XWOBA_BASELINE = 0.250;
const LEAGUE_MEAN  = 47;   // estimated league-average raw per-pitch score
const LEAGUE_STDEV = 30;   // estimated standard deviation across MLB

// Flat points awarded/deducted per out-of-zone pitch
const OOZ_CHASE_PTS = -1;  // swinging at a ball out of the zone
const OOZ_TAKE_PTS  = +1;  // laying off a ball out of the zone

function calcZoneDecisionRaw(
  zoneXwoba: Record<number, number | null>,
  zoneSwings: Record<number, number>,
  zonePitches: Record<number, number>,
  oozSwings: number,
  oozTakes: number,
): { totalPoints: number; coveredPitches: number } {
  let totalPoints = 0;
  let coveredPitches = 0;

  // In-zone scoring (zones 1-9)
  for (let z = 1; z <= 9; z++) {
    const xw = zoneXwoba[z];
    if (xw === null) continue;

    const sw = zoneSwings[z];
    const tk = zonePitches[z] - sw;
    const diffPts = (xw - XWOBA_BASELINE) * 1000;

    totalPoints += diffPts * sw;
    totalPoints += -diffPts * tk;
    coveredPitches += zonePitches[z];
  }

  // Out-of-zone scoring: flat +1 per take, -1 per chase
  totalPoints    += OOZ_CHASE_PTS * oozSwings;
  totalPoints    += OOZ_TAKE_PTS  * oozTakes;
  coveredPitches += oozSwings + oozTakes;

  return { totalPoints, coveredPitches };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const season = searchParams.get('season') || '2025';

  if (!playerId) {
    return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  }

  try {
    const url =
      `https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfGT=R%7C&hfSea=${season}%7C` +
      `&player_type=batter&batters_lookup[]=${playerId}&min_pitches=0&min_results=0&min_pas=0&type=details`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch from Baseball Savant' }, { status: 502 });
    }

    const text = await response.text();
    const lines = text.replace(/^\uFEFF/, '').split('\n').filter((l) => l.trim());

    if (lines.length < 2) {
      return NextResponse.json({ zones: [] });
    }

    const headers = parseCsvLine(lines[0]);
    const zoneIdx  = headers.indexOf('zone');
    const descIdx  = headers.indexOf('description');
    const xwobaIdx = headers.indexOf('estimated_woba_using_speedangle');

    if (zoneIdx === -1 || descIdx === -1) {
      return NextResponse.json({ error: 'Could not find required columns' }, { status: 500 });
    }

    let overallXwobaSum = 0;
    let overallXwobaN   = 0;

    // In-zone (1-9) accumulators
    const pitches:  Record<number, number> = {};
    const swings:   Record<number, number> = {};
    const contacts: Record<number, number> = {};
    const xwobaSum: Record<number, number> = {};
    const xwobaN:   Record<number, number> = {};
    for (let z = 1; z <= 9; z++) {
      pitches[z] = 0; swings[z] = 0; contacts[z] = 0; xwobaSum[z] = 0; xwobaN[z] = 0;
    }

    // Out-of-zone accumulators
    let oozSwings = 0;
    let oozTakes  = 0;

    for (let i = 1; i < lines.length; i++) {
      const fields   = parseCsvLine(lines[i]);
      const zone     = parseInt(fields[zoneIdx]?.trim()  ?? '');
      const desc     = fields[descIdx]?.trim()            ?? '';
      const xwobaVal = parseFloat(fields[xwobaIdx]?.trim() ?? '');

      const isSwing =
        desc === 'swinging_strike'         || desc === 'foul'          ||
        desc === 'hit_into_play'           || desc === 'foul_tip'      ||
        desc === 'swinging_strike_blocked' || desc === 'bunt_foul_tip' ||
        desc === 'missed_bunt';
      const isContact =
        desc === 'foul' || desc === 'hit_into_play' ||
        desc === 'foul_tip' || desc === 'bunt_foul_tip';

      // Track overall xwoba across all hit-into-play pitches (any zone)
      if (desc === 'hit_into_play' && !isNaN(xwobaVal)) { overallXwobaSum += xwobaVal; overallXwobaN++; }

      if (zone >= 1 && zone <= 9) {
        // In-zone pitch
        pitches[zone]++;
        if (isSwing) { swings[zone]++; if (isContact) contacts[zone]++; }
        if (desc === 'hit_into_play' && !isNaN(xwobaVal)) {
          xwobaSum[zone] += xwobaVal;
          xwobaN[zone]++;
        }
      } else if (zone >= 11 && zone <= 19) {
        // Out-of-zone pitch (Statcast shadow/chase zones)
        if (isSwing) {
          oozSwings++;
        } else {
          oozTakes++;
        }
      }
    }

    const zoneXwoba: Record<number, number | null> = {};
    for (let z = 1; z <= 9; z++) {
      zoneXwoba[z] = xwobaN[z] >= 5 ? xwobaSum[z] / xwobaN[z] : null;
    }

    const overallXwoba = overallXwobaN >= 10 ? Math.round((overallXwobaSum / overallXwobaN) * 1000) / 1000 : null;

    const { totalPoints, coveredPitches } = calcZoneDecisionRaw(zoneXwoba, swings, pitches, oozSwings, oozTakes);
    const totalZonePitches = Object.values(pitches).reduce((a, b) => a + b, 0);

    // Per-pitch average (removes sample-size bias)
    const rawPerPitch = coveredPitches >= 50 ? totalPoints / coveredPitches : null;

    // OPS+-style scaling: 100 = league avg, each LEAGUE_STDEV raw points = 15 ZD+
    const zdPlus = rawPerPitch !== null
      ? Math.round(100 + ((rawPerPitch - LEAGUE_MEAN) / LEAGUE_STDEV) * 15)
      : null;

    const zones: ZoneContactData[] = [];
    for (let z = 1; z <= 9; z++) {
      const pw = pitches[z]; const sw = swings[z]; const co = contacts[z];
      const n  = xwobaN[z];
      zones.push({
        zone:       z,
        pitches:    pw,
        swings:     sw,
        contacts:   co,
        swingPct:   pw >= 5 ? Math.round((sw / pw) * 1000) / 10 : null,
        contactPct: sw >= 5 ? Math.round((co / sw) * 1000) / 10 : null,
        xwoba:      n  >= 5 ? Math.round((xwobaSum[z] / n) * 1000) / 1000 : null,
        xwobaN:     n,
      });
    }

    return NextResponse.json(
      {
        zones,
        season,
        zdPlus,
        zdRaw: rawPerPitch !== null ? Math.round(rawPerPitch * 10) / 10 : null,
        xwoba: overallXwoba,
        pitchCount: totalZonePitches,
        oozSwings,
        oozTakes,
      },
      { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } }
    );
  } catch (err) {
    console.error('Zone contact fetch error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
