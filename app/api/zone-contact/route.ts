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
// Decision+ scoring
// ---------------------------------------------------------------------------
// IN-ZONE (zones 1-9): score each pitch based on the player's wOBA in that
// zone vs the 2025 MLB league-average wOBA for that zone:
//
//   SWING in zone where wOBA > league avg:  +1 per 0.001 above avg
//   SWING in zone where wOBA < league avg:  -1 per 0.001 below avg
//   TAKE  in zone where wOBA > league avg:  -1 per 0.001 above avg
//   TAKE  in zone where wOBA < league avg:  +1 per 0.001 below avg
//
// OUT-OF-ZONE (Statcast zones 11-19): flat penalty/reward:
//   CHASE (swing out of zone): -OOZ_CHASE_PTS per pitch
//   TAKE  (lay off out of zone): +OOZ_TAKE_PTS per pitch
//
// rawPerPitch = totalPoints / coveredPitches  (per-pitch average)
//
// Scaled using OPS+-style formula:
//   Decision+ = 100 + ((rawPerPitch - LEAGUE_MEAN) / LEAGUE_STDEV) * 15
//
// With per-zone baselines, a league-average player scores 0 raw pts/pitch,
// so LEAGUE_MEAN = 0 by definition.
//   LEAGUE_MEAN  = 0   (avg player is exactly at baseline in every zone)
//   LEAGUE_STDEV = 30  (spread across the league)
//
// 2025 MLB league-average wOBA by zone (per batted ball, ~81k BIP across 24 teams):
//   Zone layout (catcher's view):
//     1(hi-away) 2(hi-mid)  3(hi-in)
//     4(mid-away) 5(center) 6(mid-in)
//     7(lo-away) 8(lo-mid)  9(lo-in)

// Per-zone 2025 MLB league-average wOBA baselines (per batted ball, ~81k BIP across 24 teams)
const ZONE_BASELINE: Record<number, number> = {
  1: 0.3483,
  2: 0.3806,
  3: 0.3709,
  4: 0.3760,
  5: 0.4251,
  6: 0.3855,
  7: 0.3411,
  8: 0.4018,
  9: 0.3413,
};

const LEAGUE_MEAN  = 0;    // 0 by definition with per-zone baselines
const LEAGUE_STDEV = 30;   // estimated standard deviation across MLB

// Out-of-zone discipline adjustment (added on top of in-zone Decision+):
//   Each OOZ take contributes +OOZ_TAKE_PTS per pitch seen out of zone.
//   Each OOZ swing (chase) contributes -OOZ_CHASE_PTS per pitch seen out of zone.
//   The raw contribution is then compared against league-average expectation to
//   produce a Decision+ adjustment.
//
//   OOZ_TAKE_PTS  = +60  (laying off a ball out of the zone)
//   OOZ_CHASE_PTS =  40  (chasing a ball out of the zone, applied as negative)
//
//   League average: ~72% takes, ~28% chases
//   Avg raw per OOZ pitch = 0.72 * 60 - 0.28 * 40 = 43.2 - 11.2 = 32.0
//   Adjustment = (playerRaw - leagueAvgRaw) / OOZ_SCALE
//   OOZ_SCALE = 3.0 gives ±4-7 Decision+ range for realistic chase rate extremes.
const OOZ_TAKE_PTS       = 60;   // ZD-raw points per out-of-zone take
const OOZ_CHASE_PTS      = 40;   // ZD-raw points per out-of-zone chase (deducted)
const OOZ_LEAGUE_AVG_RAW = 0.72 * OOZ_TAKE_PTS - 0.28 * OOZ_CHASE_PTS; // ~32.0
const OOZ_SCALE          = 3.0;  // raw-per-pitch points per 1 Decision+ point

