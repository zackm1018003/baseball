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

/** Clean up a raw velocity string: strip "mph", normalise dashes, trim. */
function cleanVelo(raw: string): string {
  return raw
    .replace(/\s*mph\s*/gi, '')
    .replace(/\s*[–—]\s*/g, '-')
    .trim();
}

function parseBio(html: string): { height: string | null; weight: string | null; velocity: string | null } {
  let height: string | null = null;
  let weight: string | null = null;
  let velocity: string | null = null;

  // Pattern 1: bio-label / bio-value spans (used by HS/college profile pages)
  const bioRegex = /bio-label"[^>]*>([^<]+)<\/span>\s*<span[^>]*bio-value[^>]*>([^<]+)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = bioRegex.exec(html)) !== null) {
    const label = m[1].trim();
    const value = m[2].trim();
    if (label === 'Height') height = value;
    if (label === 'Weight') weight = value;
    if (/^(FB|Fastball|Velo|Velocity|FB Velo|FB Velocity|FB Mph|Arm|Arm Speed)$/i.test(label)) {
      velocity = cleanVelo(value);
    }
  }
  if (height || weight || velocity) return { height, weight, velocity };

  // Pattern 2: any element with text "Height"/"Weight" followed shortly by value
  const htMatch = html.match(/[Hh]eight[^>]*>[^<]*<[^>]+>\s*([56]\s*['\-–]\s*\d+(?:\s*")?)/);
  if (htMatch) height = htMatch[1].trim();

  const wtMatch = html.match(/[Ww]eight[^>]*>[^<]*<[^>]+>\s*(\d{2,3}\s*(?:lbs?)?)/);
  if (wtMatch) weight = wtMatch[1].replace(/\s*lbs?/i, '').trim();

  // Pattern 2b: inline velocity keywords (e.g. "Fastball: 90-94" / "FB: 88-92 mph")
  if (!velocity) {
    const veloMatch = html.match(
      /(?:^|>)\s*(?:FB|Fastball|Velo|Velocity|FB\s+Velo|FB\s+Velocity|Arm\s+Speed)\s*[:–\-]\s*(\d{2,3}(?:\s*[-–—]\s*\d{2,3})?\s*(?:mph)?)/im
    );
    if (veloMatch) velocity = cleanVelo(veloMatch[1]);
  }

  if (height || weight || velocity) return { height, weight, velocity };

  // Pattern 3: dt/dd pairs
  const dtRegex = /<dt[^>]*>([^<]*(?:Height|Weight|Velocity|Fastball|FB)[^<]*)<\/dt>\s*<dd[^>]*>([^<]+)<\/dd>/gi;
  while ((m = dtRegex.exec(html)) !== null) {
    const label = m[1].trim();
    const value = m[2].trim();
    if (/height/i.test(label)) height = value;
    if (/weight/i.test(label)) weight = value;
    if (/velocity|fastball|fb/i.test(label)) velocity = cleanVelo(value);
  }

  return { height, weight, velocity };
}

// GET /api/player-bio?urls=/players/foo/,/players/bar/
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawUrls = searchParams.get('urls') ?? '';

  // Split on comma — URLs are plain (no encoding needed for /players/slug/ format)
  const urls = rawUrls
    .split(',')
    .map(u => u.trim())
    .filter(u => u.startsWith('/players/') || u.startsWith('%2Fplayers%2F'))
    .map(u => u.startsWith('%2F') ? decodeURIComponent(u) : u)
    .slice(0, 30); // hard cap

  if (urls.length === 0) {
    return NextResponse.json({ error: 'No valid player URLs provided' }, { status: 400 });
  }

  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const html = await fetchPage(url);
        return { url, ...parseBio(html) };
      } catch {
        return { url, height: null, weight: null, velocity: null };
      }
    })
  );

  const bio: Record<string, { height: string | null; weight: string | null; velocity: string | null }> = {};
  for (const r of results) {
    bio[r.url] = { height: r.height, weight: r.weight, velocity: r.velocity };
  }

  return NextResponse.json(bio);
}
