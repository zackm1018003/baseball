'use client';

import { useRef, useState } from 'react';
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

// Team primary colors for row backgrounds
const TEAM_COLORS: Record<string, string> = {
  ARI: '#1a0610', ATL: '#8a0028', BAL: '#9b3200', BOS: '#8a1f27',
  CHC: '#092266', CHW: '#18161a', CIN: '#8a000f', CLE: '#002944',
  COL: '#230050', CWS: '#18161a', DET: '#0a1a30', HOU: '#9b4800',
  KC:  '#003070', LAA: '#820016', LAD: '#003d7a', MIA: '#005068',
  MIL: '#0c1c35', MIN: '#001e42', NYM: '#001c52', NYY: '#001a52',
  OAK: '#002218', PHI: '#a01020', PIT: '#1a1500', SD: '#1e1410',
  SF:  '#5e1a00', SEA: '#081e3e', STL: '#880012', TB:  '#061e3e',
  TEX: '#002060', TOR: '#0d3462', WSH: '#760002',
};

const RANK_COLORS = [
  '#d4af37', // #1 gold
  '#a0a0a0', // #2 silver
  '#cd7f32', // #3 bronze
  '#4a90e2', // #4-10 blue
];

function getRankColor(rank: number): string {
  return RANK_COLORS[Math.min(rank - 1, RANK_COLORS.length - 1)];
}

function getTeamBg(team: string): string {
  return TEAM_COLORS[team.toUpperCase()] ?? '#12182e';
}

function getHeadshotUrl(playerId: number | null): string {
  if (!playerId) return '';
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${playerId}/headshot/67/current`;
}

export default function BarrelGraphic({ players, league, lastN, onClose }: Props) {
  const graphicRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const top10 = players
    .filter(p => p.barrels != null && p.barrels > 0)
    .slice(0, 10);

  const leagueLabel = league === 'mlb' ? 'MLB' : league === 'aaa' ? 'AAA' : 'Low-A';
  const windowLabel = lastN > 0 ? `Last ${lastN} Games` : '2026 Season';

  async function download() {
    if (!graphicRef.current) return;
    setDownloading(true);
    try {
      const canvas = await html2canvas(graphicRef.current, {
        useCORS: true,
        allowTaint: true,
        scale: 2,
        backgroundColor: '#0a0f1e',
        logging: false,
      });
      const link = document.createElement('a');
      link.download = `barrel-leaderboard-${league}-${lastN > 0 ? `l${lastN}` : 'season'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-auto">
      <div className="flex flex-col items-center gap-4 max-w-2xl w-full">
        {/* Controls */}
        <div className="flex gap-3 w-full justify-end">
          <button
            onClick={download}
            disabled={downloading}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold px-4 py-2 rounded text-sm transition-colors"
          >
            {downloading ? 'Generating…' : '⬇ Download PNG'}
          </button>
          <button
            onClick={onClose}
            className="bg-[#1a1f30] hover:bg-[#262e4a] text-gray-300 font-medium px-4 py-2 rounded text-sm transition-colors"
          >
            ✕ Close
          </button>
        </div>

        {/* Graphic */}
        <div
          ref={graphicRef}
          style={{
            width: 680,
            background: 'linear-gradient(180deg, #05080f 0%, #0a0f1e 100%)',
            fontFamily: "'Arial Black', 'Arial Bold', Arial, sans-serif",
            padding: '28px 24px 20px',
            borderRadius: 12,
          }}
        >
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: '#f59e0b', fontWeight: 900, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>
              {leagueLabel} · {windowLabel}
            </div>
            <div style={{ fontSize: 42, fontWeight: 900, color: '#ffffff', lineHeight: 1, letterSpacing: -1, textTransform: 'uppercase' }}>
              Top 10 Barrel Hitters
            </div>
            <div style={{ fontSize: 13, color: '#f59e0b', fontWeight: 700, letterSpacing: 2, marginTop: 6 }}>
              2026 SEASON
            </div>
          </div>

          {/* Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {top10.map((player, i) => {
              const rank = i + 1;
              const rankColor = getRankColor(rank);
              const bgColor = getTeamBg(player.team);
              const logoUrl = getMLBTeamLogoUrl(player.team);
              const headshotUrl = getHeadshotUrl(player.playerId);

              return (
                <div
                  key={player.playerId ?? i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: `linear-gradient(90deg, ${bgColor} 0%, ${bgColor}cc 60%, ${bgColor}66 100%)`,
                    borderRadius: 8,
                    overflow: 'hidden',
                    height: 72,
                    border: `1px solid ${rankColor}22`,
                  }}
                >
                  {/* Rank */}
                  <div style={{
                    width: 56,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    background: `${rankColor}22`,
                    height: '100%',
                    borderRight: `2px solid ${rankColor}55`,
                  }}>
                    <span style={{ fontSize: 20, fontWeight: 900, color: rankColor }}>
                      #{rank}
                    </span>
                  </div>

                  {/* Headshot */}
                  <div style={{
                    width: 68,
                    height: 72,
                    flexShrink: 0,
                    overflow: 'hidden',
                    position: 'relative',
                  }}>
                    {headshotUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={headshotUrl}
                        alt={player.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
                        crossOrigin="anonymous"
                      />
                    )}
                  </div>

                  {/* Team logo */}
                  <div style={{ width: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                    {logoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logoUrl}
                        alt={player.team}
                        style={{ width: 44, height: 44, objectFit: 'contain' }}
                        crossOrigin="anonymous"
                      />
                    )}
                  </div>

                  {/* Name + team */}
                  <div style={{ flex: 1, padding: '0 8px', minWidth: 0 }}>
                    <div style={{
                      fontSize: 20,
                      fontWeight: 900,
                      color: '#ffffff',
                      textTransform: 'uppercase',
                      lineHeight: 1.15,
                      letterSpacing: 0.5,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {player.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 2 }}>
                      {player.team}
                    </div>
                  </div>

                  {/* Barrels */}
                  <div style={{
                    width: 76,
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: `${rankColor}18`,
                    height: '100%',
                    borderLeft: `2px solid ${rankColor}44`,
                  }}>
                    <span style={{ fontSize: 30, fontWeight: 900, color: rankColor, lineHeight: 1 }}>
                      {player.barrels}
                    </span>
                    <span style={{ fontSize: 9, color: '#9ca3af', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 2 }}>
                      BRLS
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{ marginTop: 14, textAlign: 'center', fontSize: 10, color: '#4b5563', letterSpacing: 1 }}>
            DATA: MLB STATS API · BASEBALL SAVANT
          </div>
        </div>
      </div>
    </div>
  );
}
