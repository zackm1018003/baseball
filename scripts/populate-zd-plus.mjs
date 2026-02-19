/**
 * populate-zd-plus.mjs
 *
 * Fetches ZoneDecision+ (ZD+) for every MLB player that has a player_id
 * and writes the result back into the specified players JSON file.
 *
 * Usage:
 *   node scripts/populate-zd-plus.mjs [options]
 *
 * Options:
 *   --file    Path to player JSON file (default: data/players.json)
 *   --url     Base URL of your deployed app (default: http://localhost:3000)
 *   --season  MLB season year (default: 2025)
 *   --delay   Milliseconds between requests to avoid rate-limiting (default: 1200)
 *   --dry-run Print what would be fetched without writing anything
 *
 * Examples:
 *   # Against local dev server:
 *   node scripts/populate-zd-plus.mjs --url http://localhost:3000
 *
 *   # Against your deployed Vercel app:
 *   node scripts/populate-zd-plus.mjs --url https://your-app.vercel.app
 *
 *   # Different data file:
 *   node scripts/populate-zd-plus.mjs --file data/players2.json --url https://your-app.vercel.app
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf('--' + name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const isDryRun = args.includes('--dry-run');

const FILE     = getArg('file',   'data/players.json');
const BASE_URL = getArg('url',    'http://localhost:3000');
const SEASON   = getArg('season', '2025');
const DELAY    = parseInt(getArg('delay', '1200'), 10);

const filePath = path.resolve(ROOT, FILE);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchZdData(playerId) {
  const url = BASE_URL + '/api/zone-contact?playerId=' + playerId + '&season=' + SEASON;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return { zdPlus: typeof data.zdPlus === "number" ? data.zdPlus : null, xwoba: typeof data.xwoba === "number" ? data.xwoba : null };
}

function pad(str, len) {
  return String(str).padEnd(len);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('============================================================');
  console.log('ZD+ Population Script');
  console.log('============================================================');
  console.log('File:    ' + filePath);
  console.log('API:     ' + BASE_URL + '/api/zone-contact');
  console.log('Season:  ' + SEASON);
  console.log('Delay:   ' + DELAY + 'ms between requests');
  if (isDryRun) console.log('MODE:    DRY RUN (no writes)');
  console.log('============================================================');

  if (!fs.existsSync(filePath)) {
    console.error('Error: File not found: ' + filePath);
    process.exit(1);
  }

  const raw     = fs.readFileSync(filePath, 'utf-8');
  const players = JSON.parse(raw);

  const eligible = players.filter(function(p) { return p.player_id != null; });
  const skipped  = players.length - eligible.length;

  console.log('\nTotal players:              ' + players.length);
  console.log('With player_id (to fetch):  ' + eligible.length);
  console.log('Without player_id (skip):   ' + skipped);

  const estMinutes = Math.ceil((eligible.length * DELAY) / 60000);
  console.log('Estimated time:             ~' + estMinutes + ' minutes\n');

  if (isDryRun) {
    console.log('Dry run — would fetch ZD+ for:');
    eligible.forEach(function(p) {
      console.log('  ' + p.player_id + '  ' + p.full_name);
    });
    return;
  }

  // ---------------------------------------------------------------------------
  // Fetch loop
  // ---------------------------------------------------------------------------
  var successCount = 0;
  var nullCount    = 0;
  var errorCount   = 0;

  for (var i = 0; i < eligible.length; i++) {
    var player   = eligible[i];
    var progress = '[' + String(i + 1).padStart(3) + '/' + eligible.length + ']';

    process.stdout.write(progress + ' ' + pad(player.full_name, 28) + ' (id: ' + player.player_id + ') ... ');

    try {
      var result = await fetchZdData(player.player_id);
      var zdPlus = result.zdPlus;
      var xwoba  = result.xwoba;

      // Find and update in the main array
      var idx = players.findIndex(function(p) { return p.player_id === player.player_id; });
      if (idx !== -1) {
        players[idx].zd_plus = zdPlus;
          players[idx].xwoba  = xwoba;
      }

      if (zdPlus !== null) {
        console.log('ZD+ = ' + zdPlus + '  xwoba = ' + xwoba);
        successCount++;
      } else {
        console.log('ZD+ = null (not enough data)');
        nullCount++;
      }
    } catch (err) {
      console.log('ERROR: ' + err.message);
      errorCount++;
      // Leave existing zd_plus unchanged on error
    }

    // Rate-limit between requests (skip after last)
    if (i < eligible.length - 1) {
      await sleep(DELAY);
    }
  }

  // ---------------------------------------------------------------------------
  // Write results
  // ---------------------------------------------------------------------------
  console.log('\n============================================================');
  console.log('Results:');
  console.log('  Populated (non-null): ' + successCount);
  console.log('  Null (insufficient data): ' + nullCount);
  console.log('  Errors (value unchanged): ' + errorCount);
  console.log('============================================================');

  var out = JSON.stringify(players, null, 2);
  fs.writeFileSync(filePath, out, 'utf-8');
  console.log('\nWrote updated data to: ' + filePath);
  console.log('Done! Commit and push players.json to deploy the ZD+ values.');
}

main().catch(function(err) {
  console.error('\nFatal error:', err);
  process.exit(1);
});
