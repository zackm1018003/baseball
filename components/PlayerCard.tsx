'use client';

import { Player } from '@/types/player';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
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

export default function PlayerCard({ player, isSelected = false, onSelect, selectionDisabled = false, isAAA = false }: PlayerCardProps) {
  const [imageError, setImageError] = useState(0);
  const [currentAge, setCurrentAge] = useState<number | null>(null);

  // Fetch age from MLB API if player has ID but no age in dataset
  useEffect(() => {
    if (player.player_id && !player.age) {
      fetchMLBPlayer(player.player_id).then((data) => {
        if (data?.currentAge) {
          setCurrentAge(data.currentAge);
        }
      }).catch(() => {
        // Silently fail if API call doesn't work
      });
    }
  }, [player.player_id, player.age]);

  // Image sources in order of preference: MLB Static -> ESPN -> Placeholder
  const imageSources = [
    getMLBStaticPlayerImage(player.player_id, { width: 213 }),
    getESPNPlayerImage(player.player_id),
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
      {onSelect && player.player_id && (
        <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            disabled={selectionDisabled}
            onChange={() => onSelect(player.player_id!)}
            className="w-5 h-5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
      )}

      <Link href={`/player/${player.player_id || encodeURIComponent(player.full_name)}`}>
        <div className="cursor-pointer">
          <div className="flex items-start gap-4">
          {/* Player Image */}
          <div className="flex-shrink-0">
            <div className="relative w-20 h-20 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
              <Image
                src={currentImage}
                alt={player.full_name || 'Player'}
                fill
                className="object-cover"
                onError={handleImageError}
                unoptimized
              />
            </div>
          </div>

          {/* Player Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate">
                {player.full_name}
              </h3>
              {player.team && player.team !== 'FA' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                  {player.team}
                </span>
              )}
            </div>

            <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              {player.college ? (
                // NCAA player info
                <>
                  {player.position && <span>{player.position} • </span>}
                  {player.college}
                  {(player.age) && ` • Age: ${player.age}`}
                  {(player.bats || player.throws || player['h/w']) && (
                    <div className="text-xs mt-0.5">
                      {player.bats && <span>B: {player.bats}</span>}
                      {player.bats && player.throws && ' / '}
                      {player.throws && <span>T: {player.throws}</span>}
                      {(player.bats || player.throws) && player['h/w'] && ' • '}
                      {player['h/w'] && <span>{player['h/w']}</span>}
                    </div>
                  )}
                </>
              ) : (
                // MLB/MiLB player info
                <>
                  {(player.age || currentAge) ? `Age: ${player.age || currentAge}` : ''}{(player.age || currentAge) && player.player_id && ' • '}{player.player_id && `ID: ${player.player_id}`}
                </>
              )}
            </div>

            {/* Key Stats */}
            {isAAA ? (
              <div className="grid grid-cols-6 gap-2 text-xs">
                <div>
                  <div className="text-gray-500 dark:text-gray-400">PA</div>
                  <div className="font-semibold text-gray-900 dark:text-white">{player.pa || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">AB</div>
                  <div className="font-semibold text-gray-900 dark:text-white">{player.ab || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">BA</div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {(() => {
                      const baValue = player.avg !== undefined ? player.avg : (typeof player.ba === 'number' ? player.ba : (typeof player.ba === 'string' ? parseFloat(player.ba) : null));
                      return baValue !== null && !isNaN(baValue) ? baValue.toFixed(3) : 'N/A';
                    })()}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">OBP</div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {(() => {
                      const obpValue = typeof player.obp === 'number' ? player.obp : (typeof player.obp === 'string' ? parseFloat(player.obp) : null);
                      return obpValue !== null && !isNaN(obpValue) ? obpValue.toFixed(3) : 'N/A';
                    })()}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">SLG</div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {(() => {
                      const slgValue = typeof player.slg === 'number' ? player.slg : (typeof player.slg === 'string' ? parseFloat(player.slg) : null);
                      return slgValue !== null && !isNaN(slgValue) ? slgValue.toFixed(3) : 'N/A';
                    })()}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">HR</div>
                  <div className="font-semibold text-gray-900 dark:text-white">{player.hr ?? 'N/A'}</div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-gray-500 dark:text-gray-400">Bat Speed</div>
                  <div className="font-semibold text-gray-900 dark:text-white">{player.bat_speed}</div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">AVG EV</div>
                  <div className="font-semibold text-gray-900 dark:text-white">{player.avg_ev?.toFixed(1)}</div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">Hard Hit%</div>
                  <div className="font-semibold text-gray-900 dark:text-white">{player['hard_hit%']}</div>
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
      </Link>
    </div>
  );
}
