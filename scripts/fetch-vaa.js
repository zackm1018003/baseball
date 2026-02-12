// Fetch pitch-level data from Statcast to calculate VAA per pitcher per pitch type
// Uses the Fangraphs formula: VAA = -arctan(vz_f / vy_f) * (180/pi)
// where:
//   vy_f = -sqrt(vy0^2 - 2*ay*(y0 - yf))
//   t = (vy_f - vy0) / ay
//   vz_f = vz0 + az*t
//   y0 = 50 (measurement point), yf = 17/12 (front of plate in feet)

const https = require('https');
const fs = require('fs');

const SEASON = 2025;
const Y0 = 50; // Statcast measurement point (feet)
const YF = 17 / 12; // Front of home plate (17 inches in feet)

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

// Proper CSV line parser that handles quoted fields with commas
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function calcVAA(vy0, vz0, ay, az) {
  const disc = vy0 * vy0 - 2 * ay * (Y0 - YF);
  if (disc < 0) return null;
  const vy_f = -Math.sqrt(disc);
  if (ay === 0) return null;
  const t = (vy_f - vy0) / ay;
  const vz_f = vz0 + az * t;
  const vaa = -Math.atan(vz_f / vy_f) * (180 / Math.PI);
  // Sanity check: VAA should be between -15 and 5 degrees
  if (isNaN(vaa) || vaa < -15 || vaa > 5) return null;
  return vaa;
}

async function fetchPitchTypeData(pt) {
  // Statcast limits to 25000 rows. For some pitch types we need multiple pages.
  // We'll fetch by month ranges to get all data.
  const months = [
    { start: '2025-03-01', end: '2025-04-30' },
    { start: '2025-05-01', end: '2025-06-30' },
    { start: '2025-07-01', end: '2025-08-31' },
    { start: '2025-09-01', end: '2025-10-31' },
  ];

  const vaaAccum = {}; // pitcherId -> { sum, count }

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
    const vy0Idx = headers.indexOf('vy0');
    const vz0Idx = headers.indexOf('vz0');
    const ayIdx = headers.indexOf('ay');
    const azIdx = headers.indexOf('az');

    if (vy0Idx === -1 || vz0Idx === -1 || ayIdx === -1 || azIdx === -1) {
      console.log(`    Missing tracking columns`);
      continue;
    }

    let pitchCount = 0;
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i]);
      const pitcherId = vals[pitcherIdx];
      const vy0 = parseFloat(vals[vy0Idx]);
      const vz0 = parseFloat(vals[vz0Idx]);
      const ay = parseFloat(vals[ayIdx]);
      const az = parseFloat(vals[azIdx]);

      if (!pitcherId || isNaN(vy0) || isNaN(vz0) || isNaN(ay) || isNaN(az)) continue;

      const vaa = calcVAA(vy0, vz0, ay, az);
      if (vaa === null) continue;

      if (!vaaAccum[pitcherId]) vaaAccum[pitcherId] = { sum: 0, count: 0 };
      vaaAccum[pitcherId].sum += vaa;
      vaaAccum[pitcherId].count++;
      pitchCount++;
    }

    console.log(`    ${range.start}: ${lines.length - 1} rows, ${pitchCount} VAA calcs`);
    await sleep(1000);
  }

  return vaaAccum;
}

async function main() {
  const pitchTypes = ['FF', 'SI', 'FC', 'SL', 'CH', 'CU', 'FS', 'ST', 'SV', 'KC'];

  // Master accumulator: key = `${pitcherId}_${code}` -> { sum, count }
  const masterAccum = {};

  for (const pt of pitchTypes) {
    console.log(`\nFetching ${pt}...`);
    const accum = await fetchPitchTypeData(pt);

    const code = pt.toLowerCase();
    for (const [pitcherId, data] of Object.entries(accum)) {
      const key = `${pitcherId}_${code}`;
      if (!masterAccum[key]) masterAccum[key] = { sum: 0, count: 0 };
      masterAccum[key].sum += data.sum;
      masterAccum[key].count += data.count;
    }

    const pitcherCount = Object.keys(accum).length;
    console.log(`  ${pt}: ${pitcherCount} pitchers with VAA data`);
    await sleep(500);
  }

  // Merge into pitchers.json
  const pitchers = JSON.parse(fs.readFileSync('data/pitchers.json', 'utf8'));
  let updated = 0;
  let missing = 0;

  const codes = ['ff','si','fc','sl','ch','cu','fs','st','sv','kc'];
  pitchers.forEach(p => {
    const id = String(p.player_id);
    codes.forEach(code => {
      if (!p[code]) return; // No pitch object
      const key = `${id}_${code}`;
      const accum = masterAccum[key];
      if (accum && accum.count > 0) {
        p[code].vaa = Math.round((accum.sum / accum.count) * 100) / 100;
        updated++;
      } else {
        missing++;
      }
    });
  });

  fs.writeFileSync('data/pitchers.json', JSON.stringify(pitchers, null, 2));
  console.log(`\nUpdated ${updated} pitch entries with VAA.`);
  console.log(`Missing VAA for ${missing} pitch entries.`);
  console.log(`Total pitcher-pitch combos in Statcast: ${Object.keys(masterAccum).length}`);

  // Verify known pitchers
  const names = ['Skenes', 'Snell', 'Zerpa', 'Webb'];
  names.forEach(n => {
    const pitcher = pitchers.find(x => x.full_name && x.full_name.includes(n));
    if (!pitcher) return;
    console.log(`\n${pitcher.full_name} (${pitcher.throws}HP):`);
    codes.forEach(c => {
      if (pitcher[c] && pitcher[c].vaa !== undefined) {
        console.log(`  ${c.toUpperCase()}: VAA=${pitcher[c].vaa}°`);
      }
    });
  });
}

main().catch(console.error);