function calcZoneDecisionRaw(
  zoneWoba: Record<number, number | null>,
  zoneSwings: Record<number, number>,
  zonePitches: Record<number, number>,
): { totalPoints: number; coveredPitches: number } {
  let totalPoints = 0;
  let coveredPitches = 0;

  // In-zone scoring (zones 1-9)
  for (let z = 1; z <= 9; z++) {
    const woba = zoneWoba[z];
    if (woba === null) continue;

    const sw = zoneSwings[z];
    const tk = zonePitches[z] - sw;
    const diffPts = (woba - ZONE_BASELINE[z]) * 1000;

    totalPoints += diffPts * sw;
    totalPoints += -diffPts * tk;
    coveredPitches += zonePitches[z];
  }

  return { totalPoints, coveredPitches };
}

/**
 * Out-of-zone discipline adjustment in Decision+ points.
 * Each OOZ take earns +OOZ_TAKE_PTS, each chase costs OOZ_CHASE_PTS.
 * Result is compared to league-average expectation and scaled to Decision+ points.
 * Returns 0 if fewer than 10 OOZ pitches (insufficient sample).
 */
function calcOozAdj(oozSwings: number, oozTakes: number): number {
  const total = oozSwings + oozTakes;
  if (total < 10) return 0;
  const rawPerOozPitch = (oozTakes * OOZ_TAKE_PTS - oozSwings * OOZ_CHASE_PTS) / total;
  return (rawPerOozPitch - OOZ_LEAGUE_AVG_RAW) / OOZ_SCALE;
}

