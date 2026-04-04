import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const MLB_API         = 'https://statsapi.mlb.com/api/v1';
const STATCAST_URL    = 'https://baseballsavant.mlb.com/leaderboard/statcast?type=batter&year=2026&position=&team=&min=1&csv=true';
const BAT_TRACK_URL   = 'https://baseballsavant.mlb.com/leaderboard/bat-tracking?year=2026&team=&min=1&csv=true';

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
  const clean = text.replace(/^\uFEFF/, '');
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

// ─── MLB (Savant) ──────────────────────────────────────────────────────────────

async function fetchMLBPlayers() {
  const [statcastText, batTrackText] = await Promise.all([
    safeFetch(STATCAST_URL),
    safeFetch(BAT_TRACK_URL).catch(() => ''),
  ]);

  const statcastRows = parseCSV(statcastText);
  const batTrackRows = parseCSV(batTrackText);

  const batSpeedById: Record<string, number> = {};
  for (const r of batTrackRows) {
    const id = r['id']?.trim();
    const bs = num(r['avg_bat_speed']);
    if (id && bs !== null) batSpeedById[id] = bs;
  }

  const players = statcastRows
    .map(r => {
      const rawName  = r['last_name, first_name'] || '';
      const playerId = num(r['player_id']);
      const idStr    = r['player_id']?.trim() ?? '';
      return {
        playerId,
        name:        formatName(rawName),
        team:        r['team_id'] || r['team_abbrev'] || r['team'] || '',
        attempts:    num(r['attempts']),
        barrels:     num(r['barrels']),
        barrelPct:   num(r['brl_percent']),
        barrelPerPA: num(r['brl_pa']),
        avgEv:       num(r['avg_hit_speed']),
        maxEv:       num(r['max_hit_speed']),
        avgBatSpeed: idStr ? (batSpeedById[idStr] ?? null) : null,
        ev50:        num(r['ev50']),
        sweetSpotPct:num(r['anglesweetspotpercent']),
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

// ─── AAA / Low-A (MLB Stats API) ──────────────────────────────────────────────

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
        playerId:    Number(player?.id ?? 0) || null,
        name:        String(player?.fullName ?? ''),
        team:        String(team?.abbreviation ?? team?.name ?? ''),
        pa,
        hr:          Number(stat.homeRuns    ?? 0),
        avg:         stat.avg  != null ? String(stat.avg)  : ab > 0 ? (h / ab).toFixed(3) : '.000',
        obp:         stat.obp  != null ? String(stat.obp)  : null,
        slg:         stat.slg  != null ? String(stat.slg)  : null,
        ops:         stat.ops  != null ? String(stat.ops)  : null,
        bb,
        k:           Number(stat.strikeOuts  ?? 0),
        sb:          Number(stat.stolenBases ?? 0),
        // Statcast fields (not available for minors)
        attempts:    null as number | null,
        barrels:     null as number | null,
        barrelPct:   null as number | null,
        barrelPerPA: null as number | null,
        avgEv:       null as number | null,
        maxEv:       null as number | null,
        avgBatSpeed: null as number | null,
        ev50:        null as number | null,
        sweetSpotPct:null as number | null,
      };
    })
    .filter(p => p.name && p.pa >= 1);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const league = searchParams.get('league') ?? 'mlb';

  try {
    if (league === 'aaa') {
      const players = await fetchMinorPlayers('11');
      players.sort((a, b) => (b.hr ?? 0) - (a.hr ?? 0));
      return NextResponse.json({ players, league: 'aaa' });
    }
    if (league === 'low-a') {
      const players = await fetchMinorPlayers('14');
      players.sort((a, b) => (b.hr ?? 0) - (a.hr ?? 0));
      return NextResponse.json({ players, league: 'low-a' });
    }

    // Default: MLB Savant
    const players = await fetchMLBPlayers();
    return NextResponse.json({ players, league: 'mlb' });
  } catch (err) {
    console.error('[barrel-leaderboard]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
