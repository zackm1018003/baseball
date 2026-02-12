#!/usr/bin/env node

/**
 * enrich-pitchers.js
 *
 * Reads pitchers.json and fills in missing data from Baseball Savant + MLB Stats API.
 *
 * USAGE:
 *   node scripts/enrich-pitchers.js
 *   node scripts/enrich-pitchers.js --limit 10      (only first 10 pitchers missing data)
 *   node scripts/enrich-pitchers.js --id 657277      (single pitcher by player_id)
 *
 * What it fills in:
 *   - IVB (induced vertical break) per pitch type
 *   - HB (horizontal break) per pitch type
 *   - VAA (vertical approach angle) per pitch type
 *   - Usage % per pitch type
 *   - Traditional stats: ERA, WHIP, K/9, BB/9, IP, W/L/SV
 *   - Bio: age, throws, team
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'pitchers.json');
const SEASON = 2025;

// Parse CLI args
const args = process.argv.slice(2);
let limit = Infinity;
let targetId = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1]);
  if (args[i] === '--id' && args[i + 1]) targetId = parseInt(args[i + 1]);
}

// Pitch type code to our JSON key
const PITCH_TYPE_MAP = {
  'FF': 'ff', 'SI': 'si', 'FC': 'fc', 'CH': 'ch', 'FS': 'fs',
  'FO': 'fo', 'CU': 'cu', 'KC': 'kc', 'SL': 'sl', 'ST': 'st', 'SV': 'sv',
};

// Also map to legacy field names
const LEGACY_MAP = {
  'FF': 'fastball', 'SI': 'sinker', 'FC': 'cutter', 'CH': 'changeup',
  'FS': 'splitter', 'FO': 'forkball', 'CU': 'curveball', 'KC': 'knuckle_curve',
  'SL': 'slider', 'ST': 'sweeper', 'SV': 'slurve',
};

// ─── HTTP helper ─────────────────────────────────────────

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── CSV parser ──────────────────────────────────────────

function parseCSV(csvString) {
  const lines = csvString.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const values = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue; }
      current += char;
    }
    values.push(current.trim());

    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

// ─── Fetch Statcast data ─────────────────────────────────

async function fetchStatcast(playerId) {
  const url = `https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details&player_id=${playerId}&player_type=pitcher&season=${SEASON}`;
  const res = await httpsGet(url);

  if (res.statusCode !== 200 || res.body.length < 100) {
    // Try previous season
    const url2 = url.replace(`season=${SEASON}`, `season=${SEASON - 1}`);
    const res2 = await httpsGet(url2);
    if (res2.statusCode !== 200 || res2.body.length < 100) return [];
    return parseCSV(res2.body);
  }
  return parseCSV(res.body);
}

// ─── Aggregate Statcast into per-pitch-type data ─────────

function aggregateStatcast(rows) {
  if (!rows.length) return null;

  const groups = {};
  const totalPitches = rows.length;

  rows.forEach(row => {
    const type = row.pitch_type;
    if (!PITCH_TYPE_MAP[type]) return;

    if (!groups[type]) groups[type] = { count: 0, velos: [], spins: [], hBreaks: [], vBreaks: [], vaas: [] };
    const g = groups[type];
    g.count++;

    const velo = parseFloat(row.release_speed);
    if (!isNaN(velo)) g.velos.push(velo);

    const spin = parseFloat(row.release_spin_rate);
    if (!isNaN(spin)) g.spins.push(spin);

    // pfx_x and pfx_z are in feet, convert to inches
    const hb = parseFloat(row.pfx_x);
    if (!isNaN(hb)) g.hBreaks.push(hb * 12);

    const ivb = parseFloat(row.pfx_z);
    if (!isNaN(ivb)) g.vBreaks.push(ivb * 12);

    // VAA from velocity components
    const vz0 = parseFloat(row.vz0);
    const vy0 = parseFloat(row.vy0);
    if (!isNaN(vz0) && !isNaN(vy0) && vy0 !== 0) {
      g.vaas.push(Math.atan2(vz0, Math.abs(vy0)) * (180 / Math.PI));
    }
  });

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : undefined;
  const r1 = v => v !== undefined ? Math.round(v * 10) / 10 : undefined;
  const r2 = v => v !== undefined ? Math.round(v * 100) / 100 : undefined;

  const countedPitches = Object.values(groups).reduce((s, g) => s + g.count, 0);
  const result = {};

  for (const [type, g] of Object.entries(groups)) {
    const usage = (g.count / countedPitches) * 100;
    if (usage < 0.5) continue;

    const key = PITCH_TYPE_MAP[type];
    result[key] = {
      movement_h: r1(avg(g.hBreaks)),
      movement_v: r1(avg(g.vBreaks)),
      vaa: r2(avg(g.vaas)),
      usage: r1(usage),
    };
  }

  return result;
}

// ─── Fetch traditional stats ─────────────────────────────

async function fetchStats(playerId) {
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&season=${SEASON}&group=pitching`;
  const res = await httpsGet(url);
  const json = JSON.parse(res.body);
  let splits = json?.stats?.[0]?.splits;

  if (!splits?.length) {
    const url2 = url.replace(`season=${SEASON}`, `season=${SEASON - 1}`);
    const res2 = await httpsGet(url2);
    const json2 = JSON.parse(res2.body);
    splits = json2?.stats?.[0]?.splits;
    if (!splits?.length) return {};
  }

  let ip = 0, er = 0, h = 0, bb = 0, k = 0, w = 0, l = 0, sv = 0;
  splits.forEach(s => {
    const st = s.stat;
    ip += parseFloat(st.inningsPitched) || 0;
    er += st.earnedRuns || 0;
    h += st.hits || 0;
    bb += st.baseOnBalls || 0;
    k += st.strikeOuts || 0;
    w += st.wins || 0;
    l += st.losses || 0;
    sv += st.saves || 0;
  });

  if (!ip) return {};
  return {
    era: Math.round((er / ip * 9) * 100) / 100,
    whip: Math.round(((h + bb) / ip) * 100) / 100,
    k_per_9: Math.round((k / ip * 9) * 10) / 10,
    bb_per_9: Math.round((bb / ip * 9) * 10) / 10,
    ip: Math.round(ip * 10) / 10,
    wins: w, losses: l, saves: sv,
  };
}

// ─── Fetch bio ───────────────────────────────────────────

async function fetchBio(playerId) {
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}`;
  const res = await httpsGet(url);
  const json = JSON.parse(res.body);
  const p = json?.people?.[0];
  if (!p) return {};
  return {
    age: p.currentAge,
    throws: p.pitchHand?.code,
    team: p.currentTeam?.abbreviation || null,
  };
}

// ─── Check what's missing ────────────────────────────────

function needsEnrichment(pitcher) {
  // Needs enrichment if missing bio, traditional stats, or pitch movement data
  if (!pitcher.throws || !pitcher.age || !pitcher.team) return true;
  if (pitcher.era === undefined && pitcher.ip === undefined) return true;

  // Check if any pitch type is missing movement/vaa/usage
  const pitchKeys = ['ff', 'si', 'fc', 'ch', 'fs', 'fo', 'cu', 'kc', 'sl', 'st', 'sv'];
  for (const key of pitchKeys) {
    const pd = pitcher[key];
    if (pd && pd.velo && (pd.movement_h === undefined || pd.movement_v === undefined || pd.vaa === undefined)) {
      return true;
    }
  }

  return false;
}

// ─── Main ────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(OUTPUT_FILE)) {
    console.error('pitchers.json not found. Run import-excel.js first.');
    process.exit(1);
  }

  const pitchers = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  console.log(`\nLoaded ${pitchers.length} pitchers from database.\n`);

  // Filter to pitchers that need enrichment
  let toProcess;
  if (targetId) {
    toProcess = pitchers.filter(p => p.player_id === targetId);
    if (!toProcess.length) { console.error(`Player ID ${targetId} not found.`); process.exit(1); }
  } else {
    toProcess = pitchers.filter(p => p.player_id && needsEnrichment(p));
  }

  if (toProcess.length > limit) toProcess = toProcess.slice(0, limit);

  console.log(`Enriching ${toProcess.length} pitcher(s) from Baseball Savant...\n`);

  let enriched = 0, failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const pitcher = toProcess[i];
    const idx = pitchers.findIndex(p => p.player_id === pitcher.player_id);
    console.log(`[${i + 1}/${toProcess.length}] ${pitcher.full_name} (${pitcher.player_id})`);

    try {
      // Fetch bio
      if (!pitcher.throws || !pitcher.age || !pitcher.team) {
        const bio = await fetchBio(pitcher.player_id);
        if (bio.age) pitchers[idx].age = bio.age;
        if (bio.throws) pitchers[idx].throws = bio.throws;
        if (bio.team) pitchers[idx].team = bio.team;
        console.log(`  Bio: ${bio.throws || '?'}HP, age ${bio.age || '?'}, ${bio.team || '?'}`);
        await sleep(200);
      }

      // Fetch Statcast for movement/VAA/usage
      console.log(`  Fetching Statcast...`);
      const rows = await fetchStatcast(pitcher.player_id);

      if (rows.length > 0) {
        const pitchData = aggregateStatcast(rows);
        if (pitchData) {
          let pitchCount = 0;
          for (const [key, data] of Object.entries(pitchData)) {
            // Merge into existing pitch data (don't overwrite Excel data)
            if (!pitchers[idx][key]) pitchers[idx][key] = {};
            const existing = pitchers[idx][key];

            if (data.movement_h !== undefined && existing.movement_h === undefined) existing.movement_h = data.movement_h;
            if (data.movement_v !== undefined && existing.movement_v === undefined) existing.movement_v = data.movement_v;
            if (data.vaa !== undefined && existing.vaa === undefined) existing.vaa = data.vaa;
            if (data.usage !== undefined && existing.usage === undefined) existing.usage = data.usage;

            // Also set legacy fields
            const legacy = LEGACY_MAP[Object.keys(PITCH_TYPE_MAP).find(k => PITCH_TYPE_MAP[k] === key)];
            if (legacy && data.movement_h !== undefined) pitchers[idx][`${legacy}_movement_h`] = pitchers[idx][`${legacy}_movement_h`] ?? data.movement_h;
            if (legacy && data.movement_v !== undefined) pitchers[idx][`${legacy}_movement_v`] = pitchers[idx][`${legacy}_movement_v`] ?? data.movement_v;
            if (legacy && data.vaa !== undefined) pitchers[idx][`${legacy}_vaa`] = pitchers[idx][`${legacy}_vaa`] ?? data.vaa;
            if (legacy && data.usage !== undefined) pitchers[idx][`${legacy}_usage`] = pitchers[idx][`${legacy}_usage`] ?? data.usage;

            pitchCount++;
          }
          console.log(`  Statcast: ${rows.length} pitches → ${pitchCount} pitch types (IVB, HB, VAA, usage)`);
        }
      } else {
        console.log(`  Statcast: no data found`);
      }

      await sleep(500);

      // Fetch traditional stats
      if (pitchers[idx].era === undefined) {
        const stats = await fetchStats(pitcher.player_id);
        if (stats.era !== undefined) {
          Object.assign(pitchers[idx], stats);
          console.log(`  Stats: ${stats.ip} IP, ${stats.era} ERA, ${stats.wins}-${stats.losses}`);
        } else {
          console.log(`  Stats: no pitching stats found`);
        }
        await sleep(200);
      }

      // Set release_height/extension from FF if not set
      if (pitchers[idx].ff?.vrel && !pitchers[idx].release_height) {
        pitchers[idx].release_height = pitchers[idx].ff.vrel;
      }
      if (pitchers[idx].ff?.ext && !pitchers[idx].extension) {
        pitchers[idx].extension = pitchers[idx].ff.ext;
      }

      enriched++;
      console.log(`  ✓ Done\n`);

      // Save periodically (every 25 pitchers)
      if ((i + 1) % 25 === 0) {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(pitchers, null, 2));
        console.log(`  [Saved progress: ${i + 1}/${toProcess.length}]\n`);
      }

      await sleep(1000); // Rate limit

    } catch (err) {
      console.log(`  ✗ Error: ${err.message}\n`);
      failed++;
      await sleep(2000);
    }
  }

  // Final save
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(pitchers, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`Enriched: ${enriched}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total pitchers: ${pitchers.length}`);
  console.log(`Output: ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
