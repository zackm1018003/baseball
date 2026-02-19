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
// zone vs the 2025 MLB league-average xwOBA for that zone:
//
//   SWING in zone where xwOBA > league avg:  +1 per 0.001 above avg
//   SWING in zone where xwOBA < league avg:  -1 per 0.001 below avg
//   TAKE  in zone where xwOBA > league avg:  -1 per 0.001 above avg
//   TAKE  in zone where xwOBA < league avg:  +1 per 0.001 below avg
//
// OUT-OF-ZONE (Statcast zones 11-19): flat penalty/reward:
//   CHASE (swing out of zone): -OOZ_CHASE_PTS per pitch
//   TAKE  (lay off out of zone): +OOZ_TAKE_PTS per pitch
//
// rawPerPitch = totalPoints / coveredPitches  (per-pitch average)
//
// Scaled using OPS+-style formula:
//   ZD+ = 100 + ((rawPerPitch - LEAGUE_MEAN) / LEAGUE_STDEV) * 15
//
// With per-zone baselines, a league-average player scores 0 raw pts/pitch,
// so LEAGUE_MEAN = 0 by definition.
//   LEAGUE_MEAN  = 0   (avg player is exactly at baseline in every zone)
//   LEAGUE_STDEV = 30  (spread across the league)
//
// 2025 MLB league-average xwOBA by zone (from ~101k batted balls):
//   Zone layout (catcher's view):
//     1(hi-away) 2(hi-mid)  3(hi-in)
//     4(mid-away) 5(center) 6(mid-in)
//     7(lo-away) 8(lo-mid)  9(lo-in)

// Per-zone 2025 MLB league-average xwOBA baselines
const ZONE_BASELINE: Record<number, number> = {
  1: 0.3413,
  2: 0.3851,
  3: 0.3512,
  4: 0.3810,
  5: 0.4348,
  6: 0.3832,
  7: 0.3570,
  8: 0.4106,
  9: 0.3551,
};

const LEAGUE_MEAN  = 0;    // 0 by definition with per-zone baselines
const LEAGUE_STDEV = 30;   // estimated standard deviation across MLB

// Out-of-zone discipline adjustment (added on top of in-zone ZD+):
//   Each OOZ take contributes +OOZ_TAKE_PTS per pitch seen out of zone.
//   Each OOZ swing (chase) contributes -OOZ_CHASE_PTS per pitch seen out of zone.
//   The raw contribution is then compared against league-average expectation to
//   produce a ZD+ adjustment.
//
//   OOZ_TAKE_PTS  = +120  (laying off a ball out of the zone, doubled)
//   OOZ_CHASE_PTS =   80  (chasing a ball out of the zone, doubled, applied as negative)
//
//   League average: ~72% takes, ~28% chases
//   Avg raw per OOZ pitch = 0.72 * 120 - 0.28 * 80 = 86.4 - 22.4 = 64.0
//   Adjustment = (playerRaw - leagueAvgRaw) / OOZ_SCALE
//   OOZ_SCALE = 3.0 so discipline now contributes ±8-15 ZD+ range for extremes.
const OOZ_TAKE_PTS       = 120;  // ZD-raw points per out-of-zone take (doubled)
const OOZ_CHASE_PTS      = 80;   // ZD-raw points per out-of-zone chase (doubled, deducted)
const OOZ_LEAGUE_AVG_RAW = 0.72 * OOZ_TAKE_PTS - 0.28 * OOZ_CHASE_PTS; // ~64.0
const OOZ_SCALE          = 3.0;  // raw-per-pitch points per 1 ZD+ point

function calcZoneDecisionRaw(
  zoneXwoba: Record<number, number | null>,
  zoneSwings: Record<number, number>,
  zonePitches: Record<number, number>,
): { totalPoints: number; coveredPitches: number } {
  let totalPoints = 0;
  let coveredPitches = 0;

  // In-zone scoring (zones 1-9)
  for (let z = 1; z <= 9; z++) {
    const xw = zoneXwoba[z];
    if (xw === null) continue;

    const sw = zoneSwings[z];
    const tk = zonePitches[z] - sw;
    const diffPts = (xw - ZONE_BASELINE[z]) * 1000;

    totalPoints += diffPts * sw;
    totalPoints += -diffPts * tk;
    coveredPitches += zonePitches[z];
  }

  return { totalPoints, coveredPitches };
}

/**
 * Out-of-zone discipline adjustment in ZD+ points.
 * Each OOZ take earns +OOZ_TAKE_PTS, each chase costs OOZ_CHASE_PTS.
 * Result is compared to league-average expectation and scaled to ZD+ points.
 * Returns 0 if fewer than 10 OOZ pitches (insufficient sample).
 */
function calcOozAdj(oozSwings: number, oozTakes: number): number {
  const total = oozSwings + oozTakes;
  if (total < 10) return 0;
  const rawPerOozPitch = (oozTakes * OOZ_TAKE_PTS - oozSwings * OOZ_CHASE_PTS) / total;
  return (rawPerOozPitch - OOZ_LEAGUE_AVG_RAW) / OOZ_SCALE;
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

    const { totalPoints, coveredPitches } = calcZoneDecisionRaw(zoneXwoba, swings, pitches);
    const totalZonePitches = Object.values(pitches).reduce((a, b) => a + b, 0);

    // Per-pitch average (removes sample-size bias)
    const rawPerPitch = coveredPitches >= 50 ? totalPoints / coveredPitches : null;

    // OPS+-style scaling: 100 = league avg, each LEAGUE_STDEV raw points = 15 ZD+
    // Then add the OOZ discipline adjustment on top (kept separate to avoid scale mismatch)
    const oozAdj = calcOozAdj(oozSwings, oozTakes);
    const zdPlus = rawPerPitch !== null
      ? Math.round(100 + ((rawPerPitch - LEAGUE_MEAN) / LEAGUE_STDEV) * 15 + oozAdj)
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
        oozAdj: Math.round(oozAdj * 10) / 10,
      },
      { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } }
    );
  } catch (err) {
    console.error('Zone contact fetch error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
