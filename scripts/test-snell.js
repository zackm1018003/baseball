const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function test() {
  // Blake Snell = 605483
  const url = 'https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details&player_id=605483&player_type=pitcher&game_date_gt=2025-01-01&game_date_lt=2025-12-31';
  console.log('Fetching Snell 2025 data...');
  const res = await httpsGet(url);
  const lines = res.body.trim().split('\n');
  console.log('Rows:', lines.length - 1);

  const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
  const typeIdx = headers.indexOf('pitch_type');

  const types = {};
  for (let i = 1; i < lines.length; i++) {
    const vals = [];
    let current = '';
    let inQuotes = false;
    for (const char of lines[i]) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === ',' && !inQuotes) { vals.push(current.trim()); current = ''; continue; }
      current += char;
    }
    vals.push(current.trim());
    const t = vals[typeIdx];
    if (t) types[t] = (types[t] || 0) + 1;
  }

  const total = Object.values(types).reduce((a, b) => a + b, 0);
  console.log('\nPitch usage (2025):');
  Object.entries(types).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => {
    console.log(`  ${t}: ${(c / total * 100).toFixed(1)}% (${c} pitches)`);
  });
}

test().catch(console.error);
