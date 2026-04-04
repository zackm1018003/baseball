'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';

type League = 'mlb' | 'aaa' | 'low-a';

interface BarrelPlayer {
  playerId: number | null;
  name: string;
  team: string;
  // MLB Statcast fields
  attempts:     number | null;
  barrels:      number | null;
  barrelPct:    number | null;
  barrelPerPA:  number | null;
  avgEv:        number | null;
  maxEv:        number | null;
  avgBatSpeed:  number | null;
  ev50:         number | null;
  sweetSpotPct: number | null;
  // Minor league traditional fields
  pa:  number | null;
  hr:  number | null;
  avg: string | null;
  obp: string | null;
  slg: string | null;
  ops: string | null;
  bb:  number | null;
  k:   number | null;
  sb:  number | null;
}

type NumKey = keyof Omit<BarrelPlayer, 'playerId' | 'name' | 'team' | 'avg' | 'obp' | 'slg' | 'ops'>;
type RateKey = 'avg' | 'obp' | 'slg' | 'ops';
type SortKey = NumKey | RateKey;

// MLB Statcast columns
const MLB_COLUMNS: { key: SortKey; label: string; title: string; format: (p: BarrelPlayer) => string }[] = [
  { key: 'barrels',     label: 'Barrels', title: 'Total barrels', format: p => p.barrels != null ? String(p.barrels) : '—' },
  { key: 'barrelPct',   label: 'BBL%',    title: 'Barrel rate (per BIP)', format: p => p.barrelPct   != null ? p.barrelPct.toFixed(1)   + '%' : '—' },
  { key: 'barrelPerPA', label: 'BBL/PA',  title: 'Barrel rate per PA',    format: p => p.barrelPerPA != null ? p.barrelPerPA.toFixed(1) + '%' : '—' },
  { key: 'avgEv',       label: 'Avg EV',  title: 'Average exit velocity', format: p => p.avgEv       != null ? p.avgEv.toFixed(1)       : '—' },
  { key: 'maxEv',       label: 'Max EV',  title: 'Max exit velocity',     format: p => p.maxEv       != null ? p.maxEv.toFixed(1)       : '—' },
  { key: 'ev50',        label: 'EV50',    title: '50th-pct exit velocity',format: p => p.ev50        != null ? p.ev50.toFixed(1)        : '—' },
  { key: 'avgBatSpeed', label: 'Avg BS',  title: 'Average bat speed',     format: p => p.avgBatSpeed != null ? p.avgBatSpeed.toFixed(1) : '—' },
  { key: 'sweetSpotPct',label: 'SS%',     title: 'Sweet-spot rate',       format: p => p.sweetSpotPct!= null ? p.sweetSpotPct.toFixed(1)+'%': '—' },
  { key: 'attempts',    label: 'BIP',     title: 'Batted ball events',    format: p => p.attempts    != null ? String(p.attempts)       : '—' },
];

// Minor league columns
const MINOR_COLUMNS: { key: SortKey; label: string; title: string; format: (p: BarrelPlayer) => string }[] = [
  { key: 'hr',  label: 'HR',  title: 'Home runs',          format: p => p.hr  != null ? String(p.hr) : '—' },
  { key: 'avg', label: 'AVG', title: 'Batting average',    format: p => p.avg ?? '—' },
  { key: 'obp', label: 'OBP', title: 'On-base percentage', format: p => p.obp ?? '—' },
  { key: 'slg', label: 'SLG', title: 'Slugging percentage',format: p => p.slg ?? '—' },
  { key: 'ops', label: 'OPS', title: 'OPS',                format: p => p.ops ?? '—' },
  { key: 'bb',  label: 'BB',  title: 'Walks',              format: p => p.bb  != null ? String(p.bb) : '—' },
  { key: 'k',   label: 'K',   title: 'Strikeouts',         format: p => p.k   != null ? String(p.k)  : '—' },
  { key: 'sb',  label: 'SB',  title: 'Stolen bases',       format: p => p.sb  != null ? String(p.sb) : '—' },
  { key: 'pa',  label: 'PA',  title: 'Plate appearances',  format: p => p.pa  != null ? String(p.pa) : '—' },
];

type SortDir = 'asc' | 'desc';

function parseRate(v: string | null): number {
  if (!v) return 0;
  return parseFloat(v) || 0;
}

