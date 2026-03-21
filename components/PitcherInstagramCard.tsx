'use client';

import { useRef } from 'react';
import { RawDot, PITCH_COLORS, PITCH_SHORT, PitchLocationChart, PitchMovementChart } from '@/components/PitchCharts';

interface PitchType {
  name: string;
  count: number;
  usage: number;
  velo: number | null;
  maxVelo: number | null;
  spin: number | null;
  h_movement: number | null;
  v_movement: number | null;
  vaa: number | null;
  haa: number | null;
  whiff: number | null;
  whiffs: number;
  zone_pct: number | null;
  barrel_pct: number | null;
  h_rel: number | null;
  v_rel: number | null;
  extension: number | null;
}

interface PitcherInstagramCardProps {
  playerName: string;
  playerImage: string | null;
  teamLogo: string | null;
  opponentLogo: string | null;
  teamAbbr: string | null;
  opponentAbbr: string | null;
  isHome: boolean | null;
  date: string;
  throws: 'L' | 'R' | null;
  bio: string;
  gameLine: { ip: string; h: number; er: number; bb: number; k: number; hr: number; pitches: number; strikes: number };
  pitchTypes: PitchType[];
  rawDots: RawDot[];
  armAngle: number | null;
  strikePct: number | null;
  swingAndMissPct: number | null;
  pitchOverrides?: Record<number, string>;
}

// Card renders at 1080×1080, displayed at 540×540
const CARD = 1080;
const DISPLAY = 540;
const SCALE = DISPLAY / CARD;

// 3 charts side-by-side: 3×315 + 2×12 gap = 969px, fits in ~980px usable width
const CHART_NATIVE = 320;
const CHART_TARGET = 315;
const CHART_SCALE = CHART_TARGET / CHART_NATIVE;

// ── Benchmarks (same as pitcher daily page) ───────────────────────────────────
const VELO_BENCHMARKS: Record<string, { p10: number; p90: number }> = {
  '4-Seam Fastball': { p10: 91.0, p90: 97.2 },
  'Sinker':          { p10: 90.4, p90: 96.6 },
  'Cutter':          { p10: 86.3, p90: 92.7 },
  'Changeup':        { p10: 81.7, p90: 90.4 },
  'Splitter':        { p10: 83.1, p90: 90.3 },
  'Curveball':       { p10: 74.8, p90: 84.2 },
  'Knuckle Curve':   { p10: 74.8, p90: 84.2 },
  'Slider':          { p10: 82.0, p90: 89.0 },
  'Sweeper':         { p10: 78.6, p90: 85.1 },
  'Slurve':          { p10: 78.5, p90: 84.6 },
};
const EXT_BENCHMARK = { p10: 5.9, p90: 6.9 };
const BARREL_BENCHMARKS: Record<string, { p10: number; p90: number }> = {
  '4-Seam Fastball': { p10: 0, p90:  9.9 },
  'Sinker':          { p10: 0, p90:  8.8 },
  'Cutter':          { p10: 0, p90: 12.5 },
  'Changeup':        { p10: 0, p90: 10.0 },
  'Splitter':        { p10: 0, p90:  9.1 },
  'Curveball':       { p10: 0, p90: 10.7 },
  'Knuckle Curve':   { p10: 0, p90:  8.3 },
  'Slider':          { p10: 0, p90: 10.7 },
  'Sweeper':         { p10: 0, p90: 10.3 },
  'Slurve':          { p10: 0, p90:  7.1 },
};
const ZONE_BENCHMARKS: Record<string, { p10: number; p90: number }> = {
  '4-Seam Fastball': { p10: 45.2, p90: 63.2 },
  'Sinker':          { p10: 43.5, p90: 66.1 },
  'Cutter':          { p10: 39.6, p90: 64.0 },
  'Changeup':        { p10: 23.8, p90: 50.2 },
  'Splitter':        { p10: 23.8, p90: 50.0 },
  'Curveball':       { p10: 29.1, p90: 54.5 },
  'Knuckle Curve':   { p10: 32.7, p90: 55.0 },
  'Slider':          { p10: 33.3, p90: 58.3 },
  'Sweeper':         { p10: 31.4, p90: 56.1 },
  'Slurve':          { p10: 25.0, p90: 49.1 },
};
const WHIFF_BENCHMARKS: Record<string, { p10: number; p90: number }> = {
  '4-Seam Fastball': { p10: 11.0, p90: 30.4 },
  'Sinker':          { p10:  4.5, p90: 21.5 },
  'Cutter':          { p10: 11.1, p90: 32.2 },
  'Changeup':        { p10: 12.5, p90: 46.2 },
  'Splitter':        { p10: 17.8, p90: 49.5 },
  'Curveball':       { p10: 14.1, p90: 44.6 },
  'Knuckle Curve':   { p10:  6.7, p90: 43.1 },
  'Slider':          { p10: 16.4, p90: 45.5 },
  'Sweeper':         { p10: 17.2, p90: 45.2 },
  'Slurve':          { p10: 16.7, p90: 44.8 },
};

