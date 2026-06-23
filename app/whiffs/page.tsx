'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';

type League = 'mlb' | 'aaa' | 'low-a' | 'rookie' | 'draft';

interface WhiffPitcher {
  playerId: number | null;
  name: string;
  team: string;
  age: number | null;
  ip: string | null;
  ipVal: number | null;
  bf: number | null;
  k: number | null;
  bb: number | null;
  hr: number | null;
  er: number | null;
  era: number | null;
  whip: number | null;
  kPct: number | null;
  bbPct: number | null;
  whiffs: number | null;
  swings: number | null;
  pitches: number | null;
  whiffPct: number | null;
  swStrPct: number | null;
  chasePct: number | null;
  swingPct: number | null;
}

type SortKey = keyof Omit<WhiffPitcher, 'playerId' | 'name' | 'team'>;
type SortDir = 'asc' | 'desc';

function fmt1(v: number | null, suffix = ''): string {
  return v != null ? v.toFixed(1) + suffix : '—';
}
function fmt2(v: number | null): string {
  return v != null ? v.toFixed(2) : '—';
}
function fmtInt(v: number | null): string {
  return v != null ? String(v) : '—';
}

// MLB Savant pitcher season columns
const MLB_SEASON_COLUMNS: { key: SortKey; label: string; title: string; format: (p: WhiffPitcher) => string }[] = [
  { key: 'whiffPct', label: 'Whiff%',  title: 'Whiff rate per swing',           format: p => fmt1(p.whiffPct, '%') },
  { key: 'swStrPct', label: 'SwStr%',  title: 'Swinging strike rate per pitch', format: p => fmt1(p.swStrPct, '%') },
  { key: 'kPct',     label: 'K%',      title: 'Strikeout rate',                 format: p => fmt1(p.kPct, '%') },
  { key: 'bbPct',    label: 'BB%',     title: 'Walk rate',                      format: p => fmt1(p.bbPct, '%') },
  { key: 'chasePct', label: 'Chase%',  title: 'Out-of-zone swing rate induced', format: p => fmt1(p.chasePct, '%') },
  { key: 'swingPct', label: 'Swing%',  title: 'Overall swing rate induced',     format: p => fmt1(p.swingPct, '%') },
  { key: 'era',      label: 'ERA',     title: 'Earned run average',             format: p => fmt2(p.era) },
  { key: 'whip',     label: 'WHIP',    title: 'Walks + hits per inning',        format: p => fmt2(p.whip) },
  { key: 'bf',       label: 'BF',      title: 'Batters faced',                  format: p => fmtInt(p.bf) },
  { key: 'age',      label: 'Age',     title: 'Player age',                     format: p => fmtInt(p.age) },
];

// Live-feed pitcher columns
const LIVE_COLUMNS: { key: SortKey; label: string; title: string; format: (p: WhiffPitcher) => string }[] = [
  { key: 'whiffs',   label: 'Whiffs',  title: 'Total swinging strikes generated', format: p => fmtInt(p.whiffs) },
  { key: 'whiffPct', label: 'Whiff%',  title: 'Whiff rate per swing',             format: p => fmt1(p.whiffPct, '%') },
  { key: 'swStrPct', label: 'SwStr%',  title: 'Swinging strike rate per pitch',   format: p => fmt1(p.swStrPct, '%') },
  { key: 'kPct',     label: 'K%',      title: 'Strikeout rate (K/BF)',            format: p => fmt1(p.kPct, '%') },
  { key: 'bbPct',    label: 'BB%',     title: 'Walk rate (BB/BF)',                format: p => fmt1(p.bbPct, '%') },
  { key: 'k',        label: 'K',       title: 'Strikeouts',                       format: p => fmtInt(p.k) },
  { key: 'bb',       label: 'BB',      title: 'Walks',                            format: p => fmtInt(p.bb) },
  { key: 'hr',       label: 'HR',      title: 'Home runs allowed',                format: p => fmtInt(p.hr) },
  { key: 'era',      label: 'ERA',     title: 'Earned run average',               format: p => fmt2(p.era) },
  { key: 'whip',     label: 'WHIP',    title: 'Walks + hits per inning',          format: p => fmt2(p.whip) },
  { key: 'ip',       label: 'IP',      title: 'Innings pitched',                  format: p => p.ip ?? '—' },
  { key: 'bf',       label: 'BF',      title: 'Batters faced',                    format: p => fmtInt(p.bf) },
  { key: 'age',      label: 'Age',     title: 'Player age',                       format: p => fmtInt(p.age) },
];

const LAST_N_OPTIONS = [
  { label: 'Season', value: 0 },
  { label: 'L5',     value: 5 },
  { label: 'L7',     value: 7 },
  { label: 'L10',    value: 10 },
  { label: 'L14',    value: 14 },
  { label: 'L20',    value: 20 },
  { label: 'L30',    value: 30 },
];

