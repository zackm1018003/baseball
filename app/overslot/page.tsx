'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

type StatRow = Record<string, string>;

interface AdvancedStats {
  draftYear: string | null;
  whiffPct:     number | null;
  izWhiffPct:   number | null;
  oozWhiffPct:  number | null;
  chasePct:     number | null;
  kPct:         number | null;
  bbPct:        number | null;
  avgEv:        number | null;
  ev90:         number | null;
  barrelPct:    number | null;
  pullAirPct:   number | null;
  xWoba:        number | null;
}

const YEARS = ['2026', '2025', '2024', '2023', '2022', '2021'];

const HIT_DEFAULT_SORT  = 'OPS';
const PIT_DEFAULT_SORT  = 'SO';

const LOWER_IS_BETTER = new Set(['WHIP', 'FIP', 'xFIP', 'SIERA', 'BB%', 'BB/K', 'BA', 'OBP', 'SLG', 'OPS', 'BABIP',
  'H', 'R', 'BB', 'HBP', 'Whiff%', 'IZ Whiff%', 'OOZ Whiff%', 'Chase%', 'K%']);

const HIT_RATE_COLS  = new Set(['BA', 'OBP', 'SLG', 'OPS', 'ISO', 'BABIP', 'wOBA']);
const PIT_RATE_COLS  = new Set(['WHIP', 'BA', 'OBP', 'SLG', 'OPS', 'BABIP', 'BB%', 'K%', 'BB/K', 'FIP', 'xFIP', 'SIERA']);
const ADV_RATE_COLS  = new Set(['Whiff%', 'IZ Whiff%', 'OOZ Whiff%', 'Chase%', 'K%', 'BB%', 'Avg EV', '90th EV', 'Barrel%', 'xWOBA']);

const MIN_PA_OPTIONS = [1, 25, 50, 75, 100, 150, 200];
const MIN_IP_OPTIONS = [1, 5, 10, 15, 20, 30, 40];

// Advanced stat columns added to the right of the table
const ADV_COLS = [
  { key: 'draftYear',  label: 'Yr',         title: 'Draft Year' },
  { key: 'whiffPct',   label: 'Whiff%',     title: 'Whiff %' },
  { key: 'izWhiffPct', label: 'IZ Whiff%',  title: 'In-Zone Whiff %' },
  { key: 'oozWhiffPct',label: 'OOZ Whiff%', title: 'Out-of-Zone Whiff %' },
  { key: 'chasePct',   label: 'Chase%',     title: 'Chase %' },
  { key: 'kPct',       label: 'K%',         title: 'K %' },
  { key: 'bbPct',      label: 'BB%',        title: 'BB %' },
  { key: 'avgEv',      label: 'Avg EV',     title: 'Avg Exit Velocity' },
  { key: 'ev90',       label: '90th EV',    title: '90th Percentile Exit Velocity' },
  { key: 'barrelPct',  label: 'Barrel%',    title: 'Barrel %' },
  { key: 'pullAirPct', label: 'Pull AIR%',  title: 'Pull Air Ball %' },
  { key: 'xWoba',      label: 'xWOBA',      title: 'Expected wOBA' },
];

function numVal(v: string | undefined): number {
  if (!v || v === '' || v === '—') return -Infinity;
  return parseFloat(v.replace('%', ''));
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
    if (col === 'BB%')  return statColor(n, 12, 8, 4, true);
    if (col === 'FIP')  return statColor(n, 5.0, 4.0, 3.0, true);
    if (col === 'xFIP') return statColor(n, 5.0, 4.0, 3.0, true);
    if (col === 'SIERA')return statColor(n, 5.0, 4.0, 3.0, true);
    if (col === 'WHIP') return statColor(n, 1.8, 1.3, 0.9, true);
  }
  // Advanced stats
  if (col === 'Avg EV')    return statColor(n, 86, 90, 94, false);
  if (col === '90th EV')   return statColor(n, 100, 107, 113, false);
  if (col === 'Barrel%')   return statColor(n, 5, 12, 22, false);
  if (col === 'xWOBA')     return statColor(n, 0.28, 0.34, 0.42, false);
  if (col === 'Whiff%')    return statColor(n, 30, 22, 14, true);
  if (col === 'Chase%')    return statColor(n, 35, 27, 18, true);
  if (col === 'K%')        return statColor(n, 32, 24, 14, true);
  if (col === 'BB%')       return statColor(n, 5, 10, 16, false);
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
  if (t < 0.5) {
    const r = 220, g = Math.round(80 + t * 2 * 140);
    return `rgb(${r},${g},60)`;
  } else {
    const r = Math.round(220 - (t - 0.5) * 2 * 180), g = 200;
    return `rgb(${r},${g},60)`;
  }
}

function fmt(v: number | null, decimals = 1): string {
  if (v == null) return '—';
  return v.toFixed(decimals);
}

