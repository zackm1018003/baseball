// components/PlayerCard.tsx — Madden-gameplan stripe card
'use client';

import { Player } from '@/types/player';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { useState } from 'react';
import Link from 'next/link';

// Team accent colors for diagonal stripe
const TEAM_STRIPE: Record<string, string> = {
  BOS: '#bd3039', NYY: '#003087', LAD: '#005a9c', TEX: '#003278',
  TOR: '#134a8e', CHC: '#0e3386', NYM: '#ff5910', PHI: '#e81828',
  KCR: '#004687', KC:  '#004687', STL: '#c41e3a', ATL: '#ce1141',
  HOU: '#eb6e1f', SF:  '#fd5a1e', SD:  '#2f241d', SEA: '#0c2c56',
  OAK: '#003831', MIA: '#00a3e0', BAL: '#df4601', WSH: '#ab0003',
  CIN: '#c6011f', CLE: '#0c2340', DET: '#0c2c56', MIN: '#002b5c',
  CWS: '#27251f', PIT: '#fdb827', MIL: '#12284b', AZ:  '#a71930',
  COL: '#33006f', TB:  '#092c5c', LAA: '#ba0021',
};

interface PlayerCardProps {
  player: Player;
  isSelected?: boolean;
  onSelect?: (playerId: number) => void;
  selectionDisabled?: boolean; // kept for caller compatibility
  isAAA?: boolean;             // kept for caller compatibility
  showUpdate?: boolean;
}

export default function PlayerCard({
  player,
  isSelected,
  onSelect,
  selectionDisabled = false,
  showUpdate,
}: PlayerCardProps) {
  const [imgErr, setImgErr] = useState(0);
  const sources = [
    getMLBStaticPlayerImage(player.player_id, { width: 213 }),
    getESPNPlayerImage(player.player_id),
    '/api/placeholder/200/200',
  ];
  const currentImage = sources[imgErr] || sources[sources.length - 1];

  const stripe = TEAM_STRIPE[player.team ?? ''] || '#ff2d2d';
  const lastName = (player.full_name.split(' ').slice(-1)[0] || player.full_name).toUpperCase();

  return (
    <Link
      href={`/player/${player.player_id || encodeURIComponent(player.full_name)}`}
      className="stripe-card block aspect-[1/1.05] flex-col flex"
      style={{ ['--stripe-color' as any]: stripe }}
    >
      {/* "®" mark */}
      <span className="absolute top-2 left-2.5 z-10 italic font-display font-black text-[18px] text-white/40">®</span>

      {/* Update ribbon */}
      {showUpdate && <span className="update-ribbon">Update</span>}

      {/* Selection checkbox */}
      {onSelect && player.player_id && (
        <span
          className="absolute top-2 right-2 z-10"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!selectionDisabled) onSelect(player.player_id!); }}
        >
          <input
            type="checkbox"
            checked={!!isSelected}
            readOnly
            disabled={selectionDisabled}
            className="w-4 h-4 accent-red-500 disabled:opacity-40"
          />
        </span>
      )}

      {/* Card body — big italic uppercase last name */}
      <div className="flex-1 px-4 pt-10 pb-4 flex flex-col justify-end">
        <div
          className="font-display italic font-black text-white uppercase leading-[0.95]"
          style={{ fontSize: 30, textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}
        >
          {lastName.slice(0, 12)}
        </div>
        <div className="font-display italic font-black text-neutral-200 uppercase text-base mt-0.5 tracking-wide">
          {player.team} · {[player.position, player.age ? `Age ${player.age}` : null].filter(Boolean).join(' · ')}
        </div>
      </div>

      {/* Bottom band — yellow tick + stats */}
      <div className="bg-[#0d0d0d] border-t border-[#2a2a2a] px-3.5 pt-3.5 pb-4 relative">
        <span className="absolute -top-0.5 left-3.5 w-14 h-[3px] bg-[#ffd200]" />
        <div className="text-[11px] font-bold uppercase tracking-wider text-white leading-snug">
          {player.full_name}&rsquo;s 2026 Daily Card
        </div>
        <div className="mt-2 flex gap-2.5 font-mono text-[11px] font-bold text-neutral-300">
          {player.hr != null && <span><span className="text-neutral-500 font-normal">HR</span> {player.hr}</span>}
          {(player.avg ?? player.ba) != null && (
            <span>
              <span className="text-neutral-500 font-normal">AVG</span>{' '}
              {typeof player.avg === 'number'
                ? player.avg.toFixed(3)
                : typeof player.ba === 'number'
                  ? player.ba.toFixed(3)
                  : (player.ba ?? '—')}
            </span>
          )}
          {player.avg_ev != null && <span><span className="text-neutral-500 font-normal">EV</span> {player.avg_ev.toFixed(1)}</span>}
          {player.bat_speed != null && player.avg_ev == null && (
            <span><span className="text-neutral-500 font-normal">BS</span> {Number(player.bat_speed).toFixed(1)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
