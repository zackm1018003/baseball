import { NextRequest, NextResponse } from 'next/server';

const MLB_API = 'https://statsapi.mlb.com/api/v1';

async function fetchJSON(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get('teamId');
  const season = searchParams.get('season') || '2025';

  if (!teamId) {
    return NextResponse.json({ error: 'teamId required' }, { status: 400 });
  }

  try {
    const scheduleUrl = `${MLB_API}/schedule?teamId=${teamId}&season=${season}&sportId=1,22&gameType=R,S,P,F,D,L,W`;
    const scheduleData = await fetchJSON(scheduleUrl);

    const games: {
      gamePk: number;
      date: string;
      homeTeam: string;
      homeTeamAbbr: string;
      homeTeamId: number;
      awayTeam: string;
      awayTeamAbbr: string;
      awayTeamId: number;
      homeScore: number;
      awayScore: number;
      status: string;
      sportId: number;
      isHome: boolean;
    }[] = [];

    const tid = parseInt(teamId);

    for (const dateObj of (scheduleData?.dates ?? []) as Record<string, unknown>[]) {
      for (const game of (dateObj.games ?? []) as Record<string, unknown>[]) {
        const homeTeam = (game.teams as Record<string, Record<string, unknown>>)?.home;
        const awayTeam = (game.teams as Record<string, Record<string, unknown>>)?.away;
        const homeTeamId = (homeTeam?.team as Record<string, unknown>)?.id as number;
        const awayTeamId = (awayTeam?.team as Record<string, unknown>)?.id as number;
        const sportId =
          ((homeTeam?.team as Record<string, unknown>)?.sport as Record<string, unknown>)?.id as number
          ?? ((awayTeam?.team as Record<string, unknown>)?.sport as Record<string, unknown>)?.id as number
          ?? 1;
        const isHome = homeTeamId === tid;
        const status = (game.status as Record<string, unknown>)?.detailedState as string
          ?? (game.status as Record<string, unknown>)?.abstractGameState as string
          ?? 'Unknown';

        games.push({
          gamePk: game.gamePk as number,
          date: dateObj.date as string,
          homeTeam: ((homeTeam?.team as Record<string, unknown>)?.name as string)
            ?? ((homeTeam?.team as Record<string, unknown>)?.abbreviation as string)
            ?? '?',
          homeTeamAbbr: ((homeTeam?.team as Record<string, unknown>)?.abbreviation as string) ?? '?',
          homeTeamId,
          awayTeam: ((awayTeam?.team as Record<string, unknown>)?.name as string)
            ?? ((awayTeam?.team as Record<string, unknown>)?.abbreviation as string)
            ?? '?',
          awayTeamAbbr: ((awayTeam?.team as Record<string, unknown>)?.abbreviation as string) ?? '?',
          awayTeamId,
          homeScore: (homeTeam?.score as number) ?? 0,
          awayScore: (awayTeam?.score as number) ?? 0,
          status,
          sportId,
          isHome,
        });
      }
    }

    return NextResponse.json({
      teamId: tid,
      season,
      games: games.sort((a, b) => a.date.localeCompare(b.date)),
    });
  } catch (err) {
    console.error('team-season route error:', err);
    return NextResponse.json({ error: 'Failed to fetch team season data' }, { status: 500 });
  }
}
