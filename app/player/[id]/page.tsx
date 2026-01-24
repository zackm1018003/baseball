'use client';

import { use, useState, useEffect } from 'react';
import { getPlayerById, getPlayerByName, getAllPlayers } from '@/lib/database';
import { DEFAULT_DATASET_ID, DATASETS } from '@/lib/datasets';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { fetchMLBPlayer, fetchMLBPlayerStats } from '@/lib/mlb-api';
import {
  calculatePlayerPercentiles,
  getPercentileColor,
  getPercentileBgColor,
  formatPercentile,
  getPercentileLabel,
} from '@/lib/percentiles';
import { findSimilarPlayersBySwingDecision, SWING_METRICS, MLB_METRICS, AAA_METRICS } from '@/lib/similarity';
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
  birthDate?: string;
  currentAge?: number;
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
  const [selectedDataset, setSelectedDataset] = useState<string>(DEFAULT_DATASET_ID);
  const [isClient, setIsClient] = useState(false);
  const [imageError, setImageError] = useState(0);
  const [mlbData, setMlbData] = useState<MLBPlayerData | null>(null);
  const [battingStats, setBattingStats] = useState<BattingStats | null>(null);
  const [similarPlayersBioData, setSimilarPlayersBioData] = useState<Record<number, MLBPlayerData>>({});

  // Load dataset preference from localStorage
  useEffect(() => {
    setIsClient(true);
    const savedDataset = localStorage.getItem('selectedDataset');
    if (savedDataset) {
      setSelectedDataset(savedDataset);
    }
  }, []);

  // Determine if id is numeric (player_id) or a name (URL-encoded full_name)
  const isNumericId = /^\d+$/.test(id);
  const decodedName = isNumericId ? null : decodeURIComponent(id);

  // Try to find player in selected dataset, if not found try all datasets
  let player = isNumericId
    ? getPlayerById(parseInt(id), selectedDataset)
    : getPlayerByName(decodedName!, selectedDataset);
  let actualDataset = selectedDataset;

  if (!player) {
    // Player not in current dataset, try all datasets
    for (const dataset of DATASETS) {
      player = isNumericId
        ? getPlayerById(parseInt(id), dataset.id)
        : getPlayerByName(decodedName!, dataset.id);

      if (player) {
        // Found in a different dataset, update the selection
        actualDataset = dataset.id;
        setSelectedDataset(dataset.id);
        if (isClient) {
          localStorage.setItem('selectedDataset', dataset.id);
        }
        break;
      }
    }
  }

  const isAAA = actualDataset !== 'mlb2025'; // All non-MLB datasets use minor league display

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
  const allPlayers = getAllPlayers(actualDataset);
  const percentiles = calculatePlayerPercentiles(player, allPlayers);

  // Find similar players by swing decision metrics
  // Both MLB and AAA players: only compare to MLB players
  // MLB uses bat_speed, AAA uses max_ev in comparison
  const mlbPlayers = getAllPlayers('mlb2025');
  const allPlayersForComparison = mlbPlayers;
  const similarPlayers = findSimilarPlayersBySwingDecision(player, allPlayersForComparison, 5, !isAAA);

  // Fetch bio data (height/weight) for similar players
  useEffect(() => {
    if (similarPlayers && similarPlayers.length > 0) {
      similarPlayers.forEach(({ player: simPlayer }) => {
        // Only fetch if player has an ID and we don't already have the data
        if (simPlayer.player_id && !similarPlayersBioData[simPlayer.player_id]) {
          fetchMLBPlayer(simPlayer.player_id).then((data) => {
            if (data) {
              setSimilarPlayersBioData(prev => ({
                ...prev,
                [simPlayer.player_id!]: data
              }));
            }
          });
        }
      });
    }
  }, [similarPlayers, similarPlayersBioData]);

  const allStatSections: { title: string; stats: StatItem[] }[] = [
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
        { label: 'Hard Hit %', value: isAAA && player['hard_hit%'] ? player['hard_hit%'].toFixed(1) : player['hard_hit%'], statKey: 'hard_hit%' },
        { label: isAAA ? 'EV90' : 'EV50', value: player.ev50?.toFixed(2), statKey: 'ev50' },
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
        { label: 'O-Whiff %', value: isAAA && player['o-whiff%'] ? player['o-whiff%'].toFixed(1) : player['o-whiff%'], statKey: 'o-whiff%' },
      ],
    },
    {
      title: 'Batted Ball Profile',
      stats: [
        { label: 'Average Launch Angle', value: player.avg_la?.toFixed(1), statKey: 'avg_la' },
        ...(isAAA ? [] : [{ label: 'Ideal Angle %', value: player['ideal_angle_%'], statKey: 'ideal_angle_%' }]),
        { label: isAAA ? 'Pull Flyball %' : 'Pull Air %', value: player['pull_air%'], statKey: 'pull_air%' },
      ],
    },
  ];

  // Filter out Swing Mechanics for AAA players
  const statSections = isAAA
    ? allStatSections.filter(section => section.title !== 'Swing Mechanics')
    : allStatSections;

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
        <Link
          href="/"
          className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 mb-3 text-sm"
        >
          ← Back to All Players
        </Link>

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
                {(player.age || mlbData?.currentAge) && <span>Age: {player.age || mlbData?.currentAge}</span>}
                {mlbData?.height && (
                  <>
                    {(player.age || mlbData?.currentAge) && <span>•</span>}
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
              {/* MLB stats from API or dataset */}
              {!isAAA && (battingStats || player.hr !== undefined) && (
                <div className="flex gap-3 text-xs text-gray-700 dark:text-gray-300 mt-2 flex-wrap">
                  <span className="font-semibold text-gray-800 dark:text-gray-200">2025 Stats:</span>
                  {battingStats?.plateAppearances !== undefined && <span>PA: {battingStats.plateAppearances}</span>}
                  {battingStats?.atBats !== undefined && <span>AB: {battingStats.atBats}</span>}
                  {battingStats?.avg && <span>AVG: {battingStats.avg}</span>}
                  {battingStats?.obp && <span>OBP: {battingStats.obp}</span>}
                  {battingStats?.slg && <span>SLG: {battingStats.slg}</span>}
                  {(battingStats?.homeRuns !== undefined || player.hr !== undefined) && (
                    <span>HR: {battingStats?.homeRuns ?? player.hr}</span>
                  )}
                  {battingStats?.stolenBases !== undefined && <span>SB: {battingStats.stolenBases}</span>}
                </div>
              )}
              {/* Minor league stats from player data */}
              {isAAA && (
                <div className="flex gap-3 text-xs text-gray-700 dark:text-gray-300 mt-2 flex-wrap">
                  <span className="font-semibold text-gray-800 dark:text-gray-200">2025 {DATASETS.find(d => d.id === actualDataset)?.name.replace(' 2025', '')} Stats:</span>
                  {player.pa !== undefined && player.pa !== null && <span>PA: {player.pa}</span>}
                  {player.ab !== undefined && player.ab !== null && <span>AB: {player.ab}</span>}
                  {player.ba && <span>AVG: {player.ba}</span>}
                  {player.obp && <span>OBP: {player.obp}</span>}
                  {player.slg && <span>SLG: {player.slg}</span>}
                  {battingStats?.homeRuns !== undefined && <span>HR: {battingStats.homeRuns}</span>}
                </div>
              )}
            </div>
          </div>

          {/* Inline Legend */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap text-xs">
                <span className="font-semibold text-gray-700 dark:text-gray-300">Percentile:</span>
                <span className="px-1.5 py-0.5 rounded bg-red-700 text-white font-semibold">Elite 90+</span>
                <span className="px-1.5 py-0.5 rounded bg-red-200 text-red-800">Great 75-89</span>
                <span className="px-1.5 py-0.5 rounded bg-gray-50 text-gray-700">Above Avg 50-74</span>
                <span className="px-1.5 py-0.5 rounded bg-blue-300 text-blue-800">Below Avg 25-49</span>
                <span className="px-1.5 py-0.5 rounded bg-blue-700 text-white">Poor 0-24</span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 italic">
                By: Zack McKeown
              </div>
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

        {/* Similar Players by Swing Decision */}
        {similarPlayers.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-3 mt-3">
            <div className="flex items-center justify-between mb-2 border-b border-gray-200 dark:border-gray-700 pb-1.5">
              <h2 className="text-base font-bold text-gray-900 dark:text-white">
                Similar Players to {player.full_name} by Swing Decision
              </h2>
              <div className="text-xs text-gray-500 dark:text-gray-400 italic">
                By: Zack McKeown
              </div>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
              MLB players with similar Z-Swing%, Z-Whiff%, Chase%, O-Whiff%, Avg LA{isAAA ? ', and Max EV metrics' : ', and Bat Speed metrics'}
            </p>
            <div className="space-y-2">
              {similarPlayers.map(({ player: similarPlayer, score }) => {
                // Determine which dataset the similar player is from
                let similarPlayerDataset = 'MLB';
                let datasetColor = 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200';

                const isFromMLB = mlbPlayers.some(p => p.player_id === similarPlayer.player_id);
                if (!isFromMLB) {
                  // Check all other datasets
                  for (const ds of DATASETS.slice(1)) { // Skip MLB since we already checked
                    const dsPlayers = getAllPlayers(ds.id);
                    if (dsPlayers.some(p => p.player_id === similarPlayer.player_id || p.full_name === similarPlayer.full_name)) {
                      similarPlayerDataset = ds.name.replace(' 2025', '');
                      datasetColor = 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200';
                      break;
                    }
                  }
                }
                const datasetLabel = similarPlayerDataset;

                const handleSimilarPlayerClick = () => {
                  // Find the correct dataset for this player
                  let targetDataset = 'mlb2025';
                  if (!isFromMLB) {
                    for (const ds of DATASETS.slice(1)) {
                      const dsPlayers = getAllPlayers(ds.id);
                      if (dsPlayers.some(p => p.player_id === similarPlayer.player_id || p.full_name === similarPlayer.full_name)) {
                        targetDataset = ds.id;
                        break;
                      }
                    }
                  }
                  localStorage.setItem('selectedDataset', targetDataset);
                  const playerId = similarPlayer.player_id || encodeURIComponent(similarPlayer.full_name);
                  window.location.href = `/player/${playerId}`;
                };

                return (
                  <div
                    key={similarPlayer.player_id}
                    onClick={handleSimilarPlayerClick}
                    className="block bg-gray-50 dark:bg-gray-700 rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                  >
                    <div className="flex justify-between items-start mb-1.5">
                      <div className="flex-1 flex gap-4 items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-gray-900 dark:text-white">
                              {similarPlayer.full_name}
                            </h3>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${datasetColor} font-medium`}>
                              {datasetLabel}
                            </span>
                          </div>
                          {similarPlayer.team && (
                            <span className="text-xs text-gray-600 dark:text-gray-400">
                              {similarPlayer.team}
                            </span>
                          )}
                        </div>
                        {/* Bio and Batting Stats */}
                        <div className="flex gap-3 text-xs text-gray-600 dark:text-gray-400 flex-wrap">
                          {(similarPlayer.age || (similarPlayer.player_id && similarPlayersBioData[similarPlayer.player_id]?.currentAge)) && (
                            <span>Age: {similarPlayer.age || (similarPlayer.player_id && similarPlayersBioData[similarPlayer.player_id]?.currentAge)}</span>
                          )}
                          {similarPlayer.player_id && similarPlayersBioData[similarPlayer.player_id]?.height && (
                            <span>Ht: {similarPlayersBioData[similarPlayer.player_id]?.height}</span>
                          )}
                          {similarPlayer.player_id && similarPlayersBioData[similarPlayer.player_id]?.weight && (
                            <span>Wt: {similarPlayersBioData[similarPlayer.player_id]?.weight} lbs</span>
                          )}
                          {similarPlayer.ba && <span>BA: {similarPlayer.ba}</span>}
                          {similarPlayer.obp && <span>OBP: {similarPlayer.obp}</span>}
                          {similarPlayer.slg && <span>SLG: {similarPlayer.slg}</span>}
                          {similarPlayer.hr !== undefined && similarPlayer.hr !== null && <span>HR: {similarPlayer.hr}</span>}
                        </div>
                      </div>
                      <div className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded whitespace-nowrap ml-2">
                        Similarity: {(100 - Math.min(score, 100)).toFixed(0)}%
                      </div>
                    </div>
                    <div className="grid grid-cols-6 gap-2 text-xs">
                      {(isAAA ? AAA_METRICS : MLB_METRICS).map((metric) => {
                        const targetVal = player[metric];
                        const similarVal = similarPlayer[metric];
                        const diff = similarVal !== null && similarVal !== undefined && targetVal !== null && targetVal !== undefined
                          ? similarVal - targetVal
                          : null;

                        // Custom display names for special metrics
                        let displayName = metric.replace('%', '').replace('-', ' ').replace('_', ' ').toUpperCase();
                        if (metric === 'bat_speed') displayName = 'BAT SPD';
                        if (metric === 'max_ev') displayName = 'MAX EV';
                        if (metric === 'avg_la') displayName = 'AVG LA';

                        return (
                          <div key={metric} className="text-center">
                            <div className="text-gray-500 dark:text-gray-400 mb-0.5 text-[10px]">
                              {displayName}
                            </div>
                            <div className="font-semibold text-gray-900 dark:text-white">
                              {similarVal?.toFixed(1) ?? 'N/A'}
                            </div>
                            {diff !== null && (
                              <div className={`text-xs ${diff > 0 ? 'text-green-600 dark:text-green-400' : diff < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                                {diff > 0 ? '+' : ''}{diff.toFixed(1)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
