'use client';

import { useState, useMemo, useEffect } from 'react';
import { getAllPlayers, getTeams } from '@/lib/database';
import PlayerCard from '@/components/PlayerCard';

export default function Home() {
  const allPlayers = getAllPlayers();
  const teams = getTeams();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('name');
  const [isClient, setIsClient] = useState(false);

  // Ensure we're on the client side
  useEffect(() => {
    setIsClient(true);
  }, []);

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

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.full_name || '').localeCompare(b.full_name || '');
        case 'bat_speed':
          return (b.bat_speed || 0) - (a.bat_speed || 0);
        case 'avg_ev':
          return (b.avg_ev || 0) - (a.avg_ev || 0);
        case 'hard_hit':
          return (b['hard_hit%'] || 0) - (a['hard_hit%'] || 0);
        case 'age':
          return (a.age || 0) - (b.age || 0);
        default:
          return 0;
      }
    });

    return sorted;
  }, [allPlayers, searchQuery, selectedTeam, sortBy]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                MLB Player Stat Database
              </h1>
              <p className="text-gray-600 mt-1">
                {filteredAndSortedPlayers.length} players
                {!isClient && <span className="text-xs ml-2">(Loading...)</span>}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Search and Filters */}
      <div className="container mx-auto px-4 py-6">
        <div className="bg-white rounded-lg shadow-md p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div>
              <label htmlFor="search-input" className="block text-sm font-medium text-gray-700 mb-2">
                Search Players
              </label>
              <input
                id="search-input"
                type="text"
                placeholder="Search by name or team..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>

            {/* Team Filter */}
            <div>
              <label htmlFor="team-filter" className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Team
              </label>
              <select
                id="team-filter"
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
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
              <label htmlFor="sort-select" className="block text-sm font-medium text-gray-700 mb-2">
                Sort By
              </label>
              <select
                id="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                <option value="name">Name</option>
                <option value="bat_speed">Bat Speed</option>
                <option value="avg_ev">Exit Velocity</option>
                <option value="hard_hit">Hard Hit %</option>
                <option value="age">Age</option>
              </select>
            </div>
          </div>
        </div>

        {/* Player Grid */}
        {filteredAndSortedPlayers.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <p className="text-gray-600 text-lg">No players found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAndSortedPlayers.map((player) => (
              <PlayerCard key={player.player_id} player={player} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