export default function BarrelLeaderboardPage() {
  const [league, setLeague]             = useState<League>('mlb');
  const [players, setPlayers]           = useState<BarrelPlayer[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [sortKey, setSortKey]           = useState<SortKey>('barrels');
  const [sortDir, setSortDir]           = useState<SortDir>('desc');
  const [search, setSearch]             = useState('');
  const [minPA, setMinPA]               = useState('');
  const [teamFilter, setTeamFilter]     = useState('');
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo]     = useState(0);

  const COLUMNS = league === 'mlb' ? MLB_COLUMNS : MINOR_COLUMNS;
  const defaultSort: SortKey = league === 'mlb' ? 'barrels' : 'hr';

  const load = useCallback(async (lg: League) => {
    setLoading(true);
    setError(null);
    setPlayers([]);
    try {
      const res = await fetch(`/api/barrel-leaderboard?league=${lg}`);
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

  useEffect(() => { load(league); }, [load, league]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => load(league), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [load, league]);

  // Tick seconds-ago counter every second
  useEffect(() => {
    const tick = setInterval(() => setSecondsAgo(s => s + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  const handleLeagueChange = (lg: League) => {
    setLeague(lg);
    setSortKey(lg === 'mlb' ? 'barrels' : 'hr');
    setSortDir('desc');
    setSearch('');
    setMinPA('');
    setTeamFilter('');
  };

  const teams = useMemo(() => {
    const s = new Set(players.map(p => p.team).filter(Boolean));
    return Array.from(s).sort();
  }, [players]);

  const sorted = useMemo(() => {
    const paMin = minPA ? parseInt(minPA) : 0;
    const lq = search.toLowerCase();
    let list = players.filter(p => {
      if (lq && !p.name.toLowerCase().includes(lq) && !p.team.toLowerCase().includes(lq)) return false;
      if (teamFilter && p.team !== teamFilter) return false;
      // For MLB: filter by BIP (attempts); for minors: filter by PA
      if (paMin) {
        const cnt = league === 'mlb' ? p.attempts : p.pa;
        if (cnt == null || cnt < paMin) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === 'avg' || sortKey === 'obp' || sortKey === 'slg' || sortKey === 'ops') {
        av = parseRate(a[sortKey]);
        bv = parseRate(b[sortKey]);
      } else {
        av = (a[sortKey] as number | null) ?? (sortDir === 'desc' ? -Infinity : Infinity);
        bv = (b[sortKey] as number | null) ?? (sortDir === 'desc' ? -Infinity : Infinity);
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return list;
  }, [players, sortKey, sortDir, search, minPA, teamFilter, league]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const leagueLabel = league === 'mlb' ? 'MLB' : league === 'aaa' ? 'AAA' : 'Low-A';
  const paLabel = league === 'mlb' ? 'Min BIP' : 'Min PA';

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      {/* Header */}
      <div className="border-b border-white/[0.08] px-4 py-3 flex items-center gap-4 flex-wrap">
        <Link href="/" className="text-gray-400 hover:text-white text-sm transition-colors">← Back</Link>
        <h1 className="text-lg font-bold tracking-tight">🛢️ Barrel Leaderboard</h1>
        <span className="text-xs text-gray-500">2026 Season · {leagueLabel}</span>

        {/* League tabs */}
        <div className="flex rounded-lg overflow-hidden border border-white/[0.12]">
          {(['mlb', 'aaa', 'low-a'] as League[]).map(lg => {
            const active = league === lg;
            const color = lg === 'mlb' ? 'bg-blue-600' : lg === 'aaa' ? 'bg-purple-600' : 'bg-green-600';
            const label = lg === 'mlb' ? 'MLB' : lg === 'aaa' ? 'AAA' : 'Low-A';
            return (
              <button
                key={lg}
                onClick={() => handleLeagueChange(lg)}
                className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                  active ? `${color} text-white` : 'bg-white/[0.04] text-gray-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
          {loading
            ? <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse inline-block" />Updating…</span>
            : lastUpdated
            ? <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                Updated {secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.floor(secondsAgo / 60)}m ago`}
              </span>
            : null}
          <span>· {league === 'mlb' ? 'Baseball Savant' : 'MLB Stats API'}</span>
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
          value={minPA}
          onChange={e => setMinPA(e.target.value)}
          placeholder={paLabel}
          type="number"
          className="bg-white/[0.06] border border-white/[0.1] rounded px-3 py-1.5 text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500/60 w-24"
        />
        <button
          onClick={() => load(league)}
          className="ml-auto bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] rounded px-3 py-1.5 text-sm text-gray-300 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-400 text-sm gap-3">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            Loading {leagueLabel} leaderboard…
          </div>
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
                    title={col.title}
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
                      const isSort = sortKey === col.key;
                      const raw = p[col.key as keyof BarrelPlayer];
                      const isHighBarrel = col.key === 'barrels' && typeof raw === 'number' && raw >= 10;
                      const isHighHR = col.key === 'hr' && typeof raw === 'number' && raw >= 5;
                      return (
                        <td
                          key={col.key}
                          className={`px-3 py-2.5 text-right tabular-nums ${
                            isHighBarrel || isHighHR
                              ? 'text-orange-400 font-bold'
                              : isSort
                              ? 'text-white font-semibold'
                              : 'text-gray-300'
                          }`}
                        >
                          {col.format(p)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {sorted.length === 0 && !loading && (
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
          Showing {sorted.length} of {players.length} players
          {league === 'mlb' ? ' · BIP = batted ball events' : ''}
        </div>
      )}
    </div>
  );
}
