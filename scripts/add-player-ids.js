const fs = require('fs');
const https = require('https');

// Read the henry-3 file
const inputFile = './henry-3';
const outputFile = './henry-3-with-ids';

function searchPlayerByName(name) {
  return new Promise((resolve, reject) => {
    const encodedName = encodeURIComponent(name);
    const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodedName}`;

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.people && json.people.length > 0) {
            // Return the first match
            resolve({
              id: json.people[0].id,
              fullName: json.people[0].fullName,
              confidence: json.people.length === 1 ? 'high' : 'medium'
            });
          } else {
            resolve(null);
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function processPlayers() {
  const data = fs.readFileSync(inputFile, 'utf8');
  const lines = data.trim().split('\n');
  const header = lines[0];
  const playerLines = lines.slice(1);

  console.log(`Found ${playerLines.length} players to process`);

  // Add ID column to header
  const newHeader = 'ID\t' + header;
  const results = [newHeader];

  let found = 0;
  let notFound = 0;
  const notFoundPlayers = [];

  for (let i = 0; i < playerLines.length; i++) {
    const line = playerLines[i];
    if (!line.trim()) continue;

    const parts = line.split('\t');
    const playerName = parts[0];

    console.log(`[${i + 1}/${playerLines.length}] Searching for: ${playerName}`);

    try {
      const result = await searchPlayerByName(playerName);

      if (result) {
        console.log(`  ✓ Found: ${result.fullName} (ID: ${result.id}) - Confidence: ${result.confidence}`);
        results.push(`${result.id}\t${line}`);
        found++;
      } else {
        console.log(`  ✗ Not found`);
        results.push(`\t${line}`); // Add empty ID
        notFound++;
        notFoundPlayers.push(playerName);
      }

      // Rate limiting - wait 200ms between requests
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`  Error searching for ${playerName}:`, error.message);
      results.push(`\t${line}`); // Add empty ID
      notFound++;
      notFoundPlayers.push(playerName);
    }
  }

  // Write results
  fs.writeFileSync(outputFile, results.join('\n'));

  console.log('\n=== Summary ===');
  console.log(`Total players: ${playerLines.length}`);
  console.log(`Found: ${found}`);
  console.log(`Not found: ${notFound}`);

  if (notFoundPlayers.length > 0) {
    console.log('\nPlayers not found:');
    notFoundPlayers.forEach(name => console.log(`  - ${name}`));

    // Save not found list
    fs.writeFileSync('./henry-3-not-found.txt', notFoundPlayers.join('\n'));
    console.log('\nSaved list of not found players to: henry-3-not-found.txt');
  }

  console.log(`\nOutput written to: ${outputFile}`);
}

processPlayers().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
