const fs = require('fs');
const path = require('path');

// Read the henry file
const henryPath = path.join(__dirname, '../henry');
const data = fs.readFileSync(henryPath, 'utf-8');

// Split into lines
const lines = data.trim().split('\n');

// Get headers
const headers = lines[0].split('\t');

// Parse data
const players = [];
for (let i = 1; i < lines.length; i++) {
  const values = lines[i].split('\t');
  const player = {};

  headers.forEach((header, index) => {
    const value = values[index];

    // Clean up header names
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
    } else {
      player[cleanHeader] = value || null;
    }
  });

  players.push(player);
}

// Write to JSON file
const outputPath = path.join(__dirname, '../data/players.json');
const dataDir = path.join(__dirname, '../data');

// Create data directory if it doesn't exist
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

fs.writeFileSync(outputPath, JSON.stringify(players, null, 2));

console.log(`Parsed ${players.length} players from henry file`);
console.log(`Data saved to ${outputPath}`);
