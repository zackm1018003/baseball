'use client';

import { useState, useMemo, useEffect } from 'react';
import { getAllPlayers } from '@/lib/database';
import { DATASETS, DEFAULT_DATASET_ID } from '@/lib/datasets';
import { Player } from '@/types/player';
import Link from 'next/link';

type SortDir = 'asc' | 'desc';

interface Column {
  key: string;
  label: string;
  shortLabel?: string;
  getValue: (p: Player, allPlayers: Player[]) => number | null;
  format?: (v: number | null) => string;
  lowerIsBetter?: boolean;
}

const COLUMNS: Column[] = [
  {
    key: 'zd_plus',
    label: 'Decision+',
    shortLabel: 'D+',
    getValue: (p: Player) => (p as any).zd_plus ?? null,
    format: (v: number | null) => v != null ? String(v) : '—',
  },
  {
    key: 'bat_speed',
    label: 'Bat Speed',
    shortLabel: 'BAT',
    getValue: (p) => p.bat_speed ?? null,
    format: (v) => v != null ? v.toFixed(1) : '—',
  },
  {
    key: 'avg_ev',
    label: 'Avg EV',
    shortLabel: 'AVG EV',
    getValue: (p) => p.avg_ev ?? null,
    format: (v) => v != null ? v.toFixed(1) : '—',
  },
  {
    key: 'max_ev',
    label: 'Max EV',
    shortLabel: 'MAX EV',
    getValue: (p) => p.max_ev ?? null,
    format: (v) => v != null ? v.toFixed(1) : '—',
  },
  {
    key: 'barrel_%',
    label: 'Barrel %',
    shortLabel: 'BBL%',
    getValue: (p) => (p as any)['barrel_%'] ?? null,
    format: (v) => v != null ? v.toFixed(1) : '—',
  },
  {
    key: 'hard_hit%',
    label: 'Hard Hit %',
    shortLabel: 'HH%',
    getValue: (p) => (p as any)['hard_hit%'] ?? null,
    format: (v) => v != null ? v.toFixed(1) : '—',
  },
  {
    key: 'bb%',
    label: 'BB %',
    shortLabel: 'BB%',
    getValue: (p) => (p as any)['bb%'] ?? (p as any).bb_percent ?? null,
    format: (v) => v != null ? v.toFixed(1) : '—',
  },
  {
    key: 'k%',
    label: 'K %',
    shortLabel: 'K%',
    getValue: (p) => (p as any)['k%'] ?? (p as any).k_percent ?? null,
    format: (v) => v != null ? v.toFixed(1) : '—',
    lowerIsBetter: true,
  },
  {
    key: 'z-swing%',
    label: 'Z-Swing %',
    shortLabel: 'ZSW%',
    getValue: (p) => (p as any)['z-swing%'] ?? (p as any).zone_swing_percent ?? null,
    format: (v) => v != null ? v.toFixed(1) : '—',
  },
  {
    key: 'chase%',
    label: 'Chase %',
    shortLabel: 'CHS%',
    getValue: (p) => (p as any)['chase%'] ?? (p as any).chase_percent ?? null,
    format: (v) => v != null ? v.toFixed(1) : '—',
    lowerIsBetter: true,
  },
  {
    key: 'o-whiff%',
    label: 'O-Whiff %',
    shortLabel: 'OWH%',
    getValue: (p) => (p as any)['o-whiff%'] ?? null,
    format: (v) => v != null ? v.toFixed(1) : '—',
    lowerIsBetter: true,
  },
  {
    key: 'pull_air%',
    label: 'Pull Air %',
    shortLabel: 'PULL%',
    getValue: (p) => (p as any)['pull_air%'] ?? null,
    format: (v) => v != null ? v.toFixed(1) : '—',
  },
];

