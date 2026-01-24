const fs = require('fs');
const { execSync } = require('child_process');

// Read the henry-3 file
const inputFile = './henry-3';
const outputFile = './henry-3-with-ids';

function searchPlayerByName(name) {
  try {
    const encodedName = encodeURIComponent(name);
    const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodedName}`;

    // Use curl to fetch data
    const result = execSync(`curl -s "${url}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const json = JSON.parse(result);

    if (json.people && json.people.length > 0) {
      return {
        id: json.people[0].id,
        fullName: json.people[0].fullName,
        confidence: json.people.length === 1 ? 'high' : 'medium'
      };
    }
    return null;
  } catch (error) {
    console.error(`  API error for ${name}:`, error.message);
    return null;
  }
}

function sleep(ms) {
  execSync(`sleep ${ms / 1000}`);
}

function processPlayers() {
  const data = fs.readFileSync(inputFile, 'utf8');
  const lines = data.trim().split('\n');
  const header = lines[0];
  const playerLines = lines.slice(1).filter(line => line.trim());

  console.log(`Found ${playerLines.length} players to process\n`);

  // Add ID column to header
  const newHeader = 'ID\t' + header;
  const results = [newHeader];

  let found = 0;
  let notFound = 0;
  const notFoundPlayers = [];
  const foundPlayers = [];

  for (let i = 0; i < playerLines.length; i++) {
    const line = playerLines[i];
    const parts = line.split('\t');
    const playerName = parts[0];

    if ((i + 1) % 50 === 0) {
      console.log(`Progress: ${i + 1}/${playerLines.length} players processed`);
    }

    const result = searchPlayerByName(playerName);

    if (result) {
      results.push(`${result.id}\t${line}`);
      found++;
      foundPlayers.push(`${playerName} -> ${result.fullName} (${result.id})`);
    } else {
      results.push(`\t${line}`); // Add empty ID
      notFound++;
      notFoundPlayers.push(playerName);
    }

    // Rate limiting - wait 100ms between requests
    if (i < playerLines.length - 1) {
      sleep(100);
    }
  }

  // Write results
  fs.writeFileSync(outputFile, results.join('\n'));

  console.log('\n=== Summary ===');
  console.log(`Total players: ${playerLines.length}`);
  console.log(`Found: ${found} (${(found / playerLines.length * 100).toFixed(1)}%)`);
  console.log(`Not found: ${notFound} (${(notFound / playerLines.length * 100).toFixed(1)}%)`);

  if (foundPlayers.length > 0 && foundPlayers.length <= 20) {
    console.log('\nPlayers found:');
    foundPlayers.forEach(p => console.log(`  ✓ ${p}`));
  }

  if (notFoundPlayers.length > 0) {
    console.log(`\nFirst 20 players not found:`);
    notFoundPlayers.slice(0, 20).forEach(name => console.log(`  ✗ ${name}`));

    // Save not found list
    fs.writeFileSync('./henry-3-not-found.txt', notFoundPlayers.join('\n'));
    console.log(`\nSaved complete list of ${notFoundPlayers.length} not found players to: henry-3-not-found.txt`);
  }

  console.log(`\nOutput written to: ${outputFile}`);
}

processPlayers();
