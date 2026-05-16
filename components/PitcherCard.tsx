// components/PitcherCard.tsx — Madden-gameplan stripe card
'use client';

import { Pitcher } from '@/types/pitcher';
import Link from 'next/link';

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

interface PitcherCardProps {
  pitcher: Pitcher;
  isSelected?: boolean;
  onSelect?: (playerId: number) => void;
  selectionDisabled?: boolean; // kept for caller compatibility
  showUpdate?: boolean;
}

export default function PitcherCard({
  pitcher,
  isSelected,
  onSelect,
  selectionDisabled = false,
  showUpdate,
}: PitcherCardProps) {
  const stripe = TEAM_STRIPE[pitcher.team ?? ''] || '#ff2d2d';
  const lastName = (pitcher.full_name.split(' ').slice(-1)[0] || pitcher.full_name).toUpperCase();

  return (
    <Link
      href={`/pitcher/${pitcher.player_id || encodeURIComponent(pitcher.full_name)}`}
      className="stripe-card block aspect-[1/1.05] flex-col flex"
      style={{ ['--stripe-color' as any]: stripe }}
    >
      <span className="absolute top-2 left-2.5 z-10 italic font-display font-black text-[18px] text-white/40">®</span>

      {showUpdate && <span className="update-ribbon">Update</span>}

      {onSelect && pitcher.player_id && (
        <span
          className="absolute top-2 right-2 z-10"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!selectionDisabled) onSelect(pitcher.player_id!); }}
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
          {pitcher.team}{pitcher.throws ? ` · ${pitcher.throws}HP` : ''}
        </div>
      </div>

      {/* Bottom band — yellow tick + stats */}
      <div className="bg-[#0d0d0d] border-t border-[#2a2a2a] px-3.5 pt-3.5 pb-4 relative">
        <span className="absolute -top-0.5 left-3.5 w-14 h-[3px] bg-[#ffd200]" />
        <div className="text-[11px] font-bold uppercase tracking-wider text-white leading-snug">
          {pitcher.full_name}&rsquo;s 2026 Daily Card
        </div>
        <div className="mt-2 flex gap-2.5 font-mono text-[11px] font-bold text-neutral-300">
          {pitcher.fastball_velo != null && <span><span className="text-neutral-500 font-normal">FB</span> {pitcher.fastball_velo.toFixed(1)}</span>}
          {pitcher.era != null && <span><span className="text-neutral-500 font-normal">ERA</span> {pitcher.era.toFixed(2)}</span>}
          {pitcher.k_per_9 != null && <span><span className="text-neutral-500 font-normal">K/9</span> {pitcher.k_per_9.toFixed(1)}</span>}
        </div>
      </div>
    </Link>
  );
}
