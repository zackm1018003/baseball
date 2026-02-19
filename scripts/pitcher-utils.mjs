/**
 * pitcher-utils.mjs
 *
 * Shared utility functions for pitcher data fetching and processing.
 * Imported by scrape-pitchers.js and fetch-daily-pitchers.mjs.
 */

import https from 'https';

export const SEASON = 2025;
export const OUTPUT_FILE = new URL('../data/pitchers.json', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

// ─── HTTP helpers ─────────────────────────────────────────────

export function httpsGet(url) {
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

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── CSV parser ───────────────────────────────────────────────

export function parseCSV(csvString) {
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

// ─── Pitch type map ───────────────────────────────────────────

export const PITCH_TYPE_MAP = {
  'FF': 'fastball',
  'SI': 'sinker',
  'FC': 'cutter',
  'SL': 'slider',
  'ST': 'slider',
  'SV': 'slider',
  'CH': 'changeup',
  'FS': 'changeup',
  'CU': 'curveball',
  'KC': 'curveball',
  'CS': 'curveball',
  'KN': null,
  'EP': null,
};

// ─── Step 1: Resolve player ID from name ─────────────────────

export async function resolvePlayerId(name) {
  const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}&sportIds=1`;
  const res = await httpsGet(url);
  const json = JSON.parse(res.body);

  if (!json.people || json.people.length === 0) {
    const url2 = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}`;
    const res2 = await httpsGet(url2);
    const json2 = JSON.parse(res2.body);
    if (!json2.people || json2.people.length === 0) return null;
    const pitcher = json2.people.find(p => p.primaryPosition?.abbreviation === 'P') || json2.people[0];
    return pitcher;
  }

  const pitcher = json.people.find(p => p.primaryPosition?.abbreviation === 'P') || json.people[0];
  return pitcher;
}

// ─── Step 2: Fetch Statcast CSV from Baseball Savant ─────────

export async function fetchStatcastData(playerId, season = SEASON) {
  const url = `https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details&player_id=${playerId}&player_type=pitcher&season=${season}`;
  console.log(`    Fetching Statcast CSV for player ${playerId}, season ${season}...`);
  const res = await httpsGet(url);

  if (res.statusCode !== 200 || !res.body.includes('pitch_type')) {
    console.log(`    Warning: Got status ${res.statusCode} or empty data, trying ${season - 1}...`);
    const url2 = `https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details&player_id=${playerId}&player_type=pitcher&season=${season - 1}`;
    const res2 = await httpsGet(url2);
    if (res2.statusCode !== 200) return null;
    return { csv: res2.body, season: season - 1 };
  }

  return { csv: res.body, season };
}

// ─── Step 3: Aggregate pitch-level data ──────────────────────

export function aggregateStatcast(rows) {
  const totalPitches = rows.length;
  if (totalPitches === 0) return null;

  const groups = {};

  rows.forEach(row => {
    const rawType = row.pitch_type;
    const mapped = PITCH_TYPE_MAP[rawType];
    if (mapped === null || mapped === undefined) return;

    if (!groups[mapped]) {
      groups[mapped] = { velos: [], spins: [], hBreaks: [], vBreaks: [], vaas: [], count: 0, relHeights: [], extensions: [] };
    }

    const g = groups[mapped];
    g.count++;

    const velo = parseFloat(row.release_speed);
    if (!isNaN(velo)) g.velos.push(velo);

    const spin = parseFloat(row.release_spin_rate);
    if (!isNaN(spin)) g.spins.push(spin);

    const hBreak = parseFloat(row.pfx_x);
    if (!isNaN(hBreak)) g.hBreaks.push(hBreak * 12);

    const vBreak = parseFloat(row.pfx_z);
    if (!isNaN(vBreak)) g.vBreaks.push(vBreak * 12);

    const relHeight = parseFloat(row.release_pos_z);
    if (!isNaN(relHeight)) g.relHeights.push(relHeight);

    const ext = parseFloat(row.release_extension);
    if (!isNaN(ext)) g.extensions.push(ext);

    const vz0 = parseFloat(row.vz0);
    const vy0 = parseFloat(row.vy0);
    if (!isNaN(vz0) && !isNaN(vy0) && vy0 !== 0) {
      const vaa = Math.atan2(vz0, Math.abs(vy0)) * (180 / Math.PI);
      g.vaas.push(vaa);
    }
  });

  const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : undefined;
  const round1 = v => v !== undefined ? Math.round(v * 10) / 10 : undefined;
  const round2 = v => v !== undefined ? Math.round(v * 100) / 100 : undefined;

  const result = {};
  const countedPitches = Object.values(groups).reduce((s, g) => s + g.count, 0);

  for (const [type, g] of Object.entries(groups)) {
    const usage = (g.count / countedPitches) * 100;
    if (usage < 1) continue;

    result[`${type}_velo`] = round1(avg(g.velos));
    result[`${type}_spin`] = Math.round(avg(g.spins) || 0) || undefined;
    result[`${type}_movement_h`] = round1(avg(g.hBreaks));
    result[`${type}_movement_v`] = round1(avg(g.vBreaks));
    result[`${type}_usage`] = round1(usage);
    result[`${type}_vaa`] = round2(avg(g.vaas));
  }

  const allRelHeights = Object.values(groups).flatMap(g => g.relHeights);
  const allExtensions = Object.values(groups).flatMap(g => g.extensions);
  result.release_height = round2(avg(allRelHeights));
  result.extension = round2(avg(allExtensions));

  return result;
}

// ─── Step 4: Fetch traditional stats from MLB Stats API ──────

export async function fetchTraditionalStats(playerId, season = SEASON) {
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&season=${season}&group=pitching`;
  const res = await httpsGet(url);
  const json = JSON.parse(res.body);

  const splits = json?.stats?.[0]?.splits;
  if (!splits || splits.length === 0) {
    const url2 = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&season=${season - 1}&group=pitching`;
    const res2 = await httpsGet(url2);
    const json2 = JSON.parse(res2.body);
    const splits2 = json2?.stats?.[0]?.splits;
    if (!splits2 || splits2.length === 0) return {};
    return parseTraditionalStats(splits2);
  }

  return parseTraditionalStats(splits);
}

