'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

type StatRow = Record<string, string>;

const YEARS = ['2026', '2025', '2024', '2023', '2022', '2021'];

const HIT_DEFAULT_SORT = 'OPS';
const PIT_DEFAULT_SORT = 'SO';

// Columns where lower = better (for pitchers)
const LOWER_IS_BETTER = new Set(['ERA', 'WHIP', 'FIP', 'xFIP', 'SIERA', 'BB%', 'BB/K', 'BA', 'OBP', 'SLG', 'OPS', 'BABIP', 'H', 'R', 'BB', 'HBP']);

const HIT_RATE_COLS = new Set(['BA', 'OBP', 'SLG', 'OPS', 'ISO', 'BABIP', 'wOBA']);
const PIT_RATE_COLS = new Set(['WHIP', 'BA', 'OBP', 'SLG', 'OPS', 'BABIP', 'BB%', 'K%', 'BB/K', 'FIP', 'xFIP', 'SIERA']);

const MIN_PA_OPTIONS  = [1, 25, 50, 75, 100, 150, 200];
const MIN_IP_OPTIONS  = [1, 5, 10, 15, 20, 30, 40];

function numVal(v: string | undefined): number {
  if (!v || v === '' || v === '-') return -Infinity;
  return parseFloat(v);
}

function colorForStat(col: string, val: string, type: 'hit' | 'pitch'): string {
  const n = parseFloat(val);
  if (isNaN(n)) return '';
  if (type === 'hit') {
    if (col === 'BA')   return statColor(n, 0.200, 0.280, 0.350, false);
    if (col === 'OBP')  return statColor(n, 0.280, 0.350, 0.430, false);
    if (col === 'SLG')  return statColor(n, 0.350, 0.450, 0.600, false);
    if (col === 'OPS')  return statColor(n, 0.650, 0.800, 1.000, false);
    if (col === 'wOBA') return statColor(n, 0.280, 0.340, 0.420, false);
    if (col === 'ISO')  return statColor(n, 0.100, 0.180, 0.280, false);
  }
  if (type === 'pitch') {
    if (col === 'K%')   return statColor(n, 15, 22, 32, false);
    if (col === 'BB%')  return statColor(n, 12, 8, 4, true);   // lower = better
    if (col === 'FIP')  return statColor(n, 5.0, 4.0, 3.0, true);
    if (col === 'xFIP') return statColor(n, 5.0, 4.0, 3.0, true);
    if (col === 'SIERA')return statColor(n, 5.0, 4.0, 3.0, true);
    if (col === 'WHIP') return statColor(n, 1.8, 1.3, 0.9, true);
  }
  return '';
}

function statColor(n: number, bad: number, avg: number, good: number, invert: boolean): string {
  let t: number;
  if (!invert) {
    if (n <= bad) t = 0;
    else if (n >= good) t = 1;
    else t = (n - bad) / (good - bad);
  } else {
    if (n >= bad) t = 0;
    else if (n <= good) t = 1;
    else t = (bad - n) / (bad - good);
  }
  // red → yellow → green
  if (t < 0.5) {
    const r = 220, g = Math.round(80 + t * 2 * 140);
    return `rgb(${r},${g},60)`;
  } else {
    const r = Math.round(220 - (t - 0.5) * 2 * 180), g = 200;
    return `rgb(${r},${g},60)`;
  }
}

