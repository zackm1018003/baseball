'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { getMLBStaticPlayerImage, getESPNPlayerImage, getPlaceholderImage } from '@/lib/mlb-images';
import { fetchMLBPlayer } from '@/lib/mlb-api';

interface MLBPlayer {
  id: number;
  fullName: string;
  primaryPosition?: {
    abbreviation: string;
  };
  currentTeam?: {
    name: string;
    id: number;
  };
  batSide?: {
    code: string;
    description: string;
  };
  pitchHand?: {
    code: string;
    description: string;
  };
  height?: string;
  weight?: number;
  birthDate?: string;
  birthCity?: string;
  birthCountry?: string;
}

interface MLBPlayerCardProps {
  playerId: number;
  showDetails?: boolean;
}

export default function MLBPlayerCard({ playerId, showDetails = false }: MLBPlayerCardProps) {
  const [player, setPlayer] = useState<MLBPlayer | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [imageSrc, setImageSrc] = useState(getMLBStaticPlayerImage(playerId));

  useEffect(() => {
    async function loadPlayer() {
      setLoading(true);
      const data = await fetchMLBPlayer(playerId);
      setPlayer(data);
      setLoading(false);
    }

    loadPlayer();
  }, [playerId]);

  const handleImageError = () => {
    if (!imageError) {
      // Try ESPN as fallback
      setImageSrc(getESPNPlayerImage(playerId));
      setImageError(true);
    } else {
      // Final fallback to placeholder
      setImageSrc(getPlaceholderImage());
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-4 animate-pulse">
        <div className="flex items-start gap-4">
          <div className="w-20 h-20 bg-gray-200 rounded-full"></div>
          <div className="flex-1">
            <div className="h-6 bg-gray-200 rounded w-3/4 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="bg-white rounded-lg shadow-md p-4">
        <p className="text-gray-500">Player not found</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow p-4 cursor-pointer border border-gray-200">
      <div className="flex items-start gap-4">
        {/* Player Image */}
        <div className="flex-shrink-0">
          <div className="relative w-20 h-20 rounded-full overflow-hidden bg-gray-100">
            <Image
              src={imageSrc}
              alt={player.fullName}
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
              {player.fullName}
            </h3>
            {player.currentTeam && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                {player.currentTeam.name}
              </span>
            )}
          </div>

          <div className="text-sm text-gray-600 mb-2">
            {player.primaryPosition?.abbreviation && (
              <span>{player.primaryPosition.abbreviation} • </span>
            )}
            {player.batSide && <span>Bats: {player.batSide.code} • </span>}
            {player.pitchHand && <span>Throws: {player.pitchHand.code}</span>}
          </div>

          {showDetails && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              {player.height && (
                <div>
                  <div className="text-gray-500">Height</div>
                  <div className="font-semibold text-gray-900">{player.height}</div>
                </div>
              )}
              {player.weight && (
                <div>
                  <div className="text-gray-500">Weight</div>
                  <div className="font-semibold text-gray-900">{player.weight} lbs</div>
                </div>
              )}
              {player.birthCity && (
                <div className="col-span-2">
                  <div className="text-gray-500">Birthplace</div>
                  <div className="font-semibold text-gray-900">
                    {player.birthCity}, {player.birthCountry}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
