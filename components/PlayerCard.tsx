'use client';

import { Player } from '@/types/player';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

interface PlayerCardProps {
  player: Player;
}

export default function PlayerCard({ player }: PlayerCardProps) {
  const [imageError, setImageError] = useState(0);

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
    <Link href={`/player/${player.player_id}`}>
      <div className="bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow p-4 cursor-pointer border border-gray-200">
        <div className="flex items-start gap-4">
          {/* Player Image */}
          <div className="flex-shrink-0">
            <div className="relative w-20 h-20 rounded-full overflow-hidden bg-gray-100">
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
              <h3 className="text-lg font-bold text-gray-900 truncate">
                {player.full_name}
              </h3>
              {player.team && player.team !== 'FA' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                  {player.team}
                </span>
              )}
            </div>

            <div className="text-sm text-gray-600 mb-2">
              Age: {player.age} • ID: {player.player_id}
            </div>

            {/* Key Stats */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-gray-500">Bat Speed</div>
                <div className="font-semibold text-gray-900">{player.bat_speed}</div>
              </div>
              <div>
                <div className="text-gray-500">AVG EV</div>
                <div className="font-semibold text-gray-900">{player.avg_ev?.toFixed(1)}</div>
              </div>
              <div>
                <div className="text-gray-500">Hard Hit%</div>
                <div className="font-semibold text-gray-900">{player['hard_hit%']}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
