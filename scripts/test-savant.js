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
  const playerId = 694973; // Skenes

  // Test different URL formats
  const urls = [
    `https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details&player_id=${playerId}&player_type=pitcher&game_date_gt=2025-01-01&game_date_lt=2025-12-31`,
    `https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details&player_id=${playerId}&player_type=pitcher&season=2025`,
    `https://baseballsavant.mlb.com/statcast_search/csv?hfSea=2025|&player_id=${playerId}&player_type=pitcher&all=true&type=details`,
  ];

  for (let i = 0; i < urls.length; i++) {
    console.log(`\nTest ${i + 1}:`);
    console.log(urls[i].substring(0, 120) + '...');
    const res = await httpsGet(urls[i]);
    const lines = res.body.trim().split('\n');
    console.log('Rows:', lines.length - 1);

    // Check game_date column
    const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
    const dateIdx = headers.indexOf('game_date');
    if (dateIdx >= 0 && lines.length > 2) {
      // Sample some dates
      const dates = new Set();
      for (let j = 1; j < Math.min(lines.length, 100); j++) {
        const vals = lines[j].split(',');
        const d = vals[dateIdx] ? vals[dateIdx].replace(/"/g, '') : '';
        if (d) dates.add(d.substring(0, 4)); // just the year
      }
      console.log('Years in sample:', [...dates].sort().join(', '));
    }
  }
}

test().catch(console.error);
