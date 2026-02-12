#!/usr/bin/env node

/**
 * import-excel.js
 *
 * Imports pitcher data from a tab-separated file into pitchers.json.
 *
 * USAGE:
 *   1. Create a file called "pitcher-data" in the repo root
 *   2. Paste your Excel data into it (header row + data rows)
 *   3. Run: node scripts/import-excel.js
 *
 *   You can also specify a custom file:
 *     node scripts/import-excel.js my-file-name
 *
 * The script will:
 *   - Parse the tab-separated data (auto-detects columns from the header)
 *   - Map each pitch type's columns into structured per-pitch data
 *   - Also populate legacy flat fields for backward compatibility
 *   - Merge into data/pitchers.json (update existing by player_id, or add new)
 */

const fs = require('fs');
const path = require('path');

// Default input file, or pass a custom one as argument
const INPUT_NAME = process.argv[2] || 'pitcher-data';
const INPUT_FILE = path.join(__dirname, '..', INPUT_NAME);
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'pitchers.json');

// All pitch type codes from the spreadsheet
const PITCH_TYPES = ['FF', 'SI', 'FC', 'CH', 'FS', 'FO', 'CU', 'KC', 'SL', 'ST', 'SV'];

// Map pitch type codes to our JSON key names
const PITCH_KEY_MAP = {
  'FF': 'ff', 'SI': 'si', 'FC': 'fc', 'CH': 'ch', 'FS': 'fs',
  'FO': 'fo', 'CU': 'cu', 'KC': 'kc', 'SL': 'sl', 'ST': 'st', 'SV': 'sv',
};

// Map pitch type codes to legacy field prefixes
const LEGACY_MAP = {
  'FF': 'fastball',
  'SI': 'sinker',
  'FC': 'cutter',
  'CH': 'changeup',
  'FS': 'splitter',
  'FO': 'forkball',
  'CU': 'curveball',
  'KC': 'knuckle_curve',
  'SL': 'slider',
  'ST': 'sweeper',
  'SV': 'slurve',
};

function parseNum(val) {
  if (!val || val === '' || val === '#N/A' || val === 'N/A' || val === '-' || val === '—') return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}

function parseTSV(content) {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split('\t').map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split('\t');
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx]?.trim() || '';
    });
    rows.push(row);
  }

  return rows;
}

function rowToPitcher(row) {
  const playerId = parseNum(row['player_id']);
  const name = row['Name'] || row['player_name'] || '';

  if (!name) return null;

  const pitcher = {
    full_name: name,
    player_id: playerId ? Math.round(playerId) : undefined,
    team: null,  // Will be filled from MLB API or existing data
    arm_angle: parseNum(row['Arm Angle']),
    strike_pct: parseNum(row['Strike%']),
  };

  // Parse each pitch type
  PITCH_TYPES.forEach(type => {
    const key = PITCH_KEY_MAP[type];
    const legacyPrefix = LEGACY_MAP[type];

    // Handle column name variations from Excel (e.g. "FC Spinrate" vs "FC Spin Rate", "CH Extension" vs "CH Ext", "St Extension")
    const typeKey = type; // e.g. 'ST'
    const altType = type === 'ST' ? 'St' : type; // Handle "St Extension" typo

    const vRel = parseNum(row[`${typeKey} vRel`]);
    const hRel = parseNum(row[`${typeKey} hRel`]);
    const whiff = parseNum(row[`${typeKey} Whiff`]);
    const zonePct = parseNum(row[`${typeKey} Zone%`]);
    const spinPct = parseNum(row[`${typeKey} Spin%`]);
    const spinRate = parseNum(row[`${typeKey} Spin Rate`] || row[`${typeKey} Spinrate`] || row[`${typeKey} SpinRate`]);
    const velo = parseNum(row[`${typeKey} Velo`]);
    const ext = parseNum(row[`${typeKey} Ext`] || row[`${typeKey} Extension`] || row[`${altType} Extension`]);
    const xwoba = parseNum(row[`${typeKey} xwOBA`]);

    // Only add if we have at least some data for this pitch type
    const hasData = [vRel, hRel, whiff, zonePct, spinPct, spinRate, velo, ext, xwoba].some(v => v !== undefined);
    if (!hasData) return;

    // New structured format
    pitcher[key] = {};
    if (velo !== undefined) pitcher[key].velo = velo;
    if (spinRate !== undefined) pitcher[key].spin = spinRate;
    if (spinPct !== undefined) pitcher[key].spin_pct = spinPct;
    if (vRel !== undefined) pitcher[key].vrel = vRel;
    if (hRel !== undefined) pitcher[key].hrel = hRel;
    if (ext !== undefined) pitcher[key].ext = ext;
    if (whiff !== undefined) pitcher[key].whiff = whiff;
    if (zonePct !== undefined) pitcher[key].zone_pct = zonePct;
    if (xwoba !== undefined) pitcher[key].xwoba = xwoba;

    // Also populate legacy flat fields for backward compat
    if (velo !== undefined) pitcher[`${legacyPrefix}_velo`] = velo;
    if (spinRate !== undefined) pitcher[`${legacyPrefix}_spin`] = spinRate;
  });

  // Set release_height from FF vRel if available (primary fastball release point)
  if (pitcher.ff?.vrel !== undefined) {
    pitcher.release_height = pitcher.ff.vrel;
  }
  // Set extension from FF ext if available
  if (pitcher.ff?.ext !== undefined) {
    pitcher.extension = pitcher.ff.ext;
  }

  return pitcher;
}

