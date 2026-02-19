/**
 * populate-zd-plus-local.mjs
 *
 * Computes ZD+ directly from Baseball Savant — no local/Vercel server needed.
 * Uses the same formula as app/api/zone-contact/route.ts.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

const args     = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf('--' + name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const FILE   = getArg('file',   'data/players.json');
const SEASON = getArg('season', '2025');
const DELAY  = parseInt(getArg('delay', '1500'), 10);
const filePath = path.resolve(ROOT, FILE);

// ---------------------------------------------------------------------------
// ZD+ formula constants — must match route.ts exactly
// ---------------------------------------------------------------------------
const ZONE_BASELINE = {
  1: 0.3413, 2: 0.3851, 3: 0.3512,
  4: 0.3810, 5: 0.4348, 6: 0.3832,
  7: 0.3570, 8: 0.4106, 9: 0.3551,
};
const LEAGUE_MEAN  = 0;
const LEAGUE_STDEV = 30;

const OOZ_TAKE_PTS       = 60;
const OOZ_CHASE_PTS      = 40;
const OOZ_LEAGUE_AVG_RAW = 0.72 * OOZ_TAKE_PTS - 0.28 * OOZ_CHASE_PTS; // 32.0
const OOZ_SCALE          = 3.0;

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------
function parseCsvLine(line) {
  const fields = [];
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
// Fetch raw CSV from Baseball Savant
// ---------------------------------------------------------------------------
function fetchSavant(playerId) {
  return new Promise((resolve, reject) => {
    const url =
      `https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfGT=R%7C&hfSea=${SEASON}%7C` +
      `&player_type=batter&batters_lookup[]=${playerId}&min_pitches=0&min_results=0&min_pas=0&type=details`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ---------------------------------------------------------------------------
// Compute ZD+ from raw CSV text
// ---------------------------------------------------------------------------
function computeZdPlus(csvText) {
  const lines = csvText.replace(/^\uFEFF/, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { zdPlus: null, xwoba: null };

  const headers   = parseCsvLine(lines[0]);
  const zoneIdx   = headers.indexOf('zone');
  const descIdx   = headers.indexOf('description');
  const xwobaIdx  = headers.indexOf('estimated_woba_using_speedangle');
  if (zoneIdx === -1 || descIdx === -1) return { zdPlus: null, xwoba: null };

  const pitches  = {}, swings = {}, xwobaSum = {}, xwobaN = {};
  for (let z = 1; z <= 9; z++) { pitches[z] = 0; swings[z] = 0; xwobaSum[z] = 0; xwobaN[z] = 0; }
  let oozSwings = 0, oozTakes = 0;
  let overallXwobaSum = 0, overallXwobaN = 0;

  for (let i = 1; i < lines.length; i++) {
    const f    = parseCsvLine(lines[i]);
    const zone = parseInt(f[zoneIdx]?.trim() ?? '');
    const desc = f[descIdx]?.trim() ?? '';
    const xw   = parseFloat(f[xwobaIdx]?.trim() ?? '');

    const isSwing =
      desc === 'swinging_strike'         || desc === 'foul'          ||
      desc === 'hit_into_play'           || desc === 'foul_tip'      ||
      desc === 'swinging_strike_blocked' || desc === 'bunt_foul_tip' ||
      desc === 'missed_bunt';
    const isContact =
      desc === 'foul' || desc === 'hit_into_play' ||
      desc === 'foul_tip' || desc === 'bunt_foul_tip';

    if (desc === 'hit_into_play' && !isNaN(xw)) { overallXwobaSum += xw; overallXwobaN++; }

    if (zone >= 1 && zone <= 9) {
      pitches[zone]++;
      if (isSwing) swings[zone]++;
      if (desc === 'hit_into_play' && !isNaN(xw)) { xwobaSum[zone] += xw; xwobaN[zone]++; }
    } else if (zone >= 11 && zone <= 19) {
      if (isSwing) oozSwings++; else oozTakes++;
    }
  }

  // In-zone scoring
  let totalPoints = 0, coveredPitches = 0;
  for (let z = 1; z <= 9; z++) {
    if (xwobaN[z] < 5) continue;
    const xw      = xwobaSum[z] / xwobaN[z];
    const sw      = swings[z];
    const tk      = pitches[z] - sw;
    const diffPts = (xw - ZONE_BASELINE[z]) * 1000;
    totalPoints   += diffPts * sw + (-diffPts) * tk;
    coveredPitches += pitches[z];
  }

  if (coveredPitches < 50) return { zdPlus: null, xwoba: null };
  const rawPerPitch = totalPoints / coveredPitches;

  // OOZ adjustment
  let oozAdj = 0;
  const oozTotal = oozSwings + oozTakes;
  if (oozTotal >= 10) {
    const rawPerOozPitch = (oozTakes * OOZ_TAKE_PTS - oozSwings * OOZ_CHASE_PTS) / oozTotal;
    oozAdj = (rawPerOozPitch - OOZ_LEAGUE_AVG_RAW) / OOZ_SCALE;
  }

  const zdPlus = Math.round(100 + ((rawPerPitch - LEAGUE_MEAN) / LEAGUE_STDEV) * 15 + oozAdj);
  const xwoba  = overallXwobaN >= 10 ? Math.round((overallXwobaSum / overallXwobaN) * 1000) / 1000 : null;

  return { zdPlus, xwoba };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function pad(s, n) { return String(s).padEnd(n); }

async function main() {
  console.log('============================================================');
  console.log('ZD+ Local Population Script (direct Baseball Savant fetch)');
  console.log('============================================================');
  console.log('File:    ' + filePath);
  console.log('Season:  ' + SEASON);
  console.log('Delay:   ' + DELAY + 'ms between requests');
  console.log('============================================================');

  const players  = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const eligible = players.filter(p => p.player_id != null);
  console.log('\nTotal players: ' + players.length + '  |  With player_id: ' + eligible.length);
  const estMins = Math.ceil((eligible.length * DELAY) / 60000);
  console.log('Estimated time: ~' + estMins + ' minutes\n');

  let successCount = 0, nullCount = 0, errorCount = 0;

  for (let i = 0; i < eligible.length; i++) {
    const player   = eligible[i];
    const progress = '[' + String(i + 1).padStart(3) + '/' + eligible.length + ']';
    process.stdout.write(progress + ' ' + pad(player.full_name, 28) + ' (id: ' + player.player_id + ') ... ');

    try {
      const csv  = await fetchSavant(player.player_id);
      const { zdPlus, xwoba } = computeZdPlus(csv);

      const idx = players.findIndex(p => p.player_id === player.player_id);
      if (idx !== -1) { players[idx].zd_plus = zdPlus; players[idx].xwoba = xwoba; }

      if (zdPlus !== null) { console.log('ZD+ = ' + zdPlus + '  xwoba = ' + xwoba); successCount++; }
      else                 { console.log('ZD+ = null (not enough data)'); nullCount++; }
    } catch (err) {
      console.log('ERROR: ' + err.message);
      errorCount++;
    }

    if (i < eligible.length - 1) await sleep(DELAY);
  }

  console.log('\n============================================================');
  console.log('Results:');
  console.log('  Populated (non-null): ' + successCount);
  console.log('  Null (insufficient data): ' + nullCount);
  console.log('  Errors (value unchanged): ' + errorCount);
  console.log('============================================================');

  fs.writeFileSync(filePath, JSON.stringify(players, null, 2), 'utf-8');
  console.log('\nWrote updated data to: ' + filePath);
  console.log('Done! Commit and push players.json to deploy the ZD+ values.');
}

main().catch(err => { console.error('\nFatal error:', err); process.exit(1); });
