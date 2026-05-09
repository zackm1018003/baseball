import { NextResponse } from 'next/server';

// Pre-bundled advanced stats cache — fetched from local dev and committed to repo
import advHit2026 from '../../../data/advanced-hit-2026.json';
import advHit2025 from '../../../data/advanced-hit-2025.json';
import advHit2024 from '../../../data/advanced-hit-2024.json';
import advHit2023 from '../../../data/advanced-hit-2023.json';
import advHit2022 from '../../../data/advanced-hit-2022.json';
import advHit2021 from '../../../data/advanced-hit-2021.json';

const ADV_CACHE: Record<string, Record<string, unknown>> = {
  '2026': advHit2026 as Record<string, unknown>,
  '2025': advHit2025 as Record<string, unknown>,
  '2024': advHit2024 as Record<string, unknown>,
  '2023': advHit2023 as Record<string, unknown>,
  '2022': advHit2022 as Record<string, unknown>,
  '2021': advHit2021 as Record<string, unknown>,
};

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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export interface AdvancedStats {
  draftYear:   string | null;
  position:    string | null;
  bt:          string | null;   // Bats/Throws e.g. "L/L"
  height:      string | null;   // e.g. "5-11"
  weight:      string | null;   // e.g. "195 lbs"
  hometown:    string | null;
  photoUrl:    string | null;
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

function extractAdvancedStats(html: string): AdvancedStats {
  const result: AdvancedStats = {
    draftYear: null, position: null, bt: null, height: null, weight: null,
    hometown: null, photoUrl: null,
    whiffPct: null, izWhiffPct: null, oozWhiffPct: null,
    chasePct: null, kPct: null, bbPct: null, avgEv: null, ev90: null,
    barrelPct: null, pullAirPct: null, xWoba: null,
  };

  // ── Draft year ─────────────────────────────────────────────────────────────
  const draftMatch = html.match(/in (\d{4}) Draft/);
  if (draftMatch) result.draftYear = draftMatch[1];

  // ── Position + school from hero subtitle: <span>OF • Arizona State</span> ──
  const heroMatch = html.match(/<span>([A-Z/]+) • ([^<]+)<\/span>/);
  if (heroMatch) result.position = heroMatch[1];

  // ── Bio list items: bio-label / bio-value pairs ────────────────────────────
  const bioRegex = /bio-label">([^<]+)<\/span>\s*<span class="bio-value">([^<]+)<\/span>/g;
  let bioMatch: RegExpExecArray | null;
  while ((bioMatch = bioRegex.exec(html)) !== null) {
    const label = bioMatch[1].trim();
    const value = bioMatch[2].trim();
    switch (label) {
      case 'B/T':      result.bt       = value; break;
      case 'Height':   result.height   = value; break;
      case 'Weight':   result.weight   = value; break;
      case 'Hometown': result.hometown = value; break;
    }
  }

  // ── Photo URL ──────────────────────────────────────────────────────────────
  const photoMatch = html.match(/player-photo-wrapper[\s\S]{0,200}?<img src="([^"]+)"/);
  if (photoMatch) result.photoUrl = photoMatch[1];

  // ── Lollipop chart JSON (chart-0 = most recent season) ────────────────────
  const chartMarker = 'renderHitterChart("#lollipop-chart-0", JSON.parse(\'';
  const markerIdx = html.indexOf(chartMarker);
  if (markerIdx === -1) return result;

  const jsonStart = markerIdx + chartMarker.length;
  const jsonEnd   = html.indexOf('\'));', jsonStart);
  if (jsonEnd === -1) return result;

  let chartData: { items?: Array<{ axis: string; score: number | null }> };
  try {
    // The JSON uses JS-style unicode escapes (" etc.) as literal text in
    // the HTML — unescape them before handing off to JSON.parse
    const rawJson = html.slice(jsonStart, jsonEnd)
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    chartData = JSON.parse(rawJson);
  } catch {
    return result;
  }

  const items = chartData.items ?? [];
  for (const item of items) {
    const score = item.score != null ? Number(item.score) : null;
    switch (item.axis) {
      case 'Whiff %':              result.whiffPct    = score; break;
      case 'In-Zone Whiff %':      result.izWhiffPct  = score; break;
      case 'Out-of-Zone Whiff %':  result.oozWhiffPct = score; break;
      case 'Chase %':              result.chasePct    = score; break;
      case 'K %':                  result.kPct        = score; break;
      case 'BB %':                 result.bbPct       = score; break;
      case 'Avg Exit Velocity':    result.avgEv       = score; break;
      case '90th % Exit Velocity': result.ev90        = score; break;
      case 'Barrel %':             result.barrelPct   = score; break;
      case 'Pull AIR %':           result.pullAirPct  = score; break;
      case 'xWOBA':                result.xWoba       = score; break;
    }
  }

  return result;
}

function parsePlayerUrls(html: string): string[] {
  const tbodyStart = html.indexOf('<tbody>');
  const tbodyEnd   = html.indexOf('</tbody>', tbodyStart);
  if (tbodyStart === -1) return [];
  const tbody = html.slice(tbodyStart, tbodyEnd);
  const matches = [...tbody.matchAll(/href="(\/players\/[^"]+)"/g)];
  return [...new Set(matches.map(m => m[1]))];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const year    = searchParams.get('year')  ?? '2026';
  const noCache = searchParams.get('fresh') === '1';

  // Serve from pre-bundled cache (avoids Cloudflare IP-blocking on Vercel)
  if (!noCache) {
    const cached = ADV_CACHE[year];
    if (cached && Object.keys(cached).length > 10) {
      return NextResponse.json({ data: cached, count: Object.keys(cached).length, source: 'cache' });
    }
  }

  // Fallback: live fetch (works from local dev / residential IPs)
  // Step 1: get all player URLs from the hitting stats page
  const statsHtml = await fetchPage(`/stats/hit/${year}/`);
  const playerUrls = parsePlayerUrls(statsHtml);

  if (playerUrls.length === 0) {
    return NextResponse.json({ error: 'No player URLs found', data: {} });
  }

  // Step 2: batch-fetch player profile pages (30 concurrent)
  const result: Record<string, AdvancedStats> = {};
  const BATCH = 30;

  for (let i = 0; i < playerUrls.length; i += BATCH) {
    const batch = playerUrls.slice(i, i + BATCH);
    await Promise.all(batch.map(async (url) => {
      try {
        const html = await fetchPage(url);
        result[url] = extractAdvancedStats(html);
      } catch {
        // non-fatal — just skip this player
      }
    }));
  }

  return NextResponse.json({ data: result, count: Object.keys(result).length });
}
