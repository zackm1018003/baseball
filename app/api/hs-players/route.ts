import { NextResponse } from 'next/server';

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

export interface HSPlayer {
  playerUrl:  string;
  name:       string;
  position:   string | null;
  school:     string | null;
  commit:     string | null;
  bt:         string | null;
  height:     string | null;
  weight:     string | null;
  hometown:   string | null;
  draftYear:  string | null;
  photoUrl:   string | null;
  // TrackMan
  whiffPct:    number | null;
  izWhiffPct:  number | null;
  oozWhiffPct: number | null;
  chasePct:    number | null;
  kPct:        number | null;
  bbPct:       number | null;
  avgEv:       number | null;
  ev90:        number | null;
  barrelPct:   number | null;
  pullAirPct:  number | null;
  xWoba:       number | null;
  // Summer circuit counting stats
  scPA:   number | null;
  scBA:   string | null;
  scOBP:  string | null;
  scSLG:  string | null;
  scOPS:  string | null;
  scISO:  string | null;
  // Summer circuit percentiles (0–100) + deltas
  scContact:       number | null;  scContactDelta:  number | null;
  scChase:         number | null;  scChaseDelta:    number | null;
  scIzContact:     number | null;  scIzContactDelta:  number | null;
  scOozContact:    number | null;  scOozContactDelta: number | null;
  scK:             number | null;  scKDelta:        number | null;
  scGb:            number | null;  scGbDelta:       number | null;
  scFb:            number | null;  scFbDelta:       number | null;
  scAirPull:       number | null;  scAirPullDelta:  number | null;
  scSprint:        number | null;  scSprintDelta:   number | null;
  scBatSpeed:      number | null;  scBatSpeedDelta: number | null;
  scRotAcc:        number | null;  scRotAccDelta:   number | null;
  scPeakHand:      number | null;  scPeakHandDelta: number | null;
  scExplosive:     number | null;  scExplosiveDelta: number | null;
}

// Rankings page slug per draft year
const RANKINGS_SLUG: Record<string, string> = {
  '2026': 'mlb-draft-2026-high-school-top-prospects',
  '2027': 'mlb-draft-2027-high-school-top-prospects',
  '2028': 'mlb-draft-2028-high-school-top-50',
};

function parsePlayerUrls(html: string): string[] {
  const matches = [...html.matchAll(/href="(\/players\/[^"]+)"/g)];
  const urls = matches.map(m => m[1]).filter(u => !u.includes('${'));
  return [...new Set(urls)];
}

type ChartItem = {
  axis:   string;
  value?: number | null;   // 0–1 decimal → ×100 = percentile rank
  score?: number | null;   // ± delta vs median
};

