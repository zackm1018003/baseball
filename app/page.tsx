'use client';

import { useState, useMemo, useEffect } from 'react';
import { getAllPlayers, getTeams } from '@/lib/database';
import { DATASETS, DEFAULT_DATASET_ID } from '@/lib/datasets';
import PlayerCard from '@/components/PlayerCard';

export default function Home() {
  const [selectedDataset, setSelectedDataset] = useState<string>(DEFAULT_DATASET_ID);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('name');
  const [isClient, setIsClient] = useState(false);
  const [selectedPlayers, setSelectedPlayers] = useState<number[]>([]);
  const [ageMin, setAgeMin] = useState<string>('');
  const [ageMax, setAgeMax] = useState<string>('');
  const [batSpeedMin, setBatSpeedMin] = useState<string>('');
  const [avgEvMin, setAvgEvMin] = useState<string>('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Load dataset preference from localStorage
  useEffect(() => {
    setIsClient(true);
    const savedDataset = localStorage.getItem('selectedDataset');
    if (savedDataset) {
      setSelectedDataset(savedDataset);
    }
  }, []);

  // Save dataset preference to localStorage
  useEffect(() => {
    if (isClient) {
      localStorage.setItem('selectedDataset', selectedDataset);
      // Reset selected players when dataset changes
      setSelectedPlayers([]);
    }
  }, [selectedDataset, isClient]);

  const allPlayers = getAllPlayers(selectedDataset);
  const teams = getTeams(selectedDataset);
  const isAAA = selectedDataset === 'aaa2025';

  const handlePlayerSelection = (playerId: number) => {
    setSelectedPlayers((prev) => {
      if (prev.includes(playerId)) {
        return prev.filter((id) => id !== playerId);
      } else if (prev.length < 2) {
        return [...prev, playerId];
      } else {
        return prev;
      }
    });
  };

  const filteredAndSortedPlayers = useMemo(() => {
    let filtered = allPlayers;

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.full_name?.toLowerCase().includes(query) ||
          p.first_name?.toLowerCase().includes(query) ||
          p.last_name?.toLowerCase().includes(query) ||
          p.team?.toLowerCase().includes(query)
      );
    }

    // Filter by team
    if (selectedTeam !== 'all') {
      filtered = filtered.filter((p) => p.team === selectedTeam);
    }

    // Filter by age range
    if (ageMin) {
      filtered = filtered.filter((p) => p.age >= parseInt(ageMin));
    }
    if (ageMax) {
      filtered = filtered.filter((p) => p.age <= parseInt(ageMax));
    }

    // Filter by bat speed
    if (batSpeedMin) {
      filtered = filtered.filter((p) => p.bat_speed >= parseFloat(batSpeedMin));
    }

    // Filter by average exit velocity
    if (avgEvMin) {
      filtered = filtered.filter((p) => (p.avg_ev || 0) >= parseFloat(avgEvMin));
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.full_name || '').localeCompare(b.full_name || '');
        case 'bat_speed':
          return (b.bat_speed || 0) - (a.bat_speed || 0);
        case 'avg_ev':
          return (b.avg_ev || 0) - (a.avg_ev || 0);
        case 'max_ev':
          return (b.max_ev || 0) - (a.max_ev || 0);
        case 'hard_hit':
          return (b['hard_hit%'] || 0) - (a['hard_hit%'] || 0);
        case 'age':
          return (a.age || 0) - (b.age || 0);
        default:
          return 0;
      }
    });

    return sorted;
  }, [allPlayers, searchQuery, selectedTeam, sortBy, ageMin, ageMax, batSpeedMin, avgEvMin]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-4">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                  MLB Player Stat Database
                </h1>
                {/* Dataset Selector */}
                <select
                  value={selectedDataset}
                  onChange={(e) => setSelectedDataset(e.target.value)}
                  className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg border-0 cursor-pointer transition-colors"
                >
                  {DATASETS.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mt-1">
                {filteredAndSortedPlayers.length} players
                {!isClient && <span className="text-xs ml-2">(Loading...)</span>}
              </p>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 italic">
              By: Zack McKeown
            </div>
          </div>
        </div>
      </header>

      {/* Search and Filters */}
      <div className="container mx-auto px-4 py-6">
        {/* Compare Button */}
        {selectedPlayers.length === 2 && (
          <div className="bg-blue-600 dark:bg-blue-700 text-white rounded-lg shadow-lg p-4 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-semibold">2 players selected for comparison</span>
              <button
                onClick={() => setSelectedPlayers([])}
                className="text-sm underline hover:no-underline"
              >
                Clear Selection
              </button>
            </div>
            <a
              href={`/compare?player1=${selectedPlayers[0]}&player2=${selectedPlayers[1]}`}
              className="bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 px-6 py-2 rounded-lg font-semibold hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Compare Players →
            </a>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div>
              <label htmlFor="search-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Search Players
              </label>
              <input
                id="search-input"
                type="text"
                placeholder="Search by name or team..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600 outline-none text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
              />
            </div>

            {/* Team Filter */}
            <div>
              <label htmlFor="team-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Filter by Team
              </label>
              <select
                id="team-filter"
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600 outline-none text-gray-900 dark:text-white"
              >
                <option value="all">All Teams</option>
                {teams.map((team) => (
                  <option key={team} value={team}>
                    {team}
                  </option>
                ))}
              </select>
            </div>

            {/* Sort */}
            <div>
              <label htmlFor="sort-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Sort By
              </label>
              <select
                id="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600 outline-none text-gray-900 dark:text-white"
              >
                <option value="name">Name</option>
                <option value="bat_speed">Bat Speed</option>
                <option value="avg_ev">Exit Velocity</option>
                <option value="max_ev">Max Exit Velocity</option>
                <option value="hard_hit">Hard Hit %</option>
                <option value="age">Age</option>
              </select>
            </div>
          </div>

          {/* Advanced Filters Toggle */}
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              {showAdvancedFilters ? '− Hide Advanced Filters' : '+ Show Advanced Filters'}
            </button>
          </div>

          {/* Advanced Filters */}
          {showAdvancedFilters && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Advanced Filters</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Age Range */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Age Range
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      value={ageMin}
                      onChange={(e) => setAgeMin(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600 outline-none text-gray-900 dark:text-white text-sm"
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      value={ageMax}
                      onChange={(e) => setAgeMax(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600 outline-none text-gray-900 dark:text-white text-sm"
                    />
                  </div>
                </div>

                {/* Bat Speed Min */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Min Bat Speed
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 72"
                    value={batSpeedMin}
                    onChange={(e) => setBatSpeedMin(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600 outline-none text-gray-900 dark:text-white text-sm"
                  />
                </div>

                {/* Avg EV Min */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Min Avg EV
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 90"
                    value={avgEvMin}
                    onChange={(e) => setAvgEvMin(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600 outline-none text-gray-900 dark:text-white text-sm"
                  />
                </div>

                {/* Clear Filters */}
                <div className="flex items-end">
                  <button
                    onClick={() => {
                      setAgeMin('');
                      setAgeMax('');
                      setBatSpeedMin('');
                      setAvgEvMin('');
                    }}
                    className="w-full px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm font-medium"
                  >
                    Clear Filters
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Player Grid */}
        {filteredAndSortedPlayers.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
            <p className="text-gray-600 dark:text-gray-300 text-lg">No players found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAndSortedPlayers.map((player) => (
              <PlayerCard
                key={player.player_id}
                player={player}
                isSelected={selectedPlayers.includes(player.player_id)}
                onSelect={handlePlayerSelection}
                selectionDisabled={selectedPlayers.length >= 2 && !selectedPlayers.includes(player.player_id)}
                isAAA={isAAA}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
