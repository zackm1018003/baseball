#!/usr/bin/env node

/**
 * scrape-pitchers.js
 *
 * Reads pitcher-input.json and fetches full Statcast data from Baseball Savant.
 *
 * USAGE:
 *   node scripts/scrape-pitchers.js
 *
 * INPUT (data/pitcher-input.json):
 *   [
 *     { "name": "Paul Skenes" },
 *     { "name": "Tarik Skubal", "team": "DET" },
 *     { "name": "Some Guy", "player_id": 123456 }
 *   ]
 *
 * The script will:
 *   1. Look up the MLB player ID (if not provided) via statsapi.mlb.com
 *   2. Fetch Statcast pitch-level data from Baseball Savant
 *   3. Aggregate into per-pitch-type stats (velo, spin, movement, usage, VAA)
 *   4. Fetch traditional stats (ERA, WHIP, K/9, BB/9, IP, W/L/SV) from MLB Stats API
 *   5. Merge into data/pitchers.json (updates existing or adds new)
 *   6. Clears pitcher-input.json when done
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const INPUT_FILE = path.join(__dirname, '..', 'data', 'pitcher-input.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'pitchers.json');

// ─── HTTP helpers ───────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Step 1: Resolve player ID from name ────────────────────

async function resolvePlayerId(name) {
  const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}&sportIds=1`;
  const res = await httpsGet(url);
  const json = JSON.parse(res.body);

  if (!json.people || json.people.length === 0) {
    // Try broader search (include minors)
    const url2 = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}`;
    const res2 = await httpsGet(url2);
    const json2 = JSON.parse(res2.body);
    if (!json2.people || json2.people.length === 0) return null;
    // Prefer active pitchers
    const pitcher = json2.people.find(p => p.primaryPosition?.abbreviation === 'P') || json2.people[0];
    return pitcher;
  }

  // Prefer pitchers
  const pitcher = json.people.find(p => p.primaryPosition?.abbreviation === 'P') || json.people[0];
  return pitcher;
}

// ─── Step 2: Fetch Statcast CSV from Baseball Savant ────────

async function fetchStatcastData(playerId, season = 2025) {
  const url = `https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details&player_id=${playerId}&player_type=pitcher&season=${season}`;
  console.log(`    Fetching Statcast CSV for player ${playerId}, season ${season}...`);
  const res = await httpsGet(url);

  if (res.statusCode !== 200) {
    console.log(`    Warning: Got status ${res.statusCode}, trying ${season - 1}...`);
    // Try previous season
    const url2 = `https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details&player_id=${playerId}&player_type=pitcher&season=${season - 1}`;
    const res2 = await httpsGet(url2);
    if (res2.statusCode !== 200) return null;
    return { csv: res2.body, season: season - 1 };
  }

  return { csv: res.body, season };
}

function parseCSV(csvString) {
  const lines = csvString.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Handle CSV with quoted fields
    const values = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue; }
      current += char;
    }
    values.push(current.trim());

    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }

  return rows;
}

// ─── Step 3: Aggregate pitch-level data ─────────────────────

// Map Statcast pitch types to our categories
const PITCH_TYPE_MAP = {
  'FF': 'fastball',    // 4-Seam Fastball
  'SI': 'sinker',      // Sinker
  'FC': 'cutter',      // Cutter
  'SL': 'slider',      // Slider
  'ST': 'slider',      // Sweeper → slider bucket
  'SV': 'slider',      // Slurve → slider bucket
  'CH': 'changeup',    // Changeup
  'FS': 'changeup',    // Splitter → changeup bucket
  'CU': 'curveball',   // Curveball
  'KC': 'curveball',   // Knuckle Curve → curveball bucket
  'CS': 'curveball',   // Slow Curve → curveball bucket
  'KN': null,          // Knuckleball (skip)
  'EP': null,          // Eephus (skip)
};

function aggregateStatcast(rows) {
  const totalPitches = rows.length;
  if (totalPitches === 0) return null;

  // Group by our pitch categories
  const groups = {};

  rows.forEach(row => {
    const rawType = row.pitch_type;
    const mapped = PITCH_TYPE_MAP[rawType];
    if (mapped === null || mapped === undefined) return; // skip unknown/knuckleball

    if (!groups[mapped]) {
      groups[mapped] = { velos: [], spins: [], hBreaks: [], vBreaks: [], vaas: [], count: 0, relHeights: [], extensions: [] };
    }

    const g = groups[mapped];
    g.count++;

    const velo = parseFloat(row.release_speed);
    if (!isNaN(velo)) g.velos.push(velo);

    const spin = parseFloat(row.release_spin_rate);
    if (!isNaN(spin)) g.spins.push(spin);

    // pfx_x = horizontal movement (inches), pfx_z = induced vertical break (inches)
    const hBreak = parseFloat(row.pfx_x);
    if (!isNaN(hBreak)) g.hBreaks.push(hBreak * 12); // feet to inches

    const vBreak = parseFloat(row.pfx_z);
    if (!isNaN(vBreak)) g.vBreaks.push(vBreak * 12); // feet to inches

    // Release point
    const relHeight = parseFloat(row.release_pos_z);
    if (!isNaN(relHeight)) g.relHeights.push(relHeight);

    const ext = parseFloat(row.release_extension);
    if (!isNaN(ext)) g.extensions.push(ext);

    // Calculate VAA from available data
    // VAA ≈ atan2(vz0, vy0) in degrees (approximate)
    const vz0 = parseFloat(row.vz0);
    const vy0 = parseFloat(row.vy0);
    if (!isNaN(vz0) && !isNaN(vy0) && vy0 !== 0) {
      const vaa = Math.atan2(vz0, Math.abs(vy0)) * (180 / Math.PI);
      g.vaas.push(vaa);
    }
  });

  const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : undefined;
  const round1 = v => v !== undefined ? Math.round(v * 10) / 10 : undefined;
  const round2 = v => v !== undefined ? Math.round(v * 100) / 100 : undefined;

  const result = {};
  const countedPitches = Object.values(groups).reduce((s, g) => s + g.count, 0);

  for (const [type, g] of Object.entries(groups)) {
    const usage = (g.count / countedPitches) * 100;
    if (usage < 1) continue; // Skip pitches used less than 1%

    result[`${type}_velo`] = round1(avg(g.velos));
    result[`${type}_spin`] = Math.round(avg(g.spins) || 0) || undefined;
    result[`${type}_movement_h`] = round1(avg(g.hBreaks));
    result[`${type}_movement_v`] = round1(avg(g.vBreaks));
    result[`${type}_usage`] = round1(usage);
    result[`${type}_vaa`] = round2(avg(g.vaas));
  }

  // Release height and extension (averaged across all pitches)
  const allRelHeights = Object.values(groups).flatMap(g => g.relHeights);
  const allExtensions = Object.values(groups).flatMap(g => g.extensions);
  result.release_height = round2(avg(allRelHeights));
  result.extension = round2(avg(allExtensions));

  return result;
}

// ─── Step 4: Fetch traditional stats from MLB Stats API ─────

async function fetchTraditionalStats(playerId, season = 2025) {
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&season=${season}&group=pitching`;
  const res = await httpsGet(url);
  const json = JSON.parse(res.body);

  const splits = json?.stats?.[0]?.splits;
  if (!splits || splits.length === 0) {
    // Try previous season
    const url2 = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&season=${season - 1}&group=pitching`;
    const res2 = await httpsGet(url2);
    const json2 = JSON.parse(res2.body);
    const splits2 = json2?.stats?.[0]?.splits;
    if (!splits2 || splits2.length === 0) return {};
    return parseTraditionalStats(splits2);
  }

  return parseTraditionalStats(splits);
}

function parseTraditionalStats(splits) {
  // Sum across all splits (in case of mid-season trade)
  let totalIP = 0, totalER = 0, totalH = 0, totalBB = 0, totalK = 0;
  let totalW = 0, totalL = 0, totalSV = 0;

  splits.forEach(split => {
    const s = split.stat;
    const ip = parseFloat(s.inningsPitched) || 0;
    totalIP += ip;
    totalER += s.earnedRuns || 0;
    totalH += s.hits || 0;
    totalBB += s.baseOnBalls || 0;
    totalK += s.strikeOuts || 0;
    totalW += s.wins || 0;
    totalL += s.losses || 0;
    totalSV += s.saves || 0;
  });

  if (totalIP === 0) return {};

  return {
    era: Math.round((totalER / totalIP * 9) * 100) / 100,
    whip: Math.round(((totalH + totalBB) / totalIP) * 100) / 100,
    k_per_9: Math.round((totalK / totalIP * 9) * 10) / 10,
    bb_per_9: Math.round((totalBB / totalIP * 9) * 10) / 10,
    ip: Math.round(totalIP * 10) / 10,
    wins: totalW,
    losses: totalL,
    saves: totalSV,
  };
}

// ─── Step 5: Fetch player bio info ──────────────────────────

async function fetchPlayerBio(playerId) {
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}`;
  const res = await httpsGet(url);
  const json = JSON.parse(res.body);
  const p = json?.people?.[0];
  if (!p) return {};

  return {
    age: p.currentAge,
    throws: p.pitchHand?.code,
    team: p.currentTeam?.abbreviation || null,
  };
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  // Read input
  if (!fs.existsSync(INPUT_FILE)) {
    console.error('No pitcher-input.json found. Create it at data/pitcher-input.json');
    process.exit(1);
  }

  const input = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const pitchers = input.filter(p => p.name); // skip comment-only entries

  if (pitchers.length === 0) {
    console.log('No pitchers to process. Add entries to data/pitcher-input.json');
    return;
  }

  console.log(`\n=== Processing ${pitchers.length} pitcher(s) ===\n`);

  // Read existing database
  let existing = [];
  if (fs.existsSync(OUTPUT_FILE)) {
    existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  }

  const results = [];

  for (let i = 0; i < pitchers.length; i++) {
    const entry = pitchers[i];
    console.log(`[${i + 1}/${pitchers.length}] ${entry.name}`);

    try {
      // Step 1: Resolve player ID
      let playerId = entry.player_id;
      let playerInfo = null;

      if (!playerId) {
        console.log('  Looking up player ID...');
        playerInfo = await resolvePlayerId(entry.name);
        if (!playerInfo) {
          console.log(`  ✗ Could not find player: ${entry.name}`);
          continue;
        }
        playerId = playerInfo.id;
        console.log(`  Found: ${playerInfo.fullName} (ID: ${playerId})`);
      }

      await sleep(500);

      // Step 2: Fetch bio
      console.log('  Fetching bio...');
      const bio = await fetchPlayerBio(playerId);
      await sleep(300);

      // Step 3: Fetch Statcast data
      console.log('  Fetching Statcast data...');
      const statcastResult = await fetchStatcastData(playerId);

      let pitchData = {};
      if (statcastResult && statcastResult.csv) {
        const rows = parseCSV(statcastResult.csv);
        console.log(`  Parsed ${rows.length} pitches (${statcastResult.season} season)`);
        pitchData = aggregateStatcast(rows) || {};
      } else {
        console.log('  Warning: No Statcast data found');
      }

      await sleep(500);

      // Step 4: Fetch traditional stats
      console.log('  Fetching traditional stats...');
      const tradStats = await fetchTraditionalStats(playerId);

      // Build final pitcher object
      const pitcher = {
        full_name: playerInfo?.fullName || entry.name,
        player_id: playerId,
        team: entry.team || bio.team || null,
        age: bio.age,
        throws: bio.throws,
        ...pitchData,
        ...tradStats,
      };

      console.log(`  ✓ Done — ${Object.keys(pitchData).length} pitch fields, ERA: ${tradStats.era ?? '—'}\n`);
      results.push(pitcher);

      await sleep(1000); // Rate limit between players

    } catch (err) {
      console.error(`  ✗ Error processing ${entry.name}: ${err.message}\n`);
    }
  }

  // Merge into existing database
  let added = 0, updated = 0;

  results.forEach(newP => {
    const idx = existing.findIndex(p =>
      p.player_id === newP.player_id ||
      p.full_name.toLowerCase() === newP.full_name.toLowerCase()
    );

    if (idx >= 0) {
      // Update existing — merge, preferring new data
      existing[idx] = { ...existing[idx], ...newP };
      updated++;
      console.log(`Updated: ${newP.full_name}`);
    } else {
      existing.push(newP);
      added++;
      console.log(`Added: ${newP.full_name}`);
    }
  });

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
  console.log(`\n=== Summary ===`);
  console.log(`Added: ${added}, Updated: ${updated}`);
  console.log(`Total pitchers in database: ${existing.length}`);
  console.log(`Output: ${OUTPUT_FILE}`);

  // Clear input file
  fs.writeFileSync(INPUT_FILE, '[\n\n]\n');
  console.log(`Cleared: ${INPUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
