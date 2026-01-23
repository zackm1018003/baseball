const fs = require('fs');
const path = require('path');

// Define datasets to parse
const datasets = [
  { name: 'MLB 2025', filename: 'henry', output: 'players.json' },
  { name: 'AAA 2025', filename: 'henry2', output: 'players2.json' }
];

function parseDataset(inputFilename, outputFilename, datasetName) {
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
      const cleanHeader = header.trim().replace(/\s+/g, '_').toLowerCase();

      // Special handling for name field
      if (cleanHeader === 'last_name,_first_name' && value) {
        const [lastName, firstName] = value.split(',').map(s => s.trim());
        player['last_name'] = lastName;
        player['first_name'] = firstName;
        player['full_name'] = value;
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

    // Filter out players with less than 100 plate appearances
    if (player.pa !== null && player.pa !== undefined && player.pa < 100) {
      console.log(`  Skipping ${player.full_name} - insufficient plate appearances (${player.pa} PA)`);
      continue;
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
  parseDataset(dataset.filename, dataset.output, dataset.name);
});

console.log('Done!');