export default function LeaderboardPage() {
  const [selectedDataset, setSelectedDataset] = useState<string>(DEFAULT_DATASET_ID);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState('decision+');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [isClient, setIsClient] = useState(false);
  const [minPA, setMinPA] = useState('');
  const [minAB, setMinAB] = useState('');

  useEffect(() => {
    setIsClient(true);
    const saved = localStorage.getItem('selectedDataset');
    if (saved) setSelectedDataset(saved);
  }, []);

  useEffect(() => {
    if (isClient) localStorage.setItem('selectedDataset', selectedDataset);
  }, [selectedDataset, isClient]);

  const allPlayers = useMemo(() => getAllPlayers(selectedDataset), [selectedDataset]);

  // Pre-compute Decision+ for all players once
  const decisionPlusMap = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const p of allPlayers) {
      const key = p.player_id ? String(p.player_id) : p.full_name;
      map.set(key, calculateDecisionPlus(p, allPlayers));
    }
    return map;
  }, [allPlayers]);

  const sortedColumnLabel = sortKey === 'pa' ? 'PA' : sortKey === 'ab' ? 'AB' : COLUMNS.find(c => c.key === sortKey)?.label;

  const filteredAndSorted = useMemo(() => {
    const lowerQuery = searchQuery.toLowerCase();
    const paMin = minPA ? parseInt(minPA) : 0;
    const abMin = minAB ? parseInt(minAB) : 0;
    let filtered = allPlayers.filter(p => {
      if (searchQuery && !(
        p.full_name?.toLowerCase().includes(lowerQuery) ||
        p.team?.toLowerCase().includes(lowerQuery)
      )) return false;
      if (paMin && (p.pa == null || p.pa < paMin)) return false;
      if (abMin && (p.ab == null || p.ab < abMin)) return false;
      return true;
    });

    filtered.sort((a, b) => {
      let aVal: number | null;
      let bVal: number | null;

      if (sortKey === 'decision+') {
        const aKey = a.player_id ? String(a.player_id) : a.full_name;
        const bKey = b.player_id ? String(b.player_id) : b.full_name;
        aVal = decisionPlusMap.get(aKey) ?? null;
        bVal = decisionPlusMap.get(bKey) ?? null;
      } else if (sortKey === 'pa') {
        aVal = a.pa ?? null;
        bVal = b.pa ?? null;
      } else if (sortKey === 'ab') {
        aVal = a.ab ?? null;
        bVal = b.ab ?? null;
      } else if (sortKey === 'age') {
        aVal = a.age ?? null;
        bVal = b.age ?? null;
      } else {
        const col = COLUMNS.find(c => c.key === sortKey);
        aVal = col ? col.getValue(a, allPlayers) : null;
        bVal = col ? col.getValue(b, allPlayers) : null;
      }

      // Nulls always last
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      const diff = aVal - bVal;
      return sortDir === 'desc' ? -diff : diff;
    });

    return filtered;
  }, [allPlayers, searchQuery, sortKey, sortDir, decisionPlusMap, minPA, minAB]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      // Default direction: desc for most stats, asc for lower-is-better
      const col = COLUMNS.find(c => c.key === key);
      setSortDir(col?.lowerIsBetter ? 'asc' : 'desc');
    }
  };

  const getSortArrow = (key: string) => {
    if (sortKey !== key) return '';
    return sortDir === 'desc' ? ' ▼' : ' ▲';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-4">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Leaderboard
                </h1>
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
              <p className="text-gray-600 dark:text-gray-300 mt-1 text-sm">
                {filteredAndSorted.length} players
                {sortedColumnLabel && <span> · Sorted by {sortedColumnLabel}</span>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors text-sm"
              >
                Players
              </a>
              <a
                href="/pitchers"
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors text-sm"
              >
                Pitchers
              </a>
              <a
                href="/similarity"
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors text-sm"
              >
                Similarity
              </a>
              <div className="text-sm text-gray-500 dark:text-gray-400 italic">
                By: Zack McKeown
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Search & Filters */}
      <div className="container mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by name or team..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full max-w-md px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600 dark:text-gray-400">Min PA:</label>
          <input
            type="number"
            placeholder="0"
            value={minPA}
            onChange={(e) => setMinPA(e.target.value)}
            className="w-20 px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600 dark:text-gray-400">Min AB:</label>
          <input
            type="number"
            placeholder="0"
            value={minAB}
            onChange={(e) => setMinAB(e.target.value)}
            className="w-20 px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Table */}
      <div className="container mx-auto px-4 pb-8">
        <div className="overflow-x-auto rounded-lg shadow-md">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800 dark:bg-gray-900 text-white">
                <th className="px-2 py-2 text-left font-semibold w-12">#</th>
                <th className="px-2 py-2 text-left font-semibold min-w-[140px]">Player</th>
                <th className="px-2 py-2 text-left font-semibold w-16">Team</th>
                <th
                  onClick={() => handleSort('age')}
                  className={`px-2 py-2 text-right font-semibold cursor-pointer hover:bg-gray-700 dark:hover:bg-gray-800 transition-colors select-none ${sortKey === 'age' ? 'bg-gray-700 dark:bg-gray-800' : ''}`}
                >
                  Age{getSortArrow('age')}
                </th>
                <th
                  onClick={() => handleSort('pa')}
                  className={`px-2 py-2 text-right font-semibold cursor-pointer hover:bg-gray-700 dark:hover:bg-gray-800 transition-colors select-none ${sortKey === 'pa' ? 'bg-gray-700 dark:bg-gray-800' : ''}`}
                >
                  PA{getSortArrow('pa')}
                </th>
                <th
                  onClick={() => handleSort('ab')}
                  className={`px-2 py-2 text-right font-semibold cursor-pointer hover:bg-gray-700 dark:hover:bg-gray-800 transition-colors select-none ${sortKey === 'ab' ? 'bg-gray-700 dark:bg-gray-800' : ''}`}
                >
                  AB{getSortArrow('ab')}
                </th>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`px-2 py-2 text-right font-semibold cursor-pointer hover:bg-gray-700 dark:hover:bg-gray-800 transition-colors whitespace-nowrap select-none ${sortKey === col.key ? 'bg-gray-700 dark:bg-gray-800' : ''}`}
                  >
                    {col.shortLabel || col.label}{getSortArrow(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map((player, idx) => {
                const playerId = player.player_id || encodeURIComponent(player.full_name);
                const playerKey = player.player_id ? String(player.player_id) : player.full_name;
                return (
                  <tr
                    key={playerKey}
                    className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400 text-xs">{idx + 1}</td>
                    <td className="px-2 py-1.5">
                      <Link
                        href={`/player/${playerId}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium text-xs"
                      >
                        {player.full_name}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 text-xs">{player.team || '—'}</td>
                    <td className="px-2 py-1.5 text-right text-xs font-mono text-gray-900 dark:text-gray-100">{player.age ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right text-xs font-mono text-gray-900 dark:text-gray-100">{player.pa ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right text-xs font-mono text-gray-900 dark:text-gray-100">{player.ab ?? '—'}</td>
                    {COLUMNS.map(col => {
                      const val = col.key === 'decision+'
                        ? decisionPlusMap.get(playerKey) ?? null
                        : col.getValue(player, allPlayers);
                      const formatted = col.format ? col.format(val) : (val != null ? String(val) : '—');
                      return (
                        <td key={col.key} className="px-2 py-1.5 text-right text-xs font-mono text-gray-900 dark:text-gray-100">
                          {formatted}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
