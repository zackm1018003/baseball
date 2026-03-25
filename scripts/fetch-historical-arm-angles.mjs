#!/usr/bin/env node
/**
 * fetch-historical-arm-angles.mjs
 *
 * Fetches arm angle data for historical pitcher seasons (2021–2024) from
 * Baseball Savant statcast_search grouped-by-name endpoint, then merges into
 * data/pitchers-historical.json.
 *
 * USAGE:
 *   node scripts/fetch-historical-arm-angles.mjs
 */

import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORICAL_FILE = path.resolve(__dirname, '..', 'data', 'pitchers-historical.json');

const YEARS = [2021, 2022, 2023, 2024];

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/["\ufeff]/g, '').trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

async function fetchArmAnglesForYear(year) {
  console.log(`  Fetching arm angles for ${year}...`);
  // No pitch type filter — arm angle is per pitcher (not per pitch type), and filtering
  // to FF would exclude pitchers who rarely throw 4-seamers (cutters, sinkers, etc.)
  const url = `https://baseballsavant.mlb.com/statcast_search/csv?hfSea=${year}%7C&hfGT=R%7CST%7C&player_type=pitcher&min_pitches=50&group_by=name&csv=true`;
  const res = await httpsGet(url);
  if (res.statusCode !== 200 || res.body.length < 200) {
    console.log(`    Failed (${res.statusCode})`);
    return {};
  }
  const rows = parseCSV(res.body);
  const byId = {};
  let count = 0;
  for (const row of rows) {
    const id = parseInt(row['player_id']);
    const aa = parseFloat(row['arm_angle']);
    if (!id || isNaN(aa)) continue;
    byId[id] = Math.round(aa * 10) / 10;
    count++;
  }
  console.log(`    Got arm angles for ${count} pitchers`);
  return byId;
}

async function main() {
  const historical = JSON.parse(fs.readFileSync(HISTORICAL_FILE, 'utf8'));

  // Fetch arm angles for each year
  const armAnglesByYear = {};
  for (const year of YEARS) {
    armAnglesByYear[year] = await fetchArmAnglesForYear(year);
    await sleep(800);
  }

  // Merge into historical data
  let updated = 0;
  let missing = 0;
  for (const pitcher of historical) {
    const year = pitcher.year;
    const id = pitcher.player_id;
    if (!year || !id) continue;
    const aa = armAnglesByYear[year]?.[id];
    if (aa !== undefined) {
      pitcher.arm_angle = aa;
      updated++;
    } else {
      missing++;
    }
  }

  console.log(`\nUpdated: ${updated}, Missing: ${missing}`);
  fs.writeFileSync(HISTORICAL_FILE, JSON.stringify(historical, null, 2));
  console.log(`Written to ${HISTORICAL_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
