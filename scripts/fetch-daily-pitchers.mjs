#!/usr/bin/env node

/**
 * fetch-daily-pitchers.mjs
 *
 * Discovers all pitchers who appeared in yesterday's MLB games and:
 *   - Adds any pitcher NOT already in pitchers.json (full ingest)
 *   - Refreshes stats for ALL pitchers found in yesterday's games
 *
 * USAGE:
 *   node scripts/fetch-daily-pitchers.mjs
 *   node scripts/fetch-daily-pitchers.mjs --date 2025-04-01   # specific date
 *
 * Runs automatically via GitHub Actions (.github/workflows/daily-pitcher-scrape.yml)
 */

import fs from 'fs';
import {
  httpsGet,
  sleep,
  OUTPUT_FILE,
  ingestPitcher,
  mergePitcherIntoDb,
} from './pitcher-utils.mjs';

// ─── Parse CLI args ───────────────────────────────────────────

function getTargetDate() {
  const args = process.argv.slice(2);
  const dateArg = args.find(a => a.startsWith('--date=') || a === '--date');
  if (dateArg) {
    const val = dateArg.includes('=') ? dateArg.split('=')[1] : args[args.indexOf('--date') + 1];
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    console.error(`Invalid date format: ${val}. Use YYYY-MM-DD.`);
    process.exit(1);
  }

  // Default: yesterday in ET
  const now = new Date();
  // Subtract UTC offset to approximate ET (UTC-4 in summer, UTC-5 in winter)
  const etOffset = isDST(now) ? 4 : 5;
  const etNow = new Date(now.getTime() - etOffset * 60 * 60 * 1000);
  const yesterday = new Date(etNow.getTime() - 24 * 60 * 60 * 1000);
  return yesterday.toISOString().slice(0, 10);
}

function isDST(date) {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return Math.min(jan, jul) === date.getTimezoneOffset();
}

// ─── Step 1: Fetch yesterday's schedule with boxscore hydration ──

async function fetchSchedule(date) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?startDate=${date}&endDate=${date}&sportId=1&hydrate=boxscore`;
  console.log(`\nFetching schedule for ${date}...`);
  const res = await httpsGet(url);
  const json = JSON.parse(res.body);

  const dates = json?.dates;
  if (!dates || dates.length === 0) {
    console.log(`No games found for ${date}.`);
    return [];
  }

  return dates[0].games || [];
}

// ─── Step 2: Extract all pitcher IDs from boxscores ──────────────

function extractPitcherIds(games) {
  const ids = new Set();

  for (const game of games) {
    const boxscore = game.boxscore || game.teams;

    // When hydrate=boxscore, pitchers are in game.teams.home/away.pitchers
    const home = game.teams?.home;
    const away = game.teams?.away;

    if (home?.pitchers) home.pitchers.forEach(id => ids.add(id));
    if (away?.pitchers) away.pitchers.forEach(id => ids.add(id));

    // Fallback: some responses nest under game.boxscore
    if (game.boxscore?.teams) {
      const bHome = game.boxscore.teams.home;
      const bAway = game.boxscore.teams.away;
      if (bHome?.pitchers) bHome.pitchers.forEach(id => ids.add(id));
      if (bAway?.pitchers) bAway.pitchers.forEach(id => ids.add(id));
    }
  }

  return [...ids];
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  const targetDate = getTargetDate();
  console.log(`=== Daily Pitcher Fetch: ${targetDate} ===`);

  // Load existing pitcher database
  let db = [];
  if (fs.existsSync(OUTPUT_FILE)) {
    db = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    console.log(`Loaded ${db.length} pitchers from database.`);
  } else {
    console.log('No existing pitchers.json — will create fresh.');
  }

  const existingIds = new Set(db.map(p => p.player_id).filter(Boolean));

  // Fetch yesterday's schedule
  const games = await fetchSchedule(targetDate);
  if (games.length === 0) {
    console.log('No games to process. Exiting.');
    return;
  }
  console.log(`Found ${games.length} game(s).`);

  // Extract all pitcher IDs
  const pitcherIds = extractPitcherIds(games);
  console.log(`Found ${pitcherIds.length} unique pitcher(s) in yesterday's games.`);

  if (pitcherIds.length === 0) {
    console.log('No pitcher IDs found in boxscores. The schedule may not be fully hydrated yet.');
    return;
  }

  // Process each pitcher
  let added = 0, updated = 0, errors = 0;

  for (let i = 0; i < pitcherIds.length; i++) {
    const playerId = pitcherIds[i];
    const isNew = !existingIds.has(playerId);
    const label = isNew ? '[NEW]' : '[REFRESH]';
    console.log(`\n[${i + 1}/${pitcherIds.length}] Player ID ${playerId} ${label}`);

    try {
      const pitcher = await ingestPitcher(playerId);

      if (!pitcher.full_name || pitcher.full_name.startsWith('Player ')) {
        console.log(`  ⚠ Could not resolve name for ID ${playerId}, skipping.`);
        errors++;
        continue;
      }

      console.log(`  → ${pitcher.full_name} (${pitcher.team || '—'}) ERA: ${pitcher.era ?? '—'}`);

      const action = mergePitcherIntoDb(db, pitcher);
      if (action === 'added') {
        added++;
        console.log(`  ✓ Added to database`);
      } else {
        updated++;
        console.log(`  ✓ Refreshed in database`);
      }

      // Rate limit: 1.2s between players to be polite to APIs
      await sleep(1200);

    } catch (err) {
      console.error(`  ✗ Error processing player ${playerId}: ${err.message}`);
      errors++;
      await sleep(500);
    }
  }

  // Write updated database
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(db, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`Date processed: ${targetDate}`);
  console.log(`Games: ${games.length}`);
  console.log(`Pitchers found: ${pitcherIds.length}`);
  console.log(`Added: ${added} | Refreshed: ${updated} | Errors: ${errors}`);
  console.log(`Total in database: ${db.length}`);
  console.log(`Output: ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
