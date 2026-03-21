'use client';

import { useRef } from 'react';
import { RawDot, PITCH_COLORS, PITCH_SHORT, PitchLocationChart, PitchMovementChart } from '@/components/PitchCharts';

interface PitchType {
  name: string;
  count: number;
  usage: number;
  velo: number | null;
  spin: number | null;
  h_movement: number | null;
  v_movement: number | null;
  whiff: number | null;
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

// Charts are fixed 320px; we scale them to ~420px inside the card
const CHART_NATIVE = 320;
const CHART_TARGET = 420;
const CHART_SCALE = CHART_TARGET / CHART_NATIVE;

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

  const handleDownload = async () => {
    if (!cardRef.current) return;
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#0d1b2a',
        width: CARD,
        height: CARD,
      });
      const link = document.createElement('a');
      link.download = `${playerName.replace(/\s+/g, '_')}_${date}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch {
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
    { label: 'STR%',   value: strikePctDisplay },
    { label: 'SwStr%', value: swStrDisplay },
  ];

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
            padding: '44px 50px 32px',
            boxSizing: 'border-box',
            gap: 0,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
          }}
        >
          {/* ── HEADER ── */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 26, marginBottom: 24 }}>
            {playerImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={playerImage} alt={playerName} crossOrigin="anonymous"
                style={{ width: 104, height: 'auto', borderRadius: 10, flexShrink: 0, border: '2px solid #1e3a5f' }} />
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                <span style={{ fontSize: 50, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {playerName}
                </span>
                {teamLogo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={teamLogo} alt={teamAbbr || ''} crossOrigin="anonymous"
                    style={{ width: 46, height: 46, objectFit: 'contain', flexShrink: 0 }} />
                )}
              </div>
              <div style={{ fontSize: 20, color: '#94a3b8', marginBottom: 6 }}>{bio}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 20, flexWrap: 'wrap' }}>
                {throws && <span style={{ fontWeight: 700, color: '#60a5fa' }}>{throws}HP</span>}
                <span style={{ fontWeight: 700 }}>{teamAbbr}</span>
                <span style={{ color: '#475569' }}>·</span>
                <span style={{ color: '#94a3b8' }}>{date}</span>
                <span style={{ color: '#475569' }}>·</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#94a3b8' }}>{isHome ? 'vs' : '@'}</span>
                  {opponentLogo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={opponentLogo} alt={opponentAbbr || ''} crossOrigin="anonymous"
                      style={{ width: 20, height: 20, objectFit: 'contain' }} />
                  )}
                  <span style={{ fontWeight: 700 }}>{opponentAbbr}</span>
                </span>
              </div>
            </div>

            {/* Stat boxes — 4×2 grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 76px)', gap: 5, flexShrink: 0 }}>
              {statBoxes.map(({ label, value }) => (
                <div key={label} style={{
                  background: '#16213e', border: '1px solid #1e3a5f', borderRadius: 6,
                  padding: '5px 4px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.15 }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── CHARTS ROW (scaled up) ── */}
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'flex-start', marginBottom: 16 }}>
            {/* Location vs LHH */}
            <div>
              <div style={{ fontSize: 16, color: '#94a3b8', textAlign: 'center', marginBottom: 4, fontWeight: 600 }}>vs LHH</div>
              <div style={{ width: CHART_TARGET, height: CHART_TARGET, overflow: 'hidden', flexShrink: 0 }}>
                <div style={{ transform: `scale(${CHART_SCALE})`, transformOrigin: 'top left', display: 'inline-block' }}>
                  <PitchLocationChart rawDots={rawDots} batterSide="L" pitchOverrides={pitchOverrides} />
                </div>
              </div>
            </div>

            {/* Movement / pitch breaks */}
            <div>
              <div style={{ fontSize: 16, color: '#94a3b8', textAlign: 'center', marginBottom: 4, fontWeight: 600 }}>Pitch Breaks</div>
              <div style={{ width: CHART_TARGET, height: CHART_TARGET, overflow: 'hidden', flexShrink: 0 }}>
                <div style={{ transform: `scale(${CHART_SCALE})`, transformOrigin: 'top left', display: 'inline-block' }}>
                  <PitchMovementChart
                    rawDots={rawDots}
                    throws={throws ?? undefined}
                    armAngle={armAngle ?? undefined}
                    pitchOverrides={pitchOverrides}
                  />
                </div>
              </div>
            </div>

            {/* Location vs RHH */}
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
          <div style={{ flex: 1 }}>
            {/* Header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '190px repeat(6, 1fr)',
              padding: '4px 8px',
              fontSize: 14, fontWeight: 700, color: '#475569',
              textTransform: 'uppercase', letterSpacing: '0.6px',
              borderBottom: '1px solid #1e3a5f',
              marginBottom: 4,
            }}>
              <span>Pitch</span>
              <span style={{ textAlign: 'center' }}>Use%</span>
              <span style={{ textAlign: 'center' }}>Velo</span>
              <span style={{ textAlign: 'center' }}>IVB</span>
              <span style={{ textAlign: 'center' }}>HB</span>
              <span style={{ textAlign: 'center' }}>Spin</span>
              <span style={{ textAlign: 'center' }}>Whiff%</span>
            </div>

            {topPitches.map((pt, i) => {
              const color = PITCH_COLORS[pt.name]?.color ?? '#94a3b8';
              const short = PITCH_SHORT[pt.name] ?? pt.name.slice(0, 2).toUpperCase();
              return (
                <div key={pt.name} style={{
                  display: 'grid',
                  gridTemplateColumns: '190px repeat(6, 1fr)',
                  padding: '7px 8px',
                  background: i % 2 === 0 ? '#16213e' : 'transparent',
                  borderRadius: 5,
                  fontSize: 20, fontWeight: 600, alignItems: 'center',
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      background: color, color: '#fff', fontSize: 13, fontWeight: 800,
                      padding: '2px 7px', borderRadius: 4, letterSpacing: '0.4px', flexShrink: 0,
                    }}>{short}</span>
                    <span style={{ fontSize: 16, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pt.name}</span>
                  </span>
                  <span style={{ textAlign: 'center', color: '#e2e8f0' }}>{pt.usage.toFixed(1)}%</span>
                  <span style={{ textAlign: 'center' }}>{pt.velo?.toFixed(1) ?? '—'}</span>
                  <span style={{ textAlign: 'center', color: '#94a3b8' }}>{pt.v_movement?.toFixed(1) ?? '—'}</span>
                  <span style={{ textAlign: 'center', color: '#94a3b8' }}>{pt.h_movement?.toFixed(1) ?? '—'}</span>
                  <span style={{ textAlign: 'center', color: '#94a3b8' }}>{pt.spin ?? '—'}</span>
                  <span style={{ textAlign: 'center', color: '#94a3b8' }}>{pt.whiff !== null ? `${pt.whiff.toFixed(1)}%` : '—'}</span>
                </div>
              );
            })}
          </div>

          {/* ── FOOTER ── */}
          <div style={{
            marginTop: 'auto', paddingTop: 10,
            borderTop: '1px solid #1e3a5f',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 15, color: '#334155', fontWeight: 600, letterSpacing: '0.5px' }}>
              BASEBALL DAILY CARDS
            </span>
            <span style={{ fontSize: 15, color: '#334155' }}>
              {date}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