export default function OverslotPage() {
  const [type, setType]           = useState<'hit' | 'pitch'>('hit');
  const [year, setYear]           = useState('2026');
  const [players, setPlayers]     = useState<StatRow[]>([]);
  const [cols, setCols]           = useState<string[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState('');
  const [sortCol, setSortCol]     = useState(HIT_DEFAULT_SORT);
  const [sortAsc, setSortAsc]     = useState(false);
  const [minPA, setMinPA]         = useState(50);
  const [minIP, setMinIP]         = useState(10);

  // Advanced stats state
  const [advData, setAdvData]       = useState<Record<string, AdvancedStats>>({});
  const [advLoading, setAdvLoading] = useState(false);
  const [advLoaded, setAdvLoaded]   = useState(false);
  const [showAdv, setShowAdv]       = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setAdvData({});
    setAdvLoaded(false);
    setShowAdv(false);
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

  async function loadAdvancedStats() {
    setAdvLoading(true);
    try {
      const res = await fetch(`/api/overslot-advanced?year=${year}`);
      const d = await res.json();
      setAdvData(d.data ?? {});
      setAdvLoaded(true);
      setShowAdv(true);
      setSortCol('Avg EV');
      setSortAsc(false);
    } finally {
      setAdvLoading(false);
    }
  }

  const allCols = useMemo(() => {
    if (showAdv && type === 'hit') return [...cols, ...ADV_COLS.map(c => c.label)];
    return cols;
  }, [cols, showAdv, type]);

  const filtered = useMemo(() => {
    let rows = players;

    if (type === 'hit') {
      rows = rows.filter(p => parseFloat(p['PA'] ?? '0') >= minPA);
    } else {
      rows = rows.filter(p => parseFloat(p['IP'] ?? '0') >= minIP);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(p =>
        p['Player']?.toLowerCase().includes(q) ||
        p['Team']?.toLowerCase().includes(q)
      );
    }

    // Merge advanced stats
    rows = rows.map(p => ({ ...p, _adv: advData[p.playerUrl] })) as StatRow[];

    rows = [...rows].sort((a, b) => {
      // Check advanced cols
      const advCol = ADV_COLS.find(c => c.label === sortCol);
      if (advCol && showAdv) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const av = (a as any)._adv?.[advCol.key] ?? -Infinity;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bv = (b as any)._adv?.[advCol.key] ?? -Infinity;
        if (av === bv) return 0;
        return sortAsc ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
      }
      const av = numVal(a[sortCol]);
      const bv = numVal(b[sortCol]);
      if (av === bv) return 0;
      return sortAsc ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
    });

    return rows;
  }, [players, type, minPA, minIP, search, sortCol, sortAsc, advData, showAdv]);

  function handleColClick(col: string) {
    if (col === sortCol) {
      setSortAsc(a => !a);
    } else {
      setSortCol(col);
      setSortAsc(type === 'pitch' && LOWER_IS_BETTER.has(col));
    }
  }

  const rateCols = type === 'hit' ? HIT_RATE_COLS : PIT_RATE_COLS;

  function renderAdvCell(player: StatRow, label: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adv: AdvancedStats | undefined = (player as any)._adv;
    const col = ADV_COLS.find(c => c.label === label);
    if (!col || !adv) return <span className="text-gray-600">—</span>;

    if (col.key === 'draftYear') {
      return <span className="text-gray-300 font-medium">{adv.draftYear ?? '—'}</span>;
    }

    const raw = adv[col.key as keyof AdvancedStats] as number | null;
    if (raw == null) return <span className="text-gray-600">—</span>;

    let display: string;
    if (col.key === 'xWoba') display = raw.toFixed(3).replace(/^0/, '');
    else if (col.key === 'avgEv' || col.key === 'ev90') display = fmt(raw, 1);
    else display = fmt(raw, 1);

    const color = colorForStat(label, String(raw), 'hit');
    return <span style={color ? { color } : undefined} className="font-mono">{display}</span>;
  }

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

          {/* Advanced stats button — hitters only */}
          {type === 'hit' && (
            <div className="flex items-center gap-2 ml-auto">
              {advLoaded && (
                <button
                  onClick={() => setShowAdv(v => !v)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    showAdv ? 'bg-sky-600 text-white' : 'bg-[#1a1f30] text-gray-300 hover:bg-[#1e2438]'
                  }`}
                >
                  {showAdv ? '⚡ Advanced On' : '⚡ Show Advanced'}
                </button>
              )}
              {!advLoaded && (
                <button
                  onClick={loadAdvancedStats}
                  disabled={advLoading || loading}
                  className="px-3 py-1.5 rounded text-sm font-medium bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white transition-colors"
                >
                  {advLoading ? '⏳ Loading…' : '⚡ Load Advanced Stats'}
                </button>
              )}
              {advLoading && (
                <span className="text-gray-400 text-xs">Fetching {players.length} profiles (~30s)…</span>
              )}
            </div>
          )}
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
                  <th className="text-left px-3 py-2.5 text-gray-400 font-medium">#</th>
                  {allCols.map(col => {
                    const advMeta = ADV_COLS.find(c => c.label === col);
                    return (
                      <th
                        key={col}
                        onClick={() => handleColClick(col)}
                        title={advMeta?.title ?? col}
                        className={`px-3 py-2.5 font-medium cursor-pointer select-none transition-colors hover:text-white ${
                          col === 'Player' || col === 'Team' ? 'text-left text-gray-400' : 'text-right text-gray-400'
                        } ${sortCol === col ? 'text-amber-400' : ''} ${
                          advMeta ? 'bg-[#0e1628] border-l border-[#2a3a5c]' : ''
                        }`}
                      >
                        {col}
                        {sortCol === col && <span className="ml-1 text-xs">{sortAsc ? '↑' : '↓'}</span>}
                      </th>
                    );
                  })}
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
                    <td className="px-3 py-2 text-gray-500 text-xs">{i + 1}</td>
                    {allCols.map(col => {
                      const isAdv = ADV_COLS.some(c => c.label === col);

                      if (isAdv) {
                        return (
                          <td key={col} className="px-3 py-2 text-right bg-[#090f1e] border-l border-[#1e2a45]">
                            {renderAdvCell(player, col)}
                          </td>
                        );
                      }

                      const val    = player[col] ?? '';
                      const isRate = rateCols.has(col);
                      const color  = isRate ? colorForStat(col, val, type) : '';
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
                    <td colSpan={allCols.length + 1} className="text-center py-12 text-gray-500">
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
