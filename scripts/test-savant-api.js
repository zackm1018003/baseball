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
  // Try the pitcher page stats API
  const urls = [
    // Snell's player page data
    'https://baseballsavant.mlb.com/player-services/statcast-pitching-breakdown?playerId=605483&position=1&hand=&season=2025&pitchBreakdown=pitches',
    // Alternative: pitch arsenal stats
    'https://baseballsavant.mlb.com/leaderboard/pitch-arsenals?type=avg_speed&year=2025&team=&min=10&csv=true',
  ];

  for (let i = 0; i < urls.length; i++) {
    console.log(`\nTest ${i + 1}: ${urls[i].substring(0, 100)}...`);
    try {
      const res = await httpsGet(urls[i]);
      console.log('Status:', res.statusCode);
      console.log('Length:', res.body.length);
      console.log('Preview:', res.body.substring(0, 500));
    } catch (e) {
      console.log('Error:', e.message);
    }
  }
}

test().catch(console.error);
