import { NextRequest, NextResponse } from 'next/server';

const MLB_API = 'https://statsapi.mlb.com/api/v1';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ results: [] });

  try {
    // MLB people search — returns pitchers matching the name across all sport levels
    const url = `${MLB_API}/people/search?names=${encodeURIComponent(q)}&sportIds=1,11,12,13,14,15,16&hydrate=currentTeam`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return NextResponse.json({ results: [] });
    const data = await res.json();

    const people: Array<{
      id?: number;
      fullName?: string;
      primaryPosition?: { code?: string };
      pitchHand?: { code?: string };
      currentTeam?: { abbreviation?: string; name?: string };
    }> = data?.people ?? [];

    // Filter to pitchers only (position code P or SP/RP/CP/1)
    const pitchers = people
      .filter(p => {
        const pos = p.primaryPosition?.code ?? '';
        return pos === 'P' || pos === '1';
      })
      .slice(0, 8)
      .map(p => ({
        player_id: p.id,
        full_name: p.fullName ?? '',
        team: p.currentTeam?.abbreviation ?? p.currentTeam?.name ?? '',
        throws: p.pitchHand?.code ?? '',
      }));

    return NextResponse.json({ results: pitchers });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
