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

// Trout+ scoring: each pitch decision is scored on a 0-100 scale.
// Correct decision = high score. Wrong decision = low score.
// Score is the DIFFERENCE from random (50), so good decisions pull the average up.
//
// Zone types: 'strike' (1-9), 'shadow' (11-19), 'chase' (21+)
// Count situations: '3-0', '3-2', '3-1', 'two_strike' (0-2 or 1-2), 'regular'
//
// Design principle: swing at strikes = good (85-100), take balls = good (75-95)
// The SPREAD between good/bad decisions is what separates elite from average.
// Scores are bounded 0-100. Average correct decision ≈ 85, average wrong ≈ 25.
// This gives a raw average of ~70 for a league-average hitter.

function getCountSituation(balls: number, strikes: number): string {
  if (balls === 3 && strikes === 0) return '3-0';
  if (balls === 3 && strikes === 2) return '3-2';
  if (balls === 3 && strikes === 1) return '3-1';
  if (strikes === 2) return 'two_strike';
  return 'regular';
}

// Swing at a strike: good decision, rewarded highly
const SWING_STRIKE_SCORES: Record<string, number> = {
  'regular':    85,
  'two_strike': 90,  // Protecting is critical
  '3-0':        70,  // Taking is often smarter in 3-0
  '3-1':        80,
  '3-2':        90,
};

// Take a strike: bad decision (called strike), penalized
const TAKE_STRIKE_SCORES: Record<string, number> = {
  'regular':    30,
  'two_strike': 10,  // Called strike 3 is terrible
  '3-0':        65,  // Taking in 3-0 is often intentional/fine
  '3-1':        35,
  '3-2':        10,  // Called strike 3 on full count
};

// Swing at shadow (borderline): partially rewarded — borderline pitch, hard read
const SWING_SHADOW_SCORES: Record<string, number> = {
  'regular':    55,
  'two_strike': 70,  // Must protect with 2 strikes
  '3-0':        30,
  '3-1':        50,
  '3-2':        70,
};

// Take shadow: good discipline, especially in hitter's counts
const TAKE_SHADOW_SCORES: Record<string, number> = {
  'regular':    70,
  'two_strike': 55,  // Risky to take borderline with 2 strikes
  '3-0':        85,
  '3-1':        75,
  '3-2':        50,
};

// Swing at chase zone (ball): bad decision, penalized heavily
const SWING_CHASE_SCORES: Record<string, number> = {
  'regular':    15,
  'two_strike': 25,  // Slightly understandable with 2 strikes
  '3-0':         5,
  '3-1':        15,
  '3-2':        30,
};

// Take chase zone (ball): excellent discipline, rewarded
const TAKE_CHASE_SCORES: Record<string, number> = {
  'regular':    90,
  'two_strike': 80,
  '3-0':        95,
  '3-1':        92,
  '3-2':        75,
};