function parseTraditionalStats(splits) {
  let totalIP = 0, totalER = 0, totalH = 0, totalBB = 0, totalK = 0;
  let totalW = 0, totalL = 0, totalSV = 0;

  splits.forEach(split => {
    const s = split.stat;
    const ip = parseFloat(s.inningsPitched) || 0;
    totalIP += ip;
    totalER += s.earnedRuns || 0;
    totalH += s.hits || 0;
    totalBB += s.baseOnBalls || 0;
    totalK += s.strikeOuts || 0;
    totalW += s.wins || 0;
    totalL += s.losses || 0;
    totalSV += s.saves || 0;
  });

  if (totalIP === 0) return {};

  return {
    era: Math.round((totalER / totalIP * 9) * 100) / 100,
    whip: Math.round(((totalH + totalBB) / totalIP) * 100) / 100,
    k_per_9: Math.round((totalK / totalIP * 9) * 10) / 10,
    bb_per_9: Math.round((totalBB / totalIP * 9) * 10) / 10,
    ip: Math.round(totalIP * 10) / 10,
    wins: totalW,
    losses: totalL,
    saves: totalSV,
  };
}

// ─── Step 5: Fetch player bio info ────────────────────────────

export async function fetchPlayerBio(playerId) {
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}`;
  const res = await httpsGet(url);
  const json = JSON.parse(res.body);
  const p = json?.people?.[0];
  if (!p) return {};

  return {
    full_name: p.fullName,
    age: p.currentAge,
    throws: p.pitchHand?.code,
    team: p.currentTeam?.abbreviation || null,
  };
}

// ─── Ingest a single pitcher by player_id ────────────────────
// Fetches bio + Statcast + traditional stats and returns a pitcher object.

export async function ingestPitcher(playerId, nameHint = null) {
  const bio = await fetchPlayerBio(playerId);
  await sleep(300);

  const statcastResult = await fetchStatcastData(playerId);
  let pitchData = {};
  if (statcastResult?.csv) {
    const rows = parseCSV(statcastResult.csv);
    console.log(`    Parsed ${rows.length} pitches (${statcastResult.season} season)`);
    pitchData = aggregateStatcast(rows) || {};
  } else {
    console.log(`    Warning: No Statcast data for player ${playerId}`);
  }
  await sleep(500);

  const tradStats = await fetchTraditionalStats(playerId);

  return {
    full_name: bio.full_name || nameHint || `Player ${playerId}`,
    player_id: playerId,
    team: bio.team || null,
    age: bio.age,
    throws: bio.throws,
    ...pitchData,
    ...tradStats,
  };
}

// ─── Merge pitcher into database array ────────────────────────

export function mergePitcherIntoDb(db, newP) {
  const idx = db.findIndex(p =>
    p.player_id === newP.player_id ||
    p.full_name?.toLowerCase() === newP.full_name?.toLowerCase()
  );

  if (idx >= 0) {
    db[idx] = { ...db[idx], ...newP };
    return 'updated';
  } else {
    db.push(newP);
    return 'added';
  }
}
