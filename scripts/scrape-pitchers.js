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
const path = require('path');

const INPUT_FILE = path.join(__dirname, '..', 'data', 'pitcher-input.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'pitchers.json');

// ─── Main ───────────────────────────────────────────────────

async function main() {
  // Dynamically import shared ES module utilities
  const {
    sleep,
    resolvePlayerId,
    ingestPitcher,
    mergePitcherIntoDb,
  } = await import('./pitcher-utils.mjs');

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

      // Steps 2-5: Fetch bio, Statcast, traditional stats via shared ingestPitcher()
      console.log('  Fetching bio, Statcast data, and traditional stats...');
      const pitcher = await ingestPitcher(playerId, playerInfo?.fullName || entry.name);

      // Allow entry-level team override
      if (entry.team) pitcher.team = entry.team;

      console.log(`  ✓ Done — ERA: ${pitcher.era ?? '—'}\n`);
      results.push(pitcher);

      await sleep(1000); // Rate limit between players

    } catch (err) {
      console.error(`  ✗ Error processing ${entry.name}: ${err.message}\n`);
    }
  }

  // Merge into existing database
  let added = 0, updated = 0;

  results.forEach(newP => {
    const action = mergePitcherIntoDb(existing, newP);
    if (action === 'added') {
      added++;
      console.log(`Added: ${newP.full_name}`);
    } else {
      updated++;
      console.log(`Updated: ${newP.full_name}`);
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
