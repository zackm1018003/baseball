// Combined fetch: barrel% AND usage splits (vs LHH/RHH) from Statcast in one pass.
// Per pitch type × per month = 80 requests. Extracts pitcher, stand, launch_speed, launch_angle.

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

function isBarrel(exitVelo, launchAngle) {
  if (exitVelo < 98 || isNaN(exitVelo) || isNaN(launchAngle)) return false;
  const evAbove98 = Math.min(exitVelo - 98, 18);
  const minLA = Math.max(8, 26 - evAbove98);
  const maxLA = Math.min(50, 30 + evAbove98);
  return launchAngle >= minLA && launchAngle <= maxLA;
}

const months = [
  { start: '2025-03-01', end: '2025-03-31' },
  { start: '2025-04-01', end: '2025-04-30' },
  { start: '2025-05-01', end: '2025-05-31' },
  { start: '2025-06-01', end: '2025-06-30' },
  { start: '2025-07-01', end: '2025-07-31' },
  { start: '2025-08-01', end: '2025-08-31' },
  { start: '2025-09-01', end: '2025-09-30' },
  { start: '2025-10-01', end: '2025-10-31' },
];

async function main() {
  const pitchTypes = ['FF', 'SI', 'FC', 'SL', 'CH', 'CU', 'FS', 'ST', 'SV', 'KC'];

  // Per pitcher per pitch code: { barrels, battedBalls, vsL, vsR }
  const data = {};
  // Per pitcher: { totalL, totalR } (for computing usage %)
  const totals = {};

  for (const pt of pitchTypes) {
    const code = pt.toLowerCase();
    console.log(`Fetching ${pt}...`);

    for (const range of months) {
      const url = `https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfPT=${pt}%7C&hfSea=${SEASON}%7C&player_type=pitcher&min_pitches=0&min_results=0&group_by=name-event&sort_col=pitches&sort_order=desc&type=details&game_date_gt=${range.start}&game_date_lt=${range.end}`;

      let res;
      try {
        res = await httpsGet(url);
      } catch (err) {
        console.log(`  ${range.start}: error - ${err.message}`);
        continue;
      }

      if (res.statusCode !== 200 || res.body.length < 200) {
        console.log(`  ${range.start}: no data`);
        continue;
      }

      const lines = res.body.trim().split('\n');
      if (lines.length < 2) continue;

      const headers = parseCSVLine(lines[0]);
      const pitcherIdx = headers.indexOf('pitcher');
      const standIdx = headers.indexOf('stand');
      const lsIdx = headers.indexOf('launch_speed');
      const laIdx = headers.indexOf('launch_angle');

      let rows = 0;
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const vals = parseCSVLine(lines[i]);
        const pid = vals[pitcherIdx];
        const stand = vals[standIdx]; // 'L' or 'R'
        if (!pid) continue;

        const key = `${pid}_${code}`;
        if (!data[key]) data[key] = { barrels: 0, battedBalls: 0, vsL: 0, vsR: 0 };
        if (!totals[pid]) totals[pid] = { totalL: 0, totalR: 0 };

        // Count splits
        if (stand === 'L') {
          data[key].vsL++;
          totals[pid].totalL++;
        } else if (stand === 'R') {
          data[key].vsR++;
          totals[pid].totalR++;
        }

        // Count barrels (only for batted balls with exit velo)
        const ev = parseFloat(vals[lsIdx]);
        const la = parseFloat(vals[laIdx]);
        if (!isNaN(ev) && ev > 0) {
          data[key].battedBalls++;
          if (isBarrel(ev, la)) data[key].barrels++;
        }

        rows++;
      }

      console.log(`  ${range.start}: ${lines.length - 1} rows`);
      await sleep(800);
    }
  }

  // Merge into pitchers.json
  const pitchers = JSON.parse(fs.readFileSync('data/pitchers.json', 'utf8'));
  let barrelUpdated = 0, splitUpdated = 0;

  const codes = ['ff', 'si', 'fc', 'sl', 'ch', 'cu', 'fs', 'st', 'sv', 'kc'];
  pitchers.forEach(p => {
    const id = String(p.player_id);
    const t = totals[id];

    codes.forEach(code => {
      if (!p[code]) return;
      const key = `${id}_${code}`;
      const d = data[key];
      if (!d) return;

      // Barrel %
      if (d.battedBalls >= 5) {
        p[code].barrel_pct = Math.round((d.barrels / d.battedBalls) * 1000) / 10;
        barrelUpdated++;
      }

      // Usage splits
      if (t) {
        if (t.totalL > 0) {
          p[code].usage_vs_lhh = Math.round((d.vsL / t.totalL) * 1000) / 10;
          splitUpdated++;
        }
        if (t.totalR > 0) {
          p[code].usage_vs_rhh = Math.round((d.vsR / t.totalR) * 1000) / 10;
        }
      }
    });
  });

  fs.writeFileSync('data/pitchers.json', JSON.stringify(pitchers, null, 2));
  console.log(`\nBarrel% updated: ${barrelUpdated} entries`);
  console.log(`Split usage updated: ${splitUpdated} entries`);

  // Verify
  ['Skenes', 'Nola', 'Snell', 'Ashcraft'].forEach(n => {
    const p = pitchers.find(x => x.full_name && x.full_name.includes(n));
    if (!p) return;
    console.log(`\n${p.full_name}:`);
    codes.forEach(c => {
      if (p[c] && p[c].usage > 0) {
        console.log(`  ${c.toUpperCase()}: barrel=${p[c].barrel_pct ?? '?'}% vsLHH=${p[c].usage_vs_lhh ?? '?'}% vsRHH=${p[c].usage_vs_rhh ?? '?'}%`);
      }
    });
  });
}

main().catch(console.error);