export default function WhiffLeaderboardPage() {
  const [league, setLeague]           = useState<League>('mlb');
  const [lastN, setLastN]             = useState<number>(0);
  const [players, setPlayers]         = useState<WhiffPitcher[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [sortKey, setSortKey]         = useState<SortKey>('whiffPct');
  const [sortDir, setSortDir]         = useState<SortDir>('desc');
  const [search, setSearch]           = useState('');
  const [minBF, setMinBF]             = useState('');
  const [teamFilter, setTeamFilter]   = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo]   = useState(0);

  const isMlbSeason = league === 'mlb' && lastN === 0;
  const COLUMNS = isMlbSeason ? MLB_SEASON_COLUMNS : LIVE_COLUMNS;

  const leagueLabel = {
    mlb:    'MLB',
    aaa:    'AAA',
    'low-a':'Low-A',
    rookie: 'Rookie Ball (FCL + ACL)',
    draft:  'MLB Draft League',
  }[league];

  const dataSource = {
    mlb:    lastN === 0 ? 'Baseball Savant' : 'MLB Stats API',
    aaa:    'MLB Stats API',
    'low-a':'MLB Stats API',
    rookie: 'MLB Stats API (FCL + ACL)',
    draft:  'MLB Stats API',
  }[league];

  const load = useCallback(async (lg: League, n: number) => {
    setLoading(true);
    setError(null);
    setPlayers([]);
    try {
      const url = n > 0
        ? `/api/whiff-leaderboard?league=${lg}&lastN=${n}`
        : `/api/whiff-leaderboard?league=${lg}`;
      const res = await fetch(url);
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

  useEffect(() => { load(league, lastN); }, [load, league, lastN]);

  useEffect(() => {
    const interval = setInterval(() => load(league, lastN), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [load, league, lastN]);

  useEffect(() => {
    const tick = setInterval(() => setSecondsAgo(s => s + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  const handleLeagueChange = (lg: League) => {
    setLeague(lg);
    setSortKey('whiffPct');
    setSortDir('desc');
    setSearch('');
    setMinBF('');
    setTeamFilter('');
  };

  const handleLastNChange = (n: number) => {
    setLastN(n);
    setSortKey(n === 0 && league === 'mlb' ? 'whiffPct' : 'whiffs');
    setSortDir('desc');
  };

  const teams = useMemo(() => {
    const s = new Set(players.map(p => p.team).filter(Boolean));
    return Array.from(s).sort();
  }, [players]);

  const sorted = useMemo(() => {
    const bfMin = minBF ? parseInt(minBF) : 0;
    const lq = search.toLowerCase();
    let list = players.filter(p => {
      if (lq && !p.name.toLowerCase().includes(lq) && !p.team.toLowerCase().includes(lq)) return false;
      if (teamFilter && p.team !== teamFilter) return false;
      if (bfMin && (p.bf == null || p.bf < bfMin)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      const inf = sortDir === 'desc' ? -Infinity : Infinity;
      const getVal = (p: WhiffPitcher): number => {
        if (sortKey === 'ip') return p.ipVal ?? inf;
        const v = p[sortKey];
        if (typeof v === 'number') return v;
        return inf;
      };
      return sortDir === 'desc' ? getVal(b) - getVal(a) : getVal(a) - getVal(b);
    });
    return list;
  }, [players, sortKey, sortDir, search, minBF, teamFilter]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  return (
    <div className="min-h-screen bg-page text-ink">
      {/* Header */}
      <div className="border-b border-ink/20 px-4 py-3 flex items-center gap-4 flex-wrap">
        <Link href="/" className="text-ink-3 hover:text-ink text-sm transition-colors">← Back</Link>
        <h1 className="text-lg font-bold tracking-tight">💨 Whiff Leaderboard</h1>
        <span className="text-xs text-ink-4">
          2026 Season · Pitchers · {leagueLabel}{lastN > 0 ? ` · Last ${lastN} Game Dates` : ''}
        </span>

        {/* League tabs */}
        <div className="flex overflow-hidden border border-ink/20">
          {([
            { id: 'mlb',    label: 'MLB',           color: 'bg-deep' },
            { id: 'aaa',    label: 'AAA',            color: 'bg-accent' },
            { id: 'low-a',  label: 'Low-A',          color: 'bg-green-600' },
            { id: 'rookie', label: '⚾ Rookie Ball',  color: 'bg-sky-600' },
            { id: 'draft',  label: '🎓 Draft League', color: 'bg-purple-600' },
          ] as { id: League; label: string; color: string }[]).map(({ id, label, color }) => (
            <button
              key={id}
              onClick={() => handleLeagueChange(id)}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                league === id ? `${color} text-ink` : 'bg-panel text-ink-3 hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Last N Games selector */}
        <div className="flex overflow-hidden border border-ink/20">
          {LAST_N_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleLastNChange(opt.value)}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                lastN === opt.value ? 'bg-amber-600 text-ink' : 'bg-panel text-ink-3 hover:text-ink'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs text-ink-4">
          {loading
            ? <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-yellow-400 animate-pulse inline-block" />Updating…</span>
            : lastUpdated
            ? <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-green-400 inline-block" />
                Updated {secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.floor(secondsAgo / 60)}m ago`}
              </span>
            : null}
          <span>· {dataSource}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-ink/20">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search pitcher / team…"
          className="bg-bone border border-ink/20 rounded px-3 py-1.5 text-sm placeholder-ink-4 focus:outline-none focus:border-ink/60 w-48"
        />
        <select
          value={teamFilter}
          onChange={e => setTeamFilter(e.target.value)}
          className="bg-bone border border-ink/20 rounded px-3 py-1.5 text-sm text-ink-2 focus:outline-none focus:border-ink/60"
        >
          <option value="">All Teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          value={minBF}
          onChange={e => setMinBF(e.target.value)}
          placeholder="Min BF"
          type="number"
          className="bg-bone border border-ink/20 rounded px-3 py-1.5 text-sm placeholder-ink-4 focus:outline-none focus:border-ink/60 w-24"
        />
        {isMlbSeason && (
          <span className="self-center text-xs text-ink-4 italic">
            SwStr% derived · Chase% from Savant swing/take
          </span>
        )}
        <div className="ml-auto">
          <button
            onClick={() => load(league, lastN)}
            className="bg-bone hover:bg-panel border border-ink/20 rounded px-3 py-1.5 text-sm text-ink-2 transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-ink-3 text-sm gap-3">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent animate-spin" />
            Loading {leagueLabel}{lastN > 0 ? ` last ${lastN} game dates` : ''} whiff leaderboard…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-24 text-red-400 text-sm">Error: {error}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/20 text-ink-3 text-xs uppercase tracking-wider">
                <th className="pl-4 pr-2 py-3 text-left w-10">#</th>
                <th className="px-2 py-3 text-left">Pitcher</th>
                <th className="px-2 py-3 text-left">Team</th>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    title={col.title}
                    className={`px-3 py-3 text-right cursor-pointer select-none hover:text-ink transition-colors whitespace-nowrap ${
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
                const isElite = (p.whiffPct ?? 0) >= 35;
                return (
                  <tr
                    key={p.playerId ?? p.name}
                    className="border-b border-ink/20 hover:bg-panel transition-colors"
                  >
                    <td className="pl-4 pr-2 py-2.5 text-ink-4 tabular-nums text-xs">{i + 1}</td>
                    <td className="px-2 py-2.5 font-medium">
                      {p.playerId ? (
                        league === 'rookie' ? (
                          <Link
                            href={`/fcl/player/season?batterId=${p.playerId}&league=rookie&season=${new Date().getFullYear()}`}
                            className="hover:text-orange-400 transition-colors"
                          >
                            {p.name}
                          </Link>
                        ) : league === 'draft' ? (
                          <Link
                            href={`/draft/pitcher/season?pitcherId=${p.playerId}&season=${new Date().getFullYear()}`}
                            className="hover:text-purple-400 transition-colors"
                          >
                            {p.name}
                          </Link>
                        ) : (
                          <Link href={`/player/${p.playerId}`} className="hover:text-blue-400 transition-colors">
                            {p.name}
                          </Link>
                        )
                      ) : p.name}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {logo && <img src={logo} alt={p.team} className="w-4 h-4 object-contain flex-shrink-0" />}
                        <span className="text-ink-3 text-xs">{p.team}</span>
                      </div>
                    </td>
                    {COLUMNS.map(col => {
                      const isSort = sortKey === col.key;
                      const isHighlighted = (col.key === 'whiffPct' || col.key === 'whiffs') && isElite;
                      return (
                        <td
                          key={col.key}
                          className={`px-3 py-2.5 text-right tabular-nums ${
                            isHighlighted
                              ? 'text-green-400 font-bold'
                              : isSort
                              ? 'text-accent font-semibold'
                              : 'text-ink-2'
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
                  <td colSpan={COLUMNS.length + 3} className="py-16 text-center text-ink-4 text-sm">
                    No pitchers found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {!loading && !error && (
        <div className="px-4 py-3 text-xs text-ink-3">
          Showing {sorted.length} of {players.length} pitchers
          {isMlbSeason
            ? ' · Whiff% = swinging strikes / swings · SwStr% derived from Whiff% × Swing%'
            : league === 'rookie'
            ? ' · FCL + ACL combined · Pitch data from play-by-play'
            : league === 'draft'
            ? ' · MLB Draft League · Pitch data from play-by-play'
            : ' · Pitch data from play-by-play · Whiff% ≥ 35% highlighted'}
        </div>
      )}
    </div>
  );
}
