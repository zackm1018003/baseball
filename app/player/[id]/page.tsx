'use client';

import { use, useState, useEffect, useCallback } from 'react';
import { getPlayerById, getPlayerByName, getAllPlayers } from '@/lib/database';
import { DEFAULT_DATASET_ID, DATASETS } from '@/lib/datasets';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { fetchMLBPlayer, fetchMLBPlayerStats } from '@/lib/mlb-api';
import {
  calculatePlayerPercentiles,
  calculateDecisionPlus,
  getPercentileColor,
  getPercentileBgColor,
  formatPercentile,
  getPercentileLabel,
} from '@/lib/percentiles';
import { findSimilarPlayersBySwingDecision, SWING_METRICS, MLB_METRICS, AAA_METRICS, AA_APLUS_METRICS, A_METRICS, DatasetType } from '@/lib/similarity';
import { getCollegeLogoUrl } from '@/lib/college-logos';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import { getCountryFlagUrl } from '@/lib/country-flags';
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
  const [zoneContactData, setZoneContactData] = useState<Array<{zone: number; contactPct: number | null; swings: number; xwoba: number | null; xwobaN: number}> | null>(null);
  const [zoneContactLoading, setZoneContactLoading] = useState(false);

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

  // Fetch zone contact data from Baseball Savant (MLB players only)
  useEffect(() => {
    if (player?.player_id && actualDataset === 'mlb2025') {
      setZoneContactLoading(true);
      setZoneContactData(null);
      fetch(`/api/zone-contact?playerId=${player.player_id}&season=2025`)
        .then(r => r.json())
        .then(data => {
          if (data.zones) setZoneContactData(data.zones);
        })
        .catch(() => {})
        .finally(() => setZoneContactLoading(false));
    }
  }, [player?.player_id, actualDataset]);

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
  } else if (actualDataset === 'ncaa2025') {
    datasetType = 'ncaa';
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

  // Calculate Decision+ (OPS+-style, 100 = league average)
  const decisionPlusValue = calculateDecisionPlus(player, allPlayers);

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
        { label: 'EV90', value: player.ev90?.toFixed(2), statKey: 'ev90' },
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
        { label: 'Decision+', value: decisionPlusValue, statKey: 'decision+' },
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
          Ã¢ÂÂ Back to All Players
        </Link>

        {/* Combined Header with Legend */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 mb-3">
          <div className="flex items-start gap-4 mb-3">
            {/* Player Image */}
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

            {/* Player Info */}
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
                {player.full_name}
              </h1>
              <div className="flex gap-2 text-xs text-gray-600 dark:text-gray-400 flex-wrap items-center">
                {(player.age || mlbData?.currentAge) && <span>Age: {player.age || mlbData?.currentAge}</span>}
                {mlbData?.height && (
                  <>
                    {(player.age || mlbData?.currentAge) && <span>·</span>}
                    <span>{mlbData.height}</span>
                  </>
                )}
                {mlbData?.weight && (
                  <>
                    <span>·</span>
                    <span>{mlbData.weight} lbs</span>
                  </>
                )}
                {mlbData?.batSide && (
                  <>
                    <span>·</span>
                    <span>Bats: {mlbData.batSide.code}</span>
                  </>
                )}
                {mlbData?.pitchHand && (
                  <>
                    <span>·</span>
                    <span>Throws: {mlbData.pitchHand.code}</span>
                  </>
                )}
                {mlbData?.birthCountry && (
                  <>
                    <span>·</span>
                    <span>{mlbData.birthCountry}</span>
                  </>
                )}
                {player.team && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                    {player.team}
                  </span>
                )}
                {player.college && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200">
                    {getCollegeLogoUrl(player.college) && (
                      <img
                        src={getCollegeLogoUrl(player.college)!}
                        alt={player.college}
                        className="w-4 h-4 object-contain"
                      />
                    )}
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

            {/* Country Flag and Team/College Logo on right */}
            <div className="flex-shrink-0 flex items-center gap-3">
              {/* Country Flag */}
              {mlbData?.birthCountry && getCountryFlagUrl(mlbData.birthCountry) && (
                <img
                  src={getCountryFlagUrl(mlbData.birthCountry, 160)!}
                  alt={mlbData.birthCountry}
                  className="w-20 h-14 object-contain rounded shadow-sm"
                />
              )}

              {/* College or MLB Team Logo */}
              {player.college && getCollegeLogoUrl(player.college) ? (
                <img
                  src={getCollegeLogoUrl(player.college)!}
                  alt={player.college}
                  className="w-24 h-24 object-contain"
                />
              ) : player.team && getMLBTeamLogoUrl(player.team) ? (
                <img
                  src={getMLBTeamLogoUrl(player.team)!}
                  alt={player.team}
                  className="w-24 h-24 object-contain"
                />
              ) : null}
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

        {/* Stats Sections - centered flex row */}
        <div className="flex flex-wrap justify-center gap-3">
          {statSections.map((section) => (
            <div
              key={section.title}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-3 flex-1 min-w-[180px] max-w-[calc(25%-0.75rem)]"
            >
              <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2 border-b border-gray-200 dark:border-gray-700 pb-1">
                {section.title}
              </h2>
              <div className="space-y-1.5">
                {section.stats.map((stat) => {
                  const percentile = !isNCAA ? percentiles[stat.statKey] : undefined;
                  const isDecisionPlus = stat.statKey === 'decision+';
                  return (
                    <div
                      key={stat.label}
                      className="flex justify-between items-center py-1 text-sm"
                    >
                      <span className={`text-gray-600 dark:text-gray-400 text-xs ${isDecisionPlus ? 'font-semibold' : '—'}`}>{stat.label}</span>
                      <div className="flex items-center gap-2">
                        {isDecisionPlus ? (
                          <span className="font-bold text-gray-900 dark:text-white text-sm">
                            {stat.value ?? 'N/A'}
                          </span>
                        ) : (
                          <>
                            <span className="font-semibold text-gray-900 dark:text-white text-xs">
                              {stat.value ?? 'N/A'}
                            </span>
                            {percentile !== null && percentile !== undefined ? (
                              <span
                                className={`px-1.5 py-0.5 rounded text-xs font-semibold min-w-[60px] text-center ${getPercentileBgColor(percentile)} ${getPercentileColor(percentile)}`}
                              >
                                {formatPercentile(percentile)}
                              </span>
                            ) : !isNCAA ? (
                              <span className="min-w-[60px]"></span>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Zone Grids - MLB only */}
        {actualDataset === 'mlb2025' && player?.player_id && (
          <div className="flex flex-wrap gap-3 mt-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 flex-1 min-w-[220px]">
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-3 border-b border-gray-200 dark:border-gray-700 pb-1">
              Zone Contact %
            </h2>
            {zoneContactLoading ? (
              <div className="text-xs text-gray-400 text-center py-4">Loading...</div>
            ) : zoneContactData && zoneContactData.some(z => z.swings > 0) ? (
              <div className="flex flex-row items-center gap-3">
                {/* Batter silhouette - pitcher's POV, right-handed batter mid-swing, torso rotated open */}
                <svg viewBox="0 0 100 195" width="75" height="200" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0" aria-hidden="true">
                  {/* === HELMET === viewed from front/slightly right, brim pointing left (3rd base side) */}
                  {/* Helmet dome */}
                  <ellipse cx="50" cy="18" rx="16" ry="14" fill="#374151"/>
                  {/* Helmet brim pointing to batter's left (toward 3rd base / our right) */}
                  <path d="M60,22 Q72,24 74,28 Q70,30 62,27 Z" fill="#374151"/>
                  {/* Ear flap on right side (toward catcher, our left) */}
                  <path d="M36,20 Q30,24 30,32 Q33,35 36,32 Q35,27 37,22 Z" fill="#374151"/>

                  {/* === HEAD === turned to face pitcher */}
                  <ellipse cx="50" cy="24" rx="11" ry="9" fill="#374151"/>

                  {/* === NECK === */}
                  <rect x="44" y="31" width="12" height="9" rx="3" fill="#374151"/>

                  {/* === TORSO === rotated/open toward pitcher — wider shape since chest faces us */}
                  {/* Shoulders wide, waist rotated */}
                  <path d="M24,40 L76,40 Q80,44 78,52 L72,92 L28,92 Q20,88 22,80 Z" fill="#374151"/>
                  {/* Collar / shirt neck area */}
                  <path d="M42,40 Q50,36 58,40" fill="none" stroke="#374151" strokeWidth="3"/>

                  {/* === RIGHT ARM (back arm, near side — elbow back, forearm driving through) === */}
                  {/* Upper arm: from right shoulder, elbow bent back then sweeping through */}
                  <path d="M72,44 Q82,50 80,62 Q76,68 68,68" fill="none" stroke="#374151" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round"/>
                  {/* Forearm: from elbow toward center/bat */}
                  <path d="M68,68 Q60,70 54,72" fill="none" stroke="#374151" strokeWidth="10" strokeLinecap="round"/>

                  {/* === LEFT ARM (lead arm, far side — extended driving bat through zone) === */}
                  {/* Upper arm: left shoulder outward */}
                  <path d="M28,44 Q18,50 16,62" fill="none" stroke="#374151" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round"/>
                  {/* Forearm: from elbow continuing to hands at bat */}
                  <path d="M16,62 Q22,70 46,72" fill="none" stroke="#374151" strokeWidth="9" strokeLinecap="round"/>

                  {/* === HANDS / GRIP === where both hands meet on bat */}
                  <ellipse cx="50" cy="73" rx="7" ry="5" fill="#374151"/>

                  {/* === BAT === horizontal mid-swing, sweeping from right side to left (3rd base side) */}
                  {/* Bat handle end (near hands, on right side of our view — 1st base side) */}
                  {/* At contact/mid-swing the bat is roughly horizontal, barrel extending to our left */}
                  {/* Handle knob */}
                  <ellipse cx="68" cy="72" rx="4" ry="3.5" fill="#374151"/>
                  {/* Bat shaft sweeping left from hands */}
                  <path d="M64,72 L16,68" stroke="#374151" strokeWidth="5" strokeLinecap="round"/>
                  {/* Bat barrel (wider, left side — 3rd base direction) */}
                  <ellipse cx="12" cy="67" rx="5" ry="7" fill="#374151" transform="rotate(-5 12 67)"/>

                  {/* === HIPS / BELT === rotated open, wider perspective */}
                  <path d="M28,92 L72,92 L74,106 L26,106 Z" fill="#374151"/>

                  {/* === FRONT LEG (left leg — stride foot, planted toward pitcher, knee firm) === */}
                  {/* Thigh: angles slightly left (open stance step) */}
                  <path d="M34,106 Q28,122 26,140" fill="none" stroke="#374151" strokeWidth="14" strokeLinecap="round"/>
                  {/* Lower leg: shin straight down, weight loaded on front foot */}
                  <path d="M26,140 Q24,156 26,168" fill="none" stroke="#374151" strokeWidth="13" strokeLinecap="round"/>
                  {/* Front foot — angled toward pitcher (pointing at us) — foreshortened ellipse */}
                  <ellipse cx="26" cy="170" rx="10" ry="5" fill="#374151"/>

                  {/* === BACK LEG (right leg — pivot leg, rising on toes as hips open) === */}
                  {/* Thigh: angles right and slightly back */}
                  <path d="M64,106 Q72,120 74,138" fill="none" stroke="#374151" strokeWidth="13" strokeLinecap="round"/>
                  {/* Lower leg: calf, slightly bent knee, weight shifting off */}
                  <path d="M74,138 Q76,154 72,166" fill="none" stroke="#374151" strokeWidth="12" strokeLinecap="round"/>
                  {/* Back foot — turned sideways (parallel to plate), toe pivot */}
                  <path d="M64,168 Q70,172 80,171 Q82,168 78,166 Q70,167 66,166 Z" fill="#374151"/>
                </svg>
                <div className="flex flex-col gap-1">
                {[[1,2,3],[4,5,6],[7,8,9]].map((row) => (
                  <div key={row[0]} className="flex gap-1">
                    {row.map((zoneNum) => {
                      const z = zoneContactData.find(z => z.zone === zoneNum);
                      const pct = z?.contactPct;
                      const swings = z?.swings ?? 0;
                      // Color: green=high contact, red=low contact
                      let bg = 'bg-gray-200 dark:bg-gray-600';
                      let textColor = 'text-gray-500 dark:text-gray-400';
                      if (pct !== null && pct !== undefined && swings >= 5) {
                        if (pct >= 90) { bg = 'bg-green-600'; textColor = 'text-white'; }
                        else if (pct >= 80) { bg = 'bg-green-400'; textColor = 'text-white'; }
                        else if (pct >= 70) { bg = 'bg-yellow-400'; textColor = 'text-gray-900'; }
                        else if (pct >= 60) { bg = 'bg-orange-400'; textColor = 'text-white'; }
                        else { bg = 'bg-red-500'; textColor = 'text-white'; }
                      }
                      return (
                        <div
                          key={zoneNum}
                          className={`${bg} rounded w-11 h-11 flex flex-col items-center justify-center`}
                          title={`Zone ${zoneNum}: ${pct !== null && pct !== undefined ? pct + '%' : '—'} (${swings} swings) - 2025`}
                        >
                          <div className={`text-xs font-bold ${textColor}`}>
                            {pct !== null && pct !== undefined && swings >= 5 ? `${pct}%` : '—'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-gray-400 text-center py-4">No zone contact data available</div>
            )}
          </div>

          {/* xwOBA Zone Grid */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 flex-1 min-w-[220px]">
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-3 border-b border-gray-200 dark:border-gray-700 pb-1">
              Zone xwOBA
            </h2>
            {zoneContactLoading ? (
              <div className="text-xs text-gray-400 text-center py-4">Loading...</div>
            ) : zoneContactData && zoneContactData.some(z => z.xwobaN > 0) ? (
              <div className="flex flex-col items-center gap-1">
                {[[1,2,3],[4,5,6],[7,8,9]].map((row) => (
                  <div key={row[0]} className="flex gap-1">
                    {row.map((zoneNum) => {
                      const z = zoneContactData.find(z => z.zone === zoneNum);
                      const xw = z?.xwoba;
                      const n = z?.xwobaN ?? 0;
                      let bg = 'bg-gray-200 dark:bg-gray-600';
                      let textColor = 'text-gray-500 dark:text-gray-400';
                      if (xw !== null && xw !== undefined && n >= 5) {
                        if (xw >= 0.600) { bg = 'bg-green-600'; textColor = 'text-white'; }
                        else if (xw >= 0.450) { bg = 'bg-green-400'; textColor = 'text-white'; }
                        else if (xw >= 0.350) { bg = 'bg-yellow-400'; textColor = 'text-gray-900'; }
                        else if (xw >= 0.250) { bg = 'bg-orange-400'; textColor = 'text-white'; }
                        else { bg = 'bg-red-500'; textColor = 'text-white'; }
                      }
                      return (
                        <div
                          key={zoneNum}
                          className={`${bg} rounded w-11 h-11 flex flex-col items-center justify-center`}
                          title={`Zone ${zoneNum}: xwOBA ${xw !== null && xw !== undefined ? xw.toFixed(3) : '—'} (${n} pitches) - 2025`}
                        >
                          <div className={`text-xs font-bold ${textColor}`}>
                            {xw !== null && xw !== undefined && n >= 5 ? xw.toFixed(3) : '—'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}

              </div>
            ) : (
              <div className="text-xs text-gray-400 text-center py-4">No xwOBA zone data available</div>
            )}
          </div>
          </div>
        )}

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
                      <div className="text-xs font-bold text-cyan-400 ml-2 whitespace-nowrap">
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
                          <div className={`text-[10px] ${(similarPlayer['z-swing%'] - player['z-swing%']) >= 0 ? 'text-green-400' : '—'}`}>
                            {(similarPlayer['z-swing%'] - player['z-swing%']) >= 0 ? '+' : '—'}{(similarPlayer['z-swing%'] - player['z-swing%']).toFixed(1)}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400">ZWH</div>
                        <div className="text-sm font-semibold text-white">
                          {similarPlayer['z-whiff%']?.toFixed(1) ?? 'N/A'}
                        </div>
                        {similarPlayer['z-whiff%'] != null && player['z-whiff%'] != null && (
                          <div className={`text-[10px] ${(similarPlayer['z-whiff%'] - player['z-whiff%']) >= 0 ? 'text-red-400' : '—'}`}>
                            {(similarPlayer['z-whiff%'] - player['z-whiff%']) >= 0 ? '+' : '—'}{(similarPlayer['z-whiff%'] - player['z-whiff%']).toFixed(1)}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400">CHS</div>
                        <div className="text-sm font-semibold text-white">
                          {similarPlayer['chase%']?.toFixed(1) ?? 'N/A'}
                        </div>
                        {similarPlayer['chase%'] != null && player['chase%'] != null && (
                          <div className={`text-[10px] ${(similarPlayer['chase%'] - player['chase%']) >= 0 ? 'text-red-400' : '—'}`}>
                            {(similarPlayer['chase%'] - player['chase%']) >= 0 ? '+' : '—'}{(similarPlayer['chase%'] - player['chase%']).toFixed(1)}
                          </div>
                        )}
                      </div>
                      {/* Row 2: OWH, EV90, LA */}
                      <div>
                        <div className="text-[10px] text-gray-400">OWH</div>
                        <div className="text-sm font-semibold text-white">
                          {similarPlayer['o-whiff%']?.toFixed(1) ?? 'N/A'}
                        </div>
                        {similarPlayer['o-whiff%'] != null && player['o-whiff%'] != null && (
                          <div className={`text-[10px] ${(similarPlayer['o-whiff%'] - player['o-whiff%']) >= 0 ? 'text-red-400' : '—'}`}>
                            {(similarPlayer['o-whiff%'] - player['o-whiff%']) >= 0 ? '+' : '—'}{(similarPlayer['o-whiff%'] - player['o-whiff%']).toFixed(1)}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400">EV90</div>
                        <div className="text-sm font-semibold text-white">
                          {similarPlayer.ev90?.toFixed(1) ?? 'N/A'}
                        </div>
                        {similarPlayer.ev90 != null && player.ev90 != null && (
                          <div className={`text-[10px] ${(similarPlayer.ev90 - player.ev90) >= 0 ? 'text-green-400' : '—'}`}>
                            {(similarPlayer.ev90 - player.ev90) >= 0 ? '+' : '—'}{(similarPlayer.ev90 - player.ev90).toFixed(1)}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400">LA</div>
                        <div className="text-sm font-semibold text-white">
                          {similarPlayer.avg_la?.toFixed(1) ?? 'N/A'}
                        </div>
                        {similarPlayer.avg_la != null && player.avg_la != null && (
                          <div className={`text-[10px] ${(similarPlayer.avg_la - player.avg_la) >= 0 ? 'text-green-400' : '—'}`}>
                            {(similarPlayer.avg_la - player.avg_la) >= 0 ? '+' : '—'}{(similarPlayer.avg_la - player.avg_la).toFixed(1)}
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
