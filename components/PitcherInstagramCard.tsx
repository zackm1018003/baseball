'use client';

import { useRef } from 'react';
import { RawDot, PITCH_COLORS, PITCH_SHORT, PitchMovementChart } from '@/components/PitchCharts';

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

// Movement chart scaled up — only one chart so we can make it bigger
const CHART_NATIVE = 320;
const CHART_TARGET = 380;
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
        backgroundColor: '#0a1628',
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

  const heroStats = [
    { label: 'IP',     value: gameLine.ip,       accent: '#60a5fa' },
    { label: 'K',      value: gameLine.k,         accent: '#4ade80' },
    { label: 'BB',     value: gameLine.bb,        accent: '#f97316' },
    { label: 'ER',     value: gameLine.er,        accent: '#f87171' },
    { label: 'H',      value: gameLine.h,         accent: '#94a3b8' },
    { label: 'P',      value: gameLine.pitches,   accent: '#a78bfa' },
    { label: 'STR%',   value: strikePctDisplay,   accent: '#fbbf24' },
    { label: 'SwStr%', value: swStrDisplay,       accent: '#fb923c' },
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
      <div style={{ width: DISPLAY, height: DISPLAY, overflow: 'hidden', borderRadius: 10, border: '2px solid #1e3a5f', boxShadow: '0 0 40px rgba(96,165,250,0.15)' }}>
        {/* Full-size 1080×1080 card scaled to 540×540 */}
        <div
          ref={cardRef}
          style={{
            width: CARD,
            height: CARD,
            transform: `scale(${SCALE})`,
            transformOrigin: 'top left',
            background: 'linear-gradient(150deg, #0a1628 0%, #0d1b2a 50%, #0f2240 100%)',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            padding: '40px 52px 32px',
            boxSizing: 'border-box',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
          }}
        >
          {/* ── HEADER: photo + name + matchup ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 30, marginBottom: 28 }}>
            {/* Player photo */}
            <div style={{ flexShrink: 0, width: 170, height: 170, borderRadius: 14, overflow: 'hidden', border: '3px solid #1e3a5f', background: '#16213e' }}>
              {playerImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={playerImage} alt={playerName} crossOrigin="anonymous"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
            </div>

            {/* Name + info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Name row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
                <span style={{ fontSize: 62, fontWeight: 900, letterSpacing: '-2px', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {playerName}
                </span>
                {teamLogo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={teamLogo} alt={teamAbbr || ''} crossOrigin="anonymous"
                    style={{ width: 60, height: 60, objectFit: 'contain', flexShrink: 0 }} />
                )}
              </div>
              {/* Bio */}
              <div style={{ fontSize: 21, color: '#94a3b8', marginBottom: 10 }}>{bio}</div>
              {/* Matchup line */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 22, flexWrap: 'wrap' }}>
                {throws && (
                  <span style={{ fontWeight: 700, color: '#60a5fa', background: '#162840', border: '1px solid #1e3a5f', padding: '3px 12px', borderRadius: 6 }}>
                    {throws}HP
                  </span>
                )}
                <span style={{ fontWeight: 800, color: '#e2e8f0' }}>{teamAbbr}</span>
                <span style={{ color: '#334155' }}>·</span>
                <span style={{ color: '#64748b' }}>{date}</span>
                <span style={{ color: '#334155' }}>·</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ color: '#64748b' }}>{isHome ? 'vs' : '@'}</span>
                  {opponentLogo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={opponentLogo} alt={opponentAbbr || ''} crossOrigin="anonymous"
                      style={{ width: 26, height: 26, objectFit: 'contain' }} />
                  )}
                  <span style={{ fontWeight: 800 }}>{opponentAbbr}</span>
                </span>
              </div>
            </div>
          </div>

          {/* ── HERO STATS: 8 boxes ── */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 26 }}>
            {heroStats.map(({ label, value, accent }) => (
              <div key={label} style={{
                flex: 1, background: '#111f38', border: '1px solid #1a2f50',
                borderTop: `3px solid ${accent}`,
                borderRadius: 10, padding: '10px 6px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 5 }}>{label}</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#f1f5f9', lineHeight: 1 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* ── CHART + ARSENAL ROW ── */}
          <div style={{ display: 'flex', gap: 28, flex: 1, minHeight: 0 }}>

            {/* Movement chart */}
            <div style={{ flexShrink: 0 }}>
              <div style={{ fontSize: 14, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                Movement Profile
              </div>
              <div style={{ width: CHART_TARGET, height: CHART_TARGET, overflow: 'hidden' }}>
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

            {/* Pitch arsenal */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 14, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 14 }}>
                Arsenal
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {topPitches.map((pt) => {
                  const color = PITCH_COLORS[pt.name]?.color ?? '#94a3b8';
                  const short = PITCH_SHORT[pt.name] ?? pt.name.slice(0, 2).toUpperCase();
                  return (
                    <div key={pt.name}>
                      {/* Name row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <span style={{
                          background: color, color: '#fff', fontSize: 13, fontWeight: 800,
                          padding: '3px 9px', borderRadius: 5, flexShrink: 0, minWidth: 42, textAlign: 'center',
                        }}>{short}</span>
                        <span style={{ fontSize: 19, fontWeight: 700, color: '#cbd5e1', flex: 1 }}>{pt.name}</span>
                        <span style={{ fontSize: 22, fontWeight: 900, color: '#f1f5f9', minWidth: 56, textAlign: 'right' }}>
                          {pt.usage.toFixed(1)}%
                        </span>
                      </div>
                      {/* Stats sub-row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                        {/* Usage bar */}
                        <div style={{ flex: 1, background: '#1e3a5f', borderRadius: 4, height: 7, overflow: 'hidden' }}>
                          <div style={{ width: `${pt.usage}%`, height: '100%', background: color, borderRadius: 4 }} />
                        </div>
                        <span style={{ fontSize: 16, color: '#64748b', minWidth: 70, textAlign: 'right' }}>
                          {pt.velo?.toFixed(1) ?? '—'} mph
                        </span>
                        {pt.whiff !== null && (
                          <span style={{ fontSize: 16, color: '#4ade80', minWidth: 68, textAlign: 'right' }}>
                            {pt.whiff.toFixed(1)}% whiff
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── FOOTER ── */}
          <div style={{
            marginTop: 18, paddingTop: 12,
            borderTop: '1px solid #1a2f50',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 16, color: '#2d4a6b', fontWeight: 700, letterSpacing: '1px' }}>
              BASEBALL DAILY CARDS
            </span>
            <span style={{ fontSize: 16, color: '#2d4a6b' }}>{date}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
