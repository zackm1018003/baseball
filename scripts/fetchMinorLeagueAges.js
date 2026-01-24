const fs = require('fs');
const path = require('path');
const https = require('https');

// Sleep function to avoid rate limiting
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch player data from MLB Stats API by name
async function searchPlayerByName(playerName) {
  return new Promise((resolve) => {
    try {
      // Clean up the name for searching
      const searchName = playerName.trim();
      const encodedName = encodeURIComponent(searchName);

      const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodedName}`;

      https.get(url, (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += chunk;
        });

        response.on('end', () => {
          try {
            const jsonData = JSON.parse(data);

            if (jsonData.people && jsonData.people.length > 0) {
              // Return the first match (most likely to be correct)
              const player = jsonData.people[0];
              resolve({
                player_id: player.id,
                birthDate: player.birthDate,
                currentAge: player.currentAge,
                fullName: player.fullName
              });
            } else {
              resolve(null);
            }
          } catch (error) {
            console.error(`Error parsing JSON for ${playerName}:`, error.message);
            resolve(null);
          }
        });
      }).on('error', (error) => {
        console.error(`Error fetching ${playerName}:`, error.message);
        resolve(null);
      });
    } catch (error) {
      console.error(`Error searching for ${playerName}:`, error.message);
      resolve(null);
    }
  });
}

// Calculate age from birth date
function calculateAge(birthDate) {
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }

  return age;
}

// Main function to fetch ages for all minor league datasets
async function fetchMinorLeagueAges() {
  const datasets = [
    { input: 'players2.json', name: 'AAA 2025' },
    { input: 'players3.json', name: 'AA 2025' },
    { input: 'players4.json', name: 'A+ 2025' },
    { input: 'players5.json', name: 'A 2025' }
  ];

  for (const dataset of datasets) {
    console.log(`\nProcessing ${dataset.name}...`);
    const filePath = path.join(__dirname, '../data', dataset.input);

    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  ${dataset.input} not found - skipping`);
      continue;
    }

    const players = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    let updated = 0;
    let alreadyHaveAge = 0;
    let notFound = 0;

    for (let i = 0; i < players.length; i++) {
      const player = players[i];

      // Skip if player already has age
      if (player.age !== null && player.age !== undefined) {
        alreadyHaveAge++;
        continue;
      }

      console.log(`  Searching for ${player.full_name}...`);

      // Search for player
      const result = await searchPlayerByName(player.full_name);

      if (result) {
        // Update player_id if we don't have one
        if (!player.player_id && result.player_id) {
          player.player_id = result.player_id;
          console.log(`    ✓ Found player_id: ${result.player_id}`);
        }

        // Add age
        if (result.currentAge) {
          player.age = result.currentAge;
          console.log(`    ✓ Added age: ${result.currentAge}`);
          updated++;
        } else if (result.birthDate) {
          player.age = calculateAge(result.birthDate);
          console.log(`    ✓ Calculated age: ${player.age}`);
          updated++;
        }
      } else {
        console.log(`    ✗ Not found`);
        notFound++;
      }

      // Rate limiting - wait 100ms between requests
      await sleep(100);
    }

    // Save updated data
    fs.writeFileSync(filePath, JSON.stringify(players, null, 2));
    console.log(`\n✓ ${dataset.name}: Updated ${updated} players, ${alreadyHaveAge} already had age, ${notFound} not found`);
  }

  console.log('\nDone!');
}

// Run the script
fetchMinorLeagueAges();
