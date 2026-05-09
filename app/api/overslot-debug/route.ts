import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const path   = searchParams.get('path') ?? '/players/landon-hairston-75e43a90-af3c-4bd0-95e6-7e26dc12e5fb/';
  const search = searchParams.get('search') ?? 'renderHitterChart';

  const url = `https://overslotbaseball.com${path}`;
  const res = await fetch(url, {
    headers: {
      'Cookie': getCookieHeader(),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://overslotbaseball.com/',
    },
    cache: 'no-store',
  });

  const html = await res.text();
  const idx = html.indexOf(search);

  // Also try to parse the chart JSON directly
  const chartMarker = 'renderHitterChart("#lollipop-chart-0", JSON.parse(\'';
  const markerIdx = html.indexOf(chartMarker);
  let chartInfo: { found: boolean; jsonSnippet?: string; parsed?: unknown; parseError?: string } = { found: false };

  if (markerIdx !== -1) {
    const jsonStart = markerIdx + chartMarker.length;
    const jsonEnd = html.indexOf('\'));', jsonStart);
    if (jsonEnd !== -1) {
      const raw = html.slice(jsonStart, jsonEnd);
      chartInfo = { found: true, jsonSnippet: raw.slice(0, 500) };
      try {
        chartInfo.parsed = JSON.parse(raw);
      } catch (e) {
        chartInfo.parseError = String(e);
        // Try with unicode unescaping
        try {
          chartInfo.parsed = JSON.parse(raw.replace(/\\u0022/g, '"'));
        } catch (e2) {
          chartInfo.parseError += ' | after unescape: ' + String(e2);
        }
      }
    }
  }

  return NextResponse.json({
    status: res.status,
    totalLen: html.length,
    searchFound: idx >= 0,
    searchAt: idx,
    snippet: idx >= 0 ? html.slice(Math.max(0, idx - 50), idx + 300) : '',
    chartInfo,
    // Also check for alternative markers
    altMarkers: [
      'renderHitterChart',
      'lollipop-chart',
      'JSON.parse',
      'whiff',
      'Whiff',
    ].map(m => ({ marker: m, found: html.indexOf(m) >= 0, at: html.indexOf(m) })),
  });
}
