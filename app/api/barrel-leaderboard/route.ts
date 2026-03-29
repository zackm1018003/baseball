import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

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
  // Strip BOM if present
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
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

export async function GET(_req: NextRequest) {
  try {
    // Fetch both CSVs in parallel
    const [statcastText, batTrackText] = await Promise.all([
      safeFetch(STATCAST_URL),
      safeFetch(BAT_TRACK_URL).catch(() => ''),   // bat speed is bonus — don't fail if missing
    ]);

    const statcastRows = parseCSV(statcastText);
    const batTrackRows = parseCSV(batTrackText);

    // Build bat speed lookup by player ID
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
        };
      })
      .filter(p => p.name && p.barrels !== null);

    players.sort((a, b) => (b.barrels ?? 0) - (a.barrels ?? 0));

    return NextResponse.json({ players });
  } catch (err) {
    console.error('[barrel-leaderboard]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
