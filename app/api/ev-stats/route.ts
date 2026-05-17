import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/ev-stats?playerId=592450&year=2026
 *
 * Proxies Baseball Savant's expected statistics leaderboard and returns
 * avg EV, max EV, and EV90 for a single player.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const year = searchParams.get('year') || String(new Date().getFullYear());

  if (!playerId) {
    return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  }

  const empty = { avgEv: null, maxEv: null, ev90: null };

  try {
    const url =
      `https://baseballsavant.mlb.com/leaderboard/expected_statistics` +
      `?type=batter&year=${year}&position=&team=&min=q`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://baseballsavant.mlb.com/',
      },
      next: { revalidate: 3600 },
    });

    if (!res.ok) throw new Error(`Savant HTTP ${res.status}`);

    const text = await res.text();
    if (text.trimStart().startsWith('<')) {
      console.warn('[ev-stats] Savant returned HTML');
      return NextResponse.json(empty);
    }

    const data = JSON.parse(text);
    const rows: Record<string, unknown>[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.data) ? data.data : [];

    const p = rows.find(row =>
      String(row.player_id ?? row.batter_id ?? row.batter ?? row.mlbam_id ?? row.id ?? '') === playerId
    );

    if (!p) {
      console.log(`[ev-stats] player ${playerId} not found in expected stats leaderboard`);
      return NextResponse.json(empty);
    }

    // Field names vary by year/endpoint — try all known variants
    const avgEv = p.exit_velocity_avg ?? p.avg_hit_speed ?? p.ev_avg ?? null;
    const maxEv = p.exit_velocity_max ?? p.max_hit_speed ?? p.ev_max ?? null;
    const ev90  = p.ev_90 ?? p.ev90 ?? p.exit_velocity_90 ?? null;

    console.log(`[ev-stats] pid=${playerId} avgEv=${avgEv} maxEv=${maxEv} ev90=${ev90}`);

    return NextResponse.json({
      avgEv: avgEv != null ? Math.round(Number(avgEv) * 10) / 10 : null,
      maxEv: maxEv != null ? Math.round(Number(maxEv) * 10) / 10 : null,
      ev90:  ev90  != null ? Math.round(Number(ev90)  * 10) / 10 : null,
    });
  } catch (e) {
    console.warn('[ev-stats route]', e);
    return NextResponse.json(empty);
  }
}
