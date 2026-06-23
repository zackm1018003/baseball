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

// Pitch call codes (from pitcher's perspective — same codes)
const WHIFF_CODES = new Set(['S', 'W', 'M', 'Q']);
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

// Display IP in baseball format: 15 outs → "5.0", 16 outs → "5.1", 17 outs → "5.2"
function outsToIPDisplay(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

// ─── Return shape ─────────────────────────────────────────────────────────────

export type WhiffPitcherRaw = {
  playerId: number;
  name: string;
  team: string;
  ip: string | null;       // display string e.g. "5.1"
  ipVal: number | null;    // actual innings (for ERA/WHIP calc)
  bf: number | null;
  k: number | null;
  bb: number | null;
  hr: number | null;
  er: number | null;
  era: number | null;
  whip: number | null;
  kPct: number | null;
  bbPct: number | null;
  whiffs: number | null;
  swings: number | null;
  pitches: number | null;
  whiffPct: number | null;
  swStrPct: number | null;
  chasePct: number | null;
  swingPct: number | null;
};

// ─── MLB (Savant) — pitcher full season ───────────────────────────────────────

async function fetchMLBPitchersSeason(): Promise<WhiffPitcherRaw[]> {
  const season = new Date().getFullYear();

  const [statcastText, swingTakeText] = await Promise.all([
    safeFetch(`https://baseballsavant.mlb.com/leaderboard/statcast?type=pitcher&year=${season}&position=&team=&min=1&csv=true`),
    safeFetch(`https://baseballsavant.mlb.com/leaderboard/swing-take?year=${season}&team=&min=25&pitcherThrows=&csv=true`).catch(() => ''),
  ]);

  const statcastRows = parseCSV(statcastText);
  const swingTakeRows = parseCSV(swingTakeText);

  // Swing/take leaderboard keyed by player_id
  const stById: Record<string, Record<string, string>> = {};
  for (const r of swingTakeRows) {
    const id = (r['player_id'] ?? r['id'] ?? '').trim();
    if (id) stById[id] = r;
  }

  // Batch-fetch teams from MLB Stats API
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

      // Pitcher CSV column names vary — try multiple fallbacks
      const kPct  = num(r['k_percent'] ?? r['p_k_percent']);
      const bbPct = num(r['bb_percent'] ?? r['p_bb_percent']);
      const whiffPct =
        num(r['whiff_percent'] ?? r['p_whiff_percent']) ??
        (st ? (num(st['whiff_percent']) ?? num(st['whiff_pct'])) : null);
      const swingPct =
        num(r['swing_percent'] ?? r['p_swing_percent']) ??
        (st ? (num(st['swing_percent']) ?? num(st['swing_pct'])) : null);
      const chasePct =
        num(r['oz_swing_percent'] ?? r['p_oz_swing_percent']) ??
        (st ? (num(st['chase_percent']) ?? num(st['oz_swing_percent'])) : null);
      const swStrPct = (whiffPct != null && swingPct != null)
        ? Math.round(whiffPct * swingPct / 100 * 10) / 10
        : null;

      const era  = num(r['p_era']  ?? r['era']  ?? r['earned_run_avg']);
      const whip = num(r['p_whip'] ?? r['whip'] ?? r['whip_9inn']);
      const ip   = num(r['p_formatted_ip'] ?? r['ip'] ?? r['innings_pitched']);

      return {
        playerId:  num(r['player_id']) ?? 0,
        name:      formatName(r['last_name, first_name'] || ''),
        team:      teamByIdStr[idStr] ?? '',
        ip:        ip != null ? String(ip) : null,
        ipVal:     ip,
        bf:        num(r['pa']),
        k:         null,
        bb:        null,
        hr:        null,
        er:        null,
        era,
        whip,
        kPct,
        bbPct,
        whiffs:    null,
        swings:    null,
        pitches:   null,
        whiffPct,
        swStrPct,
        chasePct,
        swingPct,
      } satisfies WhiffPitcherRaw;
    })
    .filter(p => !!p.name);
}

// ─── Live feed — pitcher accumulation ────────────────────────────────────────

