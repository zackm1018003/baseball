'use client';

import { use, useState, useEffect } from 'react';
import { getPlayerById, getAllPlayers } from '@/lib/database';
import { DEFAULT_DATASET_ID } from '@/lib/datasets';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { fetchMLBPlayer } from '@/lib/mlb-api';
import { calculatePlayerPercentiles } from '@/lib/percentiles';
import { Player } from '@/types/player';
import Image from 'next/image';
import Link from 'next/link';
import ComparisonRadarChart from '@/components/ComparisonRadarChart';

interface ComparePageProps {
  searchParams: Promise<{ player1?: string; player2?: string }>;
}

interface StatComparison {
  label: string;
  player1Value: string | number | undefined;
  player2Value: string | number | undefined;
  statKey: string;
  player1Better: boolean | null;
}

interface MLBPlayerData {
  height?: string;
  weight?: number;
  batSide?: { code: string };
  birthCountry?: string;
}

export default function ComparePage({ searchParams }: ComparePageProps) {
  const params = use(searchParams);
  const player1Id = params.player1 ? parseInt(params.player1) : null;
  const player2Id = params.player2 ? parseInt(params.player2) : null;

  const [selectedDataset, setSelectedDataset] = useState<string>(DEFAULT_DATASET_ID);
  const [isClient, setIsClient] = useState(false);
  const [imageError1, setImageError1] = useState(0);
  const [imageError2, setImageError2] = useState(0);
  const [mlbData1, setMlbData1] = useState<MLBPlayerData | null>(null);
  const [mlbData2, setMlbData2] = useState<MLBPlayerData | null>(null);

  // Load dataset preference from localStorage
  useEffect(() => {
    setIsClient(true);
    const savedDataset = localStorage.getItem('selectedDataset');
    if (savedDataset) {
      setSelectedDataset(savedDataset);
    }
  }, []);

  const player1 = player1Id ? getPlayerById(player1Id, selectedDataset) : null;
  const player2 = player2Id ? getPlayerById(player2Id, selectedDataset) : null;

  useEffect(() => {
    if (player1?.player_id) {
      fetchMLBPlayer(player1.player_id).then((data) => {
        if (data) setMlbData1(data);
      });
    }
    if (player2?.player_id) {
      fetchMLBPlayer(player2.player_id).then((data) => {
        if (data) setMlbData2(data);
      });
    }
  }, [player1?.player_id, player2?.player_id]);

  if (!player1 || !player2) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 py-8">
        <div className="container mx-auto px-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Invalid Comparison</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-4">Please select two valid players to compare.</p>
            <Link href="/" className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">
              Return to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const allPlayers = getAllPlayers(selectedDataset);
  const percentiles1 = calculatePlayerPercentiles(player1, allPlayers);
  const percentiles2 = calculatePlayerPercentiles(player2, allPlayers);

  const imageSources1 = [
    getMLBStaticPlayerImage(player1.player_id, { width: 300 }),
    getESPNPlayerImage(player1.player_id),
    '/api/placeholder/150/150',
  ];

  const imageSources2 = [
    getMLBStaticPlayerImage(player2.player_id, { width: 300 }),
    getESPNPlayerImage(player2.player_id),
    '/api/placeholder/150/150',
  ];

  const currentImage1 = imageSources1[imageError1] || imageSources1[imageSources1.length - 1];
  const currentImage2 = imageSources2[imageError2] || imageSources2[imageSources2.length - 1];

  // Helper function to safely compare values
  const safeCompare = (
    val1: number | undefined,
    val2: number | undefined,
    lowerIsBetter: boolean = false
  ): boolean | null => {
    if (val1 === undefined || val2 === undefined) return null;
    return lowerIsBetter ? val1 < val2 : val1 > val2;
  };

  // Stats to compare organized by category
  const statCategories: { title: string; stats: StatComparison[] }[] = [
    {
      title: 'Swing Mechanics',
      stats: [
        {
          label: 'Bat Speed',
          player1Value: player1.bat_speed,
          player2Value: player2.bat_speed,
          statKey: 'bat_speed',
          player1Better: safeCompare(player1.bat_speed, player2.bat_speed),
        },
        {
          label: 'Fast Swing %',
          player1Value: player1['fast_swing_%'],
          player2Value: player2['fast_swing_%'],
          statKey: 'fast_swing_%',
          player1Better: safeCompare(player1['fast_swing_%'], player2['fast_swing_%']),
        },
        {
          label: 'Swing Length',
          player1Value: player1.swing_length,
          player2Value: player2.swing_length,
          statKey: 'swing_length',
          player1Better: safeCompare(player1.swing_length, player2.swing_length, true), // Lower is better
        },
        {
          label: 'Attack Angle',
          player1Value: player1.attack_angle,
          player2Value: player2.attack_angle,
          statKey: 'attack_angle',
          player1Better: null,
        },
        {
          label: 'Attack Direction',
          player1Value: player1.attack_direction,
          player2Value: player2.attack_direction,
          statKey: 'attack_direction',
          player1Better: null,
        },
        {
          label: 'Swing Tilt',
          player1Value: player1.swing_tilt,
          player2Value: player2.swing_tilt,
          statKey: 'swing_tilt',
          player1Better: null,
        },
      ],
    },
    {
      title: 'Contact Quality',
      stats: [
        {
          label: 'Avg EV',
          player1Value: player1.avg_ev?.toFixed(1) || 'N/A',
          player2Value: player2.avg_ev?.toFixed(1) || 'N/A',
          statKey: 'avg_ev',
          player1Better: (player1.avg_ev || 0) > (player2.avg_ev || 0),
        },
        {
          label: 'Max EV',
          player1Value: player1.max_ev?.toFixed(1) || 'N/A',
          player2Value: player2.max_ev?.toFixed(1) || 'N/A',
          statKey: 'max_ev',
          player1Better: (player1.max_ev || 0) > (player2.max_ev || 0),
        },
        {
          label: 'Barrel %',
          player1Value: player1['barrel_%'],
          player2Value: player2['barrel_%'],
          statKey: 'barrel_%',
          player1Better: safeCompare(player1['barrel_%'], player2['barrel_%']),
        },
        {
          label: 'Hard Hit %',
          player1Value: player1['hard_hit%'],
          player2Value: player2['hard_hit%'],
          statKey: 'hard_hit%',
          player1Better: safeCompare(player1['hard_hit%'], player2['hard_hit%']),
        },
        {
          label: 'EV90',
          player1Value: player1.ev90?.toFixed(2) || 'N/A',
          player2Value: player2.ev90?.toFixed(2) || 'N/A',
          statKey: 'ev90',
          player1Better: safeCompare(player1.ev90, player2.ev90),
        },
      ],
    },
    {
      title: 'Plate Discipline',
      stats: [
        {
          label: 'BB %',
          player1Value: player1['bb%'],
          player2Value: player2['bb%'],
          statKey: 'bb%',
          player1Better: safeCompare(player1['bb%'], player2['bb%']),
        },
        {
          label: 'K %',
          player1Value: player1['k%'],
          player2Value: player2['k%'],
          statKey: 'k%',
          player1Better: safeCompare(player1['k%'], player2['k%'], true), // Lower is better
        },
        {
          label: 'Z-Swing %',
          player1Value: player1['z-swing%'],
          player2Value: player2['z-swing%'],
          statKey: 'z-swing%',
          player1Better: safeCompare(player1['z-swing%'], player2['z-swing%']),
        },
        {
          label: 'Z-Whiff %',
          player1Value: player1['z-whiff%'],
          player2Value: player2['z-whiff%'],
          statKey: 'z-whiff%',
          player1Better: safeCompare(player1['z-whiff%'], player2['z-whiff%'], true), // Lower is better
        },
        {
          label: 'Chase %',
          player1Value: player1['chase%'],
          player2Value: player2['chase%'],
          statKey: 'chase%',
          player1Better: safeCompare(player1['chase%'], player2['chase%'], true), // Lower is better
        },
        {
          label: 'O-Whiff %',
          player1Value: player1['o-whiff%'],
          player2Value: player2['o-whiff%'],
          statKey: 'o-whiff%',
          player1Better: safeCompare(player1['o-whiff%'], player2['o-whiff%'], true), // Lower is better
        },
      ],
    },
    {
      title: 'Batted Ball Profile',
      stats: [
        {
          label: 'Avg Launch Angle',
          player1Value: player1.avg_la?.toFixed(1) || 'N/A',
          player2Value: player2.avg_la?.toFixed(1) || 'N/A',
          statKey: 'avg_la',
          player1Better: null,
        },
        {
          label: 'Ideal Angle %',
          player1Value: player1['ideal_angle_%'],
          player2Value: player2['ideal_angle_%'],
          statKey: 'ideal_angle_%',
          player1Better: safeCompare(player1['ideal_angle_%'], player2['ideal_angle_%']),
        },
        {
          label: 'Pull Air %',
          player1Value: player1['pull_air%'],
          player2Value: player2['pull_air%'],
          statKey: 'pull_air%',
          player1Better: safeCompare(player1['pull_air%'], player2['pull_air%']),
        },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 py-6">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="flex items-center justify-between mb-4">
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

        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6 text-center">Player Comparison</h1>

        {/* Player Headers */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* Player 1 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4">
            <div className="flex items-center gap-4">
              <div className="relative w-20 h-20 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700 flex-shrink-0">
                <Image
                  src={currentImage1}
                  alt={player1.full_name || 'Player 1'}
                  fill
                  className="object-cover"
                  onError={() => setImageError1(imageError1 + 1)}
                  unoptimized
                />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{player1.full_name}</h2>
                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <div>Age: {player1.age} {mlbData1?.height && `• ${mlbData1.height}`} {mlbData1?.weight && `• ${mlbData1.weight} lbs`}</div>
                  {mlbData1?.batSide && <div>Bats: {mlbData1.batSide.code}{mlbData1?.birthCountry && ` • ${mlbData1.birthCountry}`}</div>}
                  {player1.team && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 mt-1">
                      {player1.team}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Player 2 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4">
            <div className="flex items-center gap-4">
              <div className="relative w-20 h-20 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700 flex-shrink-0">
                <Image
                  src={currentImage2}
                  alt={player2.full_name || 'Player 2'}
                  fill
                  className="object-cover"
                  onError={() => setImageError2(imageError2 + 1)}
                  unoptimized
                />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{player2.full_name}</h2>
                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <div>Age: {player2.age} {mlbData2?.height && `• ${mlbData2.height}`} {mlbData2?.weight && `• ${mlbData2.weight} lbs`}</div>
                  {mlbData2?.batSide && <div>Bats: {mlbData2.batSide.code}{mlbData2?.birthCountry && ` • ${mlbData2.birthCountry}`}</div>}
                  {player2.team && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 mt-1">
                      {player2.team}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Radar Chart Comparison */}
        <ComparisonRadarChart
          percentiles1={percentiles1}
          percentiles2={percentiles2}
          player1Name={player1.full_name || 'Player 1'}
          player2Name={player2.full_name || 'Player 2'}
        />

        {/* Stat Comparisons */}
        <div className="space-y-4">
          {statCategories.map((category) => (
            <div key={category.title} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-3 border-b border-gray-200 dark:border-gray-700 pb-2">
                {category.title}
              </h3>
              <div className="space-y-2">
                {category.stats.map((stat) => {
                  const percentile1 = percentiles1[stat.statKey];
                  const percentile2 = percentiles2[stat.statKey];

                  return (
                    <div key={stat.label} className="grid grid-cols-3 gap-4 items-center text-sm">
                      {/* Player 1 Value */}
                      <div
                        className={`text-right font-semibold ${
                          stat.player1Better === true
                            ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-1 rounded'
                            : 'text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {stat.player1Value}
                        {percentile1 !== null && percentile1 !== undefined && (
                          <span className="text-xs ml-1 text-gray-500 dark:text-gray-400">
                            ({percentile1}th)
                          </span>
                        )}
                      </div>

                      {/* Stat Label */}
                      <div className="text-center text-gray-600 dark:text-gray-400 font-medium">
                        {stat.label}
                      </div>

                      {/* Player 2 Value */}
                      <div
                        className={`text-left font-semibold ${
                          stat.player1Better === false
                            ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-1 rounded'
                            : 'text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {stat.player2Value}
                        {percentile2 !== null && percentile2 !== undefined && (
                          <span className="text-xs ml-1 text-gray-500 dark:text-gray-400">
                            ({percentile2}th)
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
