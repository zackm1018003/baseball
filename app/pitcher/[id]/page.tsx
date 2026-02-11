'use client';

import { use, useState, useEffect } from 'react';
import { getPitcherById, getPitcherByName } from '@/lib/pitcher-database';
import { DEFAULT_DATASET_ID, DATASETS } from '@/lib/datasets';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { fetchMLBPlayer } from '@/lib/mlb-api';
import { getCollegeLogoUrl } from '@/lib/college-logos';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import PitchMovementChart from '@/components/PitchMovementChart';
import Image from 'next/image';
import Link from 'next/link';

interface PitcherPageProps {
  params: Promise<{ id: string }>;
}

interface MLBPlayerData {
  height?: string;
  weight?: number;
  pitchHand?: {
    code: string;
    description: string;
  };
  birthCountry?: string;
  birthDate?: string;
  currentAge?: number;
}

export default function PitcherPage({ params }: PitcherPageProps) {
  const { id } = use(params);
  const [selectedDataset, setSelectedDataset] = useState<string>(DEFAULT_DATASET_ID);
  const [isClient, setIsClient] = useState(false);
  const [imageError, setImageError] = useState(0);
  const [mlbData, setMlbData] = useState<MLBPlayerData | null>(null);

  // Load dataset preference from localStorage
  useEffect(() => {
    setIsClient(true);
    const savedDataset = localStorage.getItem('selectedPitcherDataset');
    if (savedDataset) {
      setSelectedDataset(savedDataset);
    }
  }, []);

  // Determine if id is numeric (player_id) or a name (URL-encoded full_name)
  const isNumericId = /^\d+$/.test(id);
  const decodedName = isNumericId ? null : decodeURIComponent(id);

  // Try to find pitcher in selected dataset, if not found try all datasets
  let pitcher = isNumericId
    ? getPitcherById(parseInt(id), selectedDataset)
    : getPitcherByName(decodedName!, selectedDataset);
  let actualDataset = selectedDataset;

  if (!pitcher) {
    // Pitcher not in current dataset, try all datasets
    for (const dataset of DATASETS) {
      pitcher = isNumericId
        ? getPitcherById(parseInt(id), dataset.id)
        : getPitcherByName(decodedName!, dataset.id);

      if (pitcher) {
        actualDataset = dataset.id;
        setSelectedDataset(dataset.id);
        if (isClient) {
          localStorage.setItem('selectedPitcherDataset', dataset.id);
        }
        break;
      }
    }
  }

  // Fetch MLB API data for height, weight, handedness
  useEffect(() => {
    if (pitcher?.player_id) {
      fetchMLBPlayer(pitcher.player_id).then((data) => {
        if (data) {
          setMlbData(data);
        }
      });
    }
  }, [pitcher?.player_id]);

  if (!pitcher) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
        <div className="container mx-auto px-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Pitcher Not Found</h1>
            <Link href="/pitchers" className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">
              Return to Pitchers
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Image sources
  const imageSources = [
    getMLBStaticPlayerImage(pitcher.player_id, { width: 426 }),
    getESPNPlayerImage(pitcher.player_id),
    '/api/placeholder/400/400',
  ];
  const currentImage = imageSources[imageError] || imageSources[imageSources.length - 1];

  const handleImageError = () => {
    if (imageError < imageSources.length - 1) {
      setImageError(imageError + 1);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/pitchers" className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium">
              ← Back to Pitchers
            </Link>
            <Link href="/" className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 font-medium">
              View Hitters →
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Pitcher Header */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
          <div className="flex flex-col md:flex-row gap-6 items-start">
            {/* Pitcher Image */}
            <div className="flex-shrink-0">
              <div className="relative w-40 h-40 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
                <Image
                  src={currentImage}
                  alt={pitcher.full_name || 'Pitcher'}
                  fill
                  className="object-cover"
                  onError={handleImageError}
                  unoptimized
                />
              </div>
            </div>

            {/* Pitcher Info */}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
                  {pitcher.full_name}
                </h1>
                {pitcher.team && getMLBTeamLogoUrl(pitcher.team) && (
                  <img
                    src={getMLBTeamLogoUrl(pitcher.team)!}
                    alt={pitcher.team}
                    className="w-12 h-12 object-contain"
                  />
                )}
              </div>

              <div className="flex flex-wrap gap-3 mb-4">
                {pitcher.team && (
                  <span className="inline-flex items-center px-3 py-1 rounded-lg text-sm font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                    {pitcher.team}
                  </span>
                )}
                {pitcher.college && (
                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-lg text-sm font-medium bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200">
                    {getCollegeLogoUrl(pitcher.college) && (
                      <img
                        src={getCollegeLogoUrl(pitcher.college)!}
                        alt={pitcher.college}
                        className="w-5 h-5 object-contain"
                      />
                    )}
                    {pitcher.college}
                  </span>
                )}
                {pitcher.throws && (
                  <span className="inline-flex items-center px-3 py-1 rounded-lg text-sm font-medium bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                    {pitcher.throws}HP
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                {(pitcher.age || mlbData?.currentAge) && (
                  <div>
                    <div className="text-gray-500 dark:text-gray-400">Age</div>
                    <div className="font-semibold text-gray-900 dark:text-white">{pitcher.age || mlbData?.currentAge}</div>
                  </div>
                )}
                {mlbData?.height && (
                  <div>
                    <div className="text-gray-500 dark:text-gray-400">Height</div>
                    <div className="font-semibold text-gray-900 dark:text-white">{mlbData.height}</div>
                  </div>
                )}
                {mlbData?.weight && (
                  <div>
                    <div className="text-gray-500 dark:text-gray-400">Weight</div>
                    <div className="font-semibold text-gray-900 dark:text-white">{mlbData.weight} lbs</div>
                  </div>
                )}
                {pitcher.player_id && (
                  <div>
                    <div className="text-gray-500 dark:text-gray-400">Player ID</div>
                    <div className="font-semibold text-gray-900 dark:text-white">{pitcher.player_id}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Pitch Movement Chart */}
        <div className="mb-6">
          <PitchMovementChart pitcher={pitcher} year={2025} />
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Velocity Stats */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Pitch Velocity</h3>
            <div className="space-y-3">
              {pitcher.fastball_velo && (
                <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-gray-700 dark:text-gray-300">Fastball</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{pitcher.fastball_velo.toFixed(1)} mph</span>
                </div>
              )}
              {pitcher.slider_velo && (
                <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-gray-700 dark:text-gray-300">Slider</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{pitcher.slider_velo.toFixed(1)} mph</span>
                </div>
              )}
              {pitcher.changeup_velo && (
                <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-gray-700 dark:text-gray-300">Changeup</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{pitcher.changeup_velo.toFixed(1)} mph</span>
                </div>
              )}
              {pitcher.curveball_velo && (
                <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-gray-700 dark:text-gray-300">Curveball</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{pitcher.curveball_velo.toFixed(1)} mph</span>
                </div>
              )}
              {pitcher.cutter_velo && (
                <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-gray-700 dark:text-gray-300">Cutter</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{pitcher.cutter_velo.toFixed(1)} mph</span>
                </div>
              )}
            </div>
          </div>

          {/* Spin Rate Stats */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Spin Rate</h3>
            <div className="space-y-3">
              {pitcher.fastball_spin && (
                <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-gray-700 dark:text-gray-300">Fastball</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{pitcher.fastball_spin} rpm</span>
                </div>
              )}
              {pitcher.slider_spin && (
                <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-gray-700 dark:text-gray-300">Slider</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{pitcher.slider_spin} rpm</span>
                </div>
              )}
              {pitcher.changeup_spin && (
                <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-gray-700 dark:text-gray-300">Changeup</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{pitcher.changeup_spin} rpm</span>
                </div>
              )}
              {pitcher.curveball_spin && (
                <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-gray-700 dark:text-gray-300">Curveball</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{pitcher.curveball_spin} rpm</span>
                </div>
              )}
              {pitcher.cutter_spin && (
                <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-gray-700 dark:text-gray-300">Cutter</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{pitcher.cutter_spin} rpm</span>
                </div>
              )}
            </div>
          </div>

          {/* Traditional Stats */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">2025 Season Stats</h3>
            <div className="grid grid-cols-2 gap-4">
              {pitcher.era !== undefined && (
                <div>
                  <div className="text-gray-500 dark:text-gray-400 text-sm">ERA</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{pitcher.era.toFixed(2)}</div>
                </div>
              )}
              {pitcher.whip !== undefined && (
                <div>
                  <div className="text-gray-500 dark:text-gray-400 text-sm">WHIP</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{pitcher.whip.toFixed(2)}</div>
                </div>
              )}
              {pitcher.k_per_9 !== undefined && (
                <div>
                  <div className="text-gray-500 dark:text-gray-400 text-sm">K/9</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{pitcher.k_per_9.toFixed(1)}</div>
                </div>
              )}
              {pitcher.bb_per_9 !== undefined && (
                <div>
                  <div className="text-gray-500 dark:text-gray-400 text-sm">BB/9</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{pitcher.bb_per_9.toFixed(1)}</div>
                </div>
              )}
              {pitcher.ip !== undefined && (
                <div>
                  <div className="text-gray-500 dark:text-gray-400 text-sm">IP</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{pitcher.ip.toFixed(1)}</div>
                </div>
              )}
              {pitcher.wins !== undefined && (
                <div>
                  <div className="text-gray-500 dark:text-gray-400 text-sm">Wins</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{pitcher.wins}</div>
                </div>
              )}
              {pitcher.losses !== undefined && (
                <div>
                  <div className="text-gray-500 dark:text-gray-400 text-sm">Losses</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{pitcher.losses}</div>
                </div>
              )}
              {pitcher.saves !== undefined && (
                <div>
                  <div className="text-gray-500 dark:text-gray-400 text-sm">Saves</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{pitcher.saves}</div>
                </div>
              )}
            </div>
          </div>

          {/* Pitch Usage */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Pitch Usage</h3>
            <div className="space-y-3">
              {pitcher.fastball_usage && (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-gray-700 dark:text-gray-300">Fastball</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{pitcher.fastball_usage.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-red-500 h-2 rounded-full"
                      style={{ width: `${pitcher.fastball_usage}%` }}
                    />
                  </div>
                </div>
              )}
              {pitcher.slider_usage && (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-gray-700 dark:text-gray-300">Slider</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{pitcher.slider_usage.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-yellow-500 h-2 rounded-full"
                      style={{ width: `${pitcher.slider_usage}%` }}
                    />
                  </div>
                </div>
              )}
              {pitcher.changeup_usage && (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-gray-700 dark:text-gray-300">Changeup</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{pitcher.changeup_usage.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full"
                      style={{ width: `${pitcher.changeup_usage}%` }}
                    />
                  </div>
                </div>
              )}
              {pitcher.curveball_usage && (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-gray-700 dark:text-gray-300">Curveball</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{pitcher.curveball_usage.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-cyan-500 h-2 rounded-full"
                      style={{ width: `${pitcher.curveball_usage}%` }}
                    />
                  </div>
                </div>
              )}
              {pitcher.cutter_usage && (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-gray-700 dark:text-gray-300">Cutter</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{pitcher.cutter_usage.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-orange-500 h-2 rounded-full"
                      style={{ width: `${pitcher.cutter_usage}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