export default function OverslotPage() {
  const [type, setType]       = useState<'hit' | 'pitch'>('hit');
  const [year, setYear]       = useState('2026');
  const [players, setPlayers] = useState<StatRow[]>([]);
  const [cols, setCols]       = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState('');
  const [sortCol, setSortCol] = useState(HIT_DEFAULT_SORT);
  const [sortAsc, setSortAsc] = useState(false);
  const [minPA, setMinPA]     = useState(50);
  const [minIP, setMinIP]     = useState(10);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/overslot-stats?type=${type}&year=${year}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setPlayers(d.players ?? []);
        setCols(d.cols ?? []);
        setSortCol(type === 'pitch' ? PIT_DEFAULT_SORT : HIT_DEFAULT_SORT);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [type, year]);

  const filtered = useMemo(() => {
    let rows = players;

    // Min PA / IP filter
    if (type === 'hit') {
      rows = rows.filter(p => parseFloat(p['PA'] ?? '0') >= minPA);
    } else {
      rows = rows.filter(p => parseFloat(p['IP'] ?? '0') >= minIP);
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(p =>
        p['Player']?.toLowerCase().includes(q) ||
        p['Team']?.toLowerCase().includes(q)
      );
    }

    // Sort
    rows = [...rows].sort((a, b) => {
      const av = numVal(a[sortCol]);
      const bv = numVal(b[sortCol]);
      if (av === bv) return 0;
      const asc = av < bv ? -1 : 1;
      return sortAsc ? asc : -asc;
    });

    return rows;
  }, [players, type, minPA, minIP, search, sortCol, sortAsc]);

  function handleColClick(col: string) {
    if (col === sortCol) {
      setSortAsc(a => !a);
    } else {
      setSortCol(col);
      // For pitchers, default lower=better sort for rate stats
      setSortAsc(type === 'pitch' && LOWER_IS_BETTER.has(col));
    }
  }

  const rateCols = type === 'hit' ? HIT_RATE_COLS : PIT_RATE_COLS;

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <div className="max-w-full mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center gap-4 mb-5">
          <Link href="/" className="text-gray-400 hover:text-white text-sm flex-shrink-0">← Back</Link>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">College Baseball Stats</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              {loading ? 'Loading…' : error ? 'Error' : `${filtered.length} players · via Over Slot`}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {/* Hit / Pitch toggle */}
          <div className="flex gap-1">
            {(['hit', 'pitch'] as const).map(t => (
              <button key={t} onClick={() => setType(t)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  type === t ? 'bg-amber-500 text-black' : 'bg-[#1a1f30] text-gray-300 hover:bg-[#1e2438]'
                }`}>
                {t === 'hit' ? 'Hitting' : 'Pitching'}
              </button>
            ))}
          </div>

          {/* Year */}
          <div className="flex gap-1">
            {YEARS.map(y => (
              <button key={y} onClick={() => setYear(y)}
                className={`px-2.5 py-1.5 rounded text-sm font-medium transition-colors ${
                  year === y ? 'bg-amber-500 text-black' : 'bg-[#1a1f30] text-gray-300 hover:bg-[#1e2438]'
                }`}>
                {y}
              </button>
            ))}
          </div>

          {/* Min PA / IP */}
          {type === 'hit' ? (
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400 text-sm">Min PA:</span>
              <div className="flex gap-1">
                {MIN_PA_OPTIONS.map(n => (
                  <button key={n} onClick={() => setMinPA(n)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      minPA === n ? 'bg-amber-500 text-black' : 'bg-[#1a1f30] text-gray-300 hover:bg-[#1e2438]'
                    }`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400 text-sm">Min IP:</span>
              <div className="flex gap-1">
                {MIN_IP_OPTIONS.map(n => (
                  <button key={n} onClick={() => setMinIP(n)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      minIP === n ? 'bg-amber-500 text-black' : 'bg-[#1a1f30] text-gray-300 hover:bg-[#1e2438]'
                    }`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search */}
          <input
            type="text"
            placeholder="Search player or team…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-[#1a1f30] border border-[#2a3050] rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 w-52"
          />
        </div>

        {/* Table */}
        <div className="bg-[#111827] rounded-xl overflow-auto border border-[#1e2a45]">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-gray-400">Loading stats…</div>
          ) : error ? (
            <div className="flex items-center justify-center h-48 text-red-400 text-sm">{error}</div>
          ) : (
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#1e2a45]">
                  <th className="text-left px-3 py-2.5 text-gray-400 font-medium sticky left-0 bg-[#111827]">#</th>
                  {cols.map(col => (
                    <th
                      key={col}
                      onClick={() => handleColClick(col)}
                      className={`px-3 py-2.5 font-medium cursor-pointer select-none transition-colors hover:text-white ${
                        col === 'Player' || col === 'Team'
                          ? 'text-left text-gray-400'
                          : 'text-right text-gray-400'
                      } ${sortCol === col ? 'text-amber-400' : ''}`}
                    >
                      {col}
                      {sortCol === col && (
                        <span className="ml-1 text-xs">{sortAsc ? '↑' : '↓'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((player, i) => (
                  <tr
                    key={`${player['Player']}-${i}`}
                    className={`border-b border-[#1a2235] ${
                      i % 2 === 0 ? 'bg-[#0d1424]' : 'bg-[#0a1020]'
                    } hover:bg-[#1a2440] transition-colors`}
                  >
                    <td className="px-3 py-2 text-gray-500 text-xs sticky left-0 bg-inherit">{i + 1}</td>
                    {cols.map(col => {
                      const val = player[col] ?? '';
                      const isRate = rateCols.has(col);
                      const color = isRate ? colorForStat(col, val, type) : '';
                      const isPlayer = col === 'Player';
                      const isTeam   = col === 'Team';

                      return (
                        <td
                          key={col}
                          className={`px-3 py-2 ${isPlayer || isTeam ? 'text-left' : 'text-right font-mono'}`}
                          style={color ? { color } : undefined}
                        >
                          {isPlayer && player['playerUrl'] ? (
                            <a
                              href={`https://overslotbaseball.com${player['playerUrl']}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-white hover:text-amber-400 transition-colors font-medium"
                            >
                              {val}
                            </a>
                          ) : (
                            <span className={isPlayer ? 'font-medium text-white' : isTeam ? 'text-gray-300' : ''}>
                              {val || '—'}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {filtered.length === 0 && !loading && (
                  <tr>
                    <td colSpan={cols.length + 1} className="text-center py-12 text-gray-500">
                      No players found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <p className="mt-3 text-xs text-gray-600 text-right">
          Data via <a href="https://overslotbaseball.com/stats/" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400">Over Slot</a> · powered by 6-4-3 Charts
        </p>
      </div>
    </div>
  );
}
