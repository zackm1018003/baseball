'use client';

import { Player } from '@/types/player';
import { getESPNPlayerImage, getESPNTeamLogo, PLAYER_IMAGE_FALLBACK } from '@/lib/espn';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

interface PlayerCardProps {
  player: Player;
}

export default function PlayerCard({ player }: PlayerCardProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <Link href={`/player/${player.player_id}`}>
      <div className="bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow p-4 cursor-pointer border border-gray-200">
        <div className="flex items-start gap-4">
          {/* Player Image */}
          <div className="flex-shrink-0">
            <div className="relative w-20 h-20 rounded-full overflow-hidden bg-gray-100">
              <Image
                src={imageError ? PLAYER_IMAGE_FALLBACK : getESPNPlayerImage(player.player_id)}
                alt={player.full_name || 'Player'}
                fill
                className="object-cover"
                onError={() => setImageError(true)}
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
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
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
