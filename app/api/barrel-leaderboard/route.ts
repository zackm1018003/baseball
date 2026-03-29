import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

const SAVANT_CSV = 'https://baseballsavant.mlb.com/leaderboard/statcast?type=batter&year=2026&position=&team=&min=1&csv=true';

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
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

export async function GET(_req: NextRequest) {
  try {
    const res = await fetch(SAVANT_CSV, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 3600 }, // cache 1 hour
    });
    if (!res.ok) throw new Error(`Savant responded ${res.status}`);
    const text = await res.text();
    const rows = parseCSV(text);

    const players = rows
      .map(r => ({
        playerId:    num(r['player_id']) ?? num(r['batter']),
        name:        r['player_name'] || r['name'] || '',
        team:        r['team_id'] || r['team'] || '',
        pa:          num(r['pa']),
        barrels:     num(r['barrels']),
        barrelPct:   num(r['barrel_batted_rate']),
        avgEv:       num(r['exit_velocity_avg']),
        hardHitPct:  num(r['hard_hit_percent']),
        avgBatSpeed: num(r['avg_best_speed']),
        xwoba:       num(r['xwoba']),
        maxEv:       num(r['max_hit_speed']) ?? num(r['max_ev']),
      }))
      .filter(p => p.name && p.barrels !== null);

    // Sort by barrels desc by default
    players.sort((a, b) => (b.barrels ?? 0) - (a.barrels ?? 0));

    return NextResponse.json({ players });
  } catch (err) {
    console.error('[barrel-leaderboard]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
