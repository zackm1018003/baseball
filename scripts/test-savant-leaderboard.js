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

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/["\ufeff]/g, '').trim());
  return { headers, rowCount: lines.length - 1 };
}

async function test() {
  // Available leaderboard types for pitch arsenals
  const types = [
    'avg_speed',      // velocity
    'avg_spin',       // spin rate
    'n_total',        // pitch count
    'n_formatted',    // pitch count formatted
    'run_value_per_100', // run value
    'pitch_usage',    // usage %
    'ba',             // batting average against
    'whiff_percent',  // whiff %
    'put_away',       // put away %
    'hard_hit_percent', // hard hit %
    'avg_movement_x', // horizontal movement
    'avg_movement_z', // induced vertical break
  ];

  for (const type of types) {
    const url = `https://baseballsavant.mlb.com/leaderboard/pitch-arsenals?type=${type}&year=2025&team=&min=10&csv=true`;
    try {
      const res = await httpsGet(url);
      if (res.statusCode === 200 && res.body.length > 100) {
        const { headers, rowCount } = parseCSV(res.body);
        console.log(`${type.padEnd(20)} — ${rowCount} rows — columns: ${headers.slice(0, 6).join(', ')}...`);
      } else {
        console.log(`${type.padEnd(20)} — FAILED (${res.statusCode})`);
      }
    } catch (e) {
      console.log(`${type.padEnd(20)} — ERROR: ${e.message}`);
    }
  }

  // Also check pitch movement leaderboard
  console.log('\n--- Pitch Movement Leaderboard ---');
  const movUrl = 'https://baseballsavant.mlb.com/leaderboard/pitch-movement?year=2025&team=&pitch_type=FF&min=10&csv=true';
  const movRes = await httpsGet(movUrl);
  if (movRes.statusCode === 200) {
    const { headers, rowCount } = parseCSV(movRes.body);
    console.log(`FF movement — ${rowCount} rows — columns: ${headers.join(', ')}`);
  }
}

test().catch(console.error);
