'use client';

import { useState, useMemo, useEffect } from 'react';
import { getAllPitchers, getPitcherTeams } from '@/lib/pitcher-database';
import { DATASETS, DEFAULT_DATASET_ID } from '@/lib/datasets';
import PitcherCard from '@/components/PitcherCard';

export default function PitchersPage() {
  const [selectedDataset, setSelectedDataset] = useState<string>(DEFAULT_DATASET_ID);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('name');
  const [isClient, setIsClient] = useState(false);
  const [selectedPitchers, setSelectedPitchers] = useState<number[]>([]);
  const [ageMin, setAgeMin] = useState<string>('');
  const [ageMax, setAgeMax] = useState<string>('');
  const [fbVeloMin, setFbVeloMin] = useState<string>('');
  const [eraMax, setEraMax] = useState<string>('');
  const [kPer9Min, setKPer9Min] = useState<string>('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Load dataset preference from localStorage
  useEffect(() => {
    setIsClient(true);
    const savedDataset = localStorage.getItem('selectedPitcherDataset');
    if (savedDataset) {
      setSelectedDataset(savedDataset);
    }
  }, []);

  // Save dataset preference to localStorage
  useEffect(() => {
    if (isClient) {
      localStorage.setItem('selectedPitcherDataset', selectedDataset);
      // Reset selected pitchers when dataset changes
      setSelectedPitchers([]);
    }
  }, [selectedDataset, isClient]);

  const allPitchers = getAllPitchers(selectedDataset);
  const teams = getPitcherTeams(selectedDataset);

  const handlePitcherSelection = (playerId: number) => {
    setSelectedPitchers((prev) => {
      if (prev.includes(playerId)) {
        return prev.filter((id) => id !== playerId);
      } else if (prev.length < 2) {
        return [...prev, playerId];
      } else {
        return prev;
      }
    });
  };

  const filteredAndSortedPitchers = useMemo(() => {
    let filtered = allPitchers;

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.full_name?.toLowerCase().includes(query) ||
          p.team?.toLowerCase().includes(query)
      );
    }

    // Filter by team
    if (selectedTeam !== 'all') {
      filtered = filtered.filter((p) => p.team === selectedTeam);
    }

    // Filter by age range
    if (ageMin) {
      filtered = filtered.filter((p) => p.age !== undefined && p.age >= parseInt(ageMin));
    }
    if (ageMax) {
      filtered = filtered.filter((p) => p.age !== undefined && p.age <= parseInt(ageMax));
    }

    // Filter by fastball velocity
    if (fbVeloMin) {
      filtered = filtered.filter((p) => p.fastball_velo !== undefined && p.fastball_velo >= parseFloat(fbVeloMin));
    }

    // Filter by ERA
    if (eraMax) {
      filtered = filtered.filter((p) => (p.era || 999) <= parseFloat(eraMax));
    }

    // Filter by K/9
    if (kPer9Min) {
      filtered = filtered.filter((p) => (p.k_per_9 || 0) >= parseFloat(kPer9Min));
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.full_name || '').localeCompare(b.full_name || '');
        case 'fastball_velo':
          return (b.fastball_velo || 0) - (a.fastball_velo || 0);
        case 'era':
          return (a.era || 999) - (b.era || 999);
        case 'whip':
          return (a.whip || 999) - (b.whip || 999);
        case 'k_per_9':
          return (b.k_per_9 || 0) - (a.k_per_9 || 0);
        case 'age':
          return (a.age || 0) - (b.age || 0);
        case 'ip':
          return (b.ip || 0) - (a.ip || 0);
        default:
          return 0;
      }
    });

    return sorted;
  }, [allPitchers, searchQuery, selectedTeam, sortBy, ageMin, ageMax, fbVeloMin, eraMax, kPer9Min]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-4">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                  MLB Pitcher Stat Database
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
                {filteredAndSortedPitchers.length} pitchers
                {!isClient && <span className="text-xs ml-2">(Loading...)</span>}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <a
                href="/"
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors text-sm"
              >
                View Hitters
              </a>
              <div className="text-sm text-gray-500 dark:text-gray-400 italic">
                By: Zack McKeown
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Search and Filters */}
      <div className="container mx-auto px-4 py-6">
        {/* Compare Button */}
        {selectedPitchers.length === 2 && (
          <div className="bg-blue-600 dark:bg-blue-700 text-white rounded-lg shadow-lg p-4 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-semibold">2 pitchers selected for comparison</span>
              <button
                onClick={() => setSelectedPitchers([])}
                className="text-sm underline hover:no-underline"
              >
                Clear Selection
              </button>
            </div>
            <a
              href={`/compare-pitchers?pitcher1=${selectedPitchers[0]}&pitcher2=${selectedPitchers[1]}`}
              className="bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 px-6 py-2 rounded-lg font-semibold hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Compare Pitchers →
            </a>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div>
              <label htmlFor="search-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Search Pitchers
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
                <option value="fastball_velo">Fastball Velocity</option>
                <option value="era">ERA</option>
                <option value="whip">WHIP</option>
                <option value="k_per_9">K/9</option>
                <option value="ip">Innings Pitched</option>
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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

                {/* FB Velo Min */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Min FB Velo (mph)
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 95"
                    value={fbVeloMin}
                    onChange={(e) => setFbVeloMin(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600 outline-none text-gray-900 dark:text-white text-sm"
                  />
                </div>

                {/* ERA Max */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Max ERA
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 3.5"
                    value={eraMax}
                    onChange={(e) => setEraMax(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600 outline-none text-gray-900 dark:text-white text-sm"
                  />
                </div>

                {/* K/9 Min */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Min K/9
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 9.0"
                    value={kPer9Min}
                    onChange={(e) => setKPer9Min(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600 outline-none text-gray-900 dark:text-white text-sm"
                  />
                </div>

                {/* Clear Filters */}
                <div className="flex items-end">
                  <button
                    onClick={() => {
                      setAgeMin('');
                      setAgeMax('');
                      setFbVeloMin('');
                      setEraMax('');
                      setKPer9Min('');
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

        {/* Pitcher Grid */}
        {filteredAndSortedPitchers.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
            <p className="text-gray-600 dark:text-gray-300 text-lg">No pitchers found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAndSortedPitchers.map((pitcher) => (
              <PitcherCard
                key={pitcher.player_id || pitcher.full_name}
                pitcher={pitcher}
                isSelected={pitcher.player_id ? selectedPitchers.includes(pitcher.player_id) : false}
                onSelect={handlePitcherSelection}
                selectionDisabled={!pitcher.player_id || (selectedPitchers.length >= 2 && !selectedPitchers.includes(pitcher.player_id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
