import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/season-stats?playerId=809092&year=2026
 *
 * Fetches hitting season stats from the MLB Stats API across all sport levels
 * (MLB=1, AAA=11, AA=12, High-A=13, Low-A=14, FCL/DSL=16, ACL=17) in parallel
 * and returns the first result that has actual data.
 *
 * The built-in MLB Stats API endpoint ignores sportIds (plural) so we must
 * query each sportId individually.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const year = searchParams.get('year') || String(new Date().getFullYear());

  if (!playerId) {
    return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  }

  const base =
    `https://statsapi.mlb.com/api/v1/people/${playerId}/stats` +
    `?stats=season&group=hitting&season=${year}`;

  // Try all sport levels in parallel — MLB players hit on sportId=1,
  // minor leaguers hit on 11–17.
  const sportIds = [1, 11, 12, 13, 14, 16, 17];

  try {
    const results = await Promise.all(
      sportIds.map(sportId =>
        fetch(`${base}&sportId=${sportId}`, { next: { revalidate: 1800 } })
          .then(r => r.json())
          .then((d: { stats?: { splits?: { stat: Record<string, unknown> }[] }[] }) => ({
            sportId,
            stat: d.stats?.[0]?.splits?.[0]?.stat ?? null,
          }))
          .catch(() => ({ sportId, stat: null }))
      )
    );

    const found = results.find(r => r.stat !== null);
    const s = found?.stat;

    if (!s) return NextResponse.json({});

    return NextResponse.json({
      avg:    s.avg,
      obp:    s.obp,
      slg:    s.slg,
      ops:    s.ops,
      hr:     s.homeRuns,
      rbi:    s.rbi,
      bb:     s.baseOnBalls,
      k:      s.strikeOuts,
      g:      s.gamesPlayed,
      pa:     s.plateAppearances,
      sb:     s.stolenBases,
      hits:   s.hits,
      ab:     s.atBats,
      doubles: s.doubles,
      triples: s.triples,
      sportId: found!.sportId,
    });
  } catch (e) {
    console.warn('[season-stats]', e);
    return NextResponse.json({});
  }
}
