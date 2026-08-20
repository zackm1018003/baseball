'use client';

import { calcPct, getLG } from '@/app/lib/leagueBaselines';

// Mini percentile bar rendered under a stat in the compact player cards.
// 5 blue segments sit LEFT of center for below-avg; 5 red sit RIGHT of center for above-avg.
// Each segment = 10 percentile points. Fill anchors to the OUTER edge next to the percentile
// label and grows toward center as the value moves further from average — so the colored
// block always starts right where the number is, instead of floating next to the center gap.
// Only filled segments are colored; rest = dim track. p=50 shows only the dim track.
export function MiniPercentileBar({ value, leagueKey, level, pa, minPa = 25, baselineOverride, light = false, colorMode = 'redblue' }: {
  value: number | null; leagueKey: string; level: string | null | undefined; pa?: number;
  minPa?: number;
  baselineOverride?: { mean: number; std: number; inv?: boolean };
  light?: boolean;
  // 'redblue' (default) = the usual good/bad semantic (red=above avg, blue=below avg).
  // 'mono' = same magnitude bars but black/gray both sides — for scales where one side
  // isn't inherently "better" (e.g. a platoon-direction gauge).
  colorMode?: 'redblue' | 'mono';
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
  const blueColors = colorMode === 'mono'
    ? (light ? ['#999999','#777777','#555555','#333333','#111111'] : ['#8a8a8a','#6e6e6e','#525252','#363636','#1a1a1a'])
    : ['#1d7ab4','#1a6196','#184f82','#174678','#163d6e'];
  const redColors  = colorMode === 'mono'
    ? (light ? ['#999999','#777777','#555555','#333333','#111111'] : ['#8a8a8a','#6e6e6e','#525252','#363636','#1a1a1a'])
    : ['#9e0808','#c41515','#e82525','#f72e2e','#ff2d2d'];

  // Blue bar i fills when p <= 49 - i*10  (ranges: 40-49, 30-39, 20-29, 10-19, 0-9)
  // Red  bar i fills when p >= 51 + i*10  (ranges: 51-60, 61-70, 71-80, 81-90, 91+)
  // i=0 is the first to fill (mildest deviation) and sits closest to the label/outer edge;
  // i=4 is the last to fill (most extreme deviation) and sits closest to center.
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

      {/* Blue bars: normal order so bar[0] (40-49 range) sits closest to the left label */}
      <div style={{ flex: 1, display: 'flex', gap: 1.5 }}>
        {blueColors.map((color, i) => (
          <div key={i} style={{ flex: 1, height: 6, borderRadius: 2,
            background: p <= (49 - i * 10) ? color : EMPTY }} />
        ))}
      </div>

      {/* Center gap */}
      <div style={{ width: 3, flexShrink: 0 }} />

      {/* Red bars: row-reverse so bar[0] (51-60 range) sits closest to the right label */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row-reverse', gap: 1.5 }}>
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
