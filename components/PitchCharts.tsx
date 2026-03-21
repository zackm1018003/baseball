'use client';

// ─── Shared pitch chart components ────────────────────────────────────────────
// Used by: /pitcher/[id]/daily  AND  /pitcher/[id]/spring-summary
// Keep this file as the single source of truth for both chart types.

export interface RawDot {
  hb: number;
  ivb: number;
  pitchType: string;
  px: number | null;
  pz: number | null;
  isWhiff: boolean;
  isBarrel: boolean;
  batterSide: string | null;
  velo: number | null;
  spin: number | null;
  vaa: number | null;
  haa: number | null;
  hRel: number | null;
  vRel: number | null;
  extension: number | null;
}

export const PITCH_COLORS: Record<string, { color: string; bg: string; text: string }> = {
  '4-Seam Fastball': { color: '#D22D49', bg: '#D22D49', text: '#fff' },
  'Sinker':          { color: '#C75B12', bg: '#C75B12', text: '#fff' },
  'Cutter':          { color: '#933F2C', bg: '#933F2C', text: '#fff' },
  'Changeup':        { color: '#3BBB38', bg: '#3BBB38', text: '#fff' },
  'Splitter':        { color: '#1A8B6E', bg: '#1A8B6E', text: '#fff' },
  'Curveball':       { color: '#00D1ED', bg: '#00D1ED', text: '#333' },
  'Knuckle Curve':   { color: '#6236CD', bg: '#6236CD', text: '#fff' },
  'Slider':          { color: '#EFE514', bg: '#EFE514', text: '#333' },
  'Sweeper':         { color: '#FF6D00', bg: '#FF6D00', text: '#fff' },
  'Slurve':          { color: '#3B44CE', bg: '#3B44CE', text: '#fff' },
};

export const PITCH_SHORT: Record<string, string> = {
  '4-Seam Fastball': 'FF', 'Sinker': 'SI', 'Cutter': 'FC',
  'Changeup': 'CH', 'Splitter': 'FS', 'Curveball': 'CU',
  'Knuckle Curve': 'KC', 'Slider': 'SL', 'Sweeper': 'ST', 'Slurve': 'SV',
};

export function pitchColors(name: string) {
  return PITCH_COLORS[name] || { color: '#888', bg: '#888', text: '#fff' };
}

// ─── Pitch Location Chart ─────────────────────────────────────────────────────