async function processPitcherGames(gamePks: number[]): Promise<WhiffPitcherRaw[]> {
  type PitcherAcc = {
    name: string; team: string;
    outsPitched: number; er: number; h: number; hr: number; bb: number; k: number; bf: number;
    whiffs: number; swings: number; pitches: number;
  };
  const acc: Record<number, PitcherAcc> = {};

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
          const pitchers = (box.pitchers ?? []) as number[];
          for (const pid of pitchers) {
            const pData = playersMap[`ID${pid}`] as Record<string, unknown> | undefined;
            if (!pData) continue;
            const pStats = (
              ((pData.gameStats as Record<string, unknown>)?.pitching) ??
              ((pData.stats     as Record<string, unknown>)?.pitching)
            ) as Record<string, unknown> | undefined;
            if (!pStats) continue;

            // Parse innings pitched from "N.O" format (N innings, O outs)
            const ipStr = String(pStats.inningsPitched ?? '0');
            const ipParts = ipStr.split('.');
            const outsPitched = (parseInt(ipParts[0]) || 0) * 3 + (parseInt(ipParts[1]) || 0);
            if (outsPitched === 0) continue;

            if (!acc[pid]) {
              const name = String((pData.person as Record<string, unknown>)?.fullName ?? `Player ${pid}`);
              acc[pid] = { name, team: abbr, outsPitched: 0, er: 0, h: 0, hr: 0, bb: 0, k: 0, bf: 0, whiffs: 0, swings: 0, pitches: 0 };
            }
            acc[pid].team        = abbr;
            acc[pid].outsPitched += outsPitched;
            acc[pid].er          += Number(pStats.earnedRuns   ?? 0);
            acc[pid].h           += Number(pStats.hits         ?? 0);
            acc[pid].hr          += Number(pStats.homeRuns     ?? 0);
            acc[pid].bb          += Number(pStats.baseOnBalls  ?? 0);
            acc[pid].k           += Number(pStats.strikeOuts   ?? 0);
            acc[pid].bf          += Number(pStats.battersFaced ?? 0);
          }
        };

        processTeam(homeBox, homeAbbr);
        processTeam(awayBox, awayAbbr);

        // Mine play-by-play — attribute pitches to the pitcher
        const allPlays = (feed?.liveData?.plays?.allPlays ?? []) as Array<Record<string, unknown>>;
        for (const play of allPlays) {
          const pitcherId = Number(
            ((play.matchup as Record<string, unknown>)?.pitcher as Record<string, unknown>)?.id ?? NaN
          );
          if (isNaN(pitcherId) || !acc[pitcherId]) continue;

          for (const pe of ((play.playEvents as Array<Record<string, unknown>>) ?? [])) {
            if (!pe.isPitch) continue;
            const details  = pe.details as Record<string, unknown> | undefined;
            const callCode = String((details?.call as Record<string, unknown>)?.code ?? '');

            acc[pitcherId].pitches++;
            if (SWING_CODES.has(callCode)) {
              acc[pitcherId].swings++;
              if (WHIFF_CODES.has(callCode)) {
                acc[pitcherId].whiffs++;
              }
            }
          }
        }
      } catch { /* non-fatal */ }
    }));
  }

  return Object.entries(acc).map(([pidStr, s]) => {
    const pid = parseInt(pidStr);
    const ipVal = s.outsPitched / 3;
    const bfDenom = s.bf > 0 ? s.bf : null;
    return {
      playerId:  pid,
      name:      s.name,
      team:      s.team,
      ip:        outsToIPDisplay(s.outsPitched),
      ipVal,
      bf:        s.bf,
      k:         s.k,
      bb:        s.bb,
      hr:        s.hr,
      er:        s.er,
      era:       ipVal > 0 ? Math.round(s.er / ipVal * 9 * 100) / 100 : null,
      whip:      ipVal > 0 ? Math.round((s.h + s.bb) / ipVal * 100) / 100 : null,
      kPct:      bfDenom != null ? Math.round(s.k  / bfDenom * 1000) / 10 : null,
      bbPct:     bfDenom != null ? Math.round(s.bb / bfDenom * 1000) / 10 : null,
      whiffs:    s.whiffs,
      swings:    s.swings,
      pitches:   s.pitches,
      whiffPct:  s.swings  > 0 ? Math.round(s.whiffs / s.swings  * 1000) / 10 : null,
      swStrPct:  s.pitches > 0 ? Math.round(s.whiffs / s.pitches * 1000) / 10 : null,
      chasePct:  null,
      swingPct:  s.pitches > 0 ? Math.round(s.swings / s.pitches * 1000) / 10 : null,
    } satisfies WhiffPitcherRaw;
  }).filter(p => p.ipVal != null && p.ipVal > 0);
}

