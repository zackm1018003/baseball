'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { getAllPitchers, getPitcherTeams } from '@/lib/pitcher-database';
import { DATASETS, DEFAULT_DATASET_ID } from '@/lib/datasets';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import PitcherCard from '@/components/PitcherCard';
import Link from 'next/link';

// ─── Daily pitcher types ───────────────────────────────────────────────────────

interface DailyPitcherLine {
  ip: string;
  h: number;
  er: number;
  bb: number;
  k: number;
  hr: number;
  pitches: number;
  bf: number;
}

interface DailyPitcher {
  playerId: number;
  name: string;
  team: string;
  opponent: string;
  isHome: boolean;
  gamePk: number;
  line: DailyPitcherLine | null;
}

interface DailyGame {
  gamePk: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
}

interface DailyData {
  date: string;
  games: DailyGame[];
  pitchers: DailyPitcher[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseIp(ip: string): number {
  if (!ip) return 0;
  const parts = ip.split('.');
  return (parseInt(parts[0]) || 0) + (parseInt(parts[1]) || 0) / 3;
}

function statColor(stat: string, value: number): string {
  const t: Record<string, { great: number; good: number; bad: number; lowerIsBetter: boolean }> = {
    er:  { great: 0, good: 1, bad: 3, lowerIsBetter: true },
    h:   { great: 2, good: 4, bad: 7, lowerIsBetter: true },
    bb:  { great: 0, good: 1, bad: 3, lowerIsBetter: true },
    hr:  { great: 0, good: 0, bad: 1, lowerIsBetter: true },
    k:   { great: 8, good: 5, bad: 2, lowerIsBetter: false },
  };
  const thresh = t[stat];
  if (!thresh) return '';
  if (thresh.lowerIsBetter) {
    if (value <= thresh.great) return 'text-green-400';
    if (value <= thresh.good)  return 'text-green-300';
    if (value <= thresh.bad)   return 'text-yellow-400';
    return 'text-red-400';
  } else {
    if (value >= thresh.great) return 'text-green-400';
    if (value >= thresh.good)  return 'text-green-300';
    if (value >= thresh.bad)   return 'text-yellow-400';
    return 'text-red-400';
  }
}

function ipColor(ip: string): string {
  const n = parseIp(ip);
  if (n >= 7)   return 'text-green-400';
  if (n >= 6)   return 'text-green-300';
  if (n >= 5)   return 'text-yellow-400';
  if (n >= 3)   return 'text-orange-400';
  return 'text-red-400';
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ─── Daily panel component ─────────────────────────────────────────────────────

function DailyPitchersPanel() {
  const [date, setDate] = useState<string>(yesterday());
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGamePk, setSelectedGamePk] = useState<number | null>(null);
  const [showOnlyStarters, setShowOnlyStarters] = useState(false);

  const fetchDay = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    setData(null);
    setSelectedGamePk(null);
    try {
      const res = await fetch(`/api/daily-pitchers?date=${d}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDay(date); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDateChange = (d: string) => {
    setDate(d);
    fetchDay(d);
  };

  const handleGameClick = (gamePk: number) => {
    setSelectedGamePk(prev => prev === gamePk ? null : gamePk);
  };

  const displayed = useMemo(() => {
    if (!data) return [];
    let list = data.pitchers;
    if (selectedGamePk !== null) list = list.filter(p => p.gamePk === selectedGamePk);
    if (showOnlyStarters) list = list.filter(p => parseIp(p.line?.ip ?? '0') >= 3);
    return list;
  }, [data, selectedGamePk, showOnlyStarters]);

  return (
    <div className="bg-[#1a1a2e] rounded-xl overflow-hidden mb-6 shadow-xl">
      {/* Panel header */}
      <div className="bg-[#16213e] border-b border-gray-700 px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h2 className="text-white font-bold text-base">📅 Daily Pitchers</h2>
            <p className="text-gray-500 text-xs mt-0.5">Click a game to filter pitchers</p>
          </div>

          {/* Date input */}
          <input
            type="date"
            value={date}
            onChange={e => handleDateChange(e.target.value)}
            className="bg-[#0d1b2a] text-white border border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {/* Starters only toggle */}
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOnlyStarters}
              onChange={e => setShowOnlyStarters(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            Starters only (3+ IP)
          </label>

          {data && (
            <span className="ml-auto text-xs text-gray-600">
              {displayed.length} pitcher{displayed.length !== 1 ? 's' : ''} · {data.games.length} game{data.games.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Games scoreboard strip — clickable */}
      {data && data.games.length > 0 && (
        <div className="bg-[#0d1b2a] border-b border-gray-800 px-4 py-2 flex flex-wrap gap-3 overflow-x-auto">
          {data.games.map(g => {
            const homeLogo = getMLBTeamLogoUrl(g.homeTeam);
            const awayLogo = getMLBTeamLogoUrl(g.awayTeam);
            const final = g.status.toLowerCase().includes('final') || g.status.toLowerCase().includes('game over');
            const isSelected = selectedGamePk === g.gamePk;
            return (
              <button
                key={g.gamePk}
                onClick={() => handleGameClick(g.gamePk)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap flex-shrink-0 border transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-blue-700 border-blue-400 text-white'
                    : 'bg-[#16213e] border-transparent hover:border-blue-500 hover:bg-[#1e2d4a] text-gray-300'
                }`}
              >
                {awayLogo && <img src={awayLogo} alt={g.awayTeam} className="w-4 h-4 object-contain" />}
                <span className="font-semibold">{g.awayTeam}</span>
                {final ? (
                  <span className="text-gray-400 font-mono">{g.awayScore}–{g.homeScore}</span>
                ) : (
                  <span className="text-gray-600 font-mono">vs</span>
                )}
                <span className="font-semibold">{g.homeTeam}</span>
                {homeLogo && <img src={homeLogo} alt={g.homeTeam} className="w-4 h-4 object-contain" />}
                {!final && <span className="text-yellow-500 text-[9px] font-bold ml-1">{g.status}</span>}
              </button>
            );
          })}
          {selectedGamePk !== null && (
            <button
              onClick={() => setSelectedGamePk(null)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded-lg hover:bg-[#16213e] transition-colors"
            >
              ✕ Show all
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-500 gap-3">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading pitchers for {date}...</span>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="py-8 text-center text-red-400 text-sm">{error}</div>
      )}

      {/* No games */}
      {!loading && !error && data && data.pitchers.length === 0 && (
        <div className="py-10 text-center text-gray-500 text-sm">
          No games found for {date}. Try a different date.
        </div>
      )}

      {/* Pitcher table */}
      {!loading && !error && displayed.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/60 bg-[#0d1b2a]">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Pitcher</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Matchup</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">IP</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">H</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">ER</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">BB</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">K</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">HR</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">P</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Daily Card</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((p, idx) => {
                const line = p.line;
                const teamLogo = getMLBTeamLogoUrl(p.team);
                const oppLogo = getMLBTeamLogoUrl(p.opponent);
                const isStarter = parseIp(line?.ip ?? '0') >= 3;
                return (
                  <tr
                    key={`${p.playerId}-${idx}`}
                    className="border-b border-gray-800/60 hover:bg-[#16213e]/60 transition-colors"
                  >
                    {/* Name + team */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {teamLogo && <img src={teamLogo} alt={p.team} className="w-5 h-5 object-contain flex-shrink-0" />}
                        <div>
                          <Link
                            href={`/pitcher/${p.playerId}`}
                            className="text-white font-semibold hover:text-blue-400 transition-colors text-sm"
                          >
                            {p.name}
                          </Link>
                          <div className="text-xs text-gray-600 flex items-center gap-1">
                            <span>{p.team}</span>
                            {isStarter && <span className="text-blue-500">· SP</span>}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Matchup */}
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1 text-xs text-gray-400">
                        <span>{p.isHome ? 'vs' : '@'}</span>
                        {oppLogo && <img src={oppLogo} alt={p.opponent} className="w-4 h-4 object-contain" />}
                        <span className="font-semibold text-gray-300">{p.opponent}</span>
                      </div>
                    </td>

                    {/* Stat line */}
                    {line ? (
                      <>
                        <td className={`px-3 py-2.5 text-center font-bold ${ipColor(line.ip)}`}>{line.ip}</td>
                        <td className={`px-3 py-2.5 text-center font-semibold ${statColor('h', line.h)}`}>{line.h}</td>
                        <td className={`px-3 py-2.5 text-center font-semibold ${statColor('er', line.er)}`}>{line.er}</td>
                        <td className={`px-3 py-2.5 text-center font-semibold ${statColor('bb', line.bb)}`}>{line.bb}</td>
                        <td className={`px-3 py-2.5 text-center font-semibold ${statColor('k', line.k)}`}>{line.k}</td>
                        <td className={`px-3 py-2.5 text-center font-semibold ${statColor('hr', line.hr)}`}>{line.hr}</td>
                        <td className="px-3 py-2.5 text-center text-gray-400 text-xs">{line.pitches || '—'}</td>
                      </>
                    ) : (
                      <td colSpan={7} className="px-3 py-2.5 text-center text-gray-700 text-xs italic">
                        Stats pending
                      </td>
                    )}

                    {/* Daily card link */}
                    <td className="px-3 py-2.5 text-center">
                      <Link
                        href={`/pitcher/${p.playerId}/daily?date=${date}`}
                        className="inline-block px-2.5 py-1 bg-[#0d1b2a] hover:bg-blue-900/40 border border-gray-700 hover:border-blue-500 text-gray-400 hover:text-white rounded text-xs font-semibold transition-colors"
                      >
                        📅
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

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
  const [showDailyPanel, setShowDailyPanel] = useState(false);

  useEffect(() => {
    setIsClient(true);
    const savedDataset = localStorage.getItem('selectedPitcherDataset');
    if (savedDataset) setSelectedDataset(savedDataset);
  }, []);

  useEffect(() => {
    if (isClient) {
      localStorage.setItem('selectedPitcherDataset', selectedDataset);
      setSelectedPitchers([]);
    }
  }, [selectedDataset, isClient]);

  const allPitchers = getAllPitchers(selectedDataset);
  const teams = getPitcherTeams(selectedDataset);

  const handlePitcherSelection = (playerId: number) => {
    setSelectedPitchers((prev) => {
      if (prev.includes(playerId)) return prev.filter((id) => id !== playerId);
      if (prev.length < 2) return [...prev, playerId];
      return prev;
    });
  };

  const filteredAndSortedPitchers = useMemo(() => {
    let filtered = allPitchers;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.full_name?.toLowerCase().includes(query) || p.team?.toLowerCase().includes(query)
      );
    }
    if (selectedTeam !== 'all') filtered = filtered.filter(p => p.team === selectedTeam);
    if (ageMin) filtered = filtered.filter(p => p.age !== undefined && p.age >= parseInt(ageMin));
    if (ageMax) filtered = filtered.filter(p => p.age !== undefined && p.age <= parseInt(ageMax));
    if (fbVeloMin) filtered = filtered.filter(p => p.fastball_velo !== undefined && p.fastball_velo >= parseFloat(fbVeloMin));
    if (eraMax) filtered = filtered.filter(p => (p.era || 999) <= parseFloat(eraMax));
    if (kPer9Min) filtered = filtered.filter(p => (p.k_per_9 || 0) >= parseFloat(kPer9Min));

    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'name':          return (a.full_name || '').localeCompare(b.full_name || '');
        case 'fastball_velo': return (b.fastball_velo || 0) - (a.fastball_velo || 0);
        case 'era':           return (a.era || 999) - (b.era || 999);
        case 'whip':          return (a.whip || 999) - (b.whip || 999);
        case 'k_per_9':       return (b.k_per_9 || 0) - (a.k_per_9 || 0);
        case 'age':           return (a.age || 0) - (b.age || 0);
        case 'ip':            return (b.ip || 0) - (a.ip || 0);
        default:              return 0;
      }
    });
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
                <select
                  value={selectedDataset}
                  onChange={(e) => setSelectedDataset(e.target.value)}
                  className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg border-0 cursor-pointer transition-colors"
                >
                  {DATASETS.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>{dataset.name}</option>
                  ))}
                </select>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mt-1">
                {filteredAndSortedPitchers.length} pitchers
                {!isClient && <span className="text-xs ml-2">(Loading...)</span>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowDailyPanel(v => !v)}
                className={`px-4 py-2 font-medium rounded-lg transition-colors text-sm border ${
                  showDailyPanel
                    ? 'bg-blue-600 border-blue-500 text-white hover:bg-blue-700'
                    : 'bg-gray-900 border-gray-600 text-gray-300 hover:bg-gray-800 hover:border-blue-500 hover:text-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200'
                }`}
              >
                📅 Daily Pitchers
              </button>
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

      <div className="container mx-auto px-4 py-6">

        {/* Daily Pitchers Panel */}
        {showDailyPanel && <DailyPitchersPanel />}

        {/* Compare Button */}
        {selectedPitchers.length === 2 && (
          <div className="bg-blue-600 dark:bg-blue-700 text-white rounded-lg shadow-lg p-4 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-semibold">2 pitchers selected for comparison</span>
              <button onClick={() => setSelectedPitchers([])} className="text-sm underline hover:no-underline">
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

        {/* Search and Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                {teams.map((team) => <option key={team} value={team}>{team}</option>)}
              </select>
            </div>
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

          <div className="mt-4 flex justify-center">
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              {showAdvancedFilters ? '− Hide Advanced Filters' : '+ Show Advanced Filters'}
            </button>
          </div>

          {showAdvancedFilters && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Advanced Filters</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Age Range</label>
                  <div className="flex gap-2">
                    <input type="number" placeholder="Min" value={ageMin} onChange={e => setAgeMin(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600 outline-none text-gray-900 dark:text-white text-sm" />
                    <input type="number" placeholder="Max" value={ageMax} onChange={e => setAgeMax(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600 outline-none text-gray-900 dark:text-white text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Min FB Velo (mph)</label>
                  <input type="number" placeholder="e.g. 95" value={fbVeloMin} onChange={e => setFbVeloMin(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600 outline-none text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Max ERA</label>
                  <input type="number" step="0.1" placeholder="e.g. 3.5" value={eraMax} onChange={e => setEraMax(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600 outline-none text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Min K/9</label>
                  <input type="number" step="0.1" placeholder="e.g. 9.0" value={kPer9Min} onChange={e => setKPer9Min(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600 outline-none text-gray-900 dark:text-white text-sm" />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={() => { setAgeMin(''); setAgeMax(''); setFbVeloMin(''); setEraMax(''); setKPer9Min(''); }}
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
