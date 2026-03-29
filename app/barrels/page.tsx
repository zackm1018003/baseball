'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';

interface BarrelPlayer {
  playerId: number | null;
  name: string;
  team: string;
  attempts: number | null;
  barrels: number | null;
  barrelPct: number | null;
  barrelPerPA: number | null;
  avgEv: number | null;
  maxEv: number | null;
  avgBatSpeed: number | null;
  ev50: number | null;
  sweetSpotPct: number | null;
}

type SortKey = keyof Omit<BarrelPlayer, 'playerId' | 'name' | 'team'>;
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortKey; label: string; format: (v: number | null) => string }[] = [
  { key: 'barrels',     label: 'Barrels',  format: v => v != null ? String(v) : '—' },
  { key: 'barrelPct',   label: 'BBL%',     format: v => v != null ? v.toFixed(1) + '%' : '—' },
  { key: 'barrelPerPA', label: 'BBL/PA',   format: v => v != null ? v.toFixed(1) + '%' : '—' },
  { key: 'avgEv',       label: 'Avg EV',   format: v => v != null ? v.toFixed(1) : '—' },
  { key: 'maxEv',       label: 'Max EV',   format: v => v != null ? v.toFixed(1) : '—' },
  { key: 'ev50',        label: 'EV50',     format: v => v != null ? v.toFixed(1) : '—' },
  { key: 'avgBatSpeed', label: 'Avg BS',   format: v => v != null ? v.toFixed(1) : '—' },
  { key: 'sweetSpotPct',label: 'SS%',      format: v => v != null ? v.toFixed(1) + '%' : '—' },
  { key: 'attempts',    label: 'BIP',      format: v => v != null ? String(v) : '—' },
];

export default function BarrelLeaderboardPage() {
  const [players, setPlayers]       = useState<BarrelPlayer[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [sortKey, setSortKey]       = useState<SortKey>('barrels');
  const [sortDir, setSortDir]       = useState<SortDir>('desc');
  const [search, setSearch]         = useState('');
  const [minBIP, setMinBIP]         = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo]   = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/barrel-leaderboard');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPlayers(data.players ?? []);
      setLastUpdated(new Date());
      setSecondsAgo(0);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh every 5 minutes
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [load]);

  // Tick seconds-ago counter every second
  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsAgo(s => s + 1);
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const teams = useMemo(() => {
    const s = new Set(players.map(p => p.team).filter(Boolean));
    return Array.from(s).sort();
  }, [players]);

  const sorted = useMemo(() => {
    const bipMin = minBIP ? parseInt(minBIP) : 0;
    const lq = search.toLowerCase();
    let list = players.filter(p => {
      if (lq && !p.name.toLowerCase().includes(lq) && !p.team.toLowerCase().includes(lq)) return false;
      if (bipMin && (p.attempts == null || p.attempts < bipMin)) return false;
      if (teamFilter && p.team !== teamFilter) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      const av = a[sortKey] ?? (sortDir === 'desc' ? -Infinity : Infinity);
      const bv = b[sortKey] ?? (sortDir === 'desc' ? -Infinity : Infinity);
      return sortDir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
    return list;
  }, [players, sortKey, sortDir, search, minBIP, teamFilter]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      {/* Header */}
      <div className="border-b border-white/[0.08] px-4 py-3 flex items-center gap-4 flex-wrap">
        <Link href="/" className="text-gray-400 hover:text-white text-sm transition-colors">← Back</Link>
        <h1 className="text-lg font-bold tracking-tight">🛢️ Barrel Leaderboard</h1>
        <span className="text-xs text-gray-500">2026 Season · MLB</span>
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
          {loading
            ? <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse inline-block" />Updating…</span>
            : lastUpdated
            ? <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                Updated {secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.floor(secondsAgo / 60)}m ago`}
              </span>
            : null}
          <span>· Baseball Savant</span>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-white/[0.08]">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search player / team…"
          className="bg-white/[0.06] border border-white/[0.1] rounded px-3 py-1.5 text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500/60 w-48"
        />
        <select
          value={teamFilter}
          onChange={e => setTeamFilter(e.target.value)}
          className="bg-white/[0.06] border border-white/[0.1] rounded px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-blue-500/60"
        >
          <option value="">All Teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          value={minBIP}
          onChange={e => setMinBIP(e.target.value)}
          placeholder="Min BIP"
          type="number"
          className="bg-white/[0.06] border border-white/[0.1] rounded px-3 py-1.5 text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500/60 w-24"
        />
        <button
          onClick={load}
          className="ml-auto bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] rounded px-3 py-1.5 text-sm text-gray-300 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
        ) : error ? (
          <div className="flex items-center justify-center py-24 text-red-400 text-sm">Error: {error}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.08] text-gray-400 text-xs uppercase tracking-wider">
                <th className="pl-4 pr-2 py-3 text-left w-10">#</th>
                <th className="px-2 py-3 text-left">Player</th>
                <th className="px-2 py-3 text-left">Team</th>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={`px-3 py-3 text-right cursor-pointer select-none hover:text-white transition-colors whitespace-nowrap ${
                      sortKey === col.key ? 'text-blue-400' : ''
                    }`}
                  >
                    {col.label}
                    {sortKey === col.key && <span className="ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => {
                const logo = getMLBTeamLogoUrl(p.team);
                return (
                  <tr
                    key={p.playerId ?? p.name}
                    className="border-b border-white/[0.04] hover:bg-white/[0.04] transition-colors"
                  >
                    <td className="pl-4 pr-2 py-2.5 text-gray-500 tabular-nums text-xs">{i + 1}</td>
                    <td className="px-2 py-2.5 font-medium">
                      {p.playerId ? (
                        <Link href={`/player/${p.playerId}`} className="hover:text-blue-400 transition-colors">
                          {p.name}
                        </Link>
                      ) : p.name}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {logo && <img src={logo} alt={p.team} className="w-4 h-4 object-contain flex-shrink-0" />}
                        <span className="text-gray-400 text-xs">{p.team}</span>
                      </div>
                    </td>
                    {COLUMNS.map(col => {
                      const val = p[col.key] as number | null;
                      const isSort = sortKey === col.key;
                      const isHighBarrel = col.key === 'barrels' && val !== null && val >= 10;
                      return (
                        <td
                          key={col.key}
                          className={`px-3 py-2.5 text-right tabular-nums ${
                            isHighBarrel
                              ? 'text-orange-400 font-bold'
                              : isSort
                              ? 'text-white font-semibold'
                              : 'text-gray-300'
                          }`}
                        >
                          {col.format(val)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 3} className="py-16 text-center text-gray-500 text-sm">
                    No players found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {!loading && !error && (
        <div className="px-4 py-3 text-xs text-gray-600">
          Showing {sorted.length} of {players.length} players · BIP = batted ball events
        </div>
      )}
    </div>
  );
}
