'use client';

import { Pitcher } from '@/types/pitcher';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getCollegeLogoUrl } from '@/lib/college-logos';
import { fetchMLBPlayer } from '@/lib/mlb-api';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';

// Pitch colors matching TJStats style
const PITCH_COLORS: Record<string, string> = {
  ff: '#D22D49', si: '#C75B12', fc: '#933F2C', ch: '#3BBB38',
  fs: '#1A8B6E', cu: '#00D1ED', kc: '#6236CD', sl: '#EFE514',
  st: '#E66B22', sv: '#3B44CE',
};
const PITCH_LABELS: Record<string, string> = {
  ff: 'FF', si: 'SI', fc: 'FC', ch: 'CH', fs: 'FS',
  cu: 'CU', kc: 'KC', sl: 'SL', st: 'ST', sv: 'SV',
};
const PITCH_KEYS = ['ff', 'si', 'fc', 'ch', 'fs', 'cu', 'kc', 'sl', 'st', 'sv'];

interface PitcherCardProps {
  pitcher: Pitcher;
  isSelected?: boolean;
  onSelect?: (playerId: number) => void;
  selectionDisabled?: boolean;
}

export default function PitcherCard({ pitcher, isSelected = false, onSelect, selectionDisabled = false }: PitcherCardProps) {
  const [imageError, setImageError] = useState(0);
  const [currentAge, setCurrentAge] = useState<number | null>(null);

  // Fetch age from MLB API if pitcher has ID but no age in dataset
  useEffect(() => {
    if (pitcher.player_id && !pitcher.age) {
      fetchMLBPlayer(pitcher.player_id).then((data) => {
        if (data?.currentAge) {
          setCurrentAge(data.currentAge);
        }
      }).catch(() => {
        // Silently fail if API call doesn't work
      });
    }
  }, [pitcher.player_id, pitcher.age]);

  // Image sources in order of preference: MLB Static -> ESPN -> Placeholder
  const imageSources = [
    getMLBStaticPlayerImage(pitcher.player_id, { width: 213 }),
    getESPNPlayerImage(pitcher.player_id),
    '/api/placeholder/200/200',
  ];

  const currentImage = imageSources[imageError] || imageSources[imageSources.length - 1];

  const handleImageError = () => {
    if (imageError < imageSources.length - 1) {
      setImageError(imageError + 1);
    }
  };

  return (
    <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-xl transition-shadow p-4 border border-gray-200 dark:border-gray-700">
      {/* Selection Checkbox */}
      {onSelect && pitcher.player_id && (
        <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            disabled={selectionDisabled}
            onChange={() => onSelect(pitcher.player_id!)}
            className="w-5 h-5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
      )}

      <Link href={`/pitcher/${pitcher.player_id || encodeURIComponent(pitcher.full_name)}`}>
        <div className="cursor-pointer">
          <div className="flex items-start gap-4">
          {/* Pitcher Image */}
          <div className="flex-shrink-0">
            <div className="relative w-20 h-20 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
              <Image
                src={currentImage}
                alt={pitcher.full_name || 'Pitcher'}
                fill
                className="object-cover"
                onError={handleImageError}
                unoptimized
              />
            </div>
          </div>

          {/* Pitcher Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate">
                {pitcher.full_name}
              </h3>
              {pitcher.team && pitcher.team !== 'FA' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                  {pitcher.team}
                </span>
              )}
              {pitcher.college && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200">
                  {getCollegeLogoUrl(pitcher.college) && (
                    <img
                      src={getCollegeLogoUrl(pitcher.college)!}
                      alt={pitcher.college}
                      className="w-4 h-4 object-contain"
                    />
                  )}
                  {pitcher.college}
                </span>
              )}
              {pitcher.throws && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                  {pitcher.throws}HP
                </span>
              )}
            </div>

            <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              {(pitcher.age || currentAge) ? `Age: ${pitcher.age || currentAge}` : ''}{(pitcher.age || currentAge) && pitcher.player_id && ' • '}{pitcher.player_id && `ID: ${pitcher.player_id}`}
            </div>

            {/* Pitch Metrics Grid */}
            <div className="space-y-2">
              {/* Velocity */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-gray-500 dark:text-gray-400">FB Velo</div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {pitcher.fastball_velo ? `${pitcher.fastball_velo.toFixed(1)} mph` : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">SL Velo</div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {pitcher.slider_velo ? `${pitcher.slider_velo.toFixed(1)} mph` : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">CH Velo</div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {pitcher.changeup_velo ? `${pitcher.changeup_velo.toFixed(1)} mph` : 'N/A'}
                  </div>
                </div>
              </div>

              {/* Spin Rate */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-gray-500 dark:text-gray-400">FB Spin</div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {pitcher.fastball_spin ? `${pitcher.fastball_spin} rpm` : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">SL Spin</div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {pitcher.slider_spin ? `${pitcher.slider_spin} rpm` : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">CH Spin</div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {pitcher.changeup_spin ? `${pitcher.changeup_spin} rpm` : 'N/A'}
                  </div>
                </div>
              </div>

              {/* Traditional Stats */}
              <div className="grid grid-cols-4 gap-2 text-xs pt-1 border-t border-gray-200 dark:border-gray-700">
                <div>
                  <div className="text-gray-500 dark:text-gray-400">ERA</div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {pitcher.era ? pitcher.era.toFixed(2) : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">WHIP</div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {pitcher.whip ? pitcher.whip.toFixed(2) : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">K/9</div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {pitcher.k_per_9 ? pitcher.k_per_9.toFixed(1) : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">IP</div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {pitcher.ip ? pitcher.ip.toFixed(1) : 'N/A'}
                  </div>
                </div>
              </div>
            </div>

            {/* Mini Pitch Movement Chart */}
            <MiniMovementChart pitcher={pitcher} />
          </div>
        </div>
        </div>
      </Link>
    </div>
  );
}

/** Compact pitch movement scatter chart for the card */
function MiniMovementChart({ pitcher }: { pitcher: Pitcher }) {
  const p = pitcher as unknown as Record<string, any>;
  const pitchData: { key: string; hb: number; ivb: number; usage: number; color: string }[] = [];

  for (const key of PITCH_KEYS) {
    const data = p[key];
    if (!data || !data.usage || data.usage <= 0) continue;
    if (data.movement_h == null || data.movement_v == null) continue;
    pitchData.push({
      key,
      hb: data.movement_h,
      ivb: data.movement_v,
      usage: data.usage,
      color: PITCH_COLORS[key] || '#888',
    });
  }

  if (pitchData.length === 0) return null;

  const size = 140;
  const center = size / 2;
  const maxInches = 22;
  const scale = (center - 12) / maxInches;

  return (
    <div className="flex justify-center pt-1">
      <svg width={size} height={size} className="bg-gray-100 dark:bg-gray-700 rounded-md">
        {/* Crosshairs */}
        <line x1={center} y1={8} x2={center} y2={size - 8} stroke="#d1d5db" strokeWidth="0.5" className="dark:stroke-gray-600" />
        <line x1={8} y1={center} x2={size - 8} y2={center} stroke="#d1d5db" strokeWidth="0.5" className="dark:stroke-gray-600" />

        {/* Concentric guides */}
        {[10, 20].map(inches => (
          <circle key={inches} cx={center} cy={center} r={inches * scale}
            fill="none" stroke="#d1d5db" strokeWidth="0.3" strokeDasharray="2,2" className="dark:stroke-gray-600" />
        ))}

        {/* Pitch dots with labels */}
        {pitchData.sort((a, b) => b.usage - a.usage).map(pd => {
          const x = center + pd.hb * scale;
          const y = center - pd.ivb * scale;
          const r = Math.max(8, Math.min(14, 6 + pd.usage * 0.2));
          return (
            <g key={pd.key}>
              <circle cx={x} cy={y} r={r} fill={pd.color} opacity="0.85" />
              <text x={x} y={y + 3} textAnchor="middle" fontSize="7" fontWeight="bold"
                fill={['sl', 'cu'].includes(pd.key) ? '#333' : '#fff'}>
                {PITCH_LABELS[pd.key]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