function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`File not found: ${INPUT_FILE}`);
    console.error(`\nUsage:`);
    console.error(`  1. Create a file called "pitcher-data" in the repo root`);
    console.error(`  2. Paste your Excel data (with header row) into it`);
    console.error(`  3. Run: node scripts/import-excel.js`);
    console.error(`\n  Or specify a custom file: node scripts/import-excel.js my-file`);
    process.exit(1);
  }

  const content = fs.readFileSync(INPUT_FILE, 'utf8');
  const rows = parseTSV(content);

  if (rows.length === 0) {
    console.log(`No data rows found in ${INPUT_NAME}. Make sure it has a header row + data rows.`);
    return;
  }

  console.log(`\n=== Importing ${rows.length} pitcher(s) from ${INPUT_NAME} ===\n`);

  // Read existing database
  let existing = [];
  if (fs.existsSync(OUTPUT_FILE)) {
    existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  }

  let added = 0, updated = 0, skipped = 0;

  rows.forEach((row, i) => {
    const pitcher = rowToPitcher(row);
    if (!pitcher) {
      console.log(`  [${i + 1}] Skipped — no name`);
      skipped++;
      return;
    }

    // Count pitch types found
    const pitchTypes = PITCH_TYPES.filter(t => pitcher[PITCH_KEY_MAP[t]]);
    console.log(`  [${i + 1}] ${pitcher.full_name} (ID: ${pitcher.player_id || '?'}) — ${pitchTypes.length} pitch types: ${pitchTypes.join(', ')}`);

    // Merge into existing
    const idx = existing.findIndex(p =>
      (pitcher.player_id && p.player_id === pitcher.player_id) ||
      p.full_name?.toLowerCase() === pitcher.full_name.toLowerCase()
    );

    if (idx >= 0) {
      // Deep merge — keep existing fields, add/overwrite with new data
      const merged = { ...existing[idx] };

      // Merge top-level fields
      Object.keys(pitcher).forEach(key => {
        if (pitcher[key] !== undefined && pitcher[key] !== null) {
          if (typeof pitcher[key] === 'object' && !Array.isArray(pitcher[key])) {
            // Merge pitch type objects
            merged[key] = { ...(merged[key] || {}), ...pitcher[key] };
          } else {
            merged[key] = pitcher[key];
          }
        }
      });

      existing[idx] = merged;
      updated++;
    } else {
      existing.push(pitcher);
      added++;
    }
  });

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`Added: ${added}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total pitchers in database: ${existing.length}`);
  console.log(`Output: ${OUTPUT_FILE}`);
}

main();
