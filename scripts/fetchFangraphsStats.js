const fs = require('fs');
const path = require('path');

/**
 * Fetch Fangraphs stats for a player
 */
async function fetchFangraphsStats(fangraphsId, season = 2025) {
  try {
    // Remove 'sa' prefix to get the player ID number
    const playerIdNumber = fangraphsId.replace('sa', '');

    // Try the stats API endpoint
    const url = `https://www.fangraphs.com/api/players/stats?playerid=${playerIdNumber}&position=all`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      console.warn(`  ⚠️  Failed to fetch for ${fangraphsId}: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Find the stats for the requested season
    const seasonStats = data.find((s) => s.Season === season.toString());

    if (!seasonStats) {
      console.warn(`  ⚠️  No ${season} stats found for ${fangraphsId}`);
      return null;
    }

    return {
      ba: seasonStats.AVG ? parseFloat(seasonStats.AVG) : null,
      obp: seasonStats.OBP ? parseFloat(seasonStats.OBP) : null,
      slg: seasonStats.SLG ? parseFloat(seasonStats.SLG) : null,
      hr: seasonStats.HR ? parseInt(seasonStats.HR) : null,
    };
  } catch (error) {
    console.error(`  ❌ Error fetching ${fangraphsId}:`, error.message);
    return null;
  }
}

/**
 * Update player data with Fangraphs stats
 */
async function updateDatasetWithFangraphsStats(datasetFile, season = 2025, delayMs = 500) {
  const dataPath = path.join(__dirname, '../data', datasetFile);

  // Read the dataset
  const players = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  console.log(`\nFetching Fangraphs stats for ${players.length} players...`);
  console.log(`Dataset: ${datasetFile}`);
  console.log(`Season: ${season}\n`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < players.length; i++) {
    const player = players[i];

    // Skip if no Fangraphs ID
    if (!player.fangraphs_id) {
      skipped++;
      continue;
    }

    // Skip if already has all stats
    if (player.ba && player.obp && player.slg && player.hr !== null && player.hr !== undefined) {
      console.log(`  ✓ [${i + 1}/${players.length}] ${player.full_name} - already has stats, skipping`);
      skipped++;
      continue;
    }

    console.log(`  🔄 [${i + 1}/${players.length}] Fetching ${player.full_name} (${player.fangraphs_id})...`);

    const stats = await fetchFangraphsStats(player.fangraphs_id, season);

    if (stats) {
      // Update player with fetched stats
      if (stats.ba !== null) player.ba = stats.ba.toFixed(3);
      if (stats.obp !== null) player.obp = stats.obp.toFixed(3);
      if (stats.slg !== null) player.slg = stats.slg.toFixed(3);
      if (stats.hr !== null) player.hr = stats.hr;

      console.log(`     ✓ BA: ${stats.ba}, OBP: ${stats.obp}, SLG: ${stats.slg}, HR: ${stats.hr}`);
      updated++;
    } else {
      failed++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  // Save updated dataset
  fs.writeFileSync(dataPath, JSON.stringify(players, null, 2));

  console.log(`\n✅ Complete!`);
  console.log(`   Updated: ${updated} players`);
  console.log(`   Skipped: ${skipped} players`);
  console.log(`   Failed:  ${failed} players`);
  console.log(`\n📁 Saved to ${datasetFile}`);
}

// Run the script
const datasetFile = process.argv[2] || 'players3.json'; // Default to AA dataset
const season = parseInt(process.argv[3]) || 2025;
const delayMs = parseInt(process.argv[4]) || 500;

updateDatasetWithFangraphsStats(datasetFile, season, delayMs)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
