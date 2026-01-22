'use client';

import { use, useState, useEffect } from 'react';
import { getPlayerById, getAllPlayers } from '@/lib/database';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { fetchMLBPlayer, fetchMLBPlayerStats } from '@/lib/mlb-api';
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

interface MLBPlayerData {
  height?: string;
  weight?: number;
  batSide?: {
    code: string;
    description: string;
  };
  pitchHand?: {
    code: string;
    description: string;
  };
  birthCountry?: string;
}

interface BattingStats {
  atBats?: number;
  plateAppearances?: number;
  avg?: string;
  obp?: string;
  slg?: string;
  homeRuns?: number;
  stolenBases?: number;
}

export default function PlayerPage({ params }: PlayerPageProps) {
  const { id } = use(params);
  const player = getPlayerById(parseInt(id));
  const [imageError, setImageError] = useState(0);
  const [mlbData, setMlbData] = useState<MLBPlayerData | null>(null);
  const [battingStats, setBattingStats] = useState<BattingStats | null>(null);

  // Fetch MLB API data for height, weight, handedness, and 2025 batting stats
  useEffect(() => {
    if (player?.player_id) {
      // Fetch player bio data
      fetchMLBPlayer(player.player_id).then((data) => {
        if (data) {
          setMlbData(data);
        }
      });

      // Fetch 2025 batting stats
      fetchMLBPlayerStats(player.player_id, 2025, 'hitting').then((stats) => {
        if (stats && stats.length > 0) {
          // Find the season stats split
          const seasonStats = stats.find((s: any) => s.type?.displayName === 'season');
          if (seasonStats?.splits && seasonStats.splits.length > 0) {
            const stat = seasonStats.splits[0].stat;
            setBattingStats({
              atBats: stat.atBats,
              plateAppearances: stat.plateAppearances,
              avg: stat.avg,
              obp: stat.obp,
              slg: stat.slg,
              homeRuns: stat.homeRuns,
              stolenBases: stat.stolenBases,
            });
          }
        }
      });
    }
  }, [player?.player_id]);

  if (!player) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
        <div className="container mx-auto px-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Player Not Found</h1>
            <Link href="/" className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">
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
        { label: 'Max Exit Velocity', value: player.max_ev?.toFixed(1), statKey: 'max_ev' },
        { label: 'Barrel %', value: player['barrel_%'], statKey: 'barrel_%' },
        { label: 'Hard Hit %', value: player['hard_hit%'], statKey: 'hard_hit%' },
        { label: 'EV50', value: player.ev50?.toFixed(2), statKey: 'ev50' },
      ],
    },
    {
      title: 'Plate Discipline',
      stats: [
        { label: 'BB %', value: player['bb%'], statKey: 'bb%' },
        { label: 'K %', value: player['k%'], statKey: 'k%' },
        { label: 'Z-Swing %', value: player['z-swing%'], statKey: 'z-swing%' },
        { label: 'Z-Whiff %', value: player['z-whiff%'], statKey: 'z-whiff%' },
        { label: 'Chase %', value: player['chase%'], statKey: 'chase%' },
        { label: 'O-Whiff %', value: player['o-whiff%'], statKey: 'o-whiff%' },
      ],
    },
    {
      title: 'Batted Ball Profile',
      stats: [
        { label: 'Average Launch Angle', value: player.avg_la?.toFixed(1), statKey: 'avg_la' },
        { label: 'Ideal Angle %', value: player['ideal_angle_%'], statKey: 'ideal_angle_%' },
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-3">
      <div className="container mx-auto px-4 max-w-5xl">
        <div className="flex items-center justify-between mb-3">
          <Link
            href="/"
            className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm"
          >
            ← Back to All Players
          </Link>
          <div className="text-sm text-gray-500 dark:text-gray-400 italic">
            By: Zack McKeown
          </div>
        </div>

        {/* Combined Header with Legend */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 mb-3">
          <div className="flex items-start gap-4 mb-3">
            <div className="relative w-24 h-24 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700 flex-shrink-0">
              <Image
                src={currentImage}
                alt={player.full_name || 'Player'}
                fill
                className="object-cover"
                onError={handleImageError}
                unoptimized
              />
            </div>

            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
                {player.full_name}
              </h1>
              <div className="flex gap-2 text-xs text-gray-600 dark:text-gray-400 flex-wrap items-center">
                <span>Age: {player.age}</span>
                {mlbData?.height && (
                  <>
                    <span>•</span>
                    <span>{mlbData.height}</span>
                  </>
                )}
                {mlbData?.weight && (
                  <>
                    <span>•</span>
                    <span>{mlbData.weight} lbs</span>
                  </>
                )}
                {mlbData?.batSide && (
                  <>
                    <span>•</span>
                    <span>Bats: {mlbData.batSide.code}</span>
                  </>
                )}
                {mlbData?.pitchHand && (
                  <>
                    <span>•</span>
                    <span>Throws: {mlbData.pitchHand.code}</span>
                  </>
                )}
                {mlbData?.birthCountry && (
                  <>
                    <span>•</span>
                    <span>{mlbData.birthCountry}</span>
                  </>
                )}
                {player.team && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                    {player.team}
                  </span>
                )}
              </div>

              {/* 2025 Batting Stats */}
              {battingStats && (
                <div className="flex gap-3 text-xs text-gray-700 dark:text-gray-300 mt-2 flex-wrap">
                  <span className="font-semibold text-gray-800 dark:text-gray-200">2025 Stats:</span>
                  {battingStats.plateAppearances !== undefined && <span>PA: {battingStats.plateAppearances}</span>}
                  {battingStats.atBats !== undefined && <span>AB: {battingStats.atBats}</span>}
                  {battingStats.avg && <span>AVG: {battingStats.avg}</span>}
                  {battingStats.obp && <span>OBP: {battingStats.obp}</span>}
                  {battingStats.slg && <span>SLG: {battingStats.slg}</span>}
                  {battingStats.homeRuns !== undefined && <span>HR: {battingStats.homeRuns}</span>}
                  {battingStats.stolenBases !== undefined && <span>SB: {battingStats.stolenBases}</span>}
                </div>
              )}
            </div>
          </div>

          {/* Inline Legend */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <span className="font-semibold text-gray-700 dark:text-gray-300">Percentile:</span>
              <span className="px-1.5 py-0.5 rounded bg-red-700 text-white font-semibold">Elite 90+</span>
              <span className="px-1.5 py-0.5 rounded bg-red-200 text-red-800">Great 75-89</span>
              <span className="px-1.5 py-0.5 rounded bg-gray-50 text-gray-700">Above Avg 50-74</span>
              <span className="px-1.5 py-0.5 rounded bg-blue-300 text-blue-800">Below Avg 25-49</span>
              <span className="px-1.5 py-0.5 rounded bg-blue-700 text-white">Poor 0-24</span>
            </div>
          </div>
        </div>

        {/* Stats Sections - Compact Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {statSections.map((section) => (
            <div
              key={section.title}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-3"
            >
              <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2 border-b border-gray-200 dark:border-gray-700 pb-1">
                {section.title}
              </h2>
              <div className="space-y-1.5">
                {section.stats.map((stat) => {
                  const percentile = percentiles[stat.statKey];
                  return (
                    <div
                      key={stat.label}
                      className="flex justify-between items-center py-1 text-sm"
                    >
                      <span className="text-gray-600 dark:text-gray-400 text-xs flex-1">{stat.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white w-12 text-right text-xs">
                          {stat.value ?? 'N/A'}
                        </span>
                        {percentile !== null && percentile !== undefined ? (
                          <span
                            className={`px-1.5 py-0.5 rounded text-xs font-semibold min-w-[70px] text-center ${getPercentileBgColor(
                              percentile
                            )} ${getPercentileColor(percentile)}`}
                          >
                            {formatPercentile(percentile)}
                          </span>
                        ) : (
                          <span className="min-w-[70px]"></span>
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
