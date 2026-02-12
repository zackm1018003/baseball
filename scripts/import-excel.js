#!/usr/bin/env node

/**
 * import-excel.js
 *
 * Imports pitcher data from a TSV file (copy-pasted from Excel) into pitchers.json.
 *
 * USAGE:
 *   1. Open data/pitcher-import.tsv
 *   2. Copy rows from your Excel spreadsheet and paste below the header row
 *   3. Run: node scripts/import-excel.js
 *
 * The script will:
 *   - Parse the TSV data
 *   - Map each pitch type's columns into structured per-pitch data
 *   - Also populate legacy flat fields for backward compatibility
 *   - Merge into data/pitchers.json (update existing by player_id, or add new)
 *   - Clear the TSV file (keep header only) when done
 */

const fs = require('fs');
const path = require('path');

const TSV_FILE = path.join(__dirname, '..', 'data', 'pitcher-import.tsv');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'pitchers.json');

// All pitch type codes from the spreadsheet
const PITCH_TYPES = ['FF', 'SI', 'FC', 'CH', 'FS', 'FO', 'CU', 'KC', 'SL', 'ST', 'SV'];

// Per-pitch-type columns in the spreadsheet (after the type prefix)
const PITCH_COLS = ['vRel', 'hRel', 'Whiff', 'Zone%', 'Spin%', 'Spin Rate', 'Velo', 'Ext', 'xwOBA'];

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

    const vRel = parseNum(row[`${type} vRel`]);
    const hRel = parseNum(row[`${type} hRel`]);
    const whiff = parseNum(row[`${type} Whiff`]);
    const zonePct = parseNum(row[`${type} Zone%`]);
    const spinPct = parseNum(row[`${type} Spin%`]);
    const spinRate = parseNum(row[`${type} Spin Rate`]);
    const velo = parseNum(row[`${type} Velo`]);
    const ext = parseNum(row[`${type} Ext`]);
    const xwoba = parseNum(row[`${type} xwOBA`]);

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
  if (!fs.existsSync(TSV_FILE)) {
    console.error('No pitcher-import.tsv found. Create it at data/pitcher-import.tsv');
    process.exit(1);
  }

  const content = fs.readFileSync(TSV_FILE, 'utf8');
  const rows = parseTSV(content);

  if (rows.length === 0) {
    console.log('No data rows found in pitcher-import.tsv. Paste your Excel data below the header row.');
    return;
  }

  console.log(`\n=== Importing ${rows.length} pitcher(s) from Excel ===\n`);

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

  // Clear TSV (keep header only)
  const header = content.split('\n')[0];
  fs.writeFileSync(TSV_FILE, header + '\n');
  console.log(`Cleared data rows from: ${TSV_FILE}`);
}

main();
