import { NextResponse } from 'next/server';

export const dynamic    = 'force-dynamic';
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

async function fetchPage(path: string): Promise<string> {
  const res = await fetch(`https://overslotbaseball.com${path}`, {
    headers: {
      'Cookie': getCookieHeader(),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://overslotbaseball.com/',
      'Connection': 'keep-alive',
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseBio(html: string): { height: string | null; weight: string | null } {
  let height: string | null = null;
  let weight: string | null = null;
  const bioRegex = /bio-label">([^<]+)<\/span>\s*<span class="bio-value">([^<]+)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = bioRegex.exec(html)) !== null) {
    const label = m[1].trim();
    const value = m[2].trim();
    if (label === 'Height') height = value;
    if (label === 'Weight') weight = value;
  }
  return { height, weight };
}

// GET /api/player-bio?urls=/players/foo/,/players/bar/
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawUrls = searchParams.get('urls') ?? '';
  const urls = rawUrls.split(',').map(u => u.trim()).filter(u => u.startsWith('/players/'));

  if (urls.length === 0) {
    return NextResponse.json({ error: 'No valid player URLs provided' }, { status: 400 });
  }

  // Fetch up to 20 profiles concurrently
  const LIMIT = 20;
  const limited = urls.slice(0, LIMIT);

  const results = await Promise.all(
    limited.map(async (url) => {
      try {
        const html = await fetchPage(url);
        return { url, ...parseBio(html) };
      } catch {
        return { url, height: null, weight: null };
      }
    })
  );

  // Return as a map: { [playerUrl]: { height, weight } }
  const bio: Record<string, { height: string | null; weight: string | null }> = {};
  for (const r of results) {
    bio[r.url] = { height: r.height, weight: r.weight };
  }

  return NextResponse.json(bio);
}