export function PitchLocationChart({
  rawDots, batterSide, label, pitchOverrides,
}: {
  rawDots: RawDot[];
  batterSide?: 'L' | 'R';
  label?: string;
  pitchOverrides?: Record<number, string>;
}) {
  // Filter to dots with valid plate location, preserving original rawDots index for color overrides
  const dots = rawDots
    .map((d, origIdx) => ({ ...d, origIdx }))
    .filter(d =>
      d.px !== null && d.pz !== null &&
      (batterSide === undefined || d.batterSide === batterSide)
    );

  const size = 320;
  // Display window: ±2.5 ft horizontal, 0–5 ft vertical (catcher POV)
  const xMin = -2.5, xMax = 2.5;
  const zMin = 0,    zMax = 5;
  const pad = 30;
  const w = size - pad * 2;
  const h = size - pad * 2;

  const toSvgX = (px: number) => pad + ((px - xMin) / (xMax - xMin)) * w;
  const toSvgY = (pz: number) => pad + ((zMax - pz) / (zMax - zMin)) * h;

  // Strike zone: ~17in wide (0.708 ft each side), bottom ~1.5ft, top ~3.5ft (avg)
  const szLeft  = toSvgX(-0.708);
  const szRight = toSvgX(0.708);
  const szTop   = toSvgY(3.5);
  const szBot   = toSvgY(1.5);

  // Inner thirds grid
  const thirdW = (szRight - szLeft) / 3;
  const thirdH = (szBot - szTop) / 3;

  if (dots.length === 0) {
    return (
      <div className="flex flex-col items-center">
        <div style={{ width: size, height: size }} className="bg-[#d1d5db] flex items-center justify-center relative">
          {label && <span className="absolute top-2 left-0 right-0 text-center text-xs text-black font-bold uppercase">{label}</span>}
          <p className="text-gray-500 text-xs text-center px-6">No data</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="bg-white">
        {/* Label inside chart */}
        {label && (
          <text x={size / 2} y={20} textAnchor="middle" fontSize="11" fontWeight="600" fill="#111827">{label}</text>
        )}
        {/* Strike zone box */}
        <rect
          x={szLeft} y={szTop}
          width={szRight - szLeft} height={szBot - szTop}
          fill="rgba(0,0,0,0.08)" stroke="#000000" strokeWidth="2"
        />
        {/* Inner thirds grid lines */}
        <line x1={szLeft + thirdW} y1={szTop} x2={szLeft + thirdW} y2={szBot} stroke="#000000" strokeWidth="0.5" opacity="0.4" />
        <line x1={szLeft + thirdW * 2} y1={szTop} x2={szLeft + thirdW * 2} y2={szBot} stroke="#000000" strokeWidth="0.5" opacity="0.4" />
        <line x1={szLeft} y1={szTop + thirdH} x2={szRight} y2={szTop + thirdH} stroke="#000000" strokeWidth="0.5" opacity="0.4" />
        <line x1={szLeft} y1={szTop + thirdH * 2} x2={szRight} y2={szTop + thirdH * 2} stroke="#000000" strokeWidth="0.5" opacity="0.4" />

        {/* Pitch dots */}
        {dots.map((dot) => {
          const cx = toSvgX(dot.px!);
          const cy = toSvgY(dot.pz!);
          const effectiveType = pitchOverrides?.[dot.origIdx] ?? dot.pitchType;
          const col = pitchColors(effectiveType).color;
          const isOverridden = pitchOverrides?.[dot.origIdx] !== undefined;
          if (dot.isWhiff) {
            const s = 4;
            return (
              <g key={dot.origIdx}>
                <line x1={cx - s} y1={cy - s} x2={cx + s} y2={cy + s} stroke="#000000" strokeWidth="4.5" opacity="0.95" />
                <line x1={cx + s} y1={cy - s} x2={cx - s} y2={cy + s} stroke="#000000" strokeWidth="4.5" opacity="0.95" />
                <line x1={cx - s} y1={cy - s} x2={cx + s} y2={cy + s} stroke={col} strokeWidth="2.5" opacity="0.95" />
                <line x1={cx + s} y1={cy - s} x2={cx - s} y2={cy + s} stroke={col} strokeWidth="2.5" opacity="0.95" />
                {isOverridden && <circle cx={cx} cy={cy} r="7" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="3,2" />}
              </g>
            );
          }
          if (dot.isBarrel) {
            return (
              <g key={dot.origIdx}>
                <text x={cx} y={cy + 5} textAnchor="middle" fontSize="13" fontWeight="bold" fill="#000000" stroke="#000000" strokeWidth="4" strokeLinejoin="round" opacity="0.95">B</text>
                <text x={cx} y={cy + 5} textAnchor="middle" fontSize="13" fontWeight="bold" fill={col} opacity="0.95">B</text>
                {isOverridden && <circle cx={cx} cy={cy} r="9" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="3,2" />}
              </g>
            );
          }
          return (
            <g key={dot.origIdx}>
              <circle cx={cx} cy={cy} r="4" fill={col} opacity="0.8" stroke="#000000" strokeWidth="0.8" />
              {isOverridden && <circle cx={cx} cy={cy} r="7" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="3,2" opacity="0.9" />}
            </g>
          );
        })}

        {/* Legend */}
        <circle cx={pad + 6} cy={size - 10} r="3" fill="#000000" opacity="0.8" />
        <text x={pad + 12} y={size - 7} fontSize="8" fill="#000000">pitch</text>
        <line x1={pad + 42} y1={size - 13} x2={pad + 48} y2={size - 7} stroke="#000000" strokeWidth="1.5" />
        <line x1={pad + 48} y1={size - 13} x2={pad + 42} y2={size - 7} stroke="#000000" strokeWidth="1.5" />
        <text x={pad + 52} y={size - 7} fontSize="8" fill="#000000">whiff</text>
        <text x={pad + 80} y={size - 7} fontSize="8" fontWeight="bold" fill="#000000">B</text>
        <text x={pad + 88} y={size - 7} fontSize="8" fill="#000000">barrel</text>
      </svg>
    </div>
  );
}

// ─── Pitch Movement Chart — square style with grid lines ─────────────────────

export function PitchMovementChart({
  rawDots, throws, armAngle, pitchOverrides, onDotClick,
}: {
  rawDots: RawDot[];
  throws?: string;
  armAngle?: number;
  pitchOverrides?: Record<number, string>;
  onDotClick?: (origIndex: number, nearbyIndices: number[], e: React.MouseEvent) => void;
}) {
  // Layout constants
  const padding = { top: 36, right: 16, bottom: 48, left: 16 };
  const size = 320;
  const plotW = size - padding.left - padding.right;
  const plotH = size - padding.top - padding.bottom;
  // Use square plot area (min of W and H)
  const plotSize = Math.min(plotW, plotH);
  const ox = padding.left + (plotW - plotSize) / 2; // plot origin x
  const oy = padding.top;                            // plot origin y
  const cx = ox + plotSize / 2;                      // center x
  const cy = oy + plotSize / 2;                      // center y

  const maxInches = 24;
  const scale = (plotSize / 2) / maxInches;

  // Grid lines every 6 inches
  const gridInches = [-18, -12, -6, 0, 6, 12, 18];

  // Arm angle line points LEFT for LHP, RIGHT for RHP.
  // Pitch dots are also mirrored by dir so arm-side pitches land on the arm-side
  // (left for LHP, right for RHP). Both GF and CSV data store positive hb = arm side
  // for the pitcher, so multiplying by dir flips LHP correctly.
  const dir = throws === 'L' ? -1 : 1;

  // Always recompute arm angle from rawDots hRel/vRel — this uses the jmaschino56 formula:
  // arctan2(|x_in|, z_in * 0.70); negative for LHP.
  // Overrides any passed-in armAngle prop so stale server values can't affect the display.
  const effectiveArmAngle: number | undefined = (() => {
    const validDots = rawDots.filter(d => d.hRel != null && d.vRel != null && (d.vRel as number) > 0);
    if (validDots.length === 0) return armAngle;
    const avgH = validDots.reduce((s, d) => s + (d.hRel as number), 0) / validDots.length;
    const avgV = validDots.reduce((s, d) => s + (d.vRel as number), 0) / validDots.length;
    const handSign = throws === 'L' ? -1 : 1;
    const computed = Math.round(
      Math.atan2(Math.abs(avgH) * 12, avgV * 12 * 0.70) * (180 / Math.PI) * handSign * 10
    ) / 10;
    return isNaN(computed) ? armAngle : computed;
  })();

  const armLine = effectiveArmAngle !== undefined ? (() => {
    const angleRad = (effectiveArmAngle * Math.PI) / 180;
    const len = (plotSize / 2) * 0.92;
    const dx = dir * Math.cos(angleRad) * len;
    const dy = Math.sin(angleRad) * len;
    return { x1: cx, y1: cy, x2: cx + dx, y2: cy - dy };
  })() : null;

  return (
    <div className="flex justify-center">
      <svg width={size} height={size} className="bg-white">

        {/* Title */}
        <text x={size / 2} y={20} textAnchor="middle" fontSize="11" fontWeight="600" fill="#111827">
          Pitch Breaks
        </text>
        {onDotClick && (
          <text x={size / 2} y={30} textAnchor="middle" fontSize="7" fill="#6b7280">click to reclassify</text>
        )}

        {/* Plot border */}
        <rect x={ox} y={oy} width={plotSize} height={plotSize} fill="none" stroke="000000" strokeWidth="2" />

        {/* Vertical grid lines */}
        {gridInches.map(in_ => {
          const px = cx + in_ * scale;
          return (
            <line key={`v${in_}`}
              x1={px} y1={oy} x2={px} y2={oy + plotSize}
              stroke={in_ === 0 ? '#000000' : '#9ca3af'}
              strokeWidth={in_ === 0 ? 1.5 : 0.75}
            />
          );
        })}

        {/* Horizontal grid lines */}
        {gridInches.map(in_ => {
          const py = cy - in_ * scale;
          return (
            <line key={`h${in_}`}
              x1={ox} y1={py} x2={ox + plotSize} y2={py}
              stroke={in_ === 0 ? '#000000' : '#9ca3af'}
              strokeWidth={in_ === 0 ? 1.5 : 0.75}
            />
          );
        })}

        {/* X-axis tick labels (inches) */}
        {[-18, -12, -6, 6, 12, 18].map(in_ => (
          <text key={`xl${in_}`}
            x={cx + in_ * scale} y={oy + plotSize + 12}
            textAnchor="middle" fontSize="8" fill="#374151"
          >{in_}</text>
        ))}

        {/* Y-axis tick labels */}
        {[-18, -12, -6, 6, 12, 18].map(in_ => (
          <text key={`yl${in_}`}
            x={ox - 3} y={cy - in_ * scale + 3}
            textAnchor="end" fontSize="8" fill="#374151"
          >{in_}</text>
        ))}

        {/* X-axis label */}
        <text x={cx} y={oy + plotSize + 28} textAnchor="middle" fontSize="9" fill="#374151">
          Horizontal Break — Arm Angle: {effectiveArmAngle !== undefined ? `${Math.round(effectiveArmAngle)}°` : '—'}
        </text>

        {/* Y-axis label */}
        <text
          x={ox - 12}
          y={cy}
          textAnchor="middle"
          fontSize="9"
          fill="#374151"
          transform={`rotate(-90, ${ox - 12}, ${cy})`}
        >
          Induced Vertical Break (in)
        </text>

        {/* Corner labels: arm-side is LEFT for LHP, RIGHT for RHP */}
        <text x={ox + 4} y={oy + plotSize + 12} textAnchor="start" fontSize="9" fontWeight="600" fill="#374151">
          {throws === 'L' ? '← Arm Side' : '← Glove Side'}
        </text>
        <text x={ox + plotSize - 4} y={oy + plotSize + 12} textAnchor="end" fontSize="9" fontWeight="600" fill="#374151">
          {throws === 'L' ? 'Glove Side →' : 'Arm Side →'}
        </text>

        {/* Arm angle dashed line */}
        {armLine && (
          <>
            <line
              x1={armLine.x1} y1={armLine.y1}
              x2={armLine.x2} y2={armLine.y2}
              stroke="#1f2937" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.65"
            />
            {effectiveArmAngle !== undefined && (
              <text
                x={armLine.x2 + dir * 4}
                y={armLine.y2 - 6}
                textAnchor={dir === -1 ? 'end' : 'start'}
                fontSize="10" fill="#1f2937" opacity="0.8"
              >
                {Math.round(effectiveArmAngle)}°
              </text>
            )}
          </>
        )}

        {/* One dot per actual pitch — clipped to plot area */}
        {/* Multiply hb by dir so arm-side pitches plot LEFT for LHP, RIGHT for RHP */}
        {rawDots.map((dot, i) => {
          const px = cx + dot.hb * dir * scale;
          const py = cy - dot.ivb * scale;
          if (px < ox || px > ox + plotSize || py < oy || py > oy + plotSize) return null;
          const isOverridden = pitchOverrides?.[i] !== undefined;
          const handleClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            const THRESHOLD = 8;
            const nearbyIndices = rawDots.reduce<number[]>((acc, d, j) => {
              const dpx = cx + d.hb * dir * scale;
              const dpy = cy - d.ivb * scale;
              if (dpx < ox || dpx > ox + plotSize || dpy < oy || dpy > oy + plotSize) return acc;
              if (Math.sqrt((px - dpx) ** 2 + (py - dpy) ** 2) <= THRESHOLD) acc.push(j);
              return acc;
            }, []);
            onDotClick?.(i, nearbyIndices, e);
          };
          return (
            <g key={i} onClick={handleClick} style={{ cursor: onDotClick ? 'pointer' : 'default' }}>
              <circle cx={px} cy={py} r="9" fill="transparent" />
              <circle cx={px} cy={py} r="4" fill={pitchColors(dot.pitchType).color} opacity="0.99" stroke="#000000" strokeWidth="0.8" />
              {isOverridden && <circle cx={px} cy={py} r="7" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="3,2" opacity="0.9" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
