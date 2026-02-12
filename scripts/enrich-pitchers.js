#!/usr/bin/env node

/**
 * enrich-pitchers.js
 *
 * Enriches pitchers.json with data from Baseball Savant leaderboard APIs + MLB Stats API.
 *
 * Uses BULK leaderboard downloads (a handful of CSVs for all pitchers at once)
 * instead of per-pitcher Statcast CSV queries which return cached/incorrect data.
 *
 * USAGE:
 *   node scripts/enrich-pitchers.js
 *
 * What it fills in:
 *   - IVB (induced vertical break) per pitch type
 *   - HB (horizontal break) per pitch type
 *   - Usage % per pitch type
 *   - Traditional stats: ERA, WHIP, K/9, BB/9, IP, W/L/SV
 *   - Bio: age, throws, team
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'pitchers.json');
const SEASON = 2025;

// Pitch types in the leaderboard CSVs
const PITCH_CODES = ['ff', 'si', 'fc', 'sl', 'ch', 'cu', 'fs', 'kn', 'st', 'sv'];

// ─── HTTP helper ─────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── CSV parser ──────────────────────────────────────────

function parseLeaderboardCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return {};

  const headers = lines[0].split(',').map(h => h.replace(/["\ufeff]/g, '').trim());
  const pitcherIdx = headers.indexOf('pitcher');

  const byPlayer = {};
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
    const playerId = parseInt(vals[pitcherIdx]);
    if (!playerId) continue;

    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
    byPlayer[playerId] = row;
  }
  return byPlayer;
}

// ─── Fetch all leaderboard data ──────────────────────────

async function fetchLeaderboards() {
  // Note: pitch-arsenals CSV only returns data for avg_speed and avg_spin.
  // The other types (pitch_usage, movement, whiff) return empty columns.
  // We get usage, IVB, HB from the pitch-movement leaderboard instead.
  const types = {
    avg_speed: 'velo',
    avg_spin: 'spin',
  };

  const allData = {};
  const bioData = {}; // team + throws from pitch-movement

  for (const [apiType, fieldName] of Object.entries(types)) {
    const url = `https://baseballsavant.mlb.com/leaderboard/pitch-arsenals?type=${apiType}&year=${SEASON}&team=&min=10&csv=true`;
    console.log(`Fetching ${apiType}...`);
    const res = await httpsGet(url);

    if (res.statusCode !== 200 || res.body.length < 100) {
      console.log(`  Warning: Failed to fetch ${apiType}`);
      continue;
    }

    const byPlayer = parseLeaderboardCSV(res.body);
    const playerCount = Object.keys(byPlayer).length;
    console.log(`  Got ${playerCount} pitchers`);

    for (const [playerId, row] of Object.entries(byPlayer)) {
      if (!allData[playerId]) allData[playerId] = {};

      for (const code of PITCH_CODES) {
        const colName = `${code}_${apiType}`;
        const val = parseFloat(row[colName]);
        if (isNaN(val)) continue;

        if (!allData[playerId][code]) allData[playerId][code] = {};
        allData[playerId][code][fieldName] = Math.round(val * 10) / 10;
      }
    }

    await sleep(500);
  }

  // Fetch pitch-movement leaderboard for IVB, HB, usage%, team, throws
  const pitchTypes = ['FF', 'SI', 'FC', 'SL', 'CH', 'CU', 'FS', 'ST', 'SV', 'KC'];
  for (const pt of pitchTypes) {
    const url = `https://baseballsavant.mlb.com/leaderboard/pitch-movement?year=${SEASON}&team=&pitch_type=${pt}&min=10&csv=true`;
    console.log(`Fetching ${pt} movement details...`);
    const res = await httpsGet(url);

    if (res.statusCode !== 200 || res.body.length < 100) {
      console.log(`  Skipped (no data)`);
      continue;
    }

    const lines = res.body.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/["\ufeff]/g, '').trim());
    const idIdx = headers.indexOf('pitcher_id');
    const ivbIdx = headers.indexOf('pitcher_break_z_induced');
    const hbIdx = headers.indexOf('pitcher_break_x');
    const usageIdx = headers.indexOf('pitch_per');
    const teamIdx = headers.indexOf('team_name_abbrev');
    const handIdx = headers.indexOf('pitch_hand');

    const code = pt.toLowerCase();
    let count = 0;

    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
      const playerId = vals[idIdx];
      if (!playerId) continue;

      if (!allData[playerId]) allData[playerId] = {};
      if (!allData[playerId][code]) allData[playerId][code] = {};

      const ivb = parseFloat(vals[ivbIdx]);
      const hb = parseFloat(vals[hbIdx]);
      const usage = parseFloat(vals[usageIdx]);

      if (!isNaN(ivb)) allData[playerId][code].movement_v = Math.round(ivb * 10) / 10;
      if (!isNaN(hb)) allData[playerId][code].movement_h = Math.round(hb * 10) / 10;
      if (!isNaN(usage)) allData[playerId][code].usage = Math.round(usage * 1000) / 10;

      // Extract bio data (team, throws) from any pitch type row
      if (!bioData[playerId]) {
        const team = vals[teamIdx];
        const hand = vals[handIdx];
        if (team || hand) bioData[playerId] = { team, throws: hand };
      }

      count++;
    }

    console.log(`  Got ${count} pitchers`);
    await sleep(300);
  }

  return { allData, bioData };
}

// ─── Fetch traditional stats from MLB Stats API ──────────

async function fetchStats(playerId) {
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&season=${SEASON}&group=pitching`;
  const res = await httpsGet(url);
  const json = JSON.parse(res.body);
  let splits = json?.stats?.[0]?.splits;

  if (!splits?.length) {
    const url2 = url.replace(`season=${SEASON}`, `season=${SEASON - 1}`);
    const res2 = await httpsGet(url2);
    const json2 = JSON.parse(res2.body);
    splits = json2?.stats?.[0]?.splits;
    if (!splits?.length) return {};
  }

  let ip = 0, er = 0, h = 0, bb = 0, k = 0, w = 0, l = 0, sv = 0;
  splits.forEach(s => {
    const st = s.stat;
    ip += parseFloat(st.inningsPitched) || 0;
    er += st.earnedRuns || 0;
    h += st.hits || 0;
    bb += st.baseOnBalls || 0;
    k += st.strikeOuts || 0;
    w += st.wins || 0;
    l += st.losses || 0;
    sv += st.saves || 0;
  });

  if (!ip) return {};
  return {
    era: Math.round((er / ip * 9) * 100) / 100,
    whip: Math.round(((h + bb) / ip) * 100) / 100,
    k_per_9: Math.round((k / ip * 9) * 10) / 10,
    bb_per_9: Math.round((bb / ip * 9) * 10) / 10,
    ip: Math.round(ip * 10) / 10,
    wins: w, losses: l, saves: sv,
  };
}

// ─── Fetch bio ───────────────────────────────────────────

async function fetchBio(playerId) {
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

// ─── Main ────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(OUTPUT_FILE)) {
    console.error('pitchers.json not found. Run import-excel.js first.');
    process.exit(1);
  }

  const pitchers = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  console.log(`\nLoaded ${pitchers.length} pitchers.\n`);

  // Step 1: Bulk fetch leaderboard data (fast — ~12 requests total)
  console.log('=== Step 1: Fetching Savant leaderboard data (bulk) ===\n');
  const { allData: leaderboardData, bioData } = await fetchLeaderboards();
  const leaderboardPlayers = Object.keys(leaderboardData).length;
  console.log(`\nGot leaderboard data for ${leaderboardPlayers} pitchers.`);
  console.log(`Got bio data for ${Object.keys(bioData).length} pitchers.\n`);

  // Step 2: Merge leaderboard data into pitchers
  console.log('=== Step 2: Merging leaderboard data ===\n');
  let mergedCount = 0;

  pitchers.forEach(pitcher => {
    const id = pitcher.player_id;
    if (!id) return;

    // Merge bio from pitch-movement leaderboard
    const bio = bioData[id];
    if (bio) {
      if (bio.team && !pitcher.team) pitcher.team = bio.team;
      if (bio.throws && !pitcher.throws) pitcher.throws = bio.throws;
    }

    const ld = leaderboardData[id];
    if (!ld) return;

    for (const [code, data] of Object.entries(ld)) {
      if (!pitcher[code]) pitcher[code] = {};

      // Only fill in missing fields — don't overwrite Excel data
      for (const [field, value] of Object.entries(data)) {
        if (pitcher[code][field] === undefined) {
          pitcher[code][field] = value;
        }
      }

      // Also set legacy fields
      const legacyMap = {
        ff: 'fastball', si: 'sinker', fc: 'cutter', ch: 'changeup',
        fs: 'splitter', cu: 'curveball', kc: 'knuckle_curve',
        sl: 'slider', st: 'sweeper', sv: 'slurve',
      };
      const legacy = legacyMap[code];
      if (legacy) {
        if (data.movement_h !== undefined && pitcher[`${legacy}_movement_h`] === undefined) pitcher[`${legacy}_movement_h`] = data.movement_h;
        if (data.movement_v !== undefined && pitcher[`${legacy}_movement_v`] === undefined) pitcher[`${legacy}_movement_v`] = data.movement_v;
        if (data.usage !== undefined && pitcher[`${legacy}_usage`] === undefined) pitcher[`${legacy}_usage`] = data.usage;
      }
    }

    mergedCount++;
  });

  console.log(`Merged leaderboard data for ${mergedCount} pitchers.\n`);

  // Step 3: Fetch age + traditional stats from MLB Stats API
  // (team and throws already come from pitch-movement leaderboard)
  console.log('=== Step 3: Fetching age + traditional stats ===\n');
  let bioCount = 0, statsCount = 0;

  for (let i = 0; i < pitchers.length; i++) {
    const pitcher = pitchers[i];
    if (!pitcher.player_id) continue;

    const needsBio = !pitcher.age || !pitcher.throws || !pitcher.team;
    const needsStats = pitcher.era === undefined;

    if (!needsBio && !needsStats) continue;

    try {
      if (needsBio) {
        const bio = await fetchBio(pitcher.player_id);
        if (bio.age && !pitcher.age) pitcher.age = bio.age;
        if (bio.throws && !pitcher.throws) pitcher.throws = bio.throws;
        if (bio.team && !pitcher.team) pitcher.team = bio.team;
        bioCount++;
        await sleep(100);
      }

      if (needsStats) {
        const stats = await fetchStats(pitcher.player_id);
        if (stats.era !== undefined) {
          Object.assign(pitcher, stats);
          statsCount++;
        }
        await sleep(100);
      }

      // Set release_height/extension from FF if not set
      if (pitcher.ff?.vrel && !pitcher.release_height) pitcher.release_height = pitcher.ff.vrel;
      if (pitcher.ff?.ext && !pitcher.extension) pitcher.extension = pitcher.ff.ext;

      // Progress
      if ((bioCount + statsCount) % 50 === 0 && (bioCount + statsCount) > 0) {
        console.log(`  Progress: ${bioCount} bios, ${statsCount} stat lines fetched...`);
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(pitchers, null, 2));
      }

    } catch (err) {
      // Skip on error
    }
  }

  // Final save
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(pitchers, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`Leaderboard data merged: ${mergedCount} pitchers`);
  console.log(`Bios fetched: ${bioCount}`);
  console.log(`Stats fetched: ${statsCount}`);
  console.log(`Total pitchers: ${pitchers.length}`);
  console.log(`Output: ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
