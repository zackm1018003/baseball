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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://overslotbaseball.com/',
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
  school:     string | null;   // HS name
  commit:     string | null;   // college commit
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

function parseProfile(html: string, playerUrl: string): HSPlayer {
  const player: HSPlayer = {
    playerUrl, name: '', position: null, school: null, commit: null,
    bt: null, height: null, weight: null, hometown: null,
    draftYear: null, photoUrl: null,
    whiffPct: null, izWhiffPct: null, oozWhiffPct: null,
    chasePct: null, kPct: null, bbPct: null, avgEv: null,
    ev90: null, barrelPct: null, pullAirPct: null, xWoba: null,
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

  // TrackMan lollipop chart (chart-0 = most recent season)
  const chartMarker = 'renderHitterChart("#lollipop-chart-0", JSON.parse(\'';
  const markerIdx   = html.indexOf(chartMarker);
  if (markerIdx !== -1) {
    const jsonStart = markerIdx + chartMarker.length;
    const jsonEnd   = html.indexOf('\'));', jsonStart);
    if (jsonEnd !== -1) {
      try {
        const rawJson = html.slice(jsonStart, jsonEnd)
          .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        const chartData: { items?: Array<{ axis: string; score: number | null }> } = JSON.parse(rawJson);
        for (const item of (chartData.items ?? [])) {
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
      } catch { /* skip */ }
    }
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
