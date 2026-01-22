'use client';

import { use, useState } from 'react';
import { getPlayerById, getAllPlayers } from '@/lib/database';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import {
  calculatePlayerPercentiles,
  getPercentileColor,
  getPercentileBgColor,
  formatPercentile,
  getPercentileLabel,
} from '@/lib/percentiles';
import Image from 'next/image';
import Link from 'next/link';

interface PlayerPageProps {
  params: Promise<{ id: string }>;
}

interface StatItem {
  label: string;
  value: string | number | null | undefined;
  statKey: string;
}

export default function PlayerPage({ params }: PlayerPageProps) {
  const { id } = use(params);
  const player = getPlayerById(parseInt(id));
  const [imageError, setImageError] = useState(0);

  if (!player) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="container mx-auto px-4">
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">Player Not Found</h1>
            <Link href="/" className="text-blue-600 hover:text-blue-800">
              Return to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Calculate percentiles for all stats
  const allPlayers = getAllPlayers();
  const percentiles = calculatePlayerPercentiles(player, allPlayers);

  const statSections: { title: string; stats: StatItem[] }[] = [
    {
      title: 'Swing Mechanics',
      stats: [
        { label: 'Bat Speed', value: player.bat_speed, statKey: 'bat_speed' },
        { label: 'Fast Swing %', value: player['fast_swing_%'], statKey: 'fast_swing_%' },
        { label: 'Swing Length', value: player.swing_length, statKey: 'swing_length' },
        { label: 'Attack Angle', value: player.attack_angle, statKey: 'attack_angle' },
        { label: 'Attack Direction', value: player.attack_direction, statKey: 'attack_direction' },
        { label: 'Swing Tilt', value: player.swing_tilt, statKey: 'swing_tilt' },
      ],
    },
    {
      title: 'Contact Quality',
      stats: [
        { label: 'Average Exit Velocity', value: player.avg_ev?.toFixed(1), statKey: 'avg_ev' },
        { label: 'Average Launch Angle', value: player.avg_la?.toFixed(1), statKey: 'avg_la' },
        { label: 'Barrel %', value: player['barrel_%'], statKey: 'barrel_%' },
        { label: 'Hard Hit %', value: player['hard_hit%'], statKey: 'hard_hit%' },
        { label: 'EV50', value: player.ev50?.toFixed(2), statKey: 'ev50' },
        { label: 'Ideal Angle %', value: player['ideal_angle_%'], statKey: 'ideal_angle_%' },
      ],
    },
    {
      title: 'Plate Discipline',
      stats: [
        { label: 'Z-Swing %', value: player['z-swing%'], statKey: 'z-swing%' },
        { label: 'Z-Whiff %', value: player['z-whiff%'], statKey: 'z-whiff%' },
        { label: 'Chase %', value: player['chase%'], statKey: 'chase%' },
        { label: 'O-Whiff %', value: player['o-whiff%'], statKey: 'o-whiff%' },
      ],
    },
    {
      title: 'Batted Ball Profile',
      stats: [
        { label: 'Pull Air %', value: player['pull_air%'], statKey: 'pull_air%' },
      ],
    },
  ];

  // Image sources in order of preference: MLB Static -> ESPN -> Placeholder
  const imageSources = [
    getMLBStaticPlayerImage(player.player_id, { width: 500 }),
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-8">
      <div className="container mx-auto px-4 max-w-6xl">
        <Link
          href="/"
          className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-6"
        >
          ← Back to All Players
        </Link>

        {/* Player Header */}
        <div className="bg-white rounded-lg shadow-lg p-8 mb-6">
          <div className="flex items-center gap-6">
            <div className="relative w-32 h-32 rounded-full overflow-hidden bg-gray-100 flex-shrink-0">
              <Image
                src={currentImage}
                alt={player.full_name || 'Player'}
                fill
                className="object-cover"
                onError={handleImageError}
                unoptimized
              />
            </div>

            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">
                {player.full_name}
              </h1>
              <div className="flex gap-4 text-lg text-gray-600">
                <span>Age: {player.age}</span>
                {player.team && (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                    {player.team}
                  </span>
                )}
                <span>Player ID: {player.player_id}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="bg-white rounded-lg shadow-md p-4 mb-6">
          <div className="flex items-center gap-6 flex-wrap text-sm">
            <span className="font-semibold text-gray-700">Percentile Guide:</span>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 rounded bg-green-100 text-green-600 font-semibold">Elite (90+)</span>
              <span className="px-2 py-1 rounded bg-green-50 text-green-500">Great (75-89)</span>
              <span className="px-2 py-1 rounded bg-blue-50 text-blue-500">Above Avg (50-74)</span>
              <span className="px-2 py-1 rounded bg-orange-50 text-orange-500">Below Avg (25-49)</span>
              <span className="px-2 py-1 rounded bg-red-50 text-red-500">Poor (0-24)</span>
            </div>
          </div>
        </div>

        {/* Stats Sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {statSections.map((section) => (
            <div
              key={section.title}
              className="bg-white rounded-lg shadow-md p-6"
            >
              <h2 className="text-xl font-bold text-gray-900 mb-4 border-b pb-2">
                {section.title}
              </h2>
              <div className="space-y-3">
                {section.stats.map((stat) => {
                  const percentile = percentiles[stat.statKey];
                  return (
                    <div
                      key={stat.label}
                      className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0"
                    >
                      <span className="text-gray-600 flex-1">{stat.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-gray-900 w-16 text-right">
                          {stat.value ?? 'N/A'}
                        </span>
                        {percentile !== null && (
                          <span
                            className={`px-2 py-1 rounded text-xs font-semibold min-w-[80px] text-center ${getPercentileBgColor(
                              percentile
                            )} ${getPercentileColor(percentile)}`}
                          >
                            {formatPercentile(percentile)} • {getPercentileLabel(percentile)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
