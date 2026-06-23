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

// Swinging strikes (whiffs)
const WHIFF_CODES = new Set(['S', 'W', 'M', 'Q']);
// All swing attempts (contact + whiffs)
const SWING_CODES = new Set(['S', 'W', 'M', 'Q', 'X', 'F', 'D', 'T', 'E', 'O', 'L']);

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDateDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

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

// ─── Return shape ─────────────────────────────────────────────────────────────

type WhiffPlayerRaw = {
  playerId: number;
  name: string;
  team: string;
  pa: number | null;
  pitches: number | null;
  swings: number | null;
  whiffs: number | null;
  whiffPct: number | null;
  swStrPct: number | null;
  kPct: number | null;
  bbPct: number | null;
  chasePct: number | null;
  swingPct: number | null;
  k: number | null;
  bb: number | null;
  hr: number | null;
  avg: string | null;
  obp: string | null;
  slg: string | null;
  ops: string | null;
  sb: number | null;
};

// ─── MLB (Savant) — full season ───────────────────────────────────────────────

async function fetchMLBWhiffsSeason(): Promise<WhiffPlayerRaw[]> {
  const season = new Date().getFullYear();

  const [statcastText, swingTakeText] = await Promise.all([
    safeFetch(`https://baseballsavant.mlb.com/leaderboard/statcast?type=batter&year=${season}&position=&team=&min=1&csv=true`),
    safeFetch(`https://baseballsavant.mlb.com/leaderboard/swing-take?year=${season}&team=&min=25&csv=true`).catch(() => ''),
  ]);

  const statcastRows = parseCSV(statcastText);
  const swingTakeRows = parseCSV(swingTakeText);

  // Swing/take leaderboard keyed by player_id
  const stById: Record<string, Record<string, string>> = {};
  for (const r of swingTakeRows) {
    const id = (r['player_id'] ?? r['id'] ?? '').trim();
    if (id) stById[id] = r;
  }

  // Batch-fetch teams from MLB Stats API (Savant CSV has no team column)
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

  return statcastRows
    .map(r => {
      const idStr = r['player_id']?.trim() ?? '';
      const st = stById[idStr];

      const kPct    = num(r['k_percent']);
      const bbPct   = num(r['bb_percent']);
      const whiffPct = st
        ? (num(st['whiff_percent']) ?? num(st['whiff_pct']))
        : null;
      const swingPct = st
        ? (num(st['swing_percent']) ?? num(st['swing_pct']))
        : null;
      const chasePct = st
        ? (num(st['chase_percent']) ?? num(st['oz_swing_percent']) ?? num(st['out_zone_swing_percent']))
        : null;

      // swStrPct = whiffPct × swingPct / 100 (since whiff%=whiffs/swings, swing%=swings/pitches)
      const swStrPct = (whiffPct != null && swingPct != null)
        ? Math.round(whiffPct * swingPct / 100 * 10) / 10
        : null;

      return {
        playerId:  num(r['player_id']) ?? 0,
        name:      formatName(r['last_name, first_name'] || ''),
        team:      teamByIdStr[idStr] ?? '',
        pa:        num(r['pa']),
        pitches:   null,
        swings:    null,
        whiffs:    null,
        whiffPct,
        swStrPct,
        kPct,
        bbPct,
        chasePct,
        swingPct,
        k:   null,
        bb:  null,
        hr:  null,
        avg: null,
        obp: null,
        slg: null,
        ops: null,
        sb:  null,
      } satisfies WhiffPlayerRaw;
    })
    .filter(p => p.name && p.whiffPct !== null);
}

// ─── Live feed — shared accumulation logic ────────────────────────────────────

async function processGames(gamePks: number[]): Promise<WhiffPlayerRaw[]> {
  type PlayerAcc = {
    name: string; team: string;
    ab: number; h: number; hr: number; bb: number; k: number;
    doubles: number; triples: number; sb: number; hbp: number; sf: number; sh: number;
    whiffs: number; swings: number; pitches: number;
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
              acc[pid] = { name, team: abbr, ab: 0, h: 0, hr: 0, bb: 0, k: 0, doubles: 0, triples: 0, sb: 0, hbp: 0, sf: 0, sh: 0, whiffs: 0, swings: 0, pitches: 0 };
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

        // Mine play-by-play for pitch call codes
        const allPlays = (feed?.liveData?.plays?.allPlays ?? []) as Array<Record<string, unknown>>;
        for (const play of allPlays) {
          const batterId = Number(
            ((play.matchup as Record<string, unknown>)?.batter as Record<string, unknown>)?.id ?? NaN
          );
          if (isNaN(batterId) || !acc[batterId]) continue;

          for (const pe of ((play.playEvents as Array<Record<string, unknown>>) ?? [])) {
            if (!pe.isPitch) continue;
            const details  = pe.details as Record<string, unknown> | undefined;
            const callCode = String((details?.call as Record<string, unknown>)?.code ?? '');

            acc[batterId].pitches++;
            if (SWING_CODES.has(callCode)) {
              acc[batterId].swings++;
              if (WHIFF_CODES.has(callCode)) {
                acc[batterId].whiffs++;
              }
            }
          }
        }
      } catch { /* non-fatal */ }
    }));
  }

  return Object.entries(acc).map(([pidStr, s]) => {
    const pid = parseInt(pidStr);
    const pa = s.ab + s.bb + s.hbp + s.sf + s.sh;
    const obpNum  = pa > 0 ? (s.h + s.bb + s.hbp) / pa : 0;
    const tb = (s.h - s.doubles - s.triples - s.hr) + s.doubles * 2 + s.triples * 3 + s.hr * 4;
    const slgNum  = s.ab > 0 ? tb / s.ab : 0;
    return {
      playerId:  pid,
      name:      s.name,
      team:      s.team,
      pa,
      pitches:   s.pitches,
      swings:    s.swings,
      whiffs:    s.whiffs,
      whiffPct:  s.swings  > 0 ? Math.round(s.whiffs  / s.swings  * 1000) / 10 : null,
      swStrPct:  s.pitches > 0 ? Math.round(s.whiffs  / s.pitches * 1000) / 10 : null,
      kPct:      pa        > 0 ? Math.round(s.k       / pa        * 1000) / 10 : null,
      bbPct:     pa        > 0 ? Math.round(s.bb      / pa        * 1000) / 10 : null,
      chasePct:  null,
      swingPct:  s.pitches > 0 ? Math.round(s.swings  / s.pitches * 1000) / 10 : null,
      k:         s.k,
      bb:        s.bb,
      hr:        s.hr,
      avg:       s.ab > 0 ? (s.h / s.ab).toFixed(3) : '.000',
      obp:       obpNum.toFixed(3),
      slg:       slgNum.toFixed(3),
      ops:       (obpNum + slgNum).toFixed(3),
      sb:        s.sb,
    } satisfies WhiffPlayerRaw;
  }).filter(p => p.pa != null && p.pa >= 1);
}

