'use client';

import { useState } from 'react';
import { getAllPlayers } from '@/lib/database';
import { findSimilarPlayersBySwingDecision } from '@/lib/similarity';
import { DATASETS } from '@/lib/datasets';
import { Player } from '@/types/player';
import Link from 'next/link';

export default function CustomSimilarityPage() {
  const [selectedDataset, setSelectedDataset] = useState<string>('a2025');
  const [zSwing, setZSwing] = useState<string>('');
  const [zWhiff, setZWhiff] = useState<string>('');
  const [chase, setChase] = useState<string>('');
  const [oWhiff, setOWhiff] = useState<string>('');
  const [avgLa, setAvgLa] = useState<string>('');
  const [maxEv, setMaxEv] = useState<string>('');
  const [similarPlayers, setSimilarPlayers] = useState<Array<{ player: Player; score: number }>>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = () => {
    // Create a custom player object with the entered stats
    const customPlayer: Player = {
      full_name: 'Custom Search',
      first_name: 'Custom',
      last_name: 'Search',
      team: null,
      'z-swing%': zSwing ? parseFloat(zSwing) : undefined,
      'z-whiff%': zWhiff ? parseFloat(zWhiff) : undefined,
      'chase%': chase ? parseFloat(chase) : undefined,
      'o-whiff%': oWhiff ? parseFloat(oWhiff) : undefined,
      avg_la: avgLa ? parseFloat(avgLa) : undefined,
      max_ev: maxEv ? parseFloat(maxEv) : undefined,
    };

    // Get players from selected dataset
    const mlbPlayers = getAllPlayers('mlb2025');
    const aaaPlayers = getAllPlayers('aaa2025');
    const allPlayersForComparison = [...mlbPlayers, ...aaaPlayers];

    // Use A dataset type to apply the custom weights
    const results = findSimilarPlayersBySwingDecision(customPlayer, allPlayersForComparison, 10, 'a');
    setSimilarPlayers(results);
    setHasSearched(true);
  };

  const handleReset = () => {
    setZSwing('');
    setZWhiff('');
    setChase('');
    setOWhiff('');
    setAvgLa('');
    setMaxEv('');
    setSimilarPlayers([]);
    setHasSearched(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                Custom Similarity Search
              </h1>
              <p className="text-gray-600 dark:text-gray-300 mt-1">
                Enter stats to find similar players
              </p>
            </div>
            <Link
              href="/"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              ← Back to Players
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Input Form */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Enter Player Stats
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Enter at least 3 stats to find similar players. Uses A dataset weights: Avg LA (3.5x), Max EV (2.5x), O-Whiff (0.5x)
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {/* Z-Swing% */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Z-Swing% (1x)
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 65.5"
                  value={zSwing}
                  onChange={(e) => setZSwing(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-gray-900 dark:text-white"
                />
              </div>

              {/* Z-Whiff% */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Z-Whiff% (1x)
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 22.3"
                  value={zWhiff}
                  onChange={(e) => setZWhiff(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-gray-900 dark:text-white"
                />
              </div>

              {/* Chase% */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Chase% (1x)
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 28.5"
                  value={chase}
                  onChange={(e) => setChase(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-gray-900 dark:text-white"
                />
              </div>

              {/* O-Whiff% */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  O-Whiff% (0.5x) - Optional
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 35.2"
                  value={oWhiff}
                  onChange={(e) => setOWhiff(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-gray-900 dark:text-white"
                />
              </div>

              {/* Avg LA */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Avg LA (3.5x) - Optional
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 12.5"
                  value={avgLa}
                  onChange={(e) => setAvgLa(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-gray-900 dark:text-white"
                />
              </div>

              {/* Max EV */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Max EV (2.5x) - Optional
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 108.5"
                  value={maxEv}
                  onChange={(e) => setMaxEv(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={handleSearch}
                className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
              >
                Find Similar Players
              </button>
              <button
                onClick={handleReset}
                className="px-6 py-3 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-semibold rounded-lg transition-colors"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Results */}
          {hasSearched && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                Similar Players {similarPlayers.length > 0 && `(${similarPlayers.length})`}
              </h2>

              {similarPlayers.length === 0 ? (
                <p className="text-gray-600 dark:text-gray-400">
                  No similar players found. Try entering at least 3 stats.
                </p>
              ) : (
                <div className="space-y-3">
                  {similarPlayers.map(({ player, score }, index) => (
                    <Link
                      key={player.player_id || player.full_name}
                      href={`/player/${player.player_id || encodeURIComponent(player.full_name)}`}
                      className="block p-4 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl font-bold text-gray-400 dark:text-gray-500">
                              #{index + 1}
                            </span>
                            <div>
                              <h3 className="font-semibold text-gray-900 dark:text-white">
                                {player.full_name}
                              </h3>
                              <div className="flex gap-3 text-xs text-gray-600 dark:text-gray-400 mt-1">
                                {player['z-swing%'] !== null && player['z-swing%'] !== undefined && (
                                  <span>Z-Swing: {player['z-swing%'].toFixed(1)}%</span>
                                )}
                                {player['z-whiff%'] !== null && player['z-whiff%'] !== undefined && (
                                  <span>Z-Whiff: {player['z-whiff%'].toFixed(1)}%</span>
                                )}
                                {player['chase%'] !== null && player['chase%'] !== undefined && (
                                  <span>Chase: {player['chase%'].toFixed(1)}%</span>
                                )}
                                {player['o-whiff%'] !== null && player['o-whiff%'] !== undefined && (
                                  <span>O-Whiff: {player['o-whiff%'].toFixed(1)}%</span>
                                )}
                                {player.avg_la !== null && player.avg_la !== undefined && (
                                  <span>Avg LA: {player.avg_la.toFixed(1)}°</span>
                                )}
                                {player.max_ev !== null && player.max_ev !== undefined && (
                                  <span>Max EV: {player.max_ev.toFixed(1)}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="text-sm bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-3 py-1 rounded whitespace-nowrap">
                          Similarity: {(100 - Math.min(score, 100)).toFixed(0)}%
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
