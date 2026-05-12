import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BASE = 'https://statsapi.mlb.com/api/v1';
const BASE11 = 'https://statsapi.mlb.com/api/v1.1';

async function mlb(path: string) {
  const r = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${path}`);
  return r.json();
}
async function mlb11(path: string) {
  const r = await fetch(`${BASE11}${path}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${path}`);
  return r.json();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode   = searchParams.get('mode') ?? 'schedule'; // schedule | game
  const gamePk = searchParams.get('gamePk');
  const date   = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  try {
    if (mode === 'schedule') {
      // Return FCL or ACL schedule for a date range
      const startDate  = searchParams.get('startDate') ?? date;
      const endDate    = searchParams.get('endDate')   ?? date;
      const leagueType = searchParams.get('league') ?? 'fcl'; // fcl | acl
      const sportId = leagueType === 'acl' ? 17 : 16;
      // Use sportId only — leagueId can vary year-to-year and silently filters out all games
      const data = await mlb(
        `/schedule?sportId=${sportId}&startDate=${startDate}&endDate=${endDate}&hydrate=linescore,team`
      );
      return NextResponse.json(data);
    }

    if (mode === 'game' && gamePk) {
      const feed = await mlb11(`/game/${gamePk}/feed/live`);
      const gameData  = feed.gameData;
      const liveData  = feed.liveData;
      const allPlays  = liveData.plays.allPlays ?? [];

      // Build clean play list
      const plays = allPlays.map((ab: Record<string, unknown>) => {
        const matchup  = ab.matchup as Record<string, unknown>;
        const result   = ab.result  as Record<string, unknown>;
        const about    = ab.about   as Record<string, unknown>;
        const count    = ab.count   as Record<string, unknown>;
        const rawEvents = ab.playEvents as Record<string, unknown>[];

        // Process pitch events
        const pitches = (rawEvents ?? [])
          .filter((e: Record<string, unknown>) => e.isPitch)
          .map((e: Record<string, unknown>) => {
            const pd = e.pitchData as Record<string, unknown> | undefined;
            const hd = e.hitData  as Record<string, unknown> | undefined;
            const coords = pd?.coordinates as Record<string, unknown> | undefined;
            const breaks = pd?.breaks      as Record<string, unknown> | undefined;
            const det    = e.details       as Record<string, unknown> | undefined;
            const callDet = det?.call      as Record<string, unknown> | undefined;
            const typeDet = det?.type      as Record<string, unknown> | undefined;
            const hitCoords = hd?.coordinates as Record<string, unknown> | undefined;
            return {
              pitchNumber:  e.pitchNumber,
              pitchType:    typeDet?.description ?? null,
              pitchTypeCode:typeDet?.code ?? null,
              callCode:     callDet?.code ?? null,
              callDesc:     callDet?.description ?? null,
              isInPlay:     (det?.isInPlay as boolean) ?? false,
              isBall:       (det?.isBall   as boolean) ?? false,
              isStrike:     (det?.isStrike as boolean) ?? false,
              startSpeed:   (pd?.startSpeed as number) ?? null,
              spinRate:     (breaks?.spinRate as number) ?? null,
              breakHoriz:   (breaks?.breakHorizontal as number) ?? null,
              breakVert:    (breaks?.breakVerticalInduced as number) ?? null,
              zone:         (pd?.zone as number) ?? null,
              // Plate coordinates (feet): pX = horizontal, pZ = vertical height
              pX:           (coords?.pX as number) ?? null,
              pZ:           (coords?.pZ as number) ?? null,
              szTop:        (pd?.strikeZoneTop    as number) ?? null,
              szBot:        (pd?.strikeZoneBottom as number) ?? null,
              // Hit data (only present when ball is in play with tracking)
              launchSpeed:  (hd?.launchSpeed   as number) ?? null,
              launchAngle:  (hd?.launchAngle   as number) ?? null,
              totalDistance:(hd?.totalDistance  as number) ?? null,
              trajectory:   (hd?.trajectory    as string) ?? null,
              hardness:     (hd?.hardness      as string) ?? null,
              // Spray chart coordinates (Gameday system: ~125,203 = home plate)
              hitX:         (hitCoords?.coordX  as number) ?? null,
              hitY:         (hitCoords?.coordY  as number) ?? null,
            };
          });

        const lastPitch = pitches[pitches.length - 1];
        const batter = matchup?.batter as Record<string, unknown>;
        const pitcher = matchup?.pitcher as Record<string, unknown>;
        const batSide = matchup?.batSide as Record<string, unknown>;
        const pitchHand = matchup?.pitchHand as Record<string, unknown>;

        return {
          atBatIndex:   ab.atBatIndex,
          inning:       about?.inning,
          halfInning:   about?.halfInning,
          isTopInning:  about?.isTopInning,
          event:        result?.event,
          eventType:    result?.eventType,
          description:  result?.description,
          rbi:          result?.rbi,
          isOut:        result?.isOut,
          isScoringPlay:about?.isScoringPlay,
          awayScore:    result?.awayScore,
          homeScore:    result?.homeScore,
          balls:        (count as Record<string, unknown>)?.balls,
          strikes:      (count as Record<string, unknown>)?.strikes,
          outs:         (count as Record<string, unknown>)?.outs,
          batter:       { id: batter?.id, name: batter?.fullName },
          pitcher:      { id: pitcher?.id, name: pitcher?.fullName },
          batSide:      batSide?.code,
          pitchHand:    pitchHand?.code,
          pitches,
          // Convenience — last pitch's hit data
          launchSpeed:  lastPitch?.launchSpeed  ?? null,
          launchAngle:  lastPitch?.launchAngle  ?? null,
          totalDistance:lastPitch?.totalDistance ?? null,
          trajectory:   lastPitch?.trajectory   ?? null,
        };
      });

      const teams = gameData.teams as Record<string, Record<string, unknown>>;
      const away = teams?.away;
      const home = teams?.home;
      const status = gameData.status as Record<string, unknown>;
      const datetime = gameData.datetime as Record<string, unknown>;

      return NextResponse.json({
        gamePk,
        status:     status?.detailedState,
        statusCode: status?.statusCode,
        inning:     liveData.linescore?.currentInning ?? null,
        halfInning: liveData.linescore?.inningHalf ?? null,
        away: {
          id:    away?.id,
          name:  (away?.teamName as string) ?? (away?.name as string),
          abbr:  (away?.abbreviation as string),
          score: liveData.linescore?.teams?.away?.runs ?? 0,
        },
        home: {
          id:    home?.id,
          name:  (home?.teamName as string) ?? (home?.name as string),
          abbr:  (home?.abbreviation as string),
          score: liveData.linescore?.teams?.home?.runs ?? 0,
        },
        dateTime: datetime?.dateTime,
        plays,
        hasStatcast: plays.some((p: {launchSpeed: number | null}) => p.launchSpeed !== null),
      });
    }

    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
