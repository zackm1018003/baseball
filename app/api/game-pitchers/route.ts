import { NextRequest, NextResponse } from 'next/server';

async function fetchJSON(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

function extractGfWhiffs(gf: Record<string, unknown>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const side of ['home_pitchers', 'away_pitchers'] as const) {
    const sideData = gf[side] as Record<string, unknown[]> | undefined;
    if (!sideData) continue;
    for (const [pidStr, pitches] of Object.entries(sideData)) {
      let whiffs = 0;
      for (const pitch of pitches as Record<string, unknown>[]) {
        const desc = String(pitch.description ?? pitch.call_name ?? '').toLowerCase();
        if (desc.includes('swinging strike')) whiffs++;
      }
      result[pidStr] = whiffs;
    }
  }
  return result;
}

function parseIp(ip: string): number {
  if (!ip) return 0;
  const parts = ip.split('.');
  return (parseInt(parts[0]) || 0) + (parseInt(parts[1]) || 0) / 3;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const gamePk = searchParams.get('gamePk');

  if (!gamePk) {
    return NextResponse.json({ error: 'gamePk required' }, { status: 400 });
  }

  try {
    const feedUrl = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
    const feed = await fetchJSON(feedUrl);

    const homeBox = feed?.liveData?.boxscore?.teams?.home;
    const awayBox = feed?.liveData?.boxscore?.teams?.away;
    const homeAbbr: string = homeBox?.team?.abbreviation ?? homeBox?.team?.name ?? '?';
    const awayAbbr: string = awayBox?.team?.abbreviation ?? awayBox?.team?.name ?? '?';

    const homePitchers: number[] = homeBox?.pitchers ?? [];
    const awayPitchers: number[] = awayBox?.pitchers ?? [];
    const homePlayersMap: Record<string, unknown> = homeBox?.players ?? {};
    const awayPlayersMap: Record<string, unknown> = awayBox?.players ?? {};

    const extractStats = (playerData: Record<string, unknown> | undefined) => {
      const pStats =
        (playerData?.gameStats as Record<string, Record<string, unknown>>)?.pitching
        ?? (playerData?.stats as Record<string, Record<string, unknown>>)?.pitching;
      if (!pStats) return null;
      return {
        ip: String(pStats.inningsPitched ?? '0'),
        h: Number(pStats.hits ?? 0),
        er: Number(pStats.earnedRuns ?? 0),
        bb: Number(pStats.baseOnBalls ?? 0),
        k: Number(pStats.strikeOuts ?? 0),
        hr: Number(pStats.homeRuns ?? 0),
        pitches: Number(pStats.numberOfPitches ?? 0),
        bf: Number(pStats.battersFaced ?? 0),
      };
    };

    const pitchers: {
      playerId: number;
      name: string;
      team: string;
      opponent: string;
      isHome: boolean;
      line: ReturnType<typeof extractStats>;
      whiffs: number | null;
    }[] = [];

    for (const pid of homePitchers) {
      const playerData = homePlayersMap[`ID${pid}`] as Record<string, unknown> | undefined;
      const stats = extractStats(playerData);
      if (!stats || stats.bf === 0) continue;
      pitchers.push({
        playerId: pid,
        name: (playerData?.person as { fullName?: string } | undefined)?.fullName ?? `Player ${pid}`,
        team: homeAbbr,
        opponent: awayAbbr,
        isHome: true,
        line: stats,
        whiffs: null,
      });
    }

    for (const pid of awayPitchers) {
      const playerData = awayPlayersMap[`ID${pid}`] as Record<string, unknown> | undefined;
      const stats = extractStats(playerData);
      if (!stats || stats.bf === 0) continue;
      pitchers.push({
        playerId: pid,
        name: (playerData?.person as { fullName?: string } | undefined)?.fullName ?? `Player ${pid}`,
        team: awayAbbr,
        opponent: homeAbbr,
        isHome: false,
        line: stats,
        whiffs: null,
      });
    }

    // Fetch whiff data from Baseball Savant (MLB only — may fail for college)
    try {
      const gfUrl = `https://baseballsavant.mlb.com/gf?game_pk=${gamePk}`;
      const gf = await fetchJSON(gfUrl);
      const whiffs = extractGfWhiffs(gf as Record<string, unknown>);
      for (const pitcher of pitchers) {
        pitcher.whiffs = whiffs[String(pitcher.playerId)] ?? null;
      }
    } catch { /* non-fatal — not all games have Savant data */ }

    // Sort: starters (most IP) first, then by whiffs
    pitchers.sort((a, b) => {
      const ipDiff = parseIp(b.line?.ip ?? '0') - parseIp(a.line?.ip ?? '0');
      if (Math.abs(ipDiff) > 0.5) return ipDiff;
      return (b.whiffs ?? -1) - (a.whiffs ?? -1);
    });

    return NextResponse.json({ gamePk: parseInt(gamePk), pitchers });
  } catch (err) {
    console.error('game-pitchers route error:', err);
    return NextResponse.json({ error: 'Failed to fetch game pitcher data' }, { status: 500 });
  }
}
