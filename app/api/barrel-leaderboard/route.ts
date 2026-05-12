import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MLB_API = 'https://statsapi.mlb.com/api/v1';

const MLB_ID_TO_ABBR: Record<number, string> = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU',
  118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK',
  134: 'PIT', 135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL',
  139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL',
};

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDateDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function checkBarrel(ls: number, la: number): boolean {
  if (isNaN(la) || ls < 98) return false;
  const delta = Math.min(ls, 116) - 98;
  return la >= Math.max(8, 26 - delta) && la <= Math.min(50, 30 + delta);
}

// Proper CSV row parser that respects quoted fields
function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      cells.push(cur.trim()); cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function parseCSV(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

function num(v: string | undefined): number | null {
  if (!v || v === '' || v === 'null') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// "Last, First" → "First Last"
function formatName(raw: string): string {
  const comma = raw.indexOf(',');
  if (comma === -1) return raw.trim();
  const last  = raw.slice(0, comma).trim();
  const first = raw.slice(comma + 1).trim();
  return `${first} ${last}`;
}

async function safeFetch(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

async function fetchJSON(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// ─── MLB (Savant) — full season ────────────────────────────────────────────────

async function fetchMLBPlayers() {
  const season = new Date().getFullYear();
  const savantUrl   = `https://baseballsavant.mlb.com/leaderboard/statcast?type=batter&year=${season}&position=&team=&min=1&csv=true`;
  const batTrackUrl = `https://baseballsavant.mlb.com/leaderboard/bat-tracking?year=${season}&team=&min=1&csv=true`;

  const [statcastText, batTrackText] = await Promise.all([
    safeFetch(savantUrl),
    safeFetch(batTrackUrl).catch(() => ''),
  ]);

  const statcastRows = parseCSV(statcastText);
  const batTrackRows = parseCSV(batTrackText);

  const batSpeedById: Record<string, number> = {};
  for (const r of batTrackRows) {
    const id = r['id']?.trim();
    const bs = num(r['avg_bat_speed']);
    if (id && bs !== null) batSpeedById[id] = bs;
  }

  // Savant CSV has no team column — batch-fetch from MLB Stats API
  const allIds = statcastRows.map(r => r['player_id']?.trim()).filter(Boolean);
  const teamByIdStr: Record<string, string> = {};
  const BATCH = 200;
  for (let i = 0; i < allIds.length; i += BATCH) {
    try {
      const ids = allIds.slice(i, i + BATCH).join(',');
      const data = await fetchJSON(`${MLB_API}/people?personIds=${ids}&hydrate=currentTeam`);
      for (const p of (data?.people ?? []) as Array<Record<string, unknown>>) {
        const ct = p.currentTeam as Record<string, unknown> | undefined;
        const teamId = Number(ct?.id ?? NaN);
        const abbr = MLB_ID_TO_ABBR[teamId] ?? '';
        if (abbr) teamByIdStr[String(p.id)] = abbr;
      }
    } catch { /* non-fatal */ }
  }

  const players = statcastRows
    .map(r => {
      const rawName  = r['last_name, first_name'] || '';
      const playerId = num(r['player_id']);
      const idStr    = r['player_id']?.trim() ?? '';
      return {
        playerId,
        name:         formatName(rawName),
        team:         teamByIdStr[idStr] ?? '',
        attempts:     num(r['attempts']),
        barrels:      num(r['barrels']),
        barrelPct:    num(r['brl_percent']),
        barrelPerPA:  num(r['brl_pa']),
        avgEv:        num(r['avg_hit_speed']),
        maxEv:        num(r['max_hit_speed']),
        avgBatSpeed:  idStr ? (batSpeedById[idStr] ?? null) : null,
        ev50:         num(r['ev50']),
        sweetSpotPct: num(r['anglesweetspotpercent']),
        hardHit95:    null as number | null,
        // minor-league-only fields (null for MLB)
        hr: null as number | null, avg: null as string | null,
        obp: null as string | null, slg: null as string | null,
        ops: null as string | null,
        bb: null as number | null, k: null as number | null,
        pa: null as number | null, sb: null as number | null,
      };
    })
    .filter(p => p.name && p.barrels !== null);

  players.sort((a, b) => (b.barrels ?? 0) - (a.barrels ?? 0));
  return players;
}

// ─── MLB (Savant /gf) — last N game dates — REPLACED by live-feed approach ────
// Kept as dead code; handler now calls fetchPlayersLastNFromFeed('1', lastN)

async function fetchMLBPlayersLastN_unused(lastN: number) {
  const today = getToday();
  const startDate = getDateDaysAgo(Math.max(lastN * 2, 30));

  const schedule = await fetchJSON(`${MLB_API}/schedule?startDate=${startDate}&endDate=${today}&sportId=1`);
  const allDates = (schedule?.dates ?? []) as Array<{
    date: string;
    games: Array<{ gamePk: number; status: { abstractGameState: string } }>;
  }>;

  const finalDates = allDates
    .filter(d => d.games.some(g => g.status?.abstractGameState === 'Final'))
    .slice(-lastN);

  const gamePks = finalDates.flatMap(d =>
    d.games.filter(g => g.status?.abstractGameState === 'Final').map(g => g.gamePk)
  );

  type MLBAcc = {
    batSpeeds: number[]; evList: number[];
    barrels: number; bip: number; hardHit: number; maxEv: number;
  };
  const acc: Record<number, MLBAcc> = {};

  // Process in batches of 12 to avoid rate-limiting Savant; cache completed games
  const GF_BATCH = 12;
  for (let i = 0; i < gamePks.length; i += GF_BATCH) {
    await Promise.all(gamePks.slice(i, i + GF_BATCH).map(async (gamePk) => {
      try {
        const res = await fetch(`https://baseballsavant.mlb.com/gf?game_pk=${gamePk}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          next: { revalidate: 86400 }, // completed games never change
        });
        if (!res.ok) return;
        const gf = await res.json();
        const evArray = (gf?.exit_velocity ?? []) as Record<string, unknown>[];
        for (const ev of evArray) {
          const pid = Number(ev.batter ?? NaN);
          if (isNaN(pid)) continue;
          if (!acc[pid]) acc[pid] = { batSpeeds: [], evList: [], barrels: 0, bip: 0, hardHit: 0, maxEv: -1 };
          acc[pid].bip++;
          const ls = Number(ev.launch_speed ?? ev.hit_speed ?? NaN);
          if (!isNaN(ls) && ls > 0) {
            acc[pid].evList.push(ls);
            if (ls > acc[pid].maxEv) acc[pid].maxEv = ls;
            if (ls >= 95) acc[pid].hardHit++;
          }
          if (Number(ev.is_barrel) === 1) acc[pid].barrels++;
          const bs = Number(ev.batSpeed ?? NaN);
          if (!isNaN(bs) && bs >= 50) acc[pid].batSpeeds.push(bs);
        }
      } catch { /* non-fatal */ }
    }));
  }

  // Batch-fetch player names + teams from MLB API
  const pids = Object.keys(acc).map(Number);
  const playerInfo: Record<number, { name: string; team: string }> = {};
  const BATCH = 200;
  for (let i = 0; i < pids.length; i += BATCH) {
    try {
      const ids = pids.slice(i, i + BATCH).join(',');
      const data = await fetchJSON(`${MLB_API}/people?personIds=${ids}&hydrate=currentTeam`);
      for (const p of (data?.people ?? []) as Array<Record<string, unknown>>) {
        const ct = p.currentTeam as Record<string, unknown> | undefined;
        playerInfo[Number(p.id)] = {
          name: String(p.fullName ?? `Player ${p.id}`),
          team: String(ct?.abbreviation ?? ct?.name ?? ''),
        };
      }
    } catch { /* non-fatal */ }
  }

  return pids.map(pid => {
    const s = acc[pid];
    const info = playerInfo[pid];
    const avgEv = s.evList.length > 0 ? s.evList.reduce((a, b) => a + b, 0) / s.evList.length : null;
    const avgBatSpeed = s.batSpeeds.length > 0
      ? s.batSpeeds.reduce((a, b) => a + b, 0) / s.batSpeeds.length
      : null;
    return {
      playerId:     pid,
      name:         info?.name ?? `Player ${pid}`,
      team:         info?.team ?? '',
      barrels:      s.barrels,
      barrelPct:    s.bip > 0 ? (s.barrels / s.bip) * 100 : null,
      hardHit95:    s.hardHit,
      avgEv:        avgEv != null ? Math.round(avgEv * 10) / 10 : null,
      maxEv:        s.maxEv > 0 ? s.maxEv : null,
      avgBatSpeed:  avgBatSpeed != null ? Math.round(avgBatSpeed * 10) / 10 : null,
      attempts:     s.bip,
      // not computable from /gf alone
      barrelPerPA:  null as number | null,
      ev50:         null as number | null,
      sweetSpotPct: null as number | null,
      // minor-only
      hr: null as number | null, avg: null as string | null,
      obp: null as string | null, slg: null as string | null,
      ops: null as string | null,
      bb: null as number | null, k: null as number | null,
      pa: null as number | null, sb: null as number | null,
    };
  }).filter(p => (p.attempts ?? 0) > 0 || p.barrels > 0);
}

// ─── Minors — season aggregate (no barrel data) ───────────────────────────────

async function fetchMinorPlayers(sportId: string) {
  const season = new Date().getFullYear();
  const data = await fetchJSON(
    `${MLB_API}/stats?stats=season&group=hitting&season=${season}&sportId=${sportId}&limit=2000`
  );
  const splits = (data?.stats?.[0]?.splits ?? []) as Array<Record<string, unknown>>;

  return splits
    .map(split => {
      const player = split.player as Record<string, unknown>;
      const team   = split.team   as Record<string, unknown> | undefined;
      const stat   = split.stat   as Record<string, unknown>;

      const ab  = Number(stat.atBats      ?? 0);
      const h   = Number(stat.hits        ?? 0);
      const bb  = Number(stat.baseOnBalls ?? 0);
      const hbp = Number(stat.hitByPitch  ?? 0);
      const sf  = Number(stat.sacFlies    ?? 0);
      const sh  = Number(stat.sacBunts    ?? 0);
      const pa  = Number(stat.plateAppearances ?? (ab + bb + hbp + sf + sh));

      return {
        playerId:     Number(player?.id ?? 0) || null,
        name:         String(player?.fullName ?? ''),
        team:         String(team?.abbreviation ?? team?.name ?? ''),
        pa, hr: Number(stat.homeRuns ?? 0),
        avg:  stat.avg  != null ? String(stat.avg)  : ab > 0 ? (h / ab).toFixed(3) : '.000',
        obp:  stat.obp  != null ? String(stat.obp)  : null,
        slg:  stat.slg  != null ? String(stat.slg)  : null,
        ops:  stat.ops  != null ? String(stat.ops)  : null,
        bb, k: Number(stat.strikeOuts ?? 0), sb: Number(stat.stolenBases ?? 0),
        barrels:      null as number | null,
        barrelPct:    null as number | null,
        hardHit95:    null as number | null,
        maxEv:        null as number | null,
        attempts:     null as number | null,
        barrelPerPA:  null as number | null,
        avgEv:        null as number | null,
        avgBatSpeed:  null as number | null,
        ev50:         null as number | null,
        sweetSpotPct: null as number | null,
      };
    })
    .filter(p => p.name && p.pa >= 1);
}

// ─── Savant bat-tracking CSV — season avg bat speed by player ID ──────────────

async function fetchBatSpeedById(): Promise<Record<number, number>> {
  const season = new Date().getFullYear();
  try {
    const text = await safeFetch(
      `https://baseballsavant.mlb.com/leaderboard/bat-tracking?year=${season}&team=&min=1&csv=true`
    );
    const rows = parseCSV(text);
    const map: Record<number, number> = {};
    for (const r of rows) {
      const id = parseInt(r['id']?.trim() ?? '');
      const bs = num(r['avg_bat_speed']);
      if (!isNaN(id) && bs !== null) map[id] = bs;
    }
    return map;
  } catch {
    return {};
  }
}

// ─── Any league — last N game dates via live feed (MLB + minors) ──────────────

async function fetchPlayersLastNFromFeed(sportId: string, lastN: number) {
  const today = getToday();
  const startDate = getDateDaysAgo(Math.max(lastN * 2, 30));

  const [schedule, batSpeedById] = await Promise.all([
    fetchJSON(`${MLB_API}/schedule?startDate=${startDate}&endDate=${today}&sportId=${sportId}`),
    sportId === '1' ? fetchBatSpeedById() : Promise.resolve({} as Record<number, number>),
  ]);

  const allDates = (schedule?.dates ?? []) as Array<{
    date: string;
    games: Array<{ gamePk: number; status: { abstractGameState: string } }>;
  }>;

  const finalDates = allDates
    .filter(d => d.games.some(g => g.status?.abstractGameState === 'Final'))
    .slice(-lastN);

  const gamePks = finalDates.flatMap(d =>
    d.games.filter(g => g.status?.abstractGameState === 'Final').map(g => g.gamePk)
  );

  type PlayerAcc = {
    name: string; team: string;
    ab: number; h: number; hr: number; bb: number; k: number;
    doubles: number; triples: number; sb: number; hbp: number; sf: number; sh: number;
    barrels: number; bip: number; hardHit: number; maxEv: number;
    totalEv: number; evCount: number;
  };
  const acc: Record<number, PlayerAcc> = {};

  // Process in batches of 30 to balance concurrency vs rate limiting
  const BATCH = 30;
  for (let i = 0; i < gamePks.length; i += BATCH) {
    await Promise.all(gamePks.slice(i, i + BATCH).map(async (gamePk) => {
    try {
      const feed = await fetchJSON(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`);
      const gd = feed?.gameData as Record<string, unknown> | undefined;
      const homeAbbr = String((gd?.teams as Record<string, unknown>)?.home
        ? ((gd?.teams as Record<string, Record<string, unknown>>).home?.abbreviation ?? '?')
        : '?');
      const awayAbbr = String((gd?.teams as Record<string, unknown>)?.away
        ? ((gd?.teams as Record<string, Record<string, unknown>>).away?.abbreviation ?? '?')
        : '?');

      const homeBox = feed?.liveData?.boxscore?.teams?.home as Record<string, unknown> | undefined;
      const awayBox = feed?.liveData?.boxscore?.teams?.away as Record<string, unknown> | undefined;

      const processTeam = (box: Record<string, unknown> | undefined, abbr: string) => {
        if (!box) return;
        const playersMap = (box.players ?? {}) as Record<string, unknown>;
        const batters = (box.batters ?? []) as number[];
        for (const pid of batters) {
          const pData = playersMap[`ID${pid}`] as Record<string, unknown> | undefined;
          if (!pData) continue;
          const bStats = (
            ((pData.gameStats as Record<string, unknown>)?.batting) ??
            ((pData.stats     as Record<string, unknown>)?.batting)
          ) as Record<string, unknown> | undefined;
          if (!bStats) continue;
          const ab  = Number(bStats.atBats      ?? 0);
          const bb  = Number(bStats.baseOnBalls ?? 0);
          const hbp = Number(bStats.hitByPitch  ?? 0);
          const sf  = Number(bStats.sacFlies    ?? 0);
          const sh  = Number(bStats.sacBunts    ?? 0);
          if (ab + bb + hbp + sf + sh === 0) continue;
          if (!acc[pid]) {
            const name = String((pData.person as Record<string, unknown>)?.fullName ?? `Player ${pid}`);
            acc[pid] = { name, team: abbr, ab: 0, h: 0, hr: 0, bb: 0, k: 0, doubles: 0, triples: 0, sb: 0, hbp: 0, sf: 0, sh: 0, barrels: 0, bip: 0, hardHit: 0, maxEv: -1, totalEv: 0, evCount: 0 };
          }
          acc[pid].team      = abbr;
          acc[pid].ab       += ab;
          acc[pid].h        += Number(bStats.hits        ?? 0);
          acc[pid].hr       += Number(bStats.homeRuns    ?? 0);
          acc[pid].bb       += bb;
          acc[pid].k        += Number(bStats.strikeOuts  ?? 0);
          acc[pid].doubles  += Number(bStats.doubles     ?? 0);
          acc[pid].triples  += Number(bStats.triples     ?? 0);
          acc[pid].sb       += Number(bStats.stolenBases ?? 0);
          acc[pid].hbp      += hbp;
          acc[pid].sf       += sf;
          acc[pid].sh       += sh;
        }
      };

      processTeam(homeBox, homeAbbr);
      processTeam(awayBox, awayAbbr);

      // Mine play-by-play for batted ball data
      const allPlays = (feed?.liveData?.plays?.allPlays ?? []) as Array<Record<string, unknown>>;
      for (const play of allPlays) {
        const batterId = Number(
          ((play.matchup as Record<string, unknown>)?.batter as Record<string, unknown>)?.id ?? NaN
        );
        if (isNaN(batterId) || !acc[batterId]) continue;
        for (const ev of ((play.playEvents as Array<Record<string, unknown>>) ?? [])) {
          const hd = ev.hitData as Record<string, unknown> | undefined;
          if (!hd) continue;
          const ls = Number(hd.launchSpeed ?? NaN);
          const la = Number(hd.launchAngle ?? NaN);
          if (isNaN(ls) || ls <= 0) continue;
          acc[batterId].bip++;
          acc[batterId].totalEv += ls;
          acc[batterId].evCount++;
          if (ls > acc[batterId].maxEv) acc[batterId].maxEv = ls;
          if (ls >= 95) acc[batterId].hardHit++;
          if (checkBarrel(ls, la)) acc[batterId].barrels++;
        }
      }
    } catch { /* non-fatal */ }
  }));
  } // end batch loop

  return Object.entries(acc).map(([pidStr, s]) => {
    const pid = parseInt(pidStr);
    const pa = s.ab + s.bb + s.hbp + s.sf + s.sh;
    const obpNum = pa > 0 ? (s.h + s.bb + s.hbp) / pa : 0;
    const tb = (s.h - s.doubles - s.triples - s.hr) + s.doubles * 2 + s.triples * 3 + s.hr * 4;
    const slgNum = s.ab > 0 ? tb / s.ab : 0;
    return {
      playerId:     pid,
      name:         s.name,
      team:         s.team,
      pa,
      hr:           s.hr,
      avg:          s.ab > 0 ? (s.h / s.ab).toFixed(3) : '.000',
      obp:          obpNum.toFixed(3),
      slg:          slgNum.toFixed(3),
      ops:          (obpNum + slgNum).toFixed(3),
      bb:           s.bb,
      k:            s.k,
      sb:           s.sb,
      barrels:      s.barrels,
      barrelPct:    s.bip > 0 ? (s.barrels / s.bip) * 100 : null,
      barrelPerPA:  pa > 0 ? (s.barrels / pa) * 100 : null,
      hardHit95:    s.hardHit,
      maxEv:        s.maxEv > 0 ? s.maxEv : null,
      avgEv:        s.evCount > 0 ? Math.round(s.totalEv / s.evCount * 10) / 10 : null,
      attempts:     s.bip,
      avgBatSpeed:  batSpeedById[pid] != null ? batSpeedById[pid] : null,
      ev50:         null as number | null,
      sweetSpotPct: null as number | null,
    };
  }).filter(p => p.pa >= 1);
}

// ─── Minors — FULL SEASON via play-by-play (computes barrels + EV) ───────────

async function fetchMinorPlayersSeason(sportId: string) {
  const season = new Date().getFullYear();
  const today  = getToday();
  // Start from March 1 to safely cover any pre-season and the full regular season
  const startDate = `${season}-03-01`;

  const schedule = await fetchJSON(
    `${MLB_API}/schedule?startDate=${startDate}&endDate=${today}&sportId=${sportId}`
  );

  const allDates = (schedule?.dates ?? []) as Array<{
    date: string;
    games: Array<{ gamePk: number; status: { abstractGameState: string } }>;
  }>;

  const gamePks = allDates.flatMap(d =>
    d.games
      .filter(g => g.status?.abstractGameState === 'Final')
      .map(g => g.gamePk)
  );

  type PlayerAcc = {
    name: string; team: string;
    ab: number; h: number; hr: number; bb: number; k: number;
    doubles: number; triples: number; sb: number; hbp: number; sf: number; sh: number;
    barrels: number; bip: number; hardHit: number; maxEv: number;
    totalEv: number; evCount: number;
  };
  const acc: Record<number, PlayerAcc> = {};

  const BATCH = 30;
  for (let i = 0; i < gamePks.length; i += BATCH) {
    await Promise.all(gamePks.slice(i, i + BATCH).map(async (gamePk) => {
      try {
        const feed = await fetchJSON(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`);
        const gd = feed?.gameData as Record<string, unknown> | undefined;
        const homeAbbr = String((gd?.teams as Record<string, Record<string, unknown>>)?.home?.abbreviation ?? '?');
        const awayAbbr = String((gd?.teams as Record<string, Record<string, unknown>>)?.away?.abbreviation ?? '?');

        const homeBox = feed?.liveData?.boxscore?.teams?.home as Record<string, unknown> | undefined;
        const awayBox = feed?.liveData?.boxscore?.teams?.away as Record<string, unknown> | undefined;

        const processTeam = (box: Record<string, unknown> | undefined, abbr: string) => {
          if (!box) return;
          const playersMap = (box.players ?? {}) as Record<string, unknown>;
          const batters = (box.batters ?? []) as number[];
          for (const pid of batters) {
            const pData = playersMap[`ID${pid}`] as Record<string, unknown> | undefined;
            if (!pData) continue;
            const bStats = (
              ((pData.gameStats as Record<string, unknown>)?.batting) ??
              ((pData.stats     as Record<string, unknown>)?.batting)
            ) as Record<string, unknown> | undefined;
            if (!bStats) continue;
            const ab  = Number(bStats.atBats      ?? 0);
            const bb  = Number(bStats.baseOnBalls ?? 0);
            const hbp = Number(bStats.hitByPitch  ?? 0);
            const sf  = Number(bStats.sacFlies    ?? 0);
            const sh  = Number(bStats.sacBunts    ?? 0);
            if (ab + bb + hbp + sf + sh === 0) continue;
            if (!acc[pid]) {
              const name = String((pData.person as Record<string, unknown>)?.fullName ?? `Player ${pid}`);
              acc[pid] = { name, team: abbr, ab: 0, h: 0, hr: 0, bb: 0, k: 0, doubles: 0, triples: 0, sb: 0, hbp: 0, sf: 0, sh: 0, barrels: 0, bip: 0, hardHit: 0, maxEv: -1, totalEv: 0, evCount: 0 };
            }
            acc[pid].team     = abbr;
            acc[pid].ab      += ab;
            acc[pid].h       += Number(bStats.hits        ?? 0);
            acc[pid].hr      += Number(bStats.homeRuns    ?? 0);
            acc[pid].bb      += bb;
            acc[pid].k       += Number(bStats.strikeOuts  ?? 0);
            acc[pid].doubles += Number(bStats.doubles     ?? 0);
            acc[pid].triples += Number(bStats.triples     ?? 0);
            acc[pid].sb      += Number(bStats.stolenBases ?? 0);
            acc[pid].hbp     += hbp;
            acc[pid].sf      += sf;
            acc[pid].sh      += sh;
          }
        };

        processTeam(homeBox, homeAbbr);
        processTeam(awayBox, awayAbbr);

        // Mine play-by-play for batted ball data
        const allPlays = (feed?.liveData?.plays?.allPlays ?? []) as Array<Record<string, unknown>>;
        for (const play of allPlays) {
          const batterId = Number(
            ((play.matchup as Record<string, unknown>)?.batter as Record<string, unknown>)?.id ?? NaN
          );
          if (isNaN(batterId) || !acc[batterId]) continue;
          for (const ev of ((play.playEvents as Array<Record<string, unknown>>) ?? [])) {
            const hd = ev.hitData as Record<string, unknown> | undefined;
            if (!hd) continue;
            const ls = Number(hd.launchSpeed ?? NaN);
            const la = Number(hd.launchAngle ?? NaN);
            if (isNaN(ls) || ls <= 0) continue;
            acc[batterId].bip++;
            acc[batterId].totalEv += ls;
            acc[batterId].evCount++;
            if (ls > acc[batterId].maxEv) acc[batterId].maxEv = ls;
            if (ls >= 95) acc[batterId].hardHit++;
            if (checkBarrel(ls, la)) acc[batterId].barrels++;
          }
        }
      } catch { /* non-fatal */ }
    }));
  }

  return Object.entries(acc).map(([pidStr, s]) => {
    const pid = parseInt(pidStr);
    const pa = s.ab + s.bb + s.hbp + s.sf + s.sh;
    const obpNum = pa > 0 ? (s.h + s.bb + s.hbp) / pa : 0;
    const tb = (s.h - s.doubles - s.triples - s.hr) + s.doubles * 2 + s.triples * 3 + s.hr * 4;
    const slgNum = s.ab > 0 ? tb / s.ab : 0;
    return {
      playerId:     pid,
      name:         s.name,
      team:         s.team,
      pa,
      hr:           s.hr,
      avg:          s.ab > 0 ? (s.h / s.ab).toFixed(3) : '.000',
      obp:          obpNum.toFixed(3),
      slg:          slgNum.toFixed(3),
      ops:          (obpNum + slgNum).toFixed(3),
      bb:           s.bb,
      k:            s.k,
      sb:           s.sb,
      barrels:      s.barrels,
      barrelPct:    s.bip > 0 ? (s.barrels / s.bip) * 100 : null,
      barrelPerPA:  pa > 0 ? (s.barrels / pa) * 100 : null,
      hardHit95:    s.hardHit,
      maxEv:        s.maxEv > 0 ? s.maxEv : null,
      avgEv:        s.evCount > 0 ? Math.round(s.totalEv / s.evCount * 10) / 10 : null,
      attempts:     s.bip,
      avgBatSpeed:  null as number | null,
      ev50:         null as number | null,
      sweetSpotPct: null as number | null,
    };
  }).filter(p => p.pa >= 1);
}

// ─── Rookie Ball (FCL + ACL combined) — single-pass accumulator ───────────────

async function fetchRookiePlayersSeason() {
  const season = new Date().getFullYear();
  const today  = getToday();
  const startDate = `${season}-03-01`;

  // Both FCL and ACL are sportId=16 (Rookie); leagueId=124=FCL, leagueId=121=ACL
  const [fclSchedule, aclSchedule] = await Promise.all([
    fetchJSON(`${MLB_API}/schedule?startDate=${startDate}&endDate=${today}&sportId=16&leagueId=124`),
    fetchJSON(`${MLB_API}/schedule?startDate=${startDate}&endDate=${today}&sportId=16&leagueId=121`),
  ]);

  const collectPks = (schedule: unknown) => {
    const dates = ((schedule as Record<string, unknown>)?.dates ?? []) as Array<{
      games: Array<{ gamePk: number; status: { abstractGameState: string } }>;
    }>;
    return dates.flatMap(d =>
      d.games.filter(g => g.status?.abstractGameState === 'Final').map(g => g.gamePk)
    );
  };

  const gamePks = [...collectPks(fclSchedule), ...collectPks(aclSchedule)];

  type PlayerAcc = {
    name: string; team: string;
    ab: number; h: number; hr: number; bb: number; k: number;
    doubles: number; triples: number; sb: number; hbp: number; sf: number; sh: number;
    barrels: number; bip: number; hardHit: number; maxEv: number;
    totalEv: number; evCount: number;
  };
  const acc: Record<number, PlayerAcc> = {};

  const BATCH = 30;
  for (let i = 0; i < gamePks.length; i += BATCH) {
    await Promise.all(gamePks.slice(i, i + BATCH).map(async (gamePk) => {
      try {
        const feed = await fetchJSON(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`);
        const gd = feed?.gameData as Record<string, unknown> | undefined;
        const homeAbbr = String((gd?.teams as Record<string, Record<string, unknown>>)?.home?.abbreviation ?? '?');
        const awayAbbr = String((gd?.teams as Record<string, Record<string, unknown>>)?.away?.abbreviation ?? '?');

        const homeBox = feed?.liveData?.boxscore?.teams?.home as Record<string, unknown> | undefined;
        const awayBox = feed?.liveData?.boxscore?.teams?.away as Record<string, unknown> | undefined;

        const processTeam = (box: Record<string, unknown> | undefined, abbr: string) => {
          if (!box) return;
          const playersMap = (box.players ?? {}) as Record<string, unknown>;
          const batters = (box.batters ?? []) as number[];
          for (const pid of batters) {
            const pData = playersMap[`ID${pid}`] as Record<string, unknown> | undefined;
            if (!pData) continue;
            const bStats = (
              ((pData.gameStats as Record<string, unknown>)?.batting) ??
              ((pData.stats     as Record<string, unknown>)?.batting)
            ) as Record<string, unknown> | undefined;
            if (!bStats) continue;
            const ab  = Number(bStats.atBats      ?? 0);
            const bb  = Number(bStats.baseOnBalls ?? 0);
            const hbp = Number(bStats.hitByPitch  ?? 0);
            const sf  = Number(bStats.sacFlies    ?? 0);
            const sh  = Number(bStats.sacBunts    ?? 0);
            if (ab + bb + hbp + sf + sh === 0) continue;
            if (!acc[pid]) {
              const name = String((pData.person as Record<string, unknown>)?.fullName ?? `Player ${pid}`);
              acc[pid] = { name, team: abbr, ab: 0, h: 0, hr: 0, bb: 0, k: 0, doubles: 0, triples: 0, sb: 0, hbp: 0, sf: 0, sh: 0, barrels: 0, bip: 0, hardHit: 0, maxEv: -1, totalEv: 0, evCount: 0 };
            }
            acc[pid].team     = abbr;
            acc[pid].ab      += ab;
            acc[pid].h       += Number(bStats.hits        ?? 0);
            acc[pid].hr      += Number(bStats.homeRuns    ?? 0);
            acc[pid].bb      += bb;
            acc[pid].k       += Number(bStats.strikeOuts  ?? 0);
            acc[pid].doubles += Number(bStats.doubles     ?? 0);
            acc[pid].triples += Number(bStats.triples     ?? 0);
            acc[pid].sb      += Number(bStats.stolenBases ?? 0);
            acc[pid].hbp     += hbp;
            acc[pid].sf      += sf;
            acc[pid].sh      += sh;
          }
        };

        processTeam(homeBox, homeAbbr);
        processTeam(awayBox, awayAbbr);

        const allPlays = (feed?.liveData?.plays?.allPlays ?? []) as Array<Record<string, unknown>>;
        for (const play of allPlays) {
          const batterId = Number(
            ((play.matchup as Record<string, unknown>)?.batter as Record<string, unknown>)?.id ?? NaN
          );
          if (isNaN(batterId) || !acc[batterId]) continue;
          for (const ev of ((play.playEvents as Array<Record<string, unknown>>) ?? [])) {
            const hd = ev.hitData as Record<string, unknown> | undefined;
            if (!hd) continue;
            const ls = Number(hd.launchSpeed ?? NaN);
            const la = Number(hd.launchAngle ?? NaN);
            if (isNaN(ls) || ls <= 0) continue;
            acc[batterId].bip++;
            acc[batterId].totalEv += ls;
            acc[batterId].evCount++;
            if (ls > acc[batterId].maxEv) acc[batterId].maxEv = ls;
            if (ls >= 95) acc[batterId].hardHit++;
            if (checkBarrel(ls, la)) acc[batterId].barrels++;
          }
        }
      } catch { /* non-fatal */ }
    }));
  }

  return Object.entries(acc).map(([pidStr, s]) => {
    const pid = parseInt(pidStr);
    const pa = s.ab + s.bb + s.hbp + s.sf + s.sh;
    const obpNum = pa > 0 ? (s.h + s.bb + s.hbp) / pa : 0;
    const tb = (s.h - s.doubles - s.triples - s.hr) + s.doubles * 2 + s.triples * 3 + s.hr * 4;
    const slgNum = s.ab > 0 ? tb / s.ab : 0;
    return {
      playerId:     pid,
      name:         s.name,
      team:         s.team,
      pa,
      hr:           s.hr,
      avg:          s.ab > 0 ? (s.h / s.ab).toFixed(3) : '.000',
      obp:          obpNum.toFixed(3),
      slg:          slgNum.toFixed(3),
      ops:          (obpNum + slgNum).toFixed(3),
      bb:           s.bb,
      k:            s.k,
      sb:           s.sb,
      barrels:      s.barrels,
      barrelPct:    s.bip > 0 ? (s.barrels / s.bip) * 100 : null,
      barrelPerPA:  pa > 0 ? (s.barrels / pa) * 100 : null,
      hardHit95:    s.hardHit,
      maxEv:        s.maxEv > 0 ? s.maxEv : null,
      avgEv:        s.evCount > 0 ? Math.round(s.totalEv / s.evCount * 10) / 10 : null,
      attempts:     s.bip,
      avgBatSpeed:  null as number | null,
      ev50:         null as number | null,
      sweetSpotPct: null as number | null,
    };
  }).filter(p => p.pa >= 1);
}

// ─── Age helper ───────────────────────────────────────────────────────────────

function calcAge(birthDate: string): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

async function fetchAgesById(playerIds: number[]): Promise<Record<number, number | null>> {
  const ages: Record<number, number | null> = {};
  const BATCH = 200;
  for (let i = 0; i < playerIds.length; i += BATCH) {
    try {
      const ids = playerIds.slice(i, i + BATCH).join(',');
      const data = await fetchJSON(`${MLB_API}/people?personIds=${ids}&fields=people,id,birthDate`);
      for (const p of (data?.people ?? []) as Array<Record<string, unknown>>) {
        ages[Number(p.id)] = calcAge(String(p.birthDate ?? ''));
      }
    } catch { /* non-fatal */ }
  }
  return ages;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const league = searchParams.get('league') ?? 'mlb';
  const lastNRaw = searchParams.get('lastN');
  const lastN = lastNRaw ? Math.max(0, parseInt(lastNRaw) || 0) : 0;

  try {
    let players: Array<Record<string, unknown>>;

    if (league === 'rookie') {
      const raw = lastN > 0
        ? await (async () => {
            const [fclPlayers, aclPlayers] = await Promise.all([
              fetchPlayersLastNFromFeed('16', lastN),
              fetchPlayersLastNFromFeed('17', lastN),
            ]);
            return [...fclPlayers, ...aclPlayers];
          })()
        : await fetchRookiePlayersSeason();
      raw.sort((a, b) => (b.barrels ?? 0) - (a.barrels ?? 0));
      players = raw as unknown as Array<Record<string, unknown>>;
    } else if (league === 'aaa' || league === 'low-a') {
      const sportId = league === 'aaa' ? '11' : '14';
      const raw = lastN > 0
        ? await fetchPlayersLastNFromFeed(sportId, lastN)
        : await fetchMinorPlayersSeason(sportId);
      raw.sort((a, b) => (b.barrels ?? 0) - (a.barrels ?? 0));
      players = raw as unknown as Array<Record<string, unknown>>;
    } else {
      // MLB
      const raw = lastN > 0
        ? await fetchPlayersLastNFromFeed('1', lastN)
        : await fetchMLBPlayers();
      if (lastN > 0) raw.sort((a, b) => (b.barrels ?? 0) - (a.barrels ?? 0));
      players = raw as unknown as Array<Record<string, unknown>>;
    }

    // Attach ages — batch-fetch birthDates for all player IDs
    const ids = players.map(p => Number(p.playerId)).filter(id => id > 0);
    const ages = await fetchAgesById(ids);
    const withAge = players.map(p => ({ ...p, age: ages[Number(p.playerId)] ?? null }));

    return NextResponse.json({ players: withAge, league });
  } catch (err) {
    console.error('[barrel-leaderboard]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
