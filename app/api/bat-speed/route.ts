import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/bat-speed?playerId=592450&year=2025
 *
 * Proxies Baseball Savant's bat-tracking leaderboard and returns
 * avg bat speed + fast swing % (≥ 75 mph) for a single player.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const year = searchParams.get('year') || String(new Date().getFullYear());

  if (!playerId) {
    return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  }

  try {
    const url =
      `https://baseballsavant.mlb.com/leaderboard/bat-tracking` +
      `?attackZone=&batSide=&contactType=&count=&dateRange=` +
      `&firstLastName=&minSwings=q&minGroupSwings=1&pitchType=` +
      `&position=&scale=mlbAm&team=&type=batter&year=${year}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://baseballsavant.mlb.com/',
      },
      next: { revalidate: 3600 }, // re-fetch at most once per hour
    });

    if (!res.ok) throw new Error(`Savant HTTP ${res.status}`);
    const data = await res.json();

    const rows: Record<string, unknown>[] = Array.isArray(data) ? data : [];
    const p = rows.find(row =>
      String(row.player_id ?? row.batter_id ?? row.id ?? '') === playerId
    );

    if (!p) {
      return NextResponse.json({ avgBatSpeed: null, fastSwingPct: null });
    }

    const bs = p.bat_speed != null ? Number(p.bat_speed) : null;

    // fast_swing_rate may come as 0–1 decimal or 0–100 percentage
    let fsr = p.fast_swing_rate != null ? Number(p.fast_swing_rate) : null;
    if (fsr !== null && !isNaN(fsr) && fsr <= 1) fsr = fsr * 100;

    return NextResponse.json({
      avgBatSpeed: bs !== null && !isNaN(bs) ? Math.round(bs * 10) / 10 : null,
      fastSwingPct: fsr !== null && !isNaN(fsr) ? Math.round(fsr * 10) / 10 : null,
    });
  } catch (e) {
    console.warn('[bat-speed route]', e);
    return NextResponse.json({ avgBatSpeed: null, fastSwingPct: null });
  }
}
