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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

interface AdvancedStats {
  draftYear: string | null;
  whiffPct:     number | null;
  izWhiffPct:   number | null;
  oozWhiffPct:  number | null;
  chasePct:     number | null;
  kPct:         number | null;
  bbPct:        number | null;
  avgEv:        number | null;
  ev90:         number | null;
  barrelPct:    number | null;
  pullAirPct:   number | null;
  xWoba:        number | null;
}

function extractAdvancedStats(html: string): AdvancedStats {
  const result: AdvancedStats = {
    draftYear: null, whiffPct: null, izWhiffPct: null, oozWhiffPct: null,
    chasePct: null, kPct: null, bbPct: null, avgEv: null, ev90: null,
    barrelPct: null, pullAirPct: null, xWoba: null,
  };

  // Extract draft year — e.g. "in 2026 Draft"
  const draftMatch = html.match(/in (\d{4}) Draft/);
  if (draftMatch) result.draftYear = draftMatch[1];

  // Extract the current-year lollipop chart JSON (chart-0 = most recent season)
  const chartMarker = 'renderHitterChart("#lollipop-chart-0", JSON.parse(\'';
  const markerIdx = html.indexOf(chartMarker);
  if (markerIdx === -1) return result;

  const jsonStart = markerIdx + chartMarker.length;
  const jsonEnd   = html.indexOf('\'));', jsonStart);
  if (jsonEnd === -1) return result;

  let chartData: { items?: Array<{ axis: string; score: number | null }> };
  try {
    chartData = JSON.parse(html.slice(jsonStart, jsonEnd));
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
  const year = searchParams.get('year') ?? '2026';

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
