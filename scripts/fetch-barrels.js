// Fetch pitch-level Statcast data to compute Barrel% per pitcher per pitch type.
// Barrel definition (per MLB): EV >= 98 mph AND launch angle within a range that
// expands as EV increases. At 98 mph: 26-30°, at 99: 25-31°, ...
// expanding by ~1° on each side per mph up to a max range of ~8-50° at 116+ mph.

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

// MLB barrel definition: EV >= 98 mph, launch angle within expanding sweet spot
function isBarrel(exitVelo, launchAngle) {
  if (exitVelo < 98 || isNaN(exitVelo) || isNaN(launchAngle)) return false;

  // At 98 mph the zone is 26-30 degrees.
  // For each mph above 98, the zone expands ~1° on each side.
  // Min launch angle floors at 8°, max caps at 50°.
  const evAbove98 = Math.min(exitVelo - 98, 18); // cap at 116 mph
  const minLA = Math.max(8, 26 - evAbove98);
  const maxLA = Math.min(50, 30 + evAbove98);

  return launchAngle >= minLA && launchAngle <= maxLA;
}

async function fetchPitchTypeBarrels(pt) {
  const months = [
    { start: '2025-03-01', end: '2025-04-30' },
    { start: '2025-05-01', end: '2025-06-30' },
    { start: '2025-07-01', end: '2025-08-31' },
    { start: '2025-09-01', end: '2025-10-31' },
  ];

  // pitcherId -> { barrels, battedBalls }
  const accum = {};

  for (const range of months) {
    const url = `https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfPT=${pt}%7C&hfSea=${SEASON}%7C&player_type=pitcher&min_pitches=0&min_results=0&group_by=name-event&sort_col=pitches&sort_order=desc&type=details&game_date_gt=${range.start}&game_date_lt=${range.end}`;

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
    const lsIdx = headers.indexOf('launch_speed');
    const laIdx = headers.indexOf('launch_angle');

    if (lsIdx === -1 || laIdx === -1) {
      console.log(`    Missing launch_speed/launch_angle columns`);
      continue;
    }

    let barrelCount = 0;
    let battedCount = 0;

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const vals = parseCSVLine(lines[i]);
      const pitcherId = vals[pitcherIdx];
      const ev = parseFloat(vals[lsIdx]);
      const la = parseFloat(vals[laIdx]);

      if (!pitcherId) continue;

      // Only count batted ball events (those with exit velo data)
      if (isNaN(ev) || ev === 0) continue;

      if (!accum[pitcherId]) accum[pitcherId] = { barrels: 0, battedBalls: 0 };
      accum[pitcherId].battedBalls++;
      battedCount++;

      if (isBarrel(ev, la)) {
        accum[pitcherId].barrels++;
        barrelCount++;
      }
    }

    console.log(`    ${range.start}: ${lines.length - 1} rows, ${battedCount} batted balls, ${barrelCount} barrels`);
    await sleep(1000);
  }

  return accum;
}

async function main() {
  const pitchTypes = ['FF', 'SI', 'FC', 'SL', 'CH', 'CU', 'FS', 'ST', 'SV', 'KC'];

  // Master: key = `${pitcherId}_${code}` -> { barrels, battedBalls }
  const masterAccum = {};

  for (const pt of pitchTypes) {
    console.log(`\nFetching ${pt}...`);
    const accum = await fetchPitchTypeBarrels(pt);

    const code = pt.toLowerCase();
    for (const [pitcherId, data] of Object.entries(accum)) {
      const key = `${pitcherId}_${code}`;
      if (!masterAccum[key]) masterAccum[key] = { barrels: 0, battedBalls: 0 };
      masterAccum[key].barrels += data.barrels;
      masterAccum[key].battedBalls += data.battedBalls;
    }

    const pitcherCount = Object.keys(accum).length;
    console.log(`  ${pt}: ${pitcherCount} pitchers with barrel data`);
    await sleep(500);
  }

  // Merge into pitchers.json
  const pitchers = JSON.parse(fs.readFileSync('data/pitchers.json', 'utf8'));
  let updated = 0;

  const codes = ['ff', 'si', 'fc', 'sl', 'ch', 'cu', 'fs', 'st', 'sv', 'kc'];
  pitchers.forEach(p => {
    const id = String(p.player_id);
    codes.forEach(code => {
      if (!p[code]) return;
      const key = `${id}_${code}`;
      const data = masterAccum[key];
      if (data && data.battedBalls >= 5) {
        const barrelPct = Math.round((data.barrels / data.battedBalls) * 1000) / 10;
        p[code].barrel_pct = barrelPct;
        updated++;
      }
    });
  });

  fs.writeFileSync('data/pitchers.json', JSON.stringify(pitchers, null, 2));
  console.log(`\nUpdated ${updated} pitch entries with barrel%.`);

  // Verify known pitchers
  const names = ['Skenes', 'Ashcraft', 'Snell', 'Webb'];
  names.forEach(n => {
    const pitcher = pitchers.find(x => x.full_name && x.full_name.includes(n));
    if (!pitcher) return;
    console.log(`\n${pitcher.full_name}:`);
    codes.forEach(c => {
      if (pitcher[c] && pitcher[c].barrel_pct !== undefined) {
        console.log(`  ${c.toUpperCase()}: Barrel%=${pitcher[c].barrel_pct}%`);
      }
    });
  });
}

main().catch(console.error);
