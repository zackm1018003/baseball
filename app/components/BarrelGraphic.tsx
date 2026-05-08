'use client';

import { useRef, useState, useEffect } from 'react';
import html2canvas from 'html2canvas';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';

interface BarrelPlayer {
  playerId: number | null;
  name: string;
  team: string;
  barrels: number | null;
  barrelPct: number | null;
  attempts: number | null;
  pa: number | null;
  avgEv: number | null;
  maxEv: number | null;
  avgBatSpeed: number | null;
  hardHit95: number | null;
  hr: number | null;
}

interface Props {
  players: BarrelPlayer[];
  league: string;
  lastN: number;
  onClose: () => void;
}

// Dark row bg + team accent for left stripe
const TEAM_STYLES: Record<string, { bg: string; accent: string }> = {
  ARI: { bg: '#180a10', accent: '#a71930' },
  ATL: { bg: '#0f0a14', accent: '#ce1141' },
  BAL: { bg: '#180d00', accent: '#df4601' },
  BOS: { bg: '#180a0d', accent: '#bd3039' },
  CHC: { bg: '#06102a', accent: '#0e3386' },
  CWS: { bg: '#0e0e0e', accent: '#c4ced4' },
  CIN: { bg: '#180007', accent: '#c6011f' },
  CLE: { bg: '#000e20', accent: '#e31937' },
  COL: { bg: '#10001e', accent: '#8b5cf6' },
  DET: { bg: '#060c18', accent: '#4a90d9' },
  HOU: { bg: '#180e00', accent: '#eb6e1f' },
  KC:  { bg: '#00121e', accent: '#4a8abf' },
  LAA: { bg: '#180006', accent: '#c0392b' },
  LAD: { bg: '#001420', accent: '#4a90d9' },
  MIA: { bg: '#000e18', accent: '#00b4d8' },
  MIL: { bg: '#060c1a', accent: '#4a6fa5' },
  MIN: { bg: '#000718', accent: '#c0392b' },
  NYM: { bg: '#00081a', accent: '#4a90d9' },
  NYY: { bg: '#00081a', accent: '#6b7fc4' },
  OAK: { bg: '#000e06', accent: '#27ae60' },
  PHI: { bg: '#180006', accent: '#e81828' },
  PIT: { bg: '#0e0e00', accent: '#f0c040' },
  SD:  { bg: '#0c0a08', accent: '#8b7355' },
  SF:  { bg: '#180a00', accent: '#e07b3a' },
  SEA: { bg: '#02081a', accent: '#27ae60' },
  STL: { bg: '#180006', accent: '#c41e3a' },
  TB:  { bg: '#020c1a', accent: '#4a6fa5' },
  TEX: { bg: '#000c18', accent: '#4a90d9' },
  TOR: { bg: '#040c1a', accent: '#4a90d9' },
  WSH: { bg: '#180000', accent: '#c0392b' },
};

function getTeamStyle(team: string): { bg: string; accent: string } {
  return TEAM_STYLES[team.toUpperCase()] ?? { bg: '#0d1220', accent: '#4a90d9' };
}