// ─── Live feed — schedule fetch + process ─────────────────────────────────────

async function fetchPitchersFromFeed(
  sportId: string | null,
  lastN: number,
  leagueId?: string
): Promise<WhiffPitcherRaw[]> {
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

  return processPitcherGames(gamePks);
}

// ─── Rookie Ball (FCL + ACL combined) ────────────────────────────────────────

async function fetchRookiePitchers(lastN: number): Promise<WhiffPitcherRaw[]> {
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

  const gamePks = [...new Set([...collectPks(fclSchedule), ...collectPks(aclSchedule)])];
  return processPitcherGames(gamePks);
}

// ─── MLB Draft League (sportId=22, starts June) ──────────────────────────────

// sportId=22 = CBB/Draft League pool; sportId=23 = Mexican League + independents (wrong)
// Filter to exactly the 6 Draft League teams (stable roster since 2021)
const DRAFT_LEAGUE_ABBRS = new Set(['ABD', 'MV', 'SC', 'TRN', 'WV', 'WIL']);

async function fetchDraftLeaguePitchers(lastN: number): Promise<WhiffPitcherRaw[]> {
  const today = getToday();
  const season = new Date().getFullYear();
  // Draft League runs June–August; use May 15 to catch any early-start games
  const startDate = lastN > 0
    ? getDateDaysAgo(Math.max(lastN * 2, 30))
    : `${season}-05-15`;

  const schedule = await fetchJSON(
    `${MLB_API}/schedule?startDate=${startDate}&endDate=${today}&sportId=22`
  ).catch(() => null);

  // CBB games may not report abstractGameState='Final' — collect ALL non-preview/scheduled games
  const dates = ((schedule as Record<string, unknown>)?.dates ?? []) as Array<{
    games: Array<{ gamePk: number; status: { abstractGameState: string } }>;
  }>;
  const activeDates = dates.filter(d =>
    d.games.some(g => {
      const s = g.status?.abstractGameState ?? '';
      return s !== 'Preview' && s !== 'Scheduled' && s !== '';
    })
  );
  const dateSlice = lastN > 0 ? activeDates.slice(-lastN) : activeDates;
  const gamePks = [...new Set(
    dateSlice.flatMap(d =>
      d.games
        .filter(g => {
          const s = g.status?.abstractGameState ?? '';
          return s !== 'Preview' && s !== 'Scheduled' && s !== '';
        })
        .map(g => g.gamePk)
    )
  )];

  const players = await processPitcherGames(gamePks);
  return players.filter(p => DRAFT_LEAGUE_ABBRS.has(p.team.trim().toUpperCase()));
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
  const league   = searchParams.get('league') ?? 'mlb';
  const lastNRaw = searchParams.get('lastN');
  const lastN    = lastNRaw ? Math.max(0, parseInt(lastNRaw) || 0) : 0;

  try {
    let players: WhiffPitcherRaw[];

    if (league === 'rookie') {
      players = await fetchRookiePitchers(lastN);
    } else if (league === 'aaa') {
      players = await fetchPitchersFromFeed('11', lastN);
    } else if (league === 'low-a') {
      players = await fetchPitchersFromFeed('14', lastN);
    } else if (league === 'draft') {
      players = await fetchDraftLeaguePitchers(lastN);
    } else {
      players = lastN > 0
        ? await fetchPitchersFromFeed('1', lastN)
        : await fetchMLBPitchersSeason();
    }

    players.sort((a, b) => (b.whiffPct ?? -Infinity) - (a.whiffPct ?? -Infinity));

    const ids = players.map(p => p.playerId).filter(id => id > 0);
    const ages = await fetchAgesById(ids);
    const withAge = players.map(p => ({ ...p, age: ages[p.playerId] ?? null }));

    return NextResponse.json({ players: withAge, league });
  } catch (err) {
    console.error('[whiff-leaderboard]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
