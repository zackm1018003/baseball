// components/PitcherCard.tsx
'use client';

import { Pitcher } from '@/types/pitcher';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getCollegeLogoUrl } from '@/lib/college-logos';
import { fetchMLBPlayer } from '@/lib/mlb-api';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';

interface PitcherCardProps {
  pitcher: Pitcher;
  isSelected?: boolean;
  onSelect?: (playerId: number) => void;
  selectionDisabled?: boolean;
}

export default function PitcherCard({
  pitcher,
  isSelected = false,
  onSelect,
  selectionDisabled = false,
}: PitcherCardProps) {
  const [imageError, setImageError] = useState(0);
  const [currentAge, setCurrentAge] = useState<number | null>(null);

  useEffect(() => {
    if (pitcher.player_id && !pitcher.age) {
      fetchMLBPlayer(pitcher.player_id)
        .then((data) => {
          if (data?.currentAge) setCurrentAge(data.currentAge);
        })
        .catch(() => {});
    }
  }, [pitcher.player_id, pitcher.age]);

  const imageSources = [
    getMLBStaticPlayerImage(pitcher.player_id, { width: 213 }),
    getESPNPlayerImage(pitcher.player_id),
    '/api/placeholder/200/200',
  ];
  const currentImage = imageSources[imageError] || imageSources[imageSources.length - 1];
  const handleImageError = () => {
    if (imageError < imageSources.length - 1) setImageError(imageError + 1);
  };

  return (
    <div className="relative bg-panel border-2 border-ink p-3 transition-colors hover:bg-bone">
      {onSelect && pitcher.player_id && (
        <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            disabled={selectionDisabled}
            onChange={() => onSelect(pitcher.player_id!)}
            className="w-5 h-5 cursor-pointer accent-accent disabled:opacity-40"
          />
        </div>
      )}

      <Link
        href={`/pitcher/${pitcher.player_id || encodeURIComponent(pitcher.full_name)}`}
        className="block cursor-pointer"
      >
        <div className="flex items-start gap-3">
          {/* Headshot — silo cutout, hard border, NOT circle cropped */}
          <div className="flex-shrink-0 w-[72px] h-[72px] overflow-hidden bg-bone border border-ink relative">
            <Image
              src={currentImage}
              alt={pitcher.full_name || 'Pitcher'}
              fill
              className="object-cover object-top"
              onError={handleImageError}
              unoptimized
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display text-[20px] leading-none uppercase tracking-[0.02em] text-ink whitespace-nowrap">
                {pitcher.full_name}
              </span>
              {pitcher.team && pitcher.team !== 'FA' && (
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-3">
                  {pitcher.team}
                </span>
              )}
              {pitcher.throws && (
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-3">
                  {pitcher.throws}HP
                </span>
              )}
              {pitcher.college && getCollegeLogoUrl(pitcher.college) && (
                <span className="inline-flex items-center gap-1">
                  <img
                    src={getCollegeLogoUrl(pitcher.college)!}
                    alt={pitcher.college}
                    className="w-4 h-4 object-contain"
                  />
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-3">
                    {pitcher.college}
                  </span>
                </span>
              )}
            </div>

            <div className="font-mono text-[10px] text-ink-4 mt-1 tabular-nums">
              {(pitcher.age || currentAge) ? `Age ${pitcher.age || currentAge}` : ''}
              {(pitcher.age || currentAge) && pitcher.player_id ? ' · ' : ''}
              {pitcher.player_id ? `ID ${pitcher.player_id}` : ''}
            </div>

            {/* Velo row */}
            <div className="mt-2 border border-ink grid grid-cols-3">
              <div className="text-center py-1.5 px-2 border-r border-ink">
                <div className="label-micro">FB Velo</div>
                <div className="stat-num mt-0.5">{pitcher.fastball_velo?.toFixed(1) ?? '—'}</div>
              </div>
              <div className="text-center py-1.5 px-2 border-r border-ink">
                <div className="label-micro">SL Velo</div>
                <div className="stat-num mt-0.5">{pitcher.slider_velo?.toFixed(1) ?? '—'}</div>
              </div>
              <div className="text-center py-1.5 px-2">
                <div className="label-micro">CH Velo</div>
                <div className="stat-num mt-0.5">{pitcher.changeup_velo?.toFixed(1) ?? '—'}</div>
              </div>
            </div>

            {/* Spin row */}
            <div className="border-x border-b border-ink grid grid-cols-3">
              <div className="text-center py-1.5 px-2 border-r border-ink">
                <div className="label-micro">FB Spin</div>
                <div className="stat-num mt-0.5">{pitcher.fastball_spin ?? '—'}</div>
              </div>
              <div className="text-center py-1.5 px-2 border-r border-ink">
                <div className="label-micro">SL Spin</div>
                <div className="stat-num mt-0.5">{pitcher.slider_spin ?? '—'}</div>
              </div>
              <div className="text-center py-1.5 px-2">
                <div className="label-micro">CH Spin</div>
                <div className="stat-num mt-0.5">{pitcher.changeup_spin ?? '—'}</div>
              </div>
            </div>

            {/* Traditional row */}
            <div className="border-x border-b border-ink grid grid-cols-4">
              <div className="text-center py-1.5 px-2 border-r border-ink">
                <div className="label-micro">ERA</div>
                <div className="stat-num mt-0.5">{pitcher.era?.toFixed(2) ?? '—'}</div>
              </div>
              <div className="text-center py-1.5 px-2 border-r border-ink">
                <div className="label-micro">WHIP</div>
                <div className="stat-num mt-0.5">{pitcher.whip?.toFixed(2) ?? '—'}</div>
              </div>
              <div className="text-center py-1.5 px-2 border-r border-ink">
                <div className="label-micro">K/9</div>
                <div className="stat-num mt-0.5">{pitcher.k_per_9?.toFixed(1) ?? '—'}</div>
              </div>
              <div className="text-center py-1.5 px-2">
                <div className="label-micro">IP</div>
                <div className="stat-num mt-0.5">{pitcher.ip?.toFixed(1) ?? '—'}</div>
              </div>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}