// ─── Live feed — schedule fetch + process ─────────────────────────────────────

async function fetchWhiffFromFeed(
  sportId: string | null,
  lastN: number,
  leagueId?: string
): Promise<WhiffPlayerRaw[]> {
  const today = getToday();
  const season = new Date().getFullYear();
  const startDate = lastN > 0
    ? getDateDaysAgo(Math.max(lastN * 2, 30))
    : `${season}-03-01`;

  const parts: string[] = [`startDate=${startDate}`, `endDate=${today}`];
  if (sportId) parts.push(`sportId=${sportId}`);
  if (leagueId) parts.push(`leagueId=${leagueId}`);

  const schedule = await fetchJSON(`${MLB_API}/schedule?${parts.join('&')}`).catch(() => null);
  if (!schedule) return [];

  const allDates = ((schedule as Record<string, unknown>)?.dates ?? []) as Array<{
    date: string;
    games: Array<{ gamePk: number; status: { abstractGameState: string } }>;
  }>;

  const finalDates = allDates.filter(d =>
    d.games.some(g => g.status?.abstractGameState === 'Final')
  );
  const dateSlice = lastN > 0 ? finalDates.slice(-lastN) : finalDates;
  const gamePks = dateSlice.flatMap(d =>
    d.games.filter(g => g.status?.abstractGameState === 'Final').map(g => g.gamePk)
  );

  return processGames(gamePks);
}

// ─── Rookie Ball (FCL + ACL combined) ────────────────────────────────────────

async function fetchRookieWhiff(lastN: number): Promise<WhiffPlayerRaw[]> {
  const today = getToday();
  const season = new Date().getFullYear();
  const startDate = lastN > 0
    ? getDateDaysAgo(Math.max(lastN * 2, 30))
    : `${season}-03-01`;

  const [fclSchedule, aclSchedule] = await Promise.all([
    fetchJSON(`${MLB_API}/schedule?startDate=${startDate}&endDate=${today}&sportId=16&leagueId=124`).catch(() => null),
    fetchJSON(`${MLB_API}/schedule?startDate=${startDate}&endDate=${today}&sportId=16&leagueId=121`).catch(() => null),
  ]);

  const collectPks = (schedule: unknown) => {
    const dates = ((schedule as Record<string, unknown>)?.dates ?? []) as Array<{
      games: Array<{ gamePk: number; status: { abstractGameState: string } }>;
    }>;
    const finalDates = dates.filter(d =>
      d.games.some(g => g.status?.abstractGameState === 'Final')
    );
    const dateSlice = lastN > 0 ? finalDates.slice(-lastN) : finalDates;
    return dateSlice.flatMap(d =>
      d.games.filter(g => g.status?.abstractGameState === 'Final').map(g => g.gamePk)
    );
  };

  // Dedupe gamePks before processing so cross-league duplicates don't double-count
  const gamePks = [...new Set([...collectPks(fclSchedule), ...collectPks(aclSchedule)])];
  return processGames(gamePks);
}

// ─── Age helper (same as barrel leaderboard) ──────────────────────────────────

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
  const league  = searchParams.get('league') ?? 'mlb';
  const lastNRaw = searchParams.get('lastN');
  const lastN   = lastNRaw ? Math.max(0, parseInt(lastNRaw) || 0) : 0;

  try {
    let players: WhiffPlayerRaw[];

    if (league === 'rookie') {
      players = await fetchRookieWhiff(lastN);
    } else if (league === 'aaa') {
      players = await fetchWhiffFromFeed('11', lastN);
    } else if (league === 'low-a') {
      players = await fetchWhiffFromFeed('14', lastN);
    } else if (league === 'draft') {
      // MLB Draft League — leagueId=127 in MLB Stats API
      players = await fetchWhiffFromFeed(null, lastN, '127');
    } else {
      // MLB
      players = lastN > 0
        ? await fetchWhiffFromFeed('1', lastN)
        : await fetchMLBWhiffsSeason();
    }

    players.sort((a, b) => (b.whiffPct ?? -Infinity) - (a.whiffPct ?? -Infinity));

    // Attach player ages
    const ids = players.map(p => p.playerId).filter(id => id > 0);
    const ages = await fetchAgesById(ids);
    const withAge = players.map(p => ({ ...p, age: ages[p.playerId] ?? null }));

    return NextResponse.json({ players: withAge, league });
  } catch (err) {
    console.error('[whiff-leaderboard]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
