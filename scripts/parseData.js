const fs = require('fs');
const path = require('path');

// Define datasets to parse
const datasets = [
  { name: 'MLB 2025', filename: 'henry', output: 'players.json', isAAA: false },
  { name: 'AAA 2025', filename: 'henry2', output: 'players2.json', isAAA: true },
  { name: 'AA 2025', filename: 'henry-3', output: 'players3.json', isAAA: true },
  { name: 'A+ 2025', filename: 'henry-4', output: 'players4.json', isAAA: true },
  { name: 'A 2025', filename: 'henry-5', output: 'players5.json', isAAA: true }
];

// Column name normalization for different data formats
function normalizeHeader(header) {
  const normalized = header.trim().replace(/\s+/g, '_').toLowerCase();

  // Map AAA column names to MLB format
  const columnMap = {
    'name': 'full_name',
    'batter_name': 'full_name',
    'id': 'player_id',
    'avgev': 'avg_ev',
    'ev90': 'ev50',
    'maxev': 'max_ev',
    'barrel%': 'barrel_%',
    'barrel_percent': 'barrel_%',
    'hh%': 'hard_hit%',
    'hard_hit%': 'hard_hit%',
    'z-swing': 'z-swing%',
    'chase%': 'chase%',
    'chase': 'chase%',
    'z-whiff': 'z-whiff%',
    'o-whiff': 'o-whiff%',
    'avg_la': 'avg_la',
    'pull_flyball%': 'pull_air%',
    'pulled_fly_ball_percent': 'pull_air%',
    'ba': 'ba',
    'obp': 'obp',
    'slg': 'slg'
  };

  return columnMap[normalized] || normalized;
}

function parseDataset(inputFilename, outputFilename, datasetName, isAAA = false) {
  const inputPath = path.join(__dirname, `../${inputFilename}`);

  // Check if file exists
  if (!fs.existsSync(inputPath)) {
    console.log(`⚠️  ${inputFilename} not found - skipping ${datasetName}`);
    return;
  }

  const data = fs.readFileSync(inputPath, 'utf-8');
  const lines = data.trim().split('\n');

  // Check if there's data beyond the header
  if (lines.length <= 1) {
    console.log(`⚠️  ${datasetName}: No data rows found (only header) - creating empty dataset`);
    const outputPath = path.join(__dirname, '../data', outputFilename);
    fs.writeFileSync(outputPath, JSON.stringify([], null, 2));
    return;
  }

  const headers = lines[0].split('\t');
  const players = [];
  const seenPlayerIds = new Set();

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const player = {};

    headers.forEach((header, index) => {
      const value = values[index];
      const rawHeader = header.trim().replace(/\s+/g, '_').toLowerCase();
      const cleanHeader = normalizeHeader(header);

      // Special handling for name field (MLB format)
      if (rawHeader === 'last_name,_first_name' && value) {
        const [lastName, firstName] = value.split(',').map(s => s.trim());
        player['last_name'] = lastName;
        player['first_name'] = firstName;
        player['full_name'] = value;
      }
      // Special handling for simple name field (AAA format)
      else if (cleanHeader === 'full_name' && (rawHeader === 'name' || rawHeader === 'batter_name') && value) {
        player['full_name'] = value;
        // Try to split into first/last if it contains a space
        const nameParts = value.split(/\s+/);
        if (nameParts.length >= 2) {
          player['first_name'] = nameParts.slice(0, -1).join(' ');
          player['last_name'] = nameParts[nameParts.length - 1];
        }
      }
      // Convert numeric values
      else if (value && value !== '#N/A' && value !== 'FA' && !isNaN(value)) {
        player[cleanHeader] = parseFloat(value);
      } else if (value === '#N/A') {
        player[cleanHeader] = null;
      } else {
        player[cleanHeader] = value || null;
      }
    });

    // Check for duplicates based on player_id
    if (player.player_id !== null && player.player_id !== undefined) {
      if (seenPlayerIds.has(player.player_id)) {
        console.log(`  Skipping duplicate player_id ${player.player_id}: ${player.full_name}`);
        continue;
      }
      seenPlayerIds.add(player.player_id);
    }

    // Fix column data for AAA
    if (isAAA) {
      // Convert o-whiff% from decimal to percentage
      if (player['o-whiff%'] !== null && player['o-whiff%'] !== undefined) {
        player['o-whiff%'] = player['o-whiff%'] * 100;
      }

      // Z-Whiff column in new AAA data is actually Z-Contact%, so convert it
      // Z-Whiff% = 100 - Z-Contact%
      if (player['z-whiff%'] !== null && player['z-whiff%'] !== undefined && player['z-whiff%'] > 50) {
        player['z-whiff%'] = 100 - player['z-whiff%'];
      }

      // Round z-whiff% to nearest 10th
      if (player['z-whiff%'] !== null && player['z-whiff%'] !== undefined) {
        player['z-whiff%'] = Math.round(player['z-whiff%'] * 10) / 10;
      }
    }

    // Filter out players with insufficient ABs (AAA) or PAs (MLB)
    if (isAAA) {
      if (player.ab !== null && player.ab !== undefined && player.ab < 75) {
        console.log(`  Skipping ${player.full_name} - insufficient at-bats (${player.ab} AB)`);
        continue;
      }
    } else {
      if (player.pa !== null && player.pa !== undefined && player.pa < 100) {
        console.log(`  Skipping ${player.full_name} - insufficient plate appearances (${player.pa} PA)`);
        continue;
      }
    }

    players.push(player);
  }

  // Create data directory if it doesn't exist
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Write to JSON file
  const outputPath = path.join(dataDir, outputFilename);
  fs.writeFileSync(outputPath, JSON.stringify(players, null, 2));

  console.log(`✓ ${datasetName}: Parsed ${players.length} players`);
  console.log(`  Saved to ${outputPath}\n`);
}

// Parse all datasets
console.log('Parsing datasets...\n');
datasets.forEach(dataset => {
  parseDataset(dataset.filename, dataset.output, dataset.name, dataset.isAAA);
});

console.log('Done!');