function getWhiffBgColor(t: number): { bg: string; text: string } {
  const c = Math.max(0, Math.min(1, t));
  let r: number, g: number, b: number;
  if (c <= 0.5) {
    const s = c / 0.5;
    r = Math.round(30 + s * (255 - 30));
    g = Math.round(58 + s * (255 - 58));
    b = Math.round(138 + s * (255 - 138));
  } else {
    const s = (c - 0.5) / 0.5;
    r = Math.round(255 + s * (127 - 255));
    g = Math.round(255 + s * (29 - 255));
    b = Math.round(255 + s * (29 - 255));
  }
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return { bg: `rgb(${r}, ${g}, ${b})`, text: luminance > 0.5 ? '#111827' : '#ffffff' };
}

function condCell(value: number | null, p10: number, p90: number, invert = false) {
  if (value === null) return { bg: undefined, text: undefined };
  const t = Math.max(0, Math.min(1, (value - p10) / (p90 - p10)));
  const wc = getWhiffBgColor(invert ? 1 - t : t);
  return { bg: wc.bg, text: wc.text };
}

export default function PitcherInstagramCard({
  playerName, playerImage, teamLogo, opponentLogo,
  teamAbbr, opponentAbbr, isHome, date, throws,
  bio, gameLine, pitchTypes, rawDots, armAngle,
  strikePct, swingAndMissPct, pitchOverrides,
}: PitcherInstagramCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const strikePctDisplay = strikePct !== null ? `${strikePct.toFixed(1)}%` : '—';
  const swStrDisplay = swingAndMissPct !== null ? `${swingAndMissPct.toFixed(1)}%` : '—';
  const topPitches = pitchTypes.slice(0, 5);

  // Scale table size inversely with pitch count so fewer pitches = bigger rows
  const n = topPitches.length || 1;
  const rowPad    = n <= 2 ? 22 : n === 3 ? 15 : n === 4 ? 10 : 8;
  const rowFont   = n <= 2 ? 26 : n === 3 ? 22 : n === 4 ? 20 : 17;
  const hdrFont   = n <= 2 ? 18 : n === 3 ? 16 : n === 4 ? 14 : 13;
  const badgeFont = n <= 2 ? 17 : n === 3 ? 15 : n === 4 ? 14 : 13;
  const nameFont  = n <= 2 ? 21 : n === 3 ? 17 : n === 4 ? 16 : 15;

  const handleDownload = async () => {
    if (!cardRef.current) return;
    try {
      const { default: html2canvas } = await import('html2canvas');
      const el = cardRef.current;

      // Remove scale transform so html2canvas captures the full 1080×1080 element
      el.style.transform = 'none';
      const canvas = await html2canvas(el, {
        scale: 1,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#0d1b2a',
        width: CARD,
        height: CARD,
      });
      // Restore transform
      el.style.transform = `scale(${SCALE})`;

      const link = document.createElement('a');
      link.download = `${playerName.replace(/\s+/g, '_')}_${date}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch {
      // Ensure transform is restored even on error
      if (cardRef.current) cardRef.current.style.transform = `scale(${SCALE})`;
      alert('Download failed — try right-clicking the card and saving the image.');
    }
  };

  const statBoxes = [
    { label: 'IP',     value: gameLine.ip },
    { label: 'H',      value: gameLine.h },
    { label: 'ER',     value: gameLine.er },
    { label: 'BB',     value: gameLine.bb },
    { label: 'K',      value: gameLine.k },
    { label: 'P',      value: gameLine.pitches },
    { label: 'STR',   value: strikePct !== null ? strikePct.toFixed(1) : '—' },
    { label: 'SwStr', value: swingAndMissPct !== null ? swingAndMissPct.toFixed(1) : '—' },
  ];

  const COL = '150px repeat(16, 1fr)';

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={handleDownload}
        className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white bg-[#1e3a5f] hover:bg-[#2a4f7a] transition-colors"
      >
        ⬇ Download
      </button>

      {/* Clipping wrapper at display size */}
      <div style={{ width: DISPLAY, height: DISPLAY, overflow: 'hidden', borderRadius: 10, border: '1px solid #1e3a5f' }}>
        {/* Full-size card scaled down */}
        <div
          ref={cardRef}
          style={{
            width: CARD,
            height: CARD,
            transform: `scale(${SCALE})`,
            transformOrigin: 'top left',
            background: 'linear-gradient(160deg, #0d1b2a 0%, #111827 100%)',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '44px 50px 36px',
            boxSizing: 'border-box',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
          }}
        >
          {/* ── HEADER ── */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 30 }}>
            {/* Player photo */}
            <div style={{ width: 150, height: 150, borderRadius: 12, overflow: 'hidden', flexShrink: 0, border: '2px solid #1e3a5f', background: '#16213e' }}>
              {playerImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={playerImage} alt={playerName} crossOrigin="anonymous"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
                <span style={{ fontSize: 62, fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {playerName}
                </span>
                {teamLogo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={teamLogo} alt={teamAbbr || ''} crossOrigin="anonymous"
                    style={{ width: 54, height: 54, objectFit: 'contain', flexShrink: 0 }} />
                )}
              </div>
              <div style={{ fontSize: 24, color: '#94a3b8', marginBottom: 10 }}>{bio}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 24, flexWrap: 'wrap' }}>
                {throws && <span style={{ fontWeight: 700, color: '#60a5fa' }}>{throws}HP</span>}
                <span style={{ fontWeight: 700 }}>{teamAbbr}</span>
                <span style={{ color: '#475569' }}>·</span>
                <span style={{ color: '#94a3b8' }}>{date}</span>
                <span style={{ color: '#475569' }}>·</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#94a3b8' }}>{isHome ? 'vs' : '@'}</span>
                  {opponentLogo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={opponentLogo} alt={opponentAbbr || ''} crossOrigin="anonymous"
                      style={{ width: 26, height: 26, objectFit: 'contain' }} />
                  )}
                  <span style={{ fontWeight: 700 }}>{opponentAbbr}</span>
                </span>
              </div>
            </div>

            {/* Stat boxes — 4×2 grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 88px)', gap: 7, flexShrink: 0 }}>
              {statBoxes.map(({ label, value }) => (
                <div key={label} style={{
                  background: '#16213e', border: '1px solid #1e3a5f', borderRadius: 8,
                  padding: '8px 6px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 14, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
                  <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.15 }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── CHARTS ROW ── */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 16, color: '#94a3b8', textAlign: 'center', marginBottom: 4, fontWeight: 600 }}>vs LHH</div>
              <div style={{ width: CHART_TARGET, height: CHART_TARGET, overflow: 'hidden', flexShrink: 0 }}>
                <div style={{ transform: `scale(${CHART_SCALE})`, transformOrigin: 'top left', display: 'inline-block' }}>
                  <PitchLocationChart rawDots={rawDots} batterSide="L" pitchOverrides={pitchOverrides} />
                </div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 16, color: '#94a3b8', textAlign: 'center', marginBottom: 4, fontWeight: 600 }}>Pitch Breaks</div>
              <div style={{ width: CHART_TARGET, height: CHART_TARGET, overflow: 'hidden', flexShrink: 0 }}>
                <div style={{ transform: `scale(${CHART_SCALE})`, transformOrigin: 'top left', display: 'inline-block' }}>
                  <PitchMovementChart rawDots={rawDots} throws={throws ?? undefined} armAngle={armAngle ?? undefined} pitchOverrides={pitchOverrides} />
                </div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 16, color: '#94a3b8', textAlign: 'center', marginBottom: 4, fontWeight: 600 }}>vs RHH</div>
              <div style={{ width: CHART_TARGET, height: CHART_TARGET, overflow: 'hidden', flexShrink: 0 }}>
                <div style={{ transform: `scale(${CHART_SCALE})`, transformOrigin: 'top left', display: 'inline-block' }}>
                  <PitchLocationChart rawDots={rawDots} batterSide="R" pitchOverrides={pitchOverrides} />
                </div>
              </div>
            </div>
          </div>

          {/* ── PITCH TABLE ── */}
          <div>
            {/* Header row */}
            <div style={{
              display: 'grid', gridTemplateColumns: COL,
              padding: '4px 6px',
              fontSize: hdrFont, fontWeight: 700, color: '#475569',
              textTransform: 'uppercase', letterSpacing: '0.4px',
              borderBottom: '1px solid #1e3a5f', marginBottom: 4,
            }}>
              <span>Pitch</span>
              {['#', 'Use%', 'Velo', 'Max', 'IVB', 'HB', 'Spin', 'VAA', 'HAA', 'VRel', 'HRel', 'Ext.', 'Zone%', 'Brl%', 'Whf%', 'Whfs'].map(h => (
                <span key={h} style={{ textAlign: 'center' }}>{h}</span>
              ))}
            </div>

            {topPitches.map((pt, i) => {
              const color = PITCH_COLORS[pt.name]?.color ?? '#94a3b8';
              const short = PITCH_SHORT[pt.name] ?? pt.name.slice(0, 2).toUpperCase();

              const veloBm = VELO_BENCHMARKS[pt.name] ?? { p10: 80, p90: 97 };
              const veloC  = condCell(pt.velo,      veloBm.p10, veloBm.p90);
              const maxC   = condCell(pt.maxVelo,   veloBm.p10, veloBm.p90);
              const extC   = condCell(pt.extension, EXT_BENCHMARK.p10, EXT_BENCHMARK.p90);
              const zoneBm = ZONE_BENCHMARKS[pt.name]   ?? { p10: 0,  p90: 100 };
              const zoneC  = condCell(pt.zone_pct,  zoneBm.p10,  zoneBm.p90);
              const brlBm  = BARREL_BENCHMARKS[pt.name] ?? { p10: 0,  p90: 10  };
              const brlC   = condCell(pt.barrel_pct, brlBm.p10, brlBm.p90, true); // inverted: low barrel = good
              const whiffBm = WHIFF_BENCHMARKS[pt.name] ?? { p10: 0, p90: 100 };
              const whifC  = condCell(pt.whiff,     whiffBm.p10, whiffBm.p90);

              const dim: React.CSSProperties = { textAlign: 'center', color: '#94a3b8' };
              const ctr: React.CSSProperties = { textAlign: 'center' };

              return (
                <div key={pt.name} style={{
                  display: 'grid', gridTemplateColumns: COL,
                  padding: `${rowPad}px 6px`,
                  background: i % 2 === 0 ? '#16213e' : 'transparent',
                  borderRadius: 4,
                  fontSize: rowFont, fontWeight: 600, alignItems: 'center',
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ background: color, color: '#fff', fontSize: badgeFont, fontWeight: 800, padding: '2px 7px', borderRadius: 3, flexShrink: 0 }}>{short}</span>
                    <span style={{ fontSize: nameFont, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pt.name}</span>
                  </span>
                  <span style={ctr}>{pt.count}</span>
                  <span style={{ ...ctr, color: '#e2e8f0' }}>{pt.usage.toFixed(1)}%</span>
                  <span style={{ ...ctr, backgroundColor: veloC.bg, color: veloC.text }}>{pt.velo?.toFixed(1) ?? '—'}</span>
                  <span style={{ ...ctr, backgroundColor: maxC.bg,  color: maxC.text  }}>{pt.maxVelo?.toFixed(1) ?? '—'}</span>
                  <span style={dim}>{pt.v_movement?.toFixed(1) ?? '—'}</span>
                  <span style={dim}>{pt.h_movement?.toFixed(1) ?? '—'}</span>
                  <span style={dim}>{pt.spin ?? '—'}</span>
                  <span style={dim}>{pt.vaa !== null ? `${pt.vaa.toFixed(1)}°` : '—'}</span>
                  <span style={dim}>{pt.haa !== null ? `${pt.haa.toFixed(1)}°` : '—'}</span>
                  <span style={dim}>{pt.v_rel?.toFixed(2) ?? '—'}</span>
                  <span style={dim}>{pt.h_rel?.toFixed(2) ?? '—'}</span>
                  <span style={{ ...ctr, backgroundColor: extC.bg,  color: extC.text  }}>{pt.extension?.toFixed(2) ?? '—'}</span>
                  <span style={{ ...ctr, backgroundColor: zoneC.bg, color: zoneC.text }}>{pt.zone_pct  !== null ? `${pt.zone_pct.toFixed(1)}%`  : '—'}</span>
                  <span style={{ ...ctr, backgroundColor: brlC.bg,  color: brlC.text  }}>{pt.barrel_pct !== null ? `${pt.barrel_pct.toFixed(1)}%` : '—'}</span>
                  <span style={{ ...ctr, backgroundColor: whifC.bg, color: whifC.text }}>{pt.whiff !== null ? `${pt.whiff.toFixed(1)}%` : '—'}</span>
                  <span style={{ ...ctr, backgroundColor: whifC.bg, color: whifC.text }}>{pt.whiffs > 0 ? pt.whiffs : '—'}</span>
                </div>
              );
            })}
          </div>

          {/* ── FOOTER ── */}
          <div style={{
            paddingTop: 10,
            borderTop: '1px solid #1e3a5f',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 15, color: '#334155', fontWeight: 600, letterSpacing: '0.5px' }}>BASEBALL DAILY CARDS</span>
            <span style={{ fontSize: 15, color: '#334155' }}>{date}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
