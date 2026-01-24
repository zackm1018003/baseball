const fs = require('fs');

/**
 * Bulk import player IDs from a tab-separated or CSV file
 *
 * Expected format (one of these):
 * - Name\tID
 * - Name,ID
 * - ID\tName
 * - ID,Name
 *
 * Usage: node bulk-import-ids.js <input-file>
 */

const inputMappingFile = process.argv[2];
const henryFile = './henry-3';
const outputFile = './henry-3-with-ids';

if (!inputMappingFile) {
  console.log('Usage: node bulk-import-ids.js <mapping-file>');
  console.log('\nMapping file should be in one of these formats:');
  console.log('  PlayerName<TAB>ID');
  console.log('  PlayerName,ID');
  console.log('  ID<TAB>PlayerName');
  console.log('  ID,PlayerName');
  process.exit(1);
}

if (!fs.existsSync(inputMappingFile)) {
  console.error(`Error: File not found: ${inputMappingFile}`);
  process.exit(1);
}

// Read mapping file
const mappingData = fs.readFileSync(inputMappingFile, 'utf8');
const mappingLines = mappingData.trim().split('\n');

const playerIds = {};
let skipped = 0;

mappingLines.forEach((line, i) => {
  line = line.trim();
  if (!line || line.startsWith('#')) return;

  // Try tab-separated
  let parts = line.split('\t');
  if (parts.length === 1) {
    // Try comma-separated
    parts = line.split(',');
  }

  if (parts.length !== 2) {
    console.warn(`Warning: Skipping line ${i + 1}: ${line}`);
    skipped++;
    return;
  }

  const [part1, part2] = parts.map(p => p.trim());

  // Determine which is name and which is ID
  const isFirstPartId = /^\d+$/.test(part1);
  const isSecondPartId = /^\d+$/.test(part2);

  if (isFirstPartId && !isSecondPartId) {
    // ID, Name format
    playerIds[part2] = part1;
  } else if (!isFirstPartId && isSecondPartId) {
    // Name, ID format
    playerIds[part1] = part2;
  } else {
    console.warn(`Warning: Couldn't determine format for line ${i + 1}: ${line}`);
    skipped++;
  }
});

console.log(`\nLoaded ${Object.keys(playerIds).length} player ID mappings`);
if (skipped > 0) {
  console.log(`Skipped ${skipped} lines`);
}

// Read henry-3 file
const henryData = fs.readFileSync(henryFile, 'utf8');
const henryLines = henryData.trim().split('\n');
const header = henryLines[0];
const playerLines = henryLines.slice(1).filter(line => line.trim());

// Create output with IDs
const newHeader = 'ID\t' + header;
const results = [newHeader];

let matched = 0;
let unmatched = 0;

playerLines.forEach(line => {
  const parts = line.split('\t');
  const playerName = parts[0];

  // Try exact match first
  let id = playerIds[playerName];

  // Try case-insensitive match
  if (!id) {
    const nameKey = Object.keys(playerIds).find(
      key => key.toLowerCase() === playerName.toLowerCase()
    );
    if (nameKey) {
      id = playerIds[nameKey];
    }
  }

  if (id) {
    results.push(`${id}\t${line}`);
    matched++;
  } else {
    results.push(`\t${line}`);
    unmatched++;
  }
});

// Write output
fs.writeFileSync(outputFile, results.join('\n'));

console.log(`\n=== Results ===`);
console.log(`Total players: ${playerLines.length}`);
console.log(`Matched: ${matched} (${(matched / playerLines.length * 100).toFixed(1)}%)`);
console.log(`Unmatched: ${unmatched} (${(unmatched / playerLines.length * 100).toFixed(1)}%)`);
console.log(`\nOutput written to: ${outputFile}`);

// Save unmatched list
if (unmatched > 0) {
  const unmatchedPlayers = [];
  playerLines.forEach(line => {
    const playerName = line.split('\t')[0];
    if (!playerIds[playerName] &&
        !Object.keys(playerIds).find(key => key.toLowerCase() === playerName.toLowerCase())) {
      unmatchedPlayers.push(playerName);
    }
  });

  fs.writeFileSync('henry-3-still-missing.txt', unmatchedPlayers.join('\n'));
  console.log(`Saved list of unmatched players to: henry-3-still-missing.txt`);
}
