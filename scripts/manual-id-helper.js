const fs = require('fs');
const readline = require('readline');

// Read the current henry-3 file
const inputFile = './henry-3';
const outputFile = './henry-3-updated';

const data = fs.readFileSync(inputFile, 'utf8');
const lines = data.trim().split('\n');
const header = lines[0];
const playerLines = lines.slice(1).filter(line => line.trim());

// Load existing IDs if updating
let playerIds = {};
if (fs.existsSync(outputFile)) {
  const existingData = fs.readFileSync(outputFile, 'utf8');
  const existingLines = existingData.trim().split('\n').slice(1);
  existingLines.forEach(line => {
    const parts = line.split('\t');
    if (parts[0] && parts[0].trim()) {
      const name = parts[1];
      playerIds[name] = parts[0];
    }
  });
}

console.log(`\n=== Manual Player ID Helper ===`);
console.log(`Total players: ${playerLines.length}`);
console.log(`Already have IDs for: ${Object.keys(playerIds).length} players\n`);

console.log(`Instructions:`);
console.log(`1. Use https://razzball.com/mlbamids/ to search for player IDs`);
console.log(`2. Or use https://www.baseball-reference.com/ to find players`);
console.log(`3. Enter IDs in format: PlayerName=12345`);
console.log(`4. Type 'save' to save progress`);
console.log(`5. Type 'export' to create final file`);
console.log(`6. Type 'list' to see players without IDs`);
console.log(`7. Type 'quit' to exit\n`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function listPlayersWithoutIds() {
  const without = playerLines
    .map(line => line.split('\t')[0])
    .filter(name => !playerIds[name]);

  console.log(`\nPlayers without IDs (${without.length} remaining):`);
  without.slice(0, 20).forEach((name, i) => {
    console.log(`  ${i + 1}. ${name}`);
  });
  if (without.length > 20) {
    console.log(`  ... and ${without.length - 20} more`);
  }
  console.log();
}

function saveProgress() {
  fs.writeFileSync('./player-ids-progress.json', JSON.stringify(playerIds, null, 2));
  console.log(`✓ Saved progress: ${Object.keys(playerIds).length} player IDs`);
}

function exportFinal() {
  const newHeader = 'ID\t' + header;
  const results = [newHeader];

  playerLines.forEach(line => {
    const parts = line.split('\t');
    const playerName = parts[0];
    const id = playerIds[playerName] || '';
    results.push(`${id}\t${line}`);
  });

  fs.writeFileSync(outputFile, results.join('\n'));
  console.log(`✓ Exported to: ${outputFile}`);
  console.log(`  Players with IDs: ${Object.keys(playerIds).length}/${playerLines.length}`);
}

function prompt() {
  rl.question('> ', (input) => {
    input = input.trim();

    if (input === 'quit') {
      saveProgress();
      rl.close();
      return;
    }

    if (input === 'save') {
      saveProgress();
      prompt();
      return;
    }

    if (input === 'export') {
      exportFinal();
      prompt();
      return;
    }

    if (input === 'list') {
      listPlayersWithoutIds();
      prompt();
      return;
    }

    // Parse player=id format
    const match = input.match(/^(.+?)=(\d+)$/);
    if (match) {
      const name = match[1].trim();
      const id = match[2];

      // Find matching player name (case insensitive)
      const playerName = playerLines
        .map(line => line.split('\t')[0])
        .find(p => p.toLowerCase() === name.toLowerCase());

      if (playerName) {
        playerIds[playerName] = id;
        console.log(`✓ Added: ${playerName} = ${id}`);
      } else {
        console.log(`✗ Player not found: ${name}`);
        console.log(`  Did you mean one of these?`);
        playerLines
          .map(line => line.split('\t')[0])
          .filter(p => p.toLowerCase().includes(name.toLowerCase()))
          .slice(0, 5)
          .forEach(p => console.log(`    - ${p}`));
      }
    } else if (input) {
      console.log(`Invalid format. Use: PlayerName=12345`);
    }

    prompt();
  });
}

// Load saved progress if it exists
if (fs.existsSync('./player-ids-progress.json')) {
  const savedIds = JSON.parse(fs.readFileSync('./player-ids-progress.json', 'utf8'));
  playerIds = { ...playerIds, ...savedIds };
  console.log(`Loaded ${Object.keys(playerIds).length} saved IDs from previous session\n`);
}

listPlayersWithoutIds();
prompt();
