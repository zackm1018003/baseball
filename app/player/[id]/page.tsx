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
import { findSimilarPlayersBySwingDecision, SWING_METRICS, MLB_METRICS, AAA_METRICS, AA_APLUS_METRICS, A_METRICS, DatasetType } from '@/lib/similarity';
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
  const isNCAA = actualDataset === 'ncaa2025'; // NCAA dataset gets larger similar players section

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
  // Determine dataset type for similarity comparison
  let datasetType: DatasetType = 'mlb';
  if (actualDataset === 'mlb2025') {
    datasetType = 'mlb';
  } else if (actualDataset === 'aaa2025') {
    datasetType = 'aaa';
  } else if (actualDataset === 'aa2025' || actualDataset === 'aplus2025') {
    datasetType = 'aa_aplus';
  } else if (actualDataset === 'a2025') {
    datasetType = 'a';
  } else {
    datasetType = 'other';
  }

  // Minor league datasets (AAA, AA, A+, A) compare to both MLB and AAA players
  // MLB and NCAA players compare only to MLB
  const mlbPlayers = getAllPlayers('mlb2025');
  const aaaPlayers = getAllPlayers('aaa2025');
  const allPlayersForComparison = (actualDataset === 'mlb2025' || actualDataset === 'ncaa2025')
    ? mlbPlayers
    : [...mlbPlayers, ...aaaPlayers];

  // Use the original datasetType to preserve custom weights (e.g., A dataset's 3.5x avg_la)
  // The similarity algorithm will only compare metrics that both players have
  const similarPlayers = findSimilarPlayersBySwingDecision(player, allPlayersForComparison, 5, datasetType);

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

  // Helper function to get stat value with fallback to minor league naming
  const getStatValue = (primaryKey: string, fallbackKey?: string) => {
    const value = (player as any)[primaryKey];
    if (value !== null && value !== undefined) return value;
    if (fallbackKey) return (player as any)[fallbackKey];
    return null;
  };

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
        { label: isAAA ? 'EV90' : 'EV50', value: player.ev50?.toFixed(2), statKey: 'ev50' },
      ],
    },
    {
      title: 'Plate Discipline',
      stats: [
        { label: 'BB %', value: getStatValue('bb%', 'bb_percent'), statKey: 'bb%' },
        { label: 'K %', value: getStatValue('k%', 'k_percent'), statKey: 'k%' },
        { label: 'Z-Swing %', value: getStatValue('z-swing%', 'zone_swing_percent'), statKey: 'z-swing%' },
        { label: 'Z-Whiff %', value: getStatValue('z-whiff%', 'zone_contact_percent'), statKey: 'z-whiff%' },
        { label: 'Chase %', value: getStatValue('chase%', 'chase_percent'), statKey: 'chase%' },
        ...((actualDataset !== 'aplus2025' && actualDataset !== 'aa2025') ? [
          { label: 'O-Whiff %', value: isAAA && player['o-whiff%'] ? player['o-whiff%'].toFixed(1) : player['o-whiff%'], statKey: 'o-whiff%' }
        ] : []),
      ],
    },
    {
      title: 'Expected Performance',
      stats: [
        { label: 'xwOBA', value: player.xwoba_percent, statKey: 'xwoba_percent' },
        { label: 'wOBA', value: player.woba_percent, statKey: 'woba_percent' },
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

  // Filter out sections based on dataset
  const statSections = allStatSections.filter(section => {
    // Remove Swing Mechanics for all minor league datasets
    if (isAAA && section.title === 'Swing Mechanics') {
      return false;
    }
    // Remove Contact Quality for AA and A+ datasets only
    if ((actualDataset === 'aa2025' || actualDataset === 'aplus2025') && section.title === 'Contact Quality') {
      return false;
    }
    // Remove Expected Performance section (not needed for any dataset)
    if (section.title === 'Expected Performance') {
      return false;
    }
    return true;
  });

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
                {player.college && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200">
                    {player.college}
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
                  {player.pa !== undefined && <span>PA: {player.pa}</span>}
                  {player.ab !== undefined && <span>AB: {player.ab}</span>}
                  {(() => {
                    const baValue = player.avg !== undefined ? player.avg : (typeof player.ba === 'number' ? player.ba : (typeof player.ba === 'string' ? parseFloat(player.ba) : null));
                    return baValue !== null && !isNaN(baValue) ? <span>AVG: {baValue.toFixed(3)}</span> : null;
                  })()}
                  {(() => {
                    const obpValue = typeof player.obp === 'number' ? player.obp : (typeof player.obp === 'string' ? parseFloat(player.obp) : null);
                    return obpValue !== null && !isNaN(obpValue) ? <span>OBP: {obpValue.toFixed(3)}</span> : null;
                  })()}
                  {(() => {
                    const slgValue = typeof player.slg === 'number' ? player.slg : (typeof player.slg === 'string' ? parseFloat(player.slg) : null);
                    return slgValue !== null && !isNaN(slgValue) ? <span>SLG: {slgValue.toFixed(3)}</span> : null;
                  })()}
                  {(battingStats?.homeRuns !== undefined || player.hr !== undefined) && (
                    <span>HR: {battingStats?.homeRuns ?? player.hr}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Credit */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
            <div className="flex justify-end">
              <div className="text-xs text-gray-500 dark:text-gray-400 italic">
                By: Zack McKeown
              </div>
            </div>
          </div>
        </div>

        {/* Stats Sections - 3 Column Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {statSections.map((section) => (
            <div
              key={section.title}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-3"
            >
              <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2 border-b border-gray-200 dark:border-gray-700 pb-1">
                {section.title}
              </h2>
              <div className="space-y-1.5">
                {section.stats.map((stat) => (
                  <div
                    key={stat.label}
                    className="flex justify-between items-center py-1 text-sm"
                  >
                    <span className="text-gray-600 dark:text-gray-400 text-xs">{stat.label}</span>
                    <span className="font-semibold text-gray-900 dark:text-white text-xs">
                      {stat.value ?? 'N/A'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Similar MLB Players by Swing Decision */}
        {similarPlayers.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md mt-4 p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                Similar MLB Players by Swing Decision
              </h2>
              <div className="text-sm text-gray-500 dark:text-gray-400 italic">
                By: Zack McKeown
              </div>
            </div>

            {/* Horizontal card grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {similarPlayers.map(({ player: similarPlayer, score }) => {
                // Determine which dataset the similar player is from
                let similarPlayerDataset = 'MLB';
                let datasetColor = 'bg-purple-600 text-white';

                const isFromMLB = mlbPlayers.some(p => p.player_id === similarPlayer.player_id);
                if (!isFromMLB) {
                  for (const ds of DATASETS.slice(1)) {
                    const dsPlayers = getAllPlayers(ds.id);
                    if (dsPlayers.some(p => p.player_id === similarPlayer.player_id || p.full_name === similarPlayer.full_name)) {
                      similarPlayerDataset = ds.name.replace(' 2025', '');
                      datasetColor = 'bg-orange-500 text-white';
                      break;
                    }
                  }
                }

                const handleSimilarPlayerClick = () => {
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

                const similarityPercent = (100 - Math.min(score, 100)).toFixed(0);

                return (
                  <div
                    key={similarPlayer.player_id || similarPlayer.full_name}
                    onClick={handleSimilarPlayerClick}
                    className="bg-gray-700 dark:bg-gray-700 rounded-lg p-3 hover:bg-gray-600 dark:hover:bg-gray-600 transition-colors cursor-pointer border border-gray-600"
                  >
                    {/* Header: Name + Dataset Badge + Similarity */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-white text-sm truncate">
                            {similarPlayer.full_name}
                          </h3>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${datasetColor}`}>
                            {similarPlayerDataset}
                          </span>
                        </div>
                        {similarPlayer.team && (
                          <div className="text-xs text-gray-400 mt-0.5">
                            {similarPlayer.team}
                          </div>
                        )}
                      </div>
                      <div className="text-sm font-bold text-cyan-400 ml-2 whitespace-nowrap">
                        {similarityPercent}%
                      </div>
                    </div>

                    {/* Stats Grid - 2 rows x 3 cols */}
                    <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-center">
                      {/* Row 1: ZSW, ZWH, CHS */}
                      <div>
                        <div className="text-[10px] text-gray-400">ZSW</div>
                        <div className="text-sm font-semibold text-white">
                          {similarPlayer['z-swing%']?.toFixed(1) ?? 'N/A'}
                        </div>
                        {similarPlayer['z-swing%'] != null && player['z-swing%'] != null && (
                          <div className={`text-[10px] ${(similarPlayer['z-swing%'] - player['z-swing%']) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {(similarPlayer['z-swing%'] - player['z-swing%']) >= 0 ? '+' : ''}{(similarPlayer['z-swing%'] - player['z-swing%']).toFixed(1)}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400">ZWH</div>
                        <div className="text-sm font-semibold text-white">
                          {similarPlayer['z-whiff%']?.toFixed(1) ?? 'N/A'}
                        </div>
                        {similarPlayer['z-whiff%'] != null && player['z-whiff%'] != null && (
                          <div className={`text-[10px] ${(similarPlayer['z-whiff%'] - player['z-whiff%']) >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                            {(similarPlayer['z-whiff%'] - player['z-whiff%']) >= 0 ? '+' : ''}{(similarPlayer['z-whiff%'] - player['z-whiff%']).toFixed(1)}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400">CHS</div>
                        <div className="text-sm font-semibold text-white">
                          {similarPlayer['chase%']?.toFixed(1) ?? 'N/A'}
                        </div>
                        {similarPlayer['chase%'] != null && player['chase%'] != null && (
                          <div className={`text-[10px] ${(similarPlayer['chase%'] - player['chase%']) >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                            {(similarPlayer['chase%'] - player['chase%']) >= 0 ? '+' : ''}{(similarPlayer['chase%'] - player['chase%']).toFixed(1)}
                          </div>
                        )}
                      </div>
                      {/* Row 2: OWH, MAX, LA */}
                      <div>
                        <div className="text-[10px] text-gray-400">OWH</div>
                        <div className="text-sm font-semibold text-white">
                          {similarPlayer['o-whiff%']?.toFixed(1) ?? 'N/A'}
                        </div>
                        {similarPlayer['o-whiff%'] != null && player['o-whiff%'] != null && (
                          <div className={`text-[10px] ${(similarPlayer['o-whiff%'] - player['o-whiff%']) >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                            {(similarPlayer['o-whiff%'] - player['o-whiff%']) >= 0 ? '+' : ''}{(similarPlayer['o-whiff%'] - player['o-whiff%']).toFixed(1)}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400">MAX</div>
                        <div className="text-sm font-semibold text-white">
                          {similarPlayer.max_ev?.toFixed(1) ?? 'N/A'}
                        </div>
                        {similarPlayer.max_ev != null && player.max_ev != null && (
                          <div className={`text-[10px] ${(similarPlayer.max_ev - player.max_ev) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {(similarPlayer.max_ev - player.max_ev) >= 0 ? '+' : ''}{(similarPlayer.max_ev - player.max_ev).toFixed(1)}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400">LA</div>
                        <div className="text-sm font-semibold text-white">
                          {similarPlayer.avg_la?.toFixed(1) ?? 'N/A'}
                        </div>
                        {similarPlayer.avg_la != null && player.avg_la != null && (
                          <div className={`text-[10px] ${(similarPlayer.avg_la - player.avg_la) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {(similarPlayer.avg_la - player.avg_la) >= 0 ? '+' : ''}{(similarPlayer.avg_la - player.avg_la).toFixed(1)}
                          </div>
                        )}
                      </div>
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