function parseProfile(html: string, playerUrl: string): HSPlayer {
  const player: HSPlayer = {
    playerUrl, name: '', position: null, school: null, commit: null,
    bt: null, height: null, weight: null, hometown: null,
    draftYear: null, photoUrl: null,
    // TrackMan
    whiffPct: null, izWhiffPct: null, oozWhiffPct: null,
    chasePct: null, kPct: null, bbPct: null, avgEv: null,
    ev90: null, barrelPct: null, pullAirPct: null, xWoba: null,
    // Summer circuit counting
    scPA: null, scBA: null, scOBP: null, scSLG: null, scOPS: null, scISO: null,
    // Summer circuit percentiles
    scContact: null, scContactDelta: null,
    scChase: null, scChaseDelta: null,
    scIzContact: null, scIzContactDelta: null,
    scOozContact: null, scOozContactDelta: null,
    scK: null, scKDelta: null,
    scGb: null, scGbDelta: null,
    scFb: null, scFbDelta: null,
    scAirPull: null, scAirPullDelta: null,
    scSprint: null, scSprintDelta: null,
    scBatSpeed: null, scBatSpeedDelta: null,
    scRotAcc: null, scRotAccDelta: null,
    scPeakHand: null, scPeakHandDelta: null,
    scExplosive: null, scExplosiveDelta: null,
  };

  // Name from h1.hero-title
  const nameMatch = html.match(/<h1 class="hero-title">([^<]+)<\/h1>/);
  if (nameMatch) player.name = nameMatch[1].trim();

  // Position + school from hero subtitle
  const heroMatch = html.match(/<span>([A-Z/]+) • ([^<]+)<\/span>/);
  if (heroMatch) {
    player.position = heroMatch[1];
    player.school   = heroMatch[2].trim();
  }

  // Draft year
  const draftMatch = html.match(/in (\d{4}) Draft/);
  if (draftMatch) player.draftYear = draftMatch[1];

  // Bio list items
  const bioRegex = /bio-label">([^<]+)<\/span>\s*<span class="bio-value">([^<]+)<\/span>/g;
  let bioMatch: RegExpExecArray | null;
  while ((bioMatch = bioRegex.exec(html)) !== null) {
    const label = bioMatch[1].trim();
    const value = bioMatch[2].trim();
    switch (label) {
      case 'B/T':      player.bt       = value; break;
      case 'Height':   player.height   = value; break;
      case 'Weight':   player.weight   = value; break;
      case 'Hometown': player.hometown = value; break;
      case 'Commit':   player.commit   = value; break;
    }
  }

  // Photo URL
  const photoMatch = html.match(/player-photo-wrapper[\s\S]{0,200}?<img src="([^"]+)"/);
  if (photoMatch) player.photoUrl = photoMatch[1];

  // ── Summer circuit counting stats ─────────────────────────────────────────
  // Try to find PA / BA / OBP / SLG / OPS / ISO near a "Hitter Performance" section
  const perfIdx = html.indexOf('Hitter Performance');
  if (perfIdx !== -1) {
    // Take a chunk of HTML around the section (before the first chart script)
    const firstChart = html.indexOf('renderHitterChart', perfIdx);
    const sectionEnd = firstChart !== -1 ? firstChart : perfIdx + 4000;
    const section = html.slice(perfIdx, sectionEnd);

    // Pattern: find labels and grab the next visible number/decimal value
    const statPairs: [string, RegExp, (v: string) => void][] = [
      ['PA',  /\bPA\b[\s\S]{0,400}?>\s*(\d{1,4})\s*</, v => { player.scPA = parseInt(v); }],
      ['BA',  /\bBA\b[\s\S]{0,400}?>(\.\d{3})</, v => { player.scBA  = v; }],
      ['OBP', /\bOBP\b[\s\S]{0,400}?>(\.\d{3})</, v => { player.scOBP = v; }],
      ['SLG', /\bSLG\b[\s\S]{0,400}?>(\.\d{3})</, v => { player.scSLG = v; }],
      ['OPS', /\bOPS\b[\s\S]{0,400}?>(\.\d{3})</, v => { player.scOPS = v; }],
      ['ISO', /\bISO\b[\s\S]{0,400}?>(\.\d{3})</, v => { player.scISO = v; }],
    ];

    for (const [label, rx, setter] of statPairs) {
      // Find label position then search for value after it
      const labelIdx = section.indexOf(`>${label}<`);
      if (labelIdx === -1) continue;
      const nearby = section.slice(labelIdx, labelIdx + 600);
      const m = nearby.match(rx);
      if (m) setter(m[1]);
    }
  }

  // ── Parse all lollipop charts ─────────────────────────────────────────────
  // chart-0 = most recent TrackMan season; chart-1 (or another index) = summer circuit
  for (let chartIdx = 0; chartIdx < 5; chartIdx++) {
    const marker   = `renderHitterChart("#lollipop-chart-${chartIdx}", JSON.parse('`;
    const startPos = html.indexOf(marker);
    if (startPos === -1) break;

    const jsonStart = startPos + marker.length;
    const jsonEnd   = html.indexOf("'));", jsonStart);
    if (jsonEnd === -1) continue;

    try {
      const rawJson = html.slice(jsonStart, jsonEnd)
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      const chartData: { items?: ChartItem[] } = JSON.parse(rawJson);
      const items = chartData.items ?? [];

      // Identify chart type from axis names
      const isTrackman = items.some(it =>
        it.axis === 'Avg Exit Velocity' ||
        it.axis === 'xWOBA'             ||
        it.axis === '90th % Exit Velocity'
      );

      if (isTrackman) {
        // Map to named TrackMan fields (score = actual stat value for TrackMan)
        for (const item of items) {
          const score = item.score != null ? Number(item.score) : null;
          switch (item.axis) {
            case 'Whiff %':              player.whiffPct    = score; break;
            case 'In-Zone Whiff %':      player.izWhiffPct  = score; break;
            case 'Out-of-Zone Whiff %':  player.oozWhiffPct = score; break;
            case 'Chase %':              player.chasePct    = score; break;
            case 'K %':                  player.kPct        = score; break;
            case 'BB %':                 player.bbPct       = score; break;
            case 'Avg Exit Velocity':    player.avgEv       = score; break;
            case '90th % Exit Velocity': player.ev90        = score; break;
            case 'Barrel %':             player.barrelPct   = score; break;
            case 'Pull AIR %':           player.pullAirPct  = score; break;
            case 'xWOBA':                player.xWoba       = score; break;
          }
        }
      } else if (items.length > 0) {
        // Assume summer circuit — map all known axes.
        for (const item of items) {
          // value is 0–1 decimal percentile; score is ± delta vs median
          const pct   = item.value != null ? Math.round(Number(item.value) * 100) : null;
          const delta = item.score != null ? Number(item.score) : null;

          const set = (s: keyof HSPlayer, d: keyof HSPlayer) => {
            (player as unknown as Record<string, unknown>)[s as string] = pct;
            (player as unknown as Record<string, unknown>)[d as string] = delta;
          };

          // Axis names as they appear in the site's JSON
          // (both "Contact %" and "Contact%" variants covered)
          switch (item.axis) {
            case 'Contact %':
            case 'Contact%':                set('scContact',    'scContactDelta');    break;
            case 'Chase %':
            case 'Chase%':                  set('scChase',      'scChaseDelta');      break;
            case 'IZ Contact %':
            case 'IZ Contact%':
            case 'In-Zone Contact %':       set('scIzContact',  'scIzContactDelta');  break;
            case 'OOZ Contact %':
            case 'OOZ Contact%':
            case 'Out-of-Zone Contact %':   set('scOozContact', 'scOozContactDelta'); break;
            case 'K %':
            case 'K%':                      set('scK',          'scKDelta');          break;
            case 'GB %':
            case 'GB%':                     set('scGb',         'scGbDelta');         break;
            case 'FB %':
            case 'FB%':                     set('scFb',         'scFbDelta');         break;
            case 'Air PULL %':
            case 'Air PULL%':
            case 'Pull AIR %':              set('scAirPull',    'scAirPullDelta');    break;
            case 'Sprint Speed':            set('scSprint',     'scSprintDelta');     break;
            case 'Bat Speed':               set('scBatSpeed',   'scBatSpeedDelta');   break;
            case 'Avg Rot. Acc.':
            case 'Avg Rot Acc':
            case 'Avg Rotational Acc.':     set('scRotAcc',     'scRotAccDelta');     break;
            case 'Peak Hand Speed':         set('scPeakHand',   'scPeakHandDelta');   break;
            case 'Explosiveness':           set('scExplosive',  'scExplosiveDelta');  break;
          }
        }
      }
    } catch { /* skip bad JSON */ }
  }

  return player;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const year = searchParams.get('year') ?? '2026';

  const slug = RANKINGS_SLUG[year];
  if (!slug) return NextResponse.json({ error: `No rankings page for ${year}`, players: [] });

  // Step 1: fetch rankings page to get player URLs
  const rankingsHtml = await fetchPage(`/rankings/${slug}/`);
  const playerUrls   = parsePlayerUrls(rankingsHtml);

  if (playerUrls.length === 0) {
    return NextResponse.json({ error: 'No player URLs found', players: [] });
  }

  // Step 2: batch-fetch each player profile (30 concurrent)
  const players: HSPlayer[] = [];
  const BATCH = 30;

  for (let i = 0; i < playerUrls.length; i += BATCH) {
    const batch = playerUrls.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async (url) => {
      try {
        const html = await fetchPage(url);
        return parseProfile(html, url);
      } catch {
        return null;
      }
    }));
    players.push(...results.filter((p): p is HSPlayer => p !== null));
  }

  return NextResponse.json({ players, count: players.length, year });
}
