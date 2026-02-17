// Fetch pitch usage splits vs LHH and RHH from Statcast.
// Queries all pitches with stand=L and stand=R separately,
// counts per pitcher per pitch type, computes usage %.

const https = require('https');
const fs = require('fs');

const SEASON = 2025;

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  result.push(current.trim());
  return result;
}

// Map Savant pitch_type codes to our data keys
const PT_MAP = {
  'FF': 'ff', 'SI': 'si', 'FC': 'fc', 'SL': 'sl', 'CH': 'ch',
  'CU': 'cu', 'KC': 'kc', 'FS': 'fs', 'ST': 'st', 'SV': 'sv',
  'CS': 'cu', 'KN': 'kn', 'FO': 'fo',
};

async function fetchStandData(stand) {
  // Use half-month chunks to stay well under the 25,000 row limit
  const months = [
    { start: '2025-03-01', end: '2025-03-31' },
    { start: '2025-04-01', end: '2025-04-15' },
    { start: '2025-04-16', end: '2025-04-30' },
    { start: '2025-05-01', end: '2025-05-15' },
    { start: '2025-05-16', end: '2025-05-31' },
    { start: '2025-06-01', end: '2025-06-15' },
    { start: '2025-06-16', end: '2025-06-30' },
    { start: '2025-07-01', end: '2025-07-15' },
    { start: '2025-07-16', end: '2025-07-31' },
    { start: '2025-08-01', end: '2025-08-15' },
    { start: '2025-08-16', end: '2025-08-31' },
    { start: '2025-09-01', end: '2025-09-15' },
    { start: '2025-09-16', end: '2025-09-30' },
    { start: '2025-10-01', end: '2025-10-31' },
  ];

  // pitcherId -> { total: N, pitchCounts: { ff: N, si: N, ... } }
  const accum = {};

  for (const range of months) {
    const url = `https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfSea=${SEASON}%7C&player_type=pitcher&stand=${stand}&min_pitches=0&min_results=0&group_by=name-event&sort_col=pitches&sort_order=desc&type=details&game_date_gt=${range.start}&game_date_lt=${range.end}`;

    let res;
    try {
      res = await httpsGet(url);
    } catch (err) {
      console.log(`    Error ${range.start}-${range.end}: ${err.message}`);
      continue;
    }

    if (res.statusCode !== 200) {
      console.log(`    HTTP ${res.statusCode} for ${range.start}-${range.end}`);
      continue;
    }

    if (res.body.length < 200) {
      console.log(`    No data for ${range.start}-${range.end}`);
      continue;
    }

    const lines = res.body.trim().split('\n');
    if (lines.length < 2) continue;

    const headers = parseCSVLine(lines[0]);
    const pitcherIdx = headers.indexOf('pitcher');
    const ptIdx = headers.indexOf('pitch_type');

    if (pitcherIdx === -1 || ptIdx === -1) {
      console.log(`    Missing pitcher/pitch_type columns`);
      continue;
    }

    let pitchCount = 0;
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const vals = parseCSVLine(lines[i]);
      const pitcherId = vals[pitcherIdx];
      const pt = vals[ptIdx];

      if (!pitcherId || !pt) continue;

      const code = PT_MAP[pt];
      if (!code) continue;

      if (!accum[pitcherId]) accum[pitcherId] = { total: 0, pitchCounts: {} };
      accum[pitcherId].total++;
      accum[pitcherId].pitchCounts[code] = (accum[pitcherId].pitchCounts[code] || 0) + 1;
      pitchCount++;
    }

    if (lines.length - 1 >= 25000) {
      console.log(`    ⚠️  ${range.start}: HIT 25K LIMIT (${lines.length - 1} rows) — data may be truncated!`);
    } else {
      console.log(`    ${range.start}: ${lines.length - 1} rows, ${pitchCount} pitches counted`);
    }
    await sleep(1000);
  }

  return accum;
}

async function main() {
  console.log('Fetching vs LHH (stand=L)...');
  const lhh = await fetchStandData('L');
  console.log(`  LHH: ${Object.keys(lhh).length} pitchers\n`);

  console.log('Fetching vs RHH (stand=R)...');
  const rhh = await fetchStandData('R');
  console.log(`  RHH: ${Object.keys(rhh).length} pitchers\n`);

  // Merge into pitchers.json
  const pitchers = JSON.parse(fs.readFileSync('data/pitchers.json', 'utf8'));
  let updated = 0;

  const codes = ['ff', 'si', 'fc', 'sl', 'ch', 'cu', 'fs', 'st', 'sv', 'kc'];

  pitchers.forEach(p => {
    const id = String(p.player_id);

    const lhhData = lhh[id];
    const rhhData = rhh[id];

    codes.forEach(code => {
      if (!p[code]) return;

      if (lhhData && lhhData.total > 0) {
        const count = lhhData.pitchCounts[code] || 0;
        p[code].usage_vs_lhh = Math.round((count / lhhData.total) * 1000) / 10;
      }

      if (rhhData && rhhData.total > 0) {
        const count = rhhData.pitchCounts[code] || 0;
        p[code].usage_vs_rhh = Math.round((count / rhhData.total) * 1000) / 10;
      }
    });

    if (lhhData || rhhData) updated++;
  });

  fs.writeFileSync('data/pitchers.json', JSON.stringify(pitchers, null, 2));
  console.log(`Updated ${updated} pitchers with usage splits.`);

  // Verify
  const names = ['Skenes', 'Nola', 'Snell', 'Ashcraft'];
  names.forEach(n => {
    const pitcher = pitchers.find(x => x.full_name && x.full_name.includes(n));
    if (!pitcher) return;
    console.log(`\n${pitcher.full_name}:`);
    codes.forEach(c => {
      if (pitcher[c] && pitcher[c].usage > 0) {
        console.log(`  ${c.toUpperCase()}: overall=${pitcher[c].usage}% vsLHH=${pitcher[c].usage_vs_lhh}% vsRHH=${pitcher[c].usage_vs_rhh}%`);
      }
    });
  });
}

main().catch(console.error);
