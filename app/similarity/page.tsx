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
  const [ev90, setEv90] = useState<string>('');
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
      ev90: ev90 ? parseFloat(ev90) : undefined,
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
    setEv90('');
    setSimilarPlayers([]);
    setHasSearched(false);
  };

  return (
    <div className="min-h-screen bg-page">
      {/* Header */}
      <header className="bg-panel border-b border-ink/20">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-display text-3xl uppercase tracking-[0.02em] text-ink">
                Custom Similarity Search
              </h1>
              <p className="text-ink-3-2 mt-1">
                Enter stats to find similar players
              </p>
            </div>
            <Link
              href="/"
              className="px-4 py-2 bg-deep hover:bg-panel text-deep-fg transition-colors"
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
          <div className="bg-panel p-6 mb-6">
            <h2 className="text-xl font-semibold text-ink mb-4">
              Enter Player Stats
            </h2>
            <p className="text-sm text-ink-3-3 mb-4">
              Enter at least 3 stats to find similar players. Uses A dataset weights: Avg LA (3.5x), EV90 (2.5x), O-Whiff (0.5x)
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {/* Z-Swing% */}
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2">
                  Z-Swing% (1x)
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 65.5"
                  value={zSwing}
                  onChange={(e) => setZSwing(e.target.value)}
                  className="w-full px-4 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink outline-none text-ink"
                />
              </div>

              {/* Z-Whiff% */}
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2">
                  Z-Whiff% (1x)
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 22.3"
                  value={zWhiff}
                  onChange={(e) => setZWhiff(e.target.value)}
                  className="w-full px-4 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink outline-none text-ink"
                />
              </div>

              {/* Chase% */}
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2">
                  Chase% (1x)
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 28.5"
                  value={chase}
                  onChange={(e) => setChase(e.target.value)}
                  className="w-full px-4 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink outline-none text-ink"
                />
              </div>

              {/* O-Whiff% */}
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2">
                  O-Whiff% (0.5x) - Optional
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 35.2"
                  value={oWhiff}
                  onChange={(e) => setOWhiff(e.target.value)}
                  className="w-full px-4 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink outline-none text-ink"
                />
              </div>

              {/* Avg LA */}
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2">
                  Avg LA (3.5x) - Optional
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 12.5"
                  value={avgLa}
                  onChange={(e) => setAvgLa(e.target.value)}
                  className="w-full px-4 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink outline-none text-ink"
                />
              </div>

              {/* EV90 */}
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2">
                  EV90 (2.5x) - Optional
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 100.5"
                  value={ev90}
                  onChange={(e) => setEv90(e.target.value)}
                  className="w-full px-4 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink outline-none text-ink"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={handleSearch}
                className="flex-1 px-6 py-3 bg-deep hover:bg-panel text-deep-fg font-semibold transition-colors"
              >
                Find Similar Players
              </button>
              <button
                onClick={handleReset}
                className="px-6 py-3 bg-bone hover:bg-bone text-ink font-semibold transition-colors"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Results */}
          {hasSearched && (
            <div className="bg-panel p-6">
              <h2 className="text-xl font-semibold text-ink mb-4">
                Similar Players {similarPlayers.length > 0 && `(${similarPlayers.length})`}
              </h2>

              {similarPlayers.length === 0 ? (
                <p className="text-ink-3-3">
                  No similar players found. Try entering at least 3 stats.
                </p>
              ) : (
                <div className="space-y-3">
                  {similarPlayers.map(({ player, score }, index) => (
                    <Link
                      key={player.player_id || player.full_name}
                      href={`/player/${player.player_id || encodeURIComponent(player.full_name)}`}
                      className="block p-4 bg-bone hover:bg-bone transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl font-bold text-ink-3-4">
                              #{index + 1}
                            </span>
                            <div>
                              <h3 className="font-semibold text-ink">
                                {player.full_name}
                              </h3>
                              <div className="flex gap-3 text-xs text-ink-3-3 mt-1">
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
                                {player.ev90 !== null && player.ev90 !== undefined && (
                                  <span>EV90: {player.ev90.toFixed(1)}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="text-sm bg-walk text-outcome-fg px-3 py-1 rounded whitespace-nowrap">
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
