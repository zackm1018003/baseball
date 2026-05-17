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
    // Try the simplified URL first — more likely to return JSON
    const url =
      `https://baseballsavant.mlb.com/leaderboard/bat-tracking` +
      `?type=batter&year=${year}&minSwings=q&minGroupSwings=1`;

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

    // If the response is HTML (full page returned instead of JSON), bail out
    if (text.trimStart().startsWith('<')) {
      console.warn('[bat-speed] Savant returned HTML, not JSON');
      return NextResponse.json({ avgBatSpeed: null, fastSwingPct: null });
    }

    const data = JSON.parse(text);

    // Handle both plain array and { data: [...] } wrapper
    const rows: Record<string, unknown>[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
      ? data.data
      : [];

    console.log(`[bat-speed] year=${year} rows=${rows.length} pid=${playerId}`);
    if (rows.length > 0) {
      console.log('[bat-speed] sample keys:', Object.keys(rows[0]).slice(0, 15).join(', '));
    }

    const p = rows.find(row =>
      String(row.player_id ?? row.batter_id ?? row.batter ?? row.mlbam_id ?? row.id ?? '') === playerId
    );

    if (!p) {
      console.log(`[bat-speed] player ${playerId} not found`);
      return NextResponse.json({ avgBatSpeed: null, fastSwingPct: null });
    }

    const bs = p.bat_speed != null ? Number(p.bat_speed) : null;
    let fsr = p.fast_swing_rate != null ? Number(p.fast_swing_rate)
            : p.fast_swing_pct  != null ? Number(p.fast_swing_pct)
            : null;

    // Normalize 0–1 decimal → percentage
    if (fsr !== null && !isNaN(fsr) && fsr <= 1) fsr = fsr * 100;

    return NextResponse.json({
      avgBatSpeed:  bs  !== null && !isNaN(bs)  ? Math.round(bs  * 10) / 10 : null,
      fastSwingPct: fsr !== null && !isNaN(fsr) ? Math.round(fsr * 10) / 10 : null,
    });
  } catch (e) {
    console.warn('[bat-speed route]', e);
    return NextResponse.json({ avgBatSpeed: null, fastSwingPct: null });
  }
}
