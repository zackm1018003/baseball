#!/usr/bin/env node
/**
 * fetch-pitchers-historical.mjs
 *
 * Downloads MLB pitcher pitch-type metrics from Baseball Savant for
 * historical seasons and writes data/pitchers-historical.json.
 *
 * Each entry has the same shape as pitchers.json but with a `year` field.
 * Only populates: player_id, full_name, team, throws, year, ff/si/fc/sl/ch/cu/fs/st/sv/kc
 * (velo, movement_v, movement_h, usage per pitch type).
 * vrel/hrel are NOT included — those require per-pitcher Statcast queries.
 *
 * USAGE:
 *   node scripts/fetch-pitchers-historical.mjs
 *   node scripts/fetch-pitchers-historical.mjs --years 2022,2023,2024
 */

import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'pitchers-historical.json');

const args = process.argv.slice(2);
const yearsArg = args.find(a => a.startsWith('--years=') || args[args.indexOf('--years') + 1]);
const YEARS = yearsArg
  ? (yearsArg.replace('--years=', '') || args[args.indexOf('--years') + 1]).split(',').map(Number)
  : [2021, 2022, 2023, 2024];

const PITCH_CODES = ['FF', 'SI', 'FC', 'SL', 'CH', 'CU', 'FS', 'ST', 'SV', 'KC'];
const ARM_SIDE_PITCHES = new Set(['FF', 'SI', 'CH', 'FS']);

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
    headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

async function fetchYear(year) {
  console.log(`\n=== Fetching ${year} ===`);
  const players = {}; // keyed by player_id

  // ── Step 1: pitch-arsenals for velo ──────────────────────────────
  console.log(`  Fetching velo...`);
  const veloRes = await httpsGet(
    `https://baseballsavant.mlb.com/leaderboard/pitch-arsenals?type=avg_speed&year=${year}&team=&min=1&csv=true`
  );
  if (veloRes.statusCode === 200 && veloRes.body.length > 200) {
    const rows = parseCSV(veloRes.body);
    for (const row of rows) {
      const id = parseInt(row['pitcher'] || row['pitcher_id']);
      if (!id) continue;
      if (!players[id]) players[id] = { player_id: id, year };
      // Name from last_name, first_name fields
      const ln = row['last_name'] || row['last_name, first_name']?.split(', ')[0] || '';
      const fn = row['first_name'] || row['last_name, first_name']?.split(', ')[1] || '';
      const combined = row['last_name, first_name'] || '';
      if (!players[id].full_name) {
        if (combined.includes(', ')) {
          const parts = combined.split(', ');
          players[id].full_name = `${parts[1].trim()} ${parts[0].trim()}`;
        } else if (fn && ln) {
          players[id].full_name = `${fn} ${ln}`;
        }
      }
      for (const pt of PITCH_CODES) {
        const val = parseFloat(row[`${pt.toLowerCase()}_avg_speed`] || row[`${pt}_avg_speed`]);
        if (!isNaN(val) && val > 0) {
          if (!players[id][pt.toLowerCase()]) players[id][pt.toLowerCase()] = {};
          players[id][pt.toLowerCase()].velo = Math.round(val * 10) / 10;
        }
      }
    }
    console.log(`    Got ${Object.keys(players).length} pitchers`);
  } else {
    console.log(`    Warning: velo fetch failed (${veloRes.statusCode})`);
  }
  await sleep(600);

  // ── Step 2: pitch-movement per pitch type for IVB, HB, usage ─────
  for (const pt of PITCH_CODES) {
    console.log(`  Fetching ${pt} movement...`);
    const res = await httpsGet(
      `https://baseballsavant.mlb.com/leaderboard/pitch-movement?year=${year}&team=&pitch_type=${pt}&min=1&csv=true`
    );
    if (res.statusCode !== 200 || res.body.length < 100) {
      console.log(`    Skipped`);
      await sleep(300);
      continue;
    }

    const rows = parseCSV(res.body);
    let count = 0;
    for (const row of rows) {
      const id = parseInt(row['pitcher_id']);
      if (!id) continue;
      if (!players[id]) players[id] = { player_id: id, year };

      // Bio
      if (!players[id].team) players[id].team = row['team_name_abbrev'] || null;
      if (!players[id].throws) players[id].throws = row['pitch_hand'] || null;
      if (!players[id].full_name) {
        const ln = row['last_name'] || '';
        const fn = row['first_name'] || '';
        const combined = row['last_name, first_name'] || row['player_name'] || '';
        if (combined.includes(', ')) {
          const parts = combined.split(', ');
          players[id].full_name = `${parts[1].trim()} ${parts[0].trim()}`;
        } else if (fn && ln) {
          players[id].full_name = `${fn} ${ln}`;
        }
      }

      const code = pt.toLowerCase();
      if (!players[id][code]) players[id][code] = {};

      const ivb = parseFloat(row['pitcher_break_z_induced']);
      const hbRaw = parseFloat(row['pitcher_break_x']);
      const usage = parseFloat(row['pitch_per']);
      const hand = players[id].throws || row['pitch_hand'] || 'R';

      if (!isNaN(ivb)) players[id][code].movement_v = Math.round(ivb * 10) / 10;

      if (!isNaN(hbRaw)) {
        const isArmSide = ARM_SIDE_PITCHES.has(pt);
        let signed;
        if (hand === 'R') {
          signed = isArmSide ? hbRaw : -hbRaw;
        } else {
          signed = isArmSide ? -hbRaw : hbRaw;
        }
        players[id][code].movement_h = Math.round(signed * 10) / 10;
      }

      if (!isNaN(usage)) players[id][code].usage = Math.round(usage * 1000) / 10;

      count++;
    }
    console.log(`    Got ${count} entries`);
    await sleep(300);
  }

  // Filter out players with no pitch data and no name
  return Object.values(players).filter(p => p.full_name && p.player_id);
}

async function main() {
  console.log(`Fetching historical pitcher data for years: ${YEARS.join(', ')}`);
  const all = [];

  for (const year of YEARS) {
    const pitchers = await fetchYear(year);
    console.log(`  → ${pitchers.length} pitchers for ${year}`);
    all.push(...pitchers);
    await sleep(1000);
  }

  console.log(`\nTotal: ${all.length} pitcher-seasons`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(all, null, 2));
  console.log(`Written to ${OUTPUT_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
