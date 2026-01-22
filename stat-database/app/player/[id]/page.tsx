'use client';

import { use, useState } from 'react';
import { getPlayerById } from '@/lib/database';
import { getESPNPlayerImage, PLAYER_IMAGE_FALLBACK } from '@/lib/espn';
import Image from 'next/image';
import Link from 'next/link';

interface PlayerPageProps {
  params: Promise<{ id: string }>;
}

export default function PlayerPage({ params }: PlayerPageProps) {
  const { id } = use(params);
  const player = getPlayerById(parseInt(id));
  const [imageError, setImageError] = useState(false);

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

  const statSections = [
    {
      title: 'Swing Mechanics',
      stats: [
        { label: 'Bat Speed', value: player.bat_speed },
        { label: 'Fast Swing %', value: player['fast_swing_%'] },
        { label: 'Swing Length', value: player.swing_length },
        { label: 'Attack Angle', value: player.attack_angle },
        { label: 'Attack Direction', value: player.attack_direction },
        { label: 'Swing Tilt', value: player.swing_tilt },
      ],
    },
    {
      title: 'Contact Quality',
      stats: [
        { label: 'Average Exit Velocity', value: player.avg_ev?.toFixed(1) },
        { label: 'Average Launch Angle', value: player.avg_la?.toFixed(1) },
        { label: 'Barrel %', value: player['barrel_%'] },
        { label: 'Hard Hit %', value: player['hard_hit%'] },
        { label: 'EV50', value: player.ev50?.toFixed(2) },
        { label: 'Ideal Angle %', value: player['ideal_angle_%'] },
      ],
    },
    {
      title: 'Plate Discipline',
      stats: [
        { label: 'Z-Swing %', value: player['z-swing%'] },
        { label: 'Z-Whiff %', value: player['z-whiff%'] },
        { label: 'Chase %', value: player['chase%'] },
        { label: 'O-Whiff %', value: player['o-whiff%'] },
      ],
    },
    {
      title: 'Batted Ball Profile',
      stats: [
        { label: 'Pull Air %', value: player['pull_air%'] },
      ],
    },
  ];

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
                src={imageError ? PLAYER_IMAGE_FALLBACK : getESPNPlayerImage(player.player_id)}
                alt={player.full_name || 'Player'}
                fill
                className="object-cover"
                onError={() => setImageError(true)}
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
                {section.stats.map((stat) => (
                  <div
                    key={stat.label}
                    className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0"
                  >
                    <span className="text-gray-600">{stat.label}</span>
                    <span className="font-semibold text-gray-900">
                      {stat.value ?? 'N/A'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