const HOT_ZONE_BONUS = 5; // Small bonus for swinging at a personal hot zone pitch

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
    const zoneIdx = headers.indexOf('zone');
    const descIdx = headers.indexOf('description');
    const xwobaIdx = headers.indexOf('estimated_woba_using_speedangle');
    const ballsIdx = headers.indexOf('balls');
    const strikesIdx = headers.indexOf('strikes');

    if (zoneIdx === -1 || descIdx === -1) {
      return NextResponse.json({ error: 'Could not find required columns' }, { status: 500 });
    }

    // Strike zone (1-9) accumulators
    const pitches: Record<number, number> = {};
    const swings: Record<number, number> = {};
    const contacts: Record<number, number> = {};
    const xwobaSum: Record<number, number> = {};
    const xwobaN: Record<number, number> = {};
    for (let z = 1; z <= 9; z++) {
      pitches[z] = 0; swings[z] = 0; contacts[z] = 0; xwobaSum[z] = 0; xwobaN[z] = 0;
    }

    // Raw pitch rows for Trout+ scoring (second pass after we know hot zones)
    interface PitchRow {
      zone: number;
      isSwing: boolean;
      balls: number;
      strikes: number;
    }
    const pitchRows: PitchRow[] = [];

    // Overall xwOBA accumulator (all zones)
    let overallXwobaSum = 0;
    let overallXwobaN = 0;

    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i]);
      const zone = parseInt(fields[zoneIdx]?.trim() ?? '');
      const desc = fields[descIdx]?.trim() ?? '';
      const xwobaVal = parseFloat(fields[xwobaIdx]?.trim() ?? '');
      const balls = parseInt(fields[ballsIdx]?.trim() ?? '');
      const strikes = parseInt(fields[strikesIdx]?.trim() ?? '');

      const isSwing =
        desc === 'swinging_strike' || desc === 'foul' || desc === 'hit_into_play' ||
        desc === 'foul_tip' || desc === 'swinging_strike_blocked' ||
        desc === 'bunt_foul_tip' || desc === 'missed_bunt';
      const isContact =
        desc === 'foul' || desc === 'hit_into_play' ||
        desc === 'foul_tip' || desc === 'bunt_foul_tip';

      if (zone >= 1 && zone <= 9) {
        pitches[zone]++;
        if (isSwing) { swings[zone]++; if (isContact) contacts[zone]++; }
        if (!isNaN(xwobaVal)) { xwobaSum[zone] += xwobaVal; xwobaN[zone]++; }
      }

      // Track overall xwOBA across all hit-into-play pitches
      if (!isNaN(xwobaVal)) { overallXwobaSum += xwobaVal; overallXwobaN++; }

      // Store pitch row for Trout+ scoring (zones 1-9, 11-19, 21+)
      // If balls/strikes columns are missing, default to 0 (regular count)
      if (!isNaN(zone) && zone >= 1) {
        pitchRows.push({
          zone,
          isSwing,
          balls: isNaN(balls) ? 0 : balls,
          strikes: isNaN(strikes) ? 0 : strikes,
        });
      }
    }

    // Build zone xwOBA map and overall xwOBA
    const zoneXwoba: Record<number, number | null> = {};
    for (let z = 1; z <= 9; z++) {
      zoneXwoba[z] = xwobaN[z] >= 5 ? xwobaSum[z] / xwobaN[z] : null;
    }
    const overallXwoba = overallXwobaN >= 10 ? overallXwobaSum / overallXwobaN : null;

    // Identify hot zones: zone xwOBA >= overall xwOBA + 0.030 (and zone must have ≥5 xwOBA samples)
    const hotZones = new Set<number>();
    if (overallXwoba !== null) {
      for (let z = 1; z <= 9; z++) {
        const zx = zoneXwoba[z];
        if (zx !== null && zx >= overallXwoba + 0.030) {
          hotZones.add(z);
        }
      }
    }

    // Compute Trout+ raw score
    let troutScoreSum = 0;
    let troutScoreCount = 0;

    for (const pitch of pitchRows) {
      const { zone, isSwing, balls, strikes } = pitch;
      const count = getCountSituation(balls, strikes);

      let score: number;
      let zoneType: 'strike' | 'shadow' | 'chase';

      if (zone >= 1 && zone <= 9) {
        zoneType = 'strike';
        const isHot = hotZones.has(zone);
        if (isSwing) {
          score = SWING_STRIKE_SCORES[count] + (isHot ? HOT_ZONE_BONUS : 0);
        } else {
          score = TAKE_STRIKE_SCORES[count];
        }
      } else if (zone >= 11 && zone <= 19) {
        zoneType = 'shadow';
        if (isSwing) {
          score = SWING_SHADOW_SCORES[count];
        } else {
          score = TAKE_SHADOW_SCORES[count];
        }
      } else {
        // Chase zone: 21+
        zoneType = 'chase';
        if (isSwing) {
          score = SWING_CHASE_SCORES[count];
        } else {
          score = TAKE_CHASE_SCORES[count];
        }
      }

      troutScoreSum += score;
      troutScoreCount++;
      void zoneType;
    }

    // Raw score = average points per pitch
    const troutRaw = troutScoreCount >= 10 ? troutScoreSum / troutScoreCount : null;

    // Standardize to mean=100, stdev=10
    // Calibrated from scoring table estimates:
    //   League avg hitter (chase%~29, z-swing%~68): raw ≈ 66.8 → 100
    //   Judge (chase%~17, z-swing%~70): raw ≈ 72.1 → 126.4
    // LEAGUE_STDEV = (72.1 - 66.8) / 2.64 ≈ 2.0
    const LEAGUE_MEAN = 66.8;
    const LEAGUE_STDEV = 2.0;
    const troutPlus = troutRaw !== null
      ? Math.round(100 + ((troutRaw - LEAGUE_MEAN) / LEAGUE_STDEV) * 10)
      : null;

    // Build zone output (zones 1-9)
    const zones: ZoneContactData[] = [];
    for (let z = 1; z <= 9; z++) {
      const pw = pitches[z]; const sw = swings[z]; const co = contacts[z];
      const n = xwobaN[z];
      zones.push({
        zone: z,
        pitches: pw,
        swings: sw,
        contacts: co,
        swingPct: pw >= 5 ? Math.round((sw / pw) * 1000) / 10 : null,
        contactPct: sw >= 5 ? Math.round((co / sw) * 1000) / 10 : null,
        xwoba: n >= 5 ? Math.round((xwobaSum[z] / n) * 1000) / 1000 : null,
        xwobaN: n,
      });
    }

    return NextResponse.json(
      { zones, season, troutPlus, troutRaw: troutRaw !== null ? Math.round(troutRaw * 10) / 10 : null, hotZones: [...hotZones], pitchCount: troutScoreCount },
      { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } }
    );
  } catch (err) {
    console.error('Zone contact fetch error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