async function fetchSavantCsv(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
    },
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.text();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const season = searchParams.get('season') || '2025';

  if (!playerId) {
    return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  }

  try {
    // First try MLB regular season data
    const mlbUrl =
      `https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfGT=R%7C&hfSea=${season}%7C` +
      `&player_type=batter&batters_lookup[]=${playerId}&min_pitches=0&min_results=0&min_pas=0&type=details`;

    let text = await fetchSavantCsv(mlbUrl);
    let lines = text.replace(/^\uFEFF/, '').split('\n').filter((l) => l.trim());

    // If no MLB data, fall back to AAA minor league endpoint
    if (lines.length < 2) {
      const minorsUrl =
        `https://baseballsavant.mlb.com/statcast-search-minors/csv?all=true&player_type=batter` +
        `&hfSea=${season}%7C&hfGT=R%7C&hfLevel=AAA%7C&hfFlag=is..tracked%7C&chk_is_tracked=on` +
        `&minors=true&type=details&batters_lookup[]=${playerId}&min_pitches=0&min_results=0&min_pas=0`;
      text = await fetchSavantCsv(minorsUrl);
      lines = text.replace(/^\uFEFF/, '').split('\n').filter((l) => l.trim());
    }

    if (lines.length < 2) {
      return NextResponse.json({ zones: [] });
    }

    const headers   = parseCsvLine(lines[0]);
    const zoneIdx   = headers.indexOf('zone');
    const descIdx   = headers.indexOf('description');
    const eventsIdx = headers.indexOf('events');

    if (zoneIdx === -1 || descIdx === -1) {
      return NextResponse.json({ error: 'Could not find required columns' }, { status: 500 });
    }

    // 2025 MLB wOBA weights (standard linear weights)
    const WOBA_WEIGHTS: Record<string, number> = {
      walk:         0.696,
      intent_walk:  0.696,
      hit_by_pitch: 0.726,
      single:       0.883,
      double:       1.244,
      triple:       1.569,
      home_run:     2.007,
    };
    // Plate appearance events that count in wOBA denominator
    const WOBA_PA_EVENTS = new Set([
      'walk', 'intent_walk', 'hit_by_pitch',
      'single', 'double', 'triple', 'home_run',
      'field_out', 'strikeout', 'grounded_into_double_play',
      'force_out', 'strikeout_double_play', 'fielders_choice',
      'fielders_choice_out', 'field_error', 'sac_fly',
      'double_play', 'triple_play',
    ]);

    let overallWobaSum = 0;
    let overallWobaN   = 0;

    // In-zone (1-9) accumulators
    const pitches:  Record<number, number> = {};
    const swings:   Record<number, number> = {};
    const contacts: Record<number, number> = {};
    // wOBA per batted ball (hit_into_play only): used for both zone display and Decision+ scoring
    const hipWobaSum: Record<number, number> = {};
    const hipWobaN:   Record<number, number> = {};
    for (let z = 1; z <= 9; z++) {
      pitches[z] = 0; swings[z] = 0; contacts[z] = 0;
      hipWobaSum[z] = 0; hipWobaN[z] = 0;
    }

    // Out-of-zone accumulators
    let oozSwings = 0;
    let oozTakes  = 0;

    for (let i = 1; i < lines.length; i++) {
      const fields   = parseCsvLine(lines[i]);
      const zone     = parseInt(fields[zoneIdx]?.trim()  ?? '');
      const desc     = fields[descIdx]?.trim()            ?? '';
      const event    = fields[eventsIdx]?.trim()           ?? '';

      const isSwing =
        desc === 'swinging_strike'         || desc === 'foul'          ||
        desc === 'hit_into_play'           || desc === 'foul_tip'      ||
        desc === 'swinging_strike_blocked' || desc === 'bunt_foul_tip' ||
        desc === 'missed_bunt';
      const isContact =
        desc === 'foul' || desc === 'hit_into_play' ||
        desc === 'foul_tip' || desc === 'bunt_foul_tip';
      // wOBA: count PAs (any zone) for overall wOBA
      if (event && WOBA_PA_EVENTS.has(event)) {
        overallWobaSum += WOBA_WEIGHTS[event] ?? 0;
        overallWobaN++;
      }

      if (zone >= 1 && zone <= 9) {
        // In-zone pitch
        pitches[zone]++;
        if (isSwing) { swings[zone]++; if (isContact) contacts[zone]++; }
        // wOBA per batted ball in zone (display + Decision+ scoring): only hit_into_play pitches
        if (desc === 'hit_into_play' && event && WOBA_PA_EVENTS.has(event)) {
          hipWobaSum[zone] += WOBA_WEIGHTS[event] ?? 0;  // hits get weight, outs get 0
          hipWobaN[zone]++;
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

    // Zone wOBA for Decision+ scoring (per batted ball, min 3 BIP)
    const zoneWoba: Record<number, number | null> = {};
    for (let z = 1; z <= 9; z++) {
      zoneWoba[z] = hipWobaN[z] >= 3 ? hipWobaSum[z] / hipWobaN[z] : null;
    }

    const overallWoba = overallWobaN >= 5 ? Math.round((overallWobaSum / overallWobaN) * 1000) / 1000 : null;

    const { totalPoints, coveredPitches } = calcZoneDecisionRaw(zoneWoba, swings, pitches);
    const totalZonePitches = Object.values(pitches).reduce((a, b) => a + b, 0);

    // Per-pitch average (removes sample-size bias)
    const rawPerPitch = coveredPitches >= 50 ? totalPoints / coveredPitches : null;

    // OPS+-style scaling: 100 = league avg, each LEAGUE_STDEV raw points = 15 Decision+
    // Then add the OOZ discipline adjustment on top (kept separate to avoid scale mismatch)
    const oozAdj = calcOozAdj(oozSwings, oozTakes);
    const zdPlus = rawPerPitch !== null
      ? Math.round(100 + ((rawPerPitch - LEAGUE_MEAN) / LEAGUE_STDEV) * 15 + oozAdj)
      : null;

    const zones: ZoneContactData[] = [];
    for (let z = 1; z <= 9; z++) {
      const pw = pitches[z]; const sw = swings[z]; const co = contacts[z];
      const n  = hipWobaN[z];  // batted ball count in zone
      zones.push({
        zone:       z,
        pitches:    pw,
        swings:     sw,
        contacts:   co,
        swingPct:   pw >= 5 ? Math.round((sw / pw) * 1000) / 10 : null,
        contactPct: sw >= 5 ? Math.round((co / sw) * 1000) / 10 : null,
        xwoba:      n  >= 1 ? Math.round((hipWobaSum[z] / n) * 1000) / 1000 : null,
        xwobaN:     n,  // batted ball count in zone
      });
    }

    return NextResponse.json(
      {
        zones,
        season,
        zdPlus,
        zdRaw: rawPerPitch !== null ? Math.round(rawPerPitch * 10) / 10 : null,
        xwoba: overallWoba,
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
