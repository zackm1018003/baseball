import { NextRequest, NextResponse } from 'next/server';

const MLB_API = 'https://statsapi.mlb.com/api/v1';

async function fetchJSON(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const season = searchParams.get('season') || '2025';

  try {
    const [mlbData, collegeData] = await Promise.all([
      fetchJSON(`${MLB_API}/teams?sportId=1&season=${season}&activeStatus=Y`),
      fetchJSON(`${MLB_API}/teams?sportId=22&season=${season}&activeStatus=Y`),
    ]);

    const mapTeam = (t: Record<string, unknown>) => ({
      id: t.id as number,
      name: t.name as string,
      abbreviation: (t.abbreviation as string) || '',
      locationName: (t.locationName as string) || '',
      teamName: (t.teamName as string) || '',
      sportId: (t.sport as { id: number } | undefined)?.id || 1,
    });

    const mlbTeams = ((mlbData?.teams as Record<string, unknown>[]) ?? []).map(mapTeam);
    const collegeTeams = ((collegeData?.teams as Record<string, unknown>[]) ?? []).map(mapTeam);

    return NextResponse.json({
      mlb: mlbTeams.sort((a, b) => a.name.localeCompare(b.name)),
      college: collegeTeams.sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (err) {
    console.error('teams route error:', err);
    return NextResponse.json({ error: 'Failed to fetch teams' }, { status: 500 });
  }
}
