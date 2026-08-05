'use client';

import { calcPct, getLG } from '@/app/lib/leagueBaselines';

// Mini percentile bar rendered under a stat in the compact player cards.
// 5 blue segments extend LEFT from center for below-avg; 5 red extend RIGHT for above-avg.
// Each segment = 10 percentile points. Only filled segments are colored; rest = dim track.
// The percentile number appears at the outer end. p=50 shows empty track (average–59) shows only the dim track.
export function MiniPercentileBar({ value, leagueKey, level, pa, minPa = 25, baselineOverride, light = false }: {
  value: number | null; leagueKey: string; level: string | null | undefined; pa?: number;
  minPa?: number;
  baselineOverride?: { mean: number; std: number; inv?: boolean };
  light?: boolean;
}) {
  const LG       = getLG(level);
  const baseline = baselineOverride ?? LG[leagueKey];
  if (!baseline || value == null || (pa !== undefined && pa < minPa)) {
    return <div style={{ height: 20 }} />;
  }
  const p = calcPct(value, baseline.mean, baseline.std, baseline.inv);
  if (p == null) return <div style={{ height: 20 }} />;

  // p is an integer 1-99; p=50 shows empty track only
  const isBelow = p <= 49;
  const isAbove = p >= 51;

  // 5 shades per side, index 0 = closest to center
  const blueColors = ['#1d7ab4','#1a6196','#184f82','#174678','#163d6e'];
  const redColors  = ['#9e0808','#c41515','#e82525','#f72e2e','#ff2d2d'];

  // Blue bar i fills when p <= 49 - i*10  (ranges: 40-49, 30-39, 20-29, 10-19, 0-9)
  // Red  bar i fills when p >= 51 + i*10  (ranges: 51-60, 61-70, 71-80, 81-90, 91+)
  const EMPTY = light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)';

  // Label color = outermost filled bar's color
  const lastBlueIdx = isBelow ? Math.min(4, Math.floor((49 - p) / 10)) : -1;
  const lastRedIdx  = isAbove ? Math.min(4, Math.floor((p - 51) / 10)) : -1;
  const labelColor  = isBelow ? blueColors[lastBlueIdx] : isAbove ? redColors[lastRedIdx] : '#555';

  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 20, paddingTop: 3, paddingBottom: 2 }}>
      {/* Left label – visible only when below average */}
      <span style={{ fontSize: 10, fontWeight: 800, lineHeight: 1, whiteSpace: 'nowrap',
        minWidth: 22, textAlign: 'left', flexShrink: 0,
        color: isBelow ? labelColor : 'transparent' }}>
        {isBelow ? `${p}%` : ' '}
      </span>

      {/* Blue bars: row-reverse so bar[0] (40-49 range) sits closest to center */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row-reverse', gap: 1.5 }}>
        {blueColors.map((color, i) => (
          <div key={i} style={{ flex: 1, height: 6, borderRadius: 2,
            background: p <= (49 - i * 10) ? color : EMPTY }} />
        ))}
      </div>

      {/* Center gap */}
      <div style={{ width: 3, flexShrink: 0 }} />

      {/* Red bars: normal order so bar[0] (51-60 range) sits closest to center */}
      <div style={{ flex: 1, display: 'flex', gap: 1.5 }}>
        {redColors.map((color, i) => (
          <div key={i} style={{ flex: 1, height: 6, borderRadius: 2,
            background: p >= (51 + i * 10) ? color : EMPTY }} />
        ))}
      </div>

      {/* Right label – visible only when above average */}
      <span style={{ fontSize: 10, fontWeight: 800, lineHeight: 1, whiteSpace: 'nowrap',
        minWidth: 22, textAlign: 'right', flexShrink: 0,
        color: isAbove ? labelColor : 'transparent' }}>
        {isAbove ? `${p}%` : ' '}
      </span>
    </div>
  );
}
