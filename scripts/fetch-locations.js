// Fetch pitch-level location data from Statcast (plate_x, plate_z)
// and pre-compute density grids for heatmap visualization.
// Each pitcher/pitch-type gets a 20x25 grid of density values.
// Grid covers x: [-2, 2] feet (plate width + margin) and z: [0, 5] feet (height range).

const https = require('https');
const fs = require('fs');

const SEASON = 2025;

// Grid parameters
const GRID_X_MIN = -2;   // feet from center of plate
const GRID_X_MAX = 2;    // feet from center of plate
const GRID_Z_MIN = 0;    // feet above ground
const GRID_Z_MAX = 5;    // feet above ground
const GRID_COLS = 20;    // horizontal resolution
const GRID_ROWS = 25;    // vertical resolution
const CELL_W = (GRID_X_MAX - GRID_X_MIN) / GRID_COLS;
const CELL_H = (GRID_Z_MAX - GRID_Z_MIN) / GRID_ROWS;

// KDE bandwidth (in feet) - controls smoothing
const BANDWIDTH = 0.35;

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Proper CSV line parser that handles quoted fields with commas
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// Gaussian kernel for KDE
function gaussianKernel(dx, dy, bw) {
  const r2 = (dx * dx + dy * dy) / (bw * bw);
  return Math.exp(-0.5 * r2);
}

// Compute density grid from an array of [plate_x, plate_z] points
function computeDensityGrid(points) {
  if (points.length === 0) return null;

  const grid = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    grid[row] = new Array(GRID_COLS).fill(0);
  }

  // For each grid cell center, sum contributions from all points
  for (let row = 0; row < GRID_ROWS; row++) {
    const cellZ = GRID_Z_MAX - (row + 0.5) * CELL_H; // top row = high z
    for (let col = 0; col < GRID_COLS; col++) {
      const cellX = GRID_X_MIN + (col + 0.5) * CELL_W;
      let density = 0;
      for (const [px, pz] of points) {
        density += gaussianKernel(cellX - px, cellZ - pz, BANDWIDTH);
      }
      grid[row][col] = density;
    }
  }

  // Normalize to 0-1 range
  let maxVal = 0;
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      if (grid[row][col] > maxVal) maxVal = grid[row][col];
    }
  }

  if (maxVal > 0) {
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        // Round to 2 decimal places for compact storage
        grid[row][col] = Math.round((grid[row][col] / maxVal) * 100) / 100;
      }
    }
  }

  return grid;
}

async function fetchPitchTypeLocations(pt) {
  const months = [
    { start: '2025-03-01', end: '2025-04-30' },
    { start: '2025-05-01', end: '2025-06-30' },
    { start: '2025-07-01', end: '2025-08-31' },
    { start: '2025-09-01', end: '2025-10-31' },
  ];

  // pitcherId -> [[plate_x, plate_z], ...]
  const locAccum = {};

  for (const range of months) {
    const url = `https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfPT=${pt}%7C&hfSea=${SEASON}%7C&player_type=pitcher&min_pitches=0&min_results=0&group_by=name-event&sort_col=pitches&sort_order=desc&type=details&game_date_gt=${range.start}&game_date_lt=${range.end}`;

    let res;
    try {
      res = await httpsGet(url);
    } catch (err) {
      console.log(`    Error ${range.start}-${range.end}: ${err.message}`);
      continue;
    }

    if (res.statusCode !== 200) {
      console.log(`    HTTP ${res.statusCode} for ${range.start}-${range.end}`);
      continue;
    }

    if (res.body.length < 200) {
      console.log(`    No data for ${range.start}-${range.end}`);
      continue;
    }

    const lines = res.body.trim().split('\n');
    if (lines.length < 2) continue;

    const headers = parseCSVLine(lines[0]);
    const pitcherIdx = headers.indexOf('pitcher');
    const plateXIdx = headers.indexOf('plate_x');
    const plateZIdx = headers.indexOf('plate_z');

    if (plateXIdx === -1 || plateZIdx === -1) {
      console.log(`    Missing plate_x/plate_z columns`);
      continue;
    }

    let pitchCount = 0;
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const vals = parseCSVLine(lines[i]);
      const pitcherId = vals[pitcherIdx];
      const plateX = parseFloat(vals[plateXIdx]);
      const plateZ = parseFloat(vals[plateZIdx]);

      if (!pitcherId || isNaN(plateX) || isNaN(plateZ)) continue;

      // Filter out extreme outliers
      if (plateX < -4 || plateX > 4 || plateZ < -1 || plateZ > 7) continue;

      if (!locAccum[pitcherId]) locAccum[pitcherId] = [];
      locAccum[pitcherId].push([plateX, plateZ]);
      pitchCount++;
    }

    console.log(`    ${range.start}: ${lines.length - 1} rows, ${pitchCount} locations`);
    await sleep(1000);
  }

  return locAccum;
}

async function main() {
  const pitchTypes = ['FF', 'SI', 'FC', 'SL', 'CH', 'CU', 'FS', 'ST', 'SV', 'KC'];

  // Master: pitcherId -> { ff: [[x,z],...], si: [[x,z],...], ... }
  const masterLocs = {};

  for (const pt of pitchTypes) {
    console.log(`\nFetching ${pt}...`);
    const accum = await fetchPitchTypeLocations(pt);

    const code = pt.toLowerCase();
    for (const [pitcherId, points] of Object.entries(accum)) {
      if (!masterLocs[pitcherId]) masterLocs[pitcherId] = {};
      if (!masterLocs[pitcherId][code]) masterLocs[pitcherId][code] = [];
      masterLocs[pitcherId][code].push(...points);
    }

    const pitcherCount = Object.keys(accum).length;
    console.log(`  ${pt}: ${pitcherCount} pitchers with location data`);
    await sleep(500);
  }

  // Now compute density grids and merge into pitchers.json
  const pitchers = JSON.parse(fs.readFileSync('data/pitchers.json', 'utf8'));
  let updated = 0;
  let totalGrids = 0;

  const codes = ['ff', 'si', 'fc', 'sl', 'ch', 'cu', 'fs', 'st', 'sv', 'kc'];

  pitchers.forEach(p => {
    const id = String(p.player_id);
    const locs = masterLocs[id];
    if (!locs) return;

    codes.forEach(code => {
      const points = locs[code];
      if (!points || points.length < 5) return; // Need at least 5 pitches for meaningful heatmap

      if (!p[code]) p[code] = {};

      const grid = computeDensityGrid(points);
      if (grid) {
        p[code].location_grid = grid;
        p[code].location_count = points.length;
        totalGrids++;
      }
    });
    updated++;
  });

  fs.writeFileSync('data/pitchers.json', JSON.stringify(pitchers, null, 2));
  console.log(`\nUpdated ${updated} pitchers with location grids.`);
  console.log(`Total density grids computed: ${totalGrids}`);

  // Verify known pitchers
  const names = ['Skenes', 'Ashcraft', 'Snell', 'Webb'];
  names.forEach(n => {
    const pitcher = pitchers.find(x => x.full_name && x.full_name.includes(n));
    if (!pitcher) return;
    console.log(`\n${pitcher.full_name}:`);
    codes.forEach(c => {
      if (pitcher[c] && pitcher[c].location_grid) {
        console.log(`  ${c.toUpperCase()}: ${pitcher[c].location_count} pitches, grid computed`);
      }
    });
  });
}

main().catch(console.error);
