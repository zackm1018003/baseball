import { NextResponse } from 'next/server';
import fs from 'fs';
import nodePath from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getCookieHeader() {
  const session = process.env.OVERSLOT_SESSION_ID;
  const csrf    = process.env.OVERSLOT_CSRF;
  const cf      = process.env.OVERSLOT_CF_BM;
  return [
    cf      ? `__cf_bm=${cf}`       : '',
    csrf    ? `csrftoken=${csrf}`    : '',
    session ? `sessionid=${session}` : '',
  ].filter(Boolean).join('; ');
}

async function fetchPage(path: string): Promise<string> {
  const res = await fetch(`https://overslotbaseball.com${path}`, {
    headers: {
      'Cookie': getCookieHeader(),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://overslotbaseball.com/stats/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Connection': 'keep-alive',
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
  return res.text();
}

function parseStatsTable(html: string): Record<string, string>[] {
  // Extract table body
  const tbodyStart = html.indexOf('<tbody>');
  const tbodyEnd   = html.indexOf('</tbody>', tbodyStart);
  if (tbodyStart === -1 || tbodyEnd === -1) return [];

  const tbody = html.slice(tbodyStart, tbodyEnd);

  // Extract column headers in order from thead
  const theadStart = html.indexOf('<thead>');
  const theadEnd   = html.indexOf('</thead>', theadStart);
  const thead      = html.slice(theadStart, theadEnd);
  const keyMatches = [...thead.matchAll(/data-key="([^"]+)"/g)];
  const keys       = keyMatches.map(m => m[1]);

  // Split into rows
  const rows: Record<string, string>[] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(tbody)) !== null) {
    const rowHtml = rowMatch[1];
    // Extract all data-value attributes in order
    const vals = [...rowHtml.matchAll(/data-value="([^"]*)"/g)].map(m => m[1]);
    if (vals.length < 2) continue;

    // Extract player URL
    const hrefMatch = rowHtml.match(/href="(\/players\/[^"]+)"/);
    const playerUrl = hrefMatch ? hrefMatch[1] : '';

    const row: Record<string, string> = { playerUrl };
    keys.forEach((key, i) => {
      row[key] = vals[i] ?? '';
    });
    rows.push(row);
  }

  return rows;
}

// Map internal key names to cleaner display names
const HIT_COLS = [
  { key: 'player_name', label: 'Player' },
  { key: 'team_name',   label: 'Team' },
  { key: 'hit_games_played',       label: 'G' },
  { key: 'hit_plate_appearances',  label: 'PA' },
  { key: 'hit_hits',               label: 'H' },
  { key: 'hit_singles',            label: '1B' },
  { key: 'hit_doubles',            label: '2B' },
  { key: 'hit_triples',            label: '3B' },
  { key: 'hit_hrs',                label: 'HR' },
  { key: 'hit_runs',               label: 'R' },
  { key: 'hit_base_on_balls',      label: 'BB' },
  { key: 'hit_strikeouts',         label: 'SO' },
  { key: 'hit_hit_by_pitch',       label: 'HBP' },
  { key: 'hit_stolen_bases',       label: 'SB' },
  { key: 'hit_caught_stealing',    label: 'CS' },
  { key: 'hit_ba',                 label: 'BA' },
  { key: 'hit_obp',                label: 'OBP' },
  { key: 'hit_slg',                label: 'SLG' },
  { key: 'hit_ops',                label: 'OPS' },
  { key: 'hit_iso',                label: 'ISO' },
  { key: 'hit_babip',              label: 'BABIP' },
  { key: 'hit_woba',               label: 'wOBA' },
];

const PITCH_COLS = [
  { key: 'player_name', label: 'Player' },
  { key: 'team_name',   label: 'Team' },
  { key: 'pitch_appearances',    label: 'G' },
  { key: 'pitch_games_started',  label: 'GS' },
  { key: 'pitch_innings_pitched',label: 'IP' },
  { key: 'pitch_batters_faced',  label: 'BF' },
  { key: 'pitch_hits',           label: 'H' },
  { key: 'pitch_runs',           label: 'R' },
  { key: 'pitch_base_on_balls',  label: 'BB' },
  { key: 'pitch_strikeouts',     label: 'SO' },
  { key: 'pitch_hit_by_pitch',   label: 'HBP' },
  { key: 'pitch_whip',           label: 'WHIP' },
  { key: 'pitch_ba',             label: 'BA' },
  { key: 'pitch_obp',            label: 'OBP' },
  { key: 'pitch_slg',            label: 'SLG' },
  { key: 'pitch_ops',            label: 'OPS' },
  { key: 'pitch_babip',          label: 'BABIP' },
  { key: 'pitch_walk_rate',      label: 'BB%' },
  { key: 'pitch_strikeout_rate', label: 'K%' },
  { key: 'pitch_bb_k',           label: 'BB/K' },
  { key: 'pitch_fip',            label: 'FIP' },
  { key: 'pitch_xfip',           label: 'xFIP' },
  { key: 'pitch_siera',          label: 'SIERA' },
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type   = searchParams.get('type')   ?? 'hit'; // 'hit' | 'pitch'
  const year   = searchParams.get('year')   ?? '2026';
  const debug  = searchParams.get('debug')  === '1';
  const noCache = searchParams.get('fresh') === '1';

  // Check file-based cache first (committed to repo, works on any IP)
  if (!noCache) {
    try {
      const cacheFile = nodePath.join(process.cwd(), 'data', `stats-${type}-${year}.json`);
      if (fs.existsSync(cacheFile)) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (cached.players?.length >= 20) {
          return NextResponse.json({ ...cached, source: 'cache' });
        }
      }
    } catch { /* ignore bad cache, fall through to scrape */ }
  }

  const path = `/stats/${type === 'pitch' ? 'pitch' : 'hit'}/${year}/`;
  const html = await fetchPage(path);
  const rows = parseStatsTable(html);

  const cols = type === 'pitch' ? PITCH_COLS : HIT_COLS;

  // Convert raw rows to clean objects using the col mapping
  const players = rows.map(row => {
    const p: Record<string, string> = { playerUrl: row.playerUrl };
    for (const col of cols) {
      p[col.label] = row[col.key] ?? '';
    }
    return p;
  }).filter(p => p['Player']);

  if (debug) {
    // Count tbody sections and raw row counts to diagnose parsing
    const tbodyCount = (html.match(/<tbody/g) ?? []).length;
    const allTbodyMatches = [...html.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/g)];
    const rowsPerTbody = allTbodyMatches.map((m, i) => {
      const rows = [...m[1].matchAll(/<tr[^>]*>/g)].length;
      return { tbody: i, rows };
    });
    return NextResponse.json({
      players, cols: cols.map(c => c.label), type, year,
      _debug: {
        htmlLen: html.length,
        tbodyCount,
        rowsPerTbody,
        rawRowsParsed: rows.length,
        htmlStart: html.slice(0, 500),
        tbodyStart: html.indexOf('<tbody>'),
      }
    });
  }

  return NextResponse.json({ players, cols: cols.map(c => c.label), type, year });
}
