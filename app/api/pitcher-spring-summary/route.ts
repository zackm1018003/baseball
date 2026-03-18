import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

const MLB_API = 'https://statsapi.mlb.com/api/v1';
const SAVANT_BASE = 'https://baseballsavant.mlb.com/statcast_search/csv';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchJSON(url: string, noCache = false) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    ...(noCache ? { cache: 'no-store' } : { next: { revalidate: 300 } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://baseballsavant.mlb.com/',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    const text = await res.text();
    return text.startsWith('\uFEFF') ? text.slice(1) : text;
  } finally {
    clearTimeout(timer);
  }
}

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values: string[] = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { values.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    values.push(cur.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

const PITCH_TYPE_MAP: Record<string, string | null> = {
  FF: '4-Seam Fastball',
  SI: 'Sinker',
  FC: 'Cutter',
  SL: 'Slider',
  ST: 'Sweeper',
  SV: 'Slurve',
  CH: 'Changeup',
  FS: 'Splitter',
  CU: 'Curveball',
  KC: 'Knuckle Curve',
  KN: null,
  EP: null,
};

function checkBarrel(ev: number, la: number): boolean {
  if (isNaN(ev) || isNaN(la) || ev < 98) return false;
  const delta = Math.min(ev, 116) - 98;
  return la >= Math.max(8, 26 - delta) && la <= Math.min(50, 30 + delta);
}

// ─── IP helpers ───────────────────────────────────────────────────────────────

function parseIpToOuts(ip: string): number {
  if (!ip) return 0;
  const parts = ip.split('.');
  return (parseInt(parts[0]) || 0) * 3 + (parseInt(parts[1]) || 0);
}

function outsToIp(outs: number): string {
  const full = Math.floor(outs / 3);
  const partial = outs % 3;
  return `${full}.${partial}`;
}

// ─── Statcast aggregation ─────────────────────────────────────────────────────

function aggregateDayStatcast(rows: Record<string, string>[]) {
  const groups: Record<string, {
    velos: number[]; spins: number[];
    hBreaks: number[]; vBreaks: number[];
    vaas: number[]; haas: number[]; count: number; swings: number; whiffs: number; inZone: number; barrels: number;
    hRels: number[]; vRels: number[]; extensions: number[];
  }> = {};

  const rawDots: { hb: number; ivb: number; pitchType: string; px: number | null; pz: number | null; isWhiff: boolean; isBarrel: boolean; batterSide: string | null; velo: number | null; spin: number | null; vaa: number | null; haa: number | null; hRel: number | null; vRel: number | null; extension: number | null }[] = [];
  const armAngles: number[] = [];

  let totalPitches = 0;
  let strikes = 0;
  let swingAndMisses = 0;

  for (const row of rows) {
    const rawType = row.pitch_type;
    const mapped = PITCH_TYPE_MAP[rawType];
    if (mapped === null || mapped === undefined) continue;

    totalPitches++;

    const desc = (row.description || '').toLowerCase();
    if (desc.includes('strike') || desc.includes('foul') || desc.includes('swinging')) strikes++;
    if (desc.includes('swinging_strike') || desc === 'swinging_strike_blocked') swingAndMisses++;

    if (!groups[mapped]) {
      groups[mapped] = { velos: [], spins: [], hBreaks: [], vBreaks: [], vaas: [], haas: [], count: 0, swings: 0, whiffs: 0, inZone: 0, barrels: 0, hRels: [], vRels: [], extensions: [] };
    }
    const g = groups[mapped];
    g.count++;

    const isSwing = desc.includes('swinging') || desc.includes('foul') || desc.includes('hit_into_play') || desc === 'hit_into_play';
    const isWhiff = desc === 'swinging_strike' || desc === 'swinging_strike_blocked' || desc === 'foul_tip';
    if (isSwing || isWhiff) g.swings++;
    if (isWhiff) g.whiffs++;

    const velo = parseFloat(row.release_speed);
    if (!isNaN(velo)) g.velos.push(velo);

    const spin = parseFloat(row.release_spin_rate);
    if (!isNaN(spin)) g.spins.push(spin);

    const pThrows = (row.p_throws ?? '').trim().toUpperCase();
    const armSign = pThrows === 'L' ? 1 : -1;

    const hRelRaw = parseFloat(row.release_pos_x);
    if (!isNaN(hRelRaw)) g.hRels.push(armSign * hRelRaw);

    const vRelRaw = parseFloat(row.release_pos_z);
    if (!isNaN(vRelRaw)) g.vRels.push(vRelRaw);

    const extRaw = parseFloat(row.release_extension);
    if (!isNaN(extRaw)) g.extensions.push(extRaw);

    const hBreak = parseFloat(row.pfx_x);
    if (!isNaN(hBreak)) g.hBreaks.push(hBreak * armSign * 12);

    const vBreak = parseFloat(row.pfx_z);
    if (!isNaN(vBreak)) g.vBreaks.push(vBreak * 12);

    const pxRaw = parseFloat(row.plate_x);
    const pzRaw = parseFloat(row.plate_z);
    const isWhiffCsv = desc === 'swinging_strike' || desc === 'swinging_strike_blocked';
    const batterSide = (row.stand ?? '').trim() || null;
    const exitVelo = parseFloat(row.launch_speed);
    const launchAngle = parseFloat(row.launch_angle);
    const isBarrel = checkBarrel(exitVelo, launchAngle);
    if (isBarrel) g.barrels++;
    if (!isNaN(pxRaw) && !isNaN(pzRaw) && Math.abs(pxRaw) <= 0.708 && pzRaw >= 1.5 && pzRaw <= 3.5) g.inZone++;

    if (!isNaN(hRelRaw) && !isNaN(vRelRaw)) {
      const geoAA = Math.atan2(vRelRaw - 4.7, Math.abs(hRelRaw)) * (180 / Math.PI);
      if (!isNaN(geoAA)) armAngles.push(geoAA);
    }

    const vz0 = parseFloat(row.vz0);
    const vy0 = parseFloat(row.vy0);
    const vx0 = parseFloat(row.vx0);
    const ay  = parseFloat(row.ay);
    const az  = parseFloat(row.az);
    const ax  = parseFloat(row.ax);
    const yRelease = parseFloat(row.release_pos_y);
    let perPitchVaa: number | null = null;
    let perPitchHaa: number | null = null;
    if (!isNaN(vz0) && !isNaN(vy0) && !isNaN(ay) && !isNaN(az) && !isNaN(yRelease) && ay !== 0) {
      const yPlate = 1.417;
      const disc = vy0 * vy0 + 2 * ay * (yPlate - yRelease);
      if (disc >= 0) {
        const t = (-vy0 - Math.sqrt(disc)) / ay;
        const vzAtPlate = vz0 + az * t;
        const vyAtPlate = vy0 + ay * t;
        perPitchVaa = Math.atan2(vzAtPlate, Math.abs(vyAtPlate)) * (180 / Math.PI);
        g.vaas.push(perPitchVaa);
        if (!isNaN(vx0) && !isNaN(ax)) {
          const vxAtPlate = vx0 + ax * t;
          perPitchHaa = -Math.atan(vxAtPlate / vyAtPlate) * (180 / Math.PI);
          g.haas.push(perPitchHaa);
        }
      }
    }
    if (!isNaN(hBreak) && !isNaN(vBreak)) {
      rawDots.push({
        hb: hBreak * armSign * 12, ivb: vBreak * 12, pitchType: mapped,
        px: !isNaN(pxRaw) ? pxRaw : null,
        pz: !isNaN(pzRaw) ? pzRaw : null,
        isWhiff: isWhiffCsv,
        isBarrel,
        batterSide,
        velo: !isNaN(velo) ? velo : null,
        spin: !isNaN(spin) ? spin : null,
        vaa: perPitchVaa,
        haa: perPitchHaa,
        hRel: !isNaN(hRelRaw) ? armSign * hRelRaw : null,
        vRel: !isNaN(vRelRaw) ? vRelRaw : null,
        extension: !isNaN(extRaw) ? extRaw : null,
      });
    }
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const r1 = (v: number | null) => v !== null ? Math.round(v * 10) / 10 : null;
  const r2 = (v: number | null) => v !== null ? Math.round(v * 100) / 100 : null;

  const countedPitches = Object.values(groups).reduce((s, g) => s + g.count, 0);

  const pitchTypes: {
    name: string; count: number; usage: number;
    velo: number | null; maxVelo: number | null; spin: number | null;
    h_movement: number | null; v_movement: number | null;
    vaa: number | null; haa: number | null; whiff: number | null; whiffs: number;
    zone_pct: number | null; barrel_pct: number | null;
    h_rel: number | null; v_rel: number | null; extension: number | null;
  }[] = [];

  for (const [name, g] of Object.entries(groups)) {
    const usage = (g.count / countedPitches) * 100;
    if (usage < 1) continue;
    pitchTypes.push({
      name, count: g.count,
      usage: Math.round(usage * 10) / 10,
      velo: r1(avg(g.velos)),
      maxVelo: g.velos.length > 0 ? r1(Math.max(...g.velos)) : null,
      spin: avg(g.spins) !== null ? Math.round(avg(g.spins)!) : null,
      h_movement: r1(avg(g.hBreaks)),
      v_movement: r1(avg(g.vBreaks)),
      vaa: r2(avg(g.vaas)),
      haa: r2(avg(g.haas)),
      whiff: g.swings > 0 ? Math.round((g.whiffs / g.swings) * 1000) / 10 : null,
      whiffs: g.whiffs,
      zone_pct: g.count > 0 ? Math.round((g.inZone / g.count) * 1000) / 10 : null,
      barrel_pct: g.count > 0 ? Math.round((g.barrels / g.count) * 1000) / 10 : null,
      h_rel: r2(avg(g.hRels)),
      v_rel: r2(avg(g.vRels)),
      extension: r2(avg(g.extensions)),
    });
  }

  pitchTypes.sort((a, b) => b.usage - a.usage);

  const avgArmAngle = armAngles.length > 0
    ? Math.round(armAngles.reduce((a, b) => a + b, 0) / armAngles.length * 10) / 10
    : null;

  return {
    totalPitches,
    pitchTypes,
    rawDots,
    armAngle: avgArmAngle,
    strikePct: totalPitches > 0 ? Math.round((strikes / totalPitches) * 1000) / 10 : null,
    swingAndMissPct: totalPitches > 0 ? Math.round((swingAndMisses / totalPitches) * 1000) / 10 : null,
    totalWhiffs: swingAndMisses,
  };
}

// ─── Arm angle from Savant leaderboard ────────────────────────────────────────

async function fetchSavantArmAngle(playerId: string, season: number): Promise<number | null> {
  try {
    const url = `https://baseballsavant.mlb.com/leaderboard/pitcher-arm-angles?year=${season}&min=1&pos=all`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    let data: unknown;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        next: { revalidate: 300 },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      data = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const rows = Array.isArray(data) ? data : (data as Record<string, unknown>)?.data;
    if (!Array.isArray(rows)) return null;
    const row = rows.find(
      (r: Record<string, unknown>) =>
        String(r.pitcher) === String(playerId) || String(r.id) === String(playerId)
    );
    const aa = Number(row?.arm_angle);
    return !isNaN(aa) ? Math.round(aa * 10) / 10 : null;
  } catch {
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpringOuting {
  date: string;
  opponent: string;
  ip: string;
  h: number;
  er: number;
  bb: number;
  k: number;
  hr: number;
  pitches: number;
  bf: number;
  gamePk?: number;
  isHome?: boolean | null;
  team?: string | null;
  gameType?: 'S' | 'W'; // S = Spring Training, W = WBC
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const seasonParam = searchParams.get('season');

  if (!playerId) {
    return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  }

  const season = seasonParam ? parseInt(seasonParam) : new Date().getFullYear();
  const springStart = `${season}-02-01`;
  const springEnd   = `${season}-03-31`;
  // WBC is typically played in March; use same date window
  const wbcStart = `${season}-02-01`;
  const wbcEnd   = `${season}-04-10`; // extends into early April for WBC finals

  // ── 1. Player bio ──────────────────────────────────────────────────────────
  let playerName: string | null = null;
  let playerHeight: string | null = null;
  let playerWeight: number | null = null;
  let playerBirthDate: string | null = null;
  let playerPitchHand: string | null = null;
  let playerBatSide: string | null = null;
  let currentTeamId: number | null = null;
  try {
    const personData = await fetchJSON(`${MLB_API}/people/${playerId}?hydrate=currentTeam`);
    const person = personData?.people?.[0];
    playerName = person?.fullName ?? null;
    playerHeight = person?.height ?? null;
    playerWeight = person?.weight ?? null;
    playerBirthDate = person?.birthDate ?? null;
    playerPitchHand = person?.pitchHand?.code ?? null;
    playerBatSide = person?.batSide?.code ?? null;
    currentTeamId = person?.currentTeam?.id ?? null;
  } catch { /* non-fatal */ }

  // ── 2. Spring training game log ────────────────────────────────────────────
  // Fast path: game log for sportId=1, filtering to Feb–Mar dates.
  // Works for completed seasons. For the current active season the
  // game log may be empty — we fall back to schedule scanning below.
  let springOutings: SpringOuting[] = [];
  try {
    const gameLogUrl = `${MLB_API}/people/${playerId}/stats?stats=gameLog&group=pitching&season=${season}&sportId=1`;
    const gameLogData = await fetchJSON(gameLogUrl);
    const splits: {
      date?: string;
      stat: {
        inningsPitched?: string;
        hits?: number;
        earnedRuns?: number;
        baseOnBalls?: number;
        strikeOuts?: number;
        homeRuns?: number;
        numberOfPitches?: number;
        battersFaced?: number;
      };
      team?: { abbreviation?: string };
      opponent?: { abbreviation?: string; name?: string };
      isHome?: boolean;
      game?: { gamePk?: number; gameDate?: string };
    }[] = gameLogData?.stats?.[0]?.splits ?? [];

    springOutings = splits
      .map(s => {
        const date = s.date || s.game?.gameDate?.slice(0, 10) || '';
        // Determine game type: WBC games have gameType 'W' in the split data
        const rawGameType = (s as Record<string, unknown>)?.game
          ? ((s as Record<string, unknown>).game as Record<string, unknown>)?.gameType
          : undefined;
        const gameType: 'S' | 'W' = rawGameType === 'W' ? 'W' : 'S';
        return {
          date,
          opponent: s.opponent?.abbreviation || s.opponent?.name || '?',
          ip: s.stat?.inningsPitched || '0',
          h: s.stat?.hits ?? 0,
          er: s.stat?.earnedRuns ?? 0,
          bb: s.stat?.baseOnBalls ?? 0,
          k: s.stat?.strikeOuts ?? 0,
          hr: s.stat?.homeRuns ?? 0,
          pitches: s.stat?.numberOfPitches ?? 0,
          bf: s.stat?.battersFaced ?? 0,
          gamePk: s.game?.gamePk,
          isHome: s.isHome ?? null,
          team: s.team?.abbreviation || null,
          gameType,
        };
      })
      .filter(o => {
        if (!o.date) return false;
        const month = parseInt(o.date.slice(5, 7));
        // Feb–Mar = spring training; allow up to early April for WBC finals
        return month >= 2 && month <= 4 && o.date <= wbcEnd;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) {
    console.warn('[Spring game log] fetch failed:', e);
  }

  // ── 2b. WBC game log (always runs) ──────────────────────────────────────────
  // The sportId=1 game log only surfaces MLB/MiLB games; WBC is gameType=W.
  // Fetch the player's WBC game log directly — same fast-path approach as ST
  // above but with gameType=W.  Always runs so WBC outings are never missed
  // when ST games were already found.
  const hasWbcFromFastPath = springOutings.some(o => o.gameType === 'W');
  if (!hasWbcFromFastPath) {
    try {
      const seenPks = new Set(
        springOutings.map(o => o.gamePk).filter((pk): pk is number => pk !== undefined)
      );

      // Attempt 1: dedicated WBC game log via gameType=W
      const wbcLogUrl = `${MLB_API}/people/${playerId}/stats?stats=gameLog&group=pitching&season=${season}&gameType=W`;
      const wbcLogData = await fetchJSON(wbcLogUrl);
      const wbcSplits: {
        date?: string;
        stat: {
          inningsPitched?: string; hits?: number; earnedRuns?: number;
          baseOnBalls?: number; strikeOuts?: number; homeRuns?: number;
          numberOfPitches?: number; battersFaced?: number;
        };
        team?: { abbreviation?: string };
        opponent?: { abbreviation?: string; name?: string };
        isHome?: boolean;
        game?: { gamePk?: number; gameDate?: string };
      }[] = wbcLogData?.stats?.[0]?.splits ?? [];

      const wbcOutings: SpringOuting[] = wbcSplits
        .map(s => ({
          date: s.date || s.game?.gameDate?.slice(0, 10) || '',
          opponent: s.opponent?.abbreviation || s.opponent?.name || '?',
          ip: s.stat?.inningsPitched || '0',
          h: s.stat?.hits ?? 0,
          er: s.stat?.earnedRuns ?? 0,
          bb: s.stat?.baseOnBalls ?? 0,
          k: s.stat?.strikeOuts ?? 0,
          hr: s.stat?.homeRuns ?? 0,
          pitches: s.stat?.numberOfPitches ?? 0,
          bf: s.stat?.battersFaced ?? 0,
          gamePk: s.game?.gamePk,
          isHome: s.isHome ?? null,
          team: s.team?.abbreviation || null,
          gameType: 'W' as const,
        }))
        .filter(o => {
          if (!o.date) return false;
          if (o.gamePk && seenPks.has(o.gamePk)) return false;
          const month = parseInt(o.date.slice(5, 7));
          return month >= 2 && month <= 4 && o.date <= wbcEnd;
        });

      if (wbcOutings.length > 0) {
        springOutings.push(...wbcOutings);
        springOutings.sort((a, b) => a.date.localeCompare(b.date));
        console.log(`[WBC game log] found ${wbcOutings.length} WBC outings`);
      } else {
        // Attempt 2: schedule scan — try both with and without sportId
        // so we work regardless of how the API routes WBC games.
        const wbcScheduleUrls = [
          `${MLB_API}/schedule?season=${season}&gameType=W&startDate=${wbcStart}&endDate=${wbcEnd}`,
          `${MLB_API}/schedule?sportId=51&season=${season}&gameType=W&startDate=${wbcStart}&endDate=${wbcEnd}`,
          `${MLB_API}/schedule?sportId=1&season=${season}&gameType=W&startDate=${wbcStart}&endDate=${wbcEnd}`,
        ];
        const wbcGameSet = new Map<number, string>(); // gamePk → gameDate
        for (const url of wbcScheduleUrls) {
          try {
            const sched = await fetchJSON(url);
            for (const dateEntry of sched?.dates ?? []) {
              for (const g of dateEntry?.games ?? []) {
                if (String(g?.status?.abstractGameState ?? '') === 'Final') {
                  wbcGameSet.set(Number(g.gamePk), String(g.gameDate ?? '').slice(0, 10));
                }
              }
            }
          } catch { /* try next url */ }
        }
        const wbcGames = Array.from(wbcGameSet.entries())
          .filter(([pk]) => !seenPks.has(pk))
          .map(([gamePk, gameDate]) => ({ gamePk, gameDate }));

        const pid = parseInt(playerId);
        const BATCH = 8;
        for (let i = 0; i < wbcGames.length; i += BATCH) {
          const batch = wbcGames.slice(i, i + BATCH);
          const results = await Promise.allSettled(
            batch.map(async g => {
              const feed = await fetchJSON(`https://statsapi.mlb.com/api/v1.1/game/${g.gamePk}/feed/live`, true);
              const homeBox = feed?.liveData?.boxscore?.teams?.home;
              const awayBox = feed?.liveData?.boxscore?.teams?.away;
              const homePitchers: number[] = homeBox?.pitchers ?? [];
              const awayPitchers: number[] = awayBox?.pitchers ?? [];
              const isHome = homePitchers.includes(pid);
              const isAway = awayPitchers.includes(pid);
              if (!isHome && !isAway) return null;
              const box = isHome ? homeBox : awayBox;
              const playerData = box?.players?.[`ID${pid}`];
              const pStats = playerData?.gameStats?.pitching ?? playerData?.stats?.pitching;
              if (!pStats) return null;
              const homeTeam = feed?.gameData?.teams?.home;
              const awayTeam = feed?.gameData?.teams?.away;
              const myTeam = isHome ? homeTeam : awayTeam;
              const oppTeam = isHome ? awayTeam : homeTeam;
              return {
                date: g.gameDate,
                opponent: oppTeam?.abbreviation || oppTeam?.teamName || '?',
                ip: pStats.inningsPitched ?? '0',
                h: pStats.hits ?? 0,
                er: pStats.earnedRuns ?? 0,
                bb: pStats.baseOnBalls ?? 0,
                k: pStats.strikeOuts ?? 0,
                hr: pStats.homeRuns ?? 0,
                pitches: pStats.numberOfPitches ?? 0,
                bf: pStats.battersFaced ?? 0,
                gamePk: g.gamePk,
                isHome,
                team: myTeam?.abbreviation || null,
                gameType: 'W' as const,
              } as SpringOuting;
            })
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
              seenPks.add(r.value.gamePk!);
              springOutings.push(r.value);
            }
          }
        }
        springOutings.sort((a, b) => a.date.localeCompare(b.date));
        console.log(`[WBC schedule scan] found ${springOutings.filter(o => o.gameType === 'W').length} WBC outings`);
      }
    } catch (e) {
      console.warn('[WBC] fetch failed:', e);
    }
  }

  // ── 2c. Fallback: scan ST schedule + live feeds ──────────────────────────────
  // Used when game log returned no spring training games (e.g. current active
  // season where the game log isn't populated yet).  WBC is handled by 2b above.
  const hasStFromFastPath = springOutings.some(o => o.gameType === 'S');
  if (!hasStFromFastPath) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const pid = parseInt(playerId);
      const seenPks = new Set(
        springOutings.map(o => o.gamePk).filter((pk): pk is number => pk !== undefined)
      );

      // Helper: scan a schedule URL and collect completed games
      async function scanSchedule(url: string, gType: 'S' | 'W') {
        const schedData = await fetchJSON(url);
        const games: { gamePk: number; gameDate: string; status: string; gameType: 'S' | 'W' }[] = [];
        for (const dateEntry of schedData?.dates ?? []) {
          for (const g of dateEntry?.games ?? []) {
            const status = String(g?.status?.abstractGameState ?? '');
            if (status === 'Final') {
              games.push({ gamePk: g.gamePk, gameDate: String(g.gameDate ?? '').slice(0, 10), status, gameType: gType });
            }
          }
        }
        return games;
      }

      // Spring training games — scoped to player's current MLB team
      const stGames: { gamePk: number; gameDate: string; status: string; gameType: 'S' | 'W' }[] = [];
      if (currentTeamId) {
        try {
          const found = await scanSchedule(
            `${MLB_API}/schedule?teamId=${currentTeamId}&sportId=1&season=${season}&gameType=S&startDate=${springStart}&endDate=${today}`,
            'S'
          );
          stGames.push(...found);
        } catch { /* non-fatal */ }
      }

      const uniqueGames = stGames.filter(g => {
        if (seenPks.has(g.gamePk)) return false;
        seenPks.add(g.gamePk);
        return true;
      });

      // Fetch live feeds in parallel batches of 8
      const BATCH = 8;
      for (let i = 0; i < uniqueGames.length; i += BATCH) {
        const batch = uniqueGames.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map(async g => {
            const feed = await fetchJSON(`https://statsapi.mlb.com/api/v1.1/game/${g.gamePk}/feed/live`, true);
            const homeBox = feed?.liveData?.boxscore?.teams?.home;
            const awayBox = feed?.liveData?.boxscore?.teams?.away;
            const homePitchers: number[] = homeBox?.pitchers ?? [];
            const awayPitchers: number[] = awayBox?.pitchers ?? [];
            const isHome = homePitchers.includes(pid);
            const isAway = awayPitchers.includes(pid);
            if (!isHome && !isAway) return null;

            const box = isHome ? homeBox : awayBox;
            const playerData = box?.players?.[`ID${pid}`];
            const pStats = playerData?.gameStats?.pitching ?? playerData?.stats?.pitching;
            if (!pStats) return null;

            const homeTeam = feed?.gameData?.teams?.home;
            const awayTeam = feed?.gameData?.teams?.away;
            const myTeam = isHome ? homeTeam : awayTeam;
            const oppTeam = isHome ? awayTeam : homeTeam;

            return {
              date: g.gameDate,
              opponent: oppTeam?.abbreviation || oppTeam?.teamName || '?',
              ip: pStats.inningsPitched ?? '0',
              h: pStats.hits ?? 0,
              er: pStats.earnedRuns ?? 0,
              bb: pStats.baseOnBalls ?? 0,
              k: pStats.strikeOuts ?? 0,
              hr: pStats.homeRuns ?? 0,
              pitches: pStats.numberOfPitches ?? 0,
              bf: pStats.battersFaced ?? 0,
              gamePk: g.gamePk,
              isHome,
              team: myTeam?.abbreviation || null,
              gameType: g.gameType,
            } as SpringOuting;
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) springOutings.push(r.value);
        }
      }
      springOutings.sort((a, b) => a.date.localeCompare(b.date));
      console.log(`[ST fallback scan] found ${springOutings.length} total outings`);
    } catch (e) {
      console.warn('[ST fallback scan] failed:', e);
    }
  }

  if (springOutings.length === 0) {
    return NextResponse.json({
      error: `No spring training or WBC appearances found for ${season}.`,
      playerName, playerHeight, playerWeight, playerBirthDate, playerPitchHand, playerBatSide,
      springOutings: [],
    }, { status: 404 });
  }

  // ── 3. Aggregate game line totals ──────────────────────────────────────────
  const totalOuts = springOutings.reduce((sum, o) => sum + parseIpToOuts(o.ip), 0);
  const totalH   = springOutings.reduce((sum, o) => sum + o.h, 0);
  const totalER  = springOutings.reduce((sum, o) => sum + o.er, 0);
  const totalBB  = springOutings.reduce((sum, o) => sum + o.bb, 0);
  const totalK   = springOutings.reduce((sum, o) => sum + o.k, 0);
  const totalHR  = springOutings.reduce((sum, o) => sum + o.hr, 0);
  const totalPitches = springOutings.reduce((sum, o) => sum + o.pitches, 0);
  const totalBF  = springOutings.reduce((sum, o) => sum + o.bf, 0);
  const ipDecimal = totalOuts / 3;
  const era = ipDecimal > 0 ? (totalER / ipDecimal * 9).toFixed(2) : null;

  const aggregatedGameLine = {
    ip: outsToIp(totalOuts),
    h: totalH,
    er: totalER,
    bb: totalBB,
    k: totalK,
    hr: totalHR,
    pitches: totalPitches,
    bf: totalBF,
    era,
    games: springOutings.length,
  };

  // ── 4. Fetch Statcast CSV for spring training + WBC period ──────────────────
  // hfGT=S|E|W| covers spring training (S), exhibition (E), and WBC (W)
  let pitchData = null;
  try {
    const savantUrl = `${SAVANT_BASE}?all=true&type=details&pitchers_lookup%5B%5D=${playerId}&player_type=pitcher&game_date_gt=${springStart}&game_date_lt=${wbcEnd}&hfGT=S%7CE%7CW%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`;
    const csvText = await fetchText(savantUrl);
    if (csvText.includes('pitch_type')) {
      const rows = parseCSV(csvText);
      const pidStr = String(playerId).trim();
      const gamePks = new Set(
        springOutings.map(o => o.gamePk?.toString()).filter(Boolean)
      );
      const filtered = rows.filter(r => {
        const pkMatch = gamePks.size > 0 ? gamePks.has(r.game_pk?.trim()) : true;
        return pkMatch && r.pitcher?.trim() === pidStr;
      });
      if (filtered.length > 0) {
        pitchData = aggregateDayStatcast(filtered);
      }
    }
  } catch (e) {
    console.warn('[Spring Statcast CSV] fetch failed:', e);
  }

  // Fallback: try /gf for each gamePk
  if (!pitchData) {
    type GfPitch = Record<string, unknown>;
    const allGfPitches: { hb: number; ivb: number; pitchType: string; px: number | null; pz: number | null; isWhiff: boolean; isBarrel: boolean; batterSide: string | null; velo: number | null; spin: number | null; vaa: number | null; haa: number | null; hRel: number | null; vRel: number | null; extension: number | null }[] = [];

    // Build a combined CSV-like representation from /gf data per game
    const allGfRaw: GfPitch[] = [];
    for (const outing of springOutings) {
      if (!outing.gamePk) continue;
      try {
        const gfUrl = `https://baseballsavant.mlb.com/gf?game_pk=${outing.gamePk}`;
        const gf = await fetchJSON(gfUrl, true);
        const pidStr = String(playerId);
        const homePitches: GfPitch[] = gf?.home_pitchers?.[pidStr] ?? [];
        const awayPitches: GfPitch[] = gf?.away_pitchers?.[pidStr] ?? [];
        allGfRaw.push(...homePitches, ...awayPitches);
      } catch { /* continue to next game */ }
    }

    if (allGfRaw.length > 0 && allGfPitches.length === 0) {
      // Use a simple inline aggregation for /gf fallback
      // Re-use aggregateDayStatcast by converting gf pitches to csv-like records is complex;
      // instead just indicate we have pitch count from game lines
      console.log(`[Spring /gf] fallback: ${allGfRaw.length} pitches found across spring training`);
    }
  }

  // ── 5. Arm angle ───────────────────────────────────────────────────────────
  if (pitchData) {
    const savantArmAngle = await fetchSavantArmAngle(playerId, season);
    if (savantArmAngle !== null) {
      pitchData = { ...pitchData, armAngle: savantArmAngle };
    }
  }

  return NextResponse.json({
    playerId: parseInt(playerId),
    playerName,
    playerHeight,
    playerWeight,
    playerBirthDate,
    playerPitchHand,
    playerBatSide,
    season,
    aggregatedGameLine,
    pitchData,
    springOutings,
  });
}
