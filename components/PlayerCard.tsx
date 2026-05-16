// components/PlayerCard.tsx
'use client';

import { Player } from '@/types/player';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getCollegeLogoUrl } from '@/lib/college-logos';
import { fetchMLBPlayer } from '@/lib/mlb-api';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';

interface PlayerCardProps {
  player: Player;
  isSelected?: boolean;
  onSelect?: (playerId: number) => void;
  selectionDisabled?: boolean;
  isAAA?: boolean;
}

export default function PlayerCard({
  player,
  isSelected = false,
  onSelect,
  selectionDisabled = false,
  isAAA = false,
}: PlayerCardProps) {
  const [imageError, setImageError] = useState(0);
  const [currentAge, setCurrentAge] = useState<number | null>(null);

  useEffect(() => {
    if (player.player_id && !player.age) {
      fetchMLBPlayer(player.player_id)
        .then((data) => {
          if (data?.currentAge) setCurrentAge(data.currentAge);
        })
        .catch(() => {});
    }
  }, [player.player_id, player.age]);

  const imageSources = [
    getMLBStaticPlayerImage(player.player_id, { width: 213 }),
    getESPNPlayerImage(player.player_id),
    '/api/placeholder/200/200',
  ];
  const currentImage = imageSources[imageError] || imageSources[imageSources.length - 1];
  const handleImageError = () => {
    if (imageError < imageSources.length - 1) setImageError(imageError + 1);
  };

  return (
    <div className="relative bg-panel border-2 border-ink p-3 transition-colors hover:bg-bone">
      {/* Selection checkbox */}
      {onSelect && player.player_id && (
        <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            disabled={selectionDisabled}
            onChange={() => onSelect(player.player_id!)}
            className="w-5 h-5 cursor-pointer accent-accent disabled:opacity-40 disabled:cursor-not-allowed"
          />
        </div>
      )}

      {/* Daily card link */}
      {player.player_id && (
        <div className="absolute bottom-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
          <Link
            href={`/player/${player.player_id}/daily`}
            className="inline-block px-2 py-0.5 bg-deep text-deep-fg text-[10px] font-bold uppercase tracking-[0.1em] border border-ink hover:bg-accent hover:text-accent-ink"
          >
            Daily
          </Link>
        </div>
      )}

      <Link
        href={`/player/${player.player_id || encodeURIComponent(player.full_name)}`}
        className="block cursor-pointer"
      >
        <div className="flex items-start gap-3">
          {/* Headshot — silo cutout, hard border, NOT circle cropped */}
          <div className="flex-shrink-0 w-[72px] h-[72px] overflow-hidden bg-bone border border-ink relative">
            <Image
              src={currentImage}
              alt={player.full_name || 'Player'}
              fill
              className="object-cover object-top"
              onError={handleImageError}
              unoptimized
            />
          </div>

          {/* Identity */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display text-[20px] leading-none uppercase tracking-[0.02em] text-ink whitespace-nowrap">
                {player.full_name}
              </span>
              {player.team && player.team !== 'FA' && (
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-3">
                  {player.team}
                </span>
              )}
              {player.college && getCollegeLogoUrl(player.college) && (
                <span className="inline-flex items-center gap-1">
                  <img
                    src={getCollegeLogoUrl(player.college)!}
                    alt={player.college}
                    className="w-4 h-4 object-contain"
                  />
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-3">
                    {player.college}
                  </span>
                </span>
              )}
            </div>

            <div className="font-mono text-[10px] text-ink-4 mt-1 tabular-nums">
              {(player.age || currentAge) ? `Age ${player.age || currentAge}` : ''}
              {(player.age || currentAge) && player.player_id ? ' · ' : ''}
              {player.player_id ? `ID ${player.player_id}` : ''}
            </div>

            {/* Stat grid — hairline cells, mono numbers, uppercase tracked labels */}
            <div className="mt-3 border border-ink grid grid-cols-3">
              {(isAAA ? aaaStats(player) : statcastStats(player)).map((s, i, arr) => (
                <div
                  key={s.label}
                  className={`text-center py-1.5 px-2 ${i < arr.length - 1 ? 'border-r border-ink' : ''}`}
                >
                  <div className="label-micro">{s.label}</div>
                  <div className="stat-num mt-0.5">{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}

// ─── Stat row builders ─────────────────────────────────────

function statcastStats(p: Player) {
  return [
    { label: 'Bat Spd', value: p.bat_speed != null ? Number(p.bat_speed).toFixed(1) : '—' },
    { label: 'Avg EV',  value: p.avg_ev != null ? p.avg_ev.toFixed(1) : '—' },
    { label: 'Hard%',   value: p['hard_hit%'] != null ? String(p['hard_hit%']) : '—' },
  ];
}

function aaaStats(p: Player) {
  const ba = p.avg !== undefined ? p.avg
    : typeof p.ba === 'number' ? p.ba
    : typeof p.ba === 'string' ? parseFloat(p.ba)
    : null;
  const obp = typeof p.obp === 'number' ? p.obp
    : typeof p.obp === 'string' ? parseFloat(p.obp)
    : null;
  const slg = typeof p.slg === 'number' ? p.slg
    : typeof p.slg === 'string' ? parseFloat(p.slg)
    : null;
  return [
    { label: 'PA',  value: p.pa ?? '—' },
    { label: 'BA',  value: ba != null && !isNaN(ba)   ? ba.toFixed(3)  : '—' },
    { label: 'OBP', value: obp != null && !isNaN(obp) ? obp.toFixed(3) : '—' },
    { label: 'SLG', value: slg != null && !isNaN(slg) ? slg.toFixed(3) : '—' },
    { label: 'HR',  value: p.hr ?? '—' },
    { label: 'AB',  value: p.ab ?? '—' },
  ];
}