function getHeadshotUrl(playerId: number | null): string {
  if (!playerId) return '';
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${playerId}/headshot/67/current`;
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function BarrelGraphic({ players, league, lastN, onClose }: Props) {
  const graphicRef = useRef<HTMLDivElement>(null);
  const [imageUrl, setImageUrl]   = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [copied, setCopied]       = useState(false);

  const hasBarrels = players.some(p => p.barrels != null && p.barrels > 0);
  const useHR = !hasBarrels; // fall back to HR for minors season view

  const top10 = [...players]
    .filter(p => useHR ? (p.hr != null && p.hr > 0) : (p.barrels != null && p.barrels > 0))
    .sort((a, b) => useHR ? (b.hr ?? 0) - (a.hr ?? 0) : (b.barrels ?? 0) - (a.barrels ?? 0))
    .slice(0, 10);

  const leagueLabel = league === 'mlb' ? 'MLB' : league === 'aaa' ? 'AAA' : 'Low-A';
  const windowLabel = lastN > 0 ? `Last ${lastN} Games` : '2026 Season';
  const statLabel   = useHR ? 'HR' : 'BRLS';
  const titleLine   = useHR ? 'Top 10 Home Run Hitters' : 'Top 10 Barrel Hitters';
  const filename = `barrel-leaderboard-${league}-${lastN > 0 ? `l${lastN}` : 'season'}.png`;

  // Auto-render to image after a brief delay so images can load
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!graphicRef.current) return;
      try {
        const canvas = await html2canvas(graphicRef.current, {
          useCORS: true,
          allowTaint: true,
          scale: 2,
          backgroundColor: '#080c18',
          logging: false,
        });
        setImageUrl(canvas.toDataURL('image/png'));
      } finally {
        setRendering(false);
      }
    }, 1500); // wait for headshots + SVG logos to fully load
    return () => clearTimeout(timer);
  }, []);

  function download() {
    if (!imageUrl) return;
    const link = document.createElement('a');
    link.download = filename;
    link.href = imageUrl;
    link.click();
  }

  async function copyToClipboard() {
    if (!imageUrl) return;
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: open in new tab so user can save manually
      window.open(imageUrl, '_blank');
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-auto">
      <div className="flex flex-col items-center gap-4 max-w-2xl w-full">
        {/* Controls */}
        <div className="flex gap-3 w-full justify-end items-center">
          {rendering && (
            <span className="text-gray-400 text-sm mr-auto">Rendering image…</span>
          )}
          {imageUrl && !rendering && (
            <span className="text-gray-400 text-sm mr-auto">Right-click the image to save · or use buttons below</span>
          )}
          <button
            onClick={copyToClipboard}
            disabled={!imageUrl}
            className="bg-[#1a1f30] hover:bg-[#262e4a] disabled:opacity-40 border border-[#303a5c] text-gray-300 font-medium px-4 py-2 rounded text-sm transition-colors"
          >
            {copied ? '✓ Copied!' : '📋 Copy'}
          </button>
          <button
            onClick={download}
            disabled={!imageUrl}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold px-4 py-2 rounded text-sm transition-colors"
          >
            ⬇ Download
          </button>
          <button
            onClick={onClose}
            className="bg-[#1a1f30] hover:bg-[#262e4a] text-gray-300 font-medium px-4 py-2 rounded text-sm transition-colors"
          >
            ✕ Close
          </button>
        </div>

        {/* After rendering: show the captured image (right-clickable) */}
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="Barrel leaderboard graphic"
            style={{ maxWidth: '100%', borderRadius: 12, cursor: 'context-menu' }}
            title="Right-click → Save Image As"
          />
        )}

        {/* HTML graphic — visible while rendering, hidden once image is ready */}
        <div ref={graphicRef} style={{ display: imageUrl ? 'none' : 'block' }}>
        <div
          style={{
            width: 680,
            background: '#080c18',
            fontFamily: "'Arial Black', 'Arial Bold', Arial, sans-serif",
            padding: '26px 22px 18px',
            borderRadius: 12,
          }}
        >
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>
              {leagueLabel} · {windowLabel} · {formatDate()}
            </div>
            <div style={{
              fontSize: 44,
              fontWeight: 900,
              color: '#ffffff',
              lineHeight: 1,
              letterSpacing: -1,
              textTransform: 'uppercase',
            }}>
              {titleLine}
            </div>
            {/* Divider */}
            <div style={{ height: 2, background: 'linear-gradient(90deg, transparent, #f59e0b, transparent)', marginTop: 12 }} />
          </div>

          {/* Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {top10.map((player, i) => {
              const rank = i + 1;
              const { bg, accent } = getTeamStyle(player.team);
              const logoUrl = getMLBTeamLogoUrl(player.team);
              const headshotUrl = getHeadshotUrl(player.playerId);

              return (
                <div
                  key={player.playerId ?? i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: bg,
                    borderRadius: 6,
                    overflow: 'hidden',
                    height: 88,
                    borderLeft: `5px solid ${accent}`,
                  }}
                >
                  {/* Rank */}
                  <div style={{
                    width: 52,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    height: 88,
                  }}>
                    <span style={{ fontSize: 18, fontWeight: 900, color: '#ffffff', opacity: 0.9 }}>
                      #{rank}
                    </span>
                  </div>

                  {/* Headshot */}
                  <div style={{
                    width: 80,
                    height: 88,
                    flexShrink: 0,
                    overflow: 'hidden',
                  }}>
                    {headshotUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={headshotUrl}
                        alt={player.name}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          objectPosition: '50% 22%',
                        }}
                        crossOrigin="anonymous"
                      />
                    )}
                  </div>

                  {/* Team logo */}
                  <div style={{ width: 50, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                    {logoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logoUrl}
                        alt={player.team}
                        style={{ width: 42, height: 42, objectFit: 'contain' }}
                        crossOrigin="anonymous"
                      />
                    )}
                  </div>

                  {/* Name + team */}
                  <div style={{ flex: 1, padding: '0 10px', minWidth: 0 }}>
                    <div style={{
                      fontSize: 21,
                      fontWeight: 900,
                      color: '#ffffff',
                      textTransform: 'uppercase',
                      lineHeight: 1.15,
                      letterSpacing: 0.3,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {player.name}
                    </div>
                    <div style={{ fontSize: 10, color: accent, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginTop: 3 }}>
                      {player.team}
                    </div>
                  </div>

                  {/* Barrels */}
                  <div style={{
                    width: 72,
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 88,
                    borderLeft: `1px solid ${accent}44`,
                  }}>
                    <span style={{ fontSize: 32, fontWeight: 900, color: '#f59e0b', lineHeight: 1 }}>
                      {useHR ? player.hr : player.barrels}
                    </span>
                    <span style={{ fontSize: 9, color: '#6b7280', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 2 }}>
                      {statLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{ marginTop: 14, textAlign: 'center', fontSize: 10, color: '#374151', letterSpacing: 1.5, textTransform: 'uppercase' }}>
            Data: MLB Stats API · Baseball Savant
          </div>
        </div>
        </div> {/* end offscreen wrapper */}
      </div>
    </div>
  );
}
