'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { getAllPlayers, getTeams } from '@/lib/database';
import { DATASETS, DEFAULT_DATASET_ID } from '@/lib/datasets';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import { getCountryFlagUrl } from '@/lib/country-flags';
import PlayerCard from '@/components/PlayerCard';
import Link from 'next/link';

// ─── Daily hitter types ────────────────────────────────────────────────────────

interface DailyHitterLine {
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  doubles: number;
  triples: number;
  sb: number;
}

interface DailyHitter {
  playerId: number;
  name: string;
  team: string;
  opponent: string;
  isHome: boolean;
  gamePk: number;
  line: DailyHitterLine | null;
  batSpeed: number | null;
  maxEv: number | null;
  barrels: number | null;
  hardHit95: number | null;
}

interface DailyGame {
  gamePk: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  sportId: number;
}

interface DailyData {
  date: string;
  games: DailyGame[];
  hitters: DailyHitter[];
}

// ─── Season hitter types ───────────────────────────────────────────────────────

interface SeasonHitter {
  playerId: number;
  name: string;
  team: string;
  pa: number;
  ab: number;
  h: number;
  avg: string;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  doubles: number;
  triples: number;
  sb: number;
  obp: string | null;
  slg: string | null;
  ops: string | null;
  avgEv: number | null;
  barrelPct: number | null;
  hardHitPct: number | null;
  avgBatSpeed: number | null;
}

interface SeasonData {
  season: string;
  hitters: SeasonHitter[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function hitColor(h: number): string {
  if (h >= 4) return 'text-green-400';
  if (h >= 3) return 'text-green-300';
  if (h >= 2) return 'text-yellow-400';
  if (h >= 1) return 'text-gray-200';
  return 'text-red-400';
}

function hrColor(hr: number): string {
  if (hr >= 2) return 'text-green-400';
  if (hr >= 1) return 'text-yellow-400';
  return 'text-gray-500';
}

// ─── Daily Hitters Panel ───────────────────────────────────────────────────────

function DailyHittersPanel() {
  const [date, setDate] = useState<string>(today());
  const [league, setLeague] = useState<'mlb' | 'aaa' | 'low-a'>('mlb');
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGamePk, setSelectedGamePk] = useState<number | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [sortCol, setSortCol] = useState<string>('h');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const fetchDay = useCallback(async (d: string, lg: 'mlb' | 'aaa' | 'low-a', silent = false) => {
    if (!silent) { setLoading(true); setError(null); setData(null); setSelectedGamePk(null); }
    try {
      const res = await fetch(`/api/daily-hitters?date=${d}&league=${lg}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setData(json);
      setLastRefresh(new Date());
    } catch (e: unknown) {
      if (!silent) setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDay(date, league); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 60 seconds when viewing today's date (handles pre-game → live transitions)
  useEffect(() => {
    if (date !== today()) return;
    const allFinal = (data?.games.length ?? 0) > 0 && data!.games.every(g => {
      const s = g.status.toLowerCase();
      return s.includes('final') || s.includes('postponed') || s.includes('cancelled') || s.includes('game over');
    });
    if (allFinal) return;
    const interval = setInterval(() => fetchDay(date, league, true), 60_000);
    return () => clearInterval(interval);
  }, [date, league, data, fetchDay]);

  const handleDateChange = (d: string) => {
    setDate(d);
    fetchDay(d, league);
  };

  const handleLeagueChange = (lg: 'mlb' | 'aaa' | 'low-a') => {
    setLeague(lg);
    fetchDay(date, lg);
  };

  const shiftDate = (days: number) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + days);
    const newDate = d.toISOString().slice(0, 10);
    setDate(newDate);
    fetchDay(newDate, league);
  };

  const handleGameClick = (gamePk: number) => {
    setSelectedGamePk(prev => prev === gamePk ? null : gamePk);
  };

  const displayed = useMemo(() => {
    if (!data) return [];
    let list = data.hitters;
    if (selectedGamePk !== null) list = list.filter(h => h.gamePk === selectedGamePk);
    return [...list].sort((a, b) => {
      let av: number, bv: number;
      switch (sortCol) {
        case 'h':      av = a.line?.h ?? -1;        bv = b.line?.h ?? -1;       break;
        case 'hr':     av = a.line?.hr ?? -1;       bv = b.line?.hr ?? -1;      break;
        case 'rbi':    av = a.line?.rbi ?? -1;      bv = b.line?.rbi ?? -1;     break;
        case 'bb':     av = a.line?.bb ?? -1;       bv = b.line?.bb ?? -1;      break;
        case 'k':      av = a.line?.k ?? -1;        bv = b.line?.k ?? -1;       break;
        case 'ab':     av = a.line?.ab ?? -1;       bv = b.line?.ab ?? -1;      break;
        case '2b':     av = a.line?.doubles ?? -1;  bv = b.line?.doubles ?? -1; break;
        case 'sb':     av = a.line?.sb ?? -1;       bv = b.line?.sb ?? -1;      break;
        case 'batspd': av = a.batSpeed ?? -1;       bv = b.batSpeed ?? -1;      break;
        case 'maxev':  av = a.maxEv ?? -1;          bv = b.maxEv ?? -1;         break;
        case 'barrel': av = a.barrels ?? -1;        bv = b.barrels ?? -1;       break;
        case 'hh95':   av = a.hardHit95 ?? -1;      bv = b.hardHit95 ?? -1;     break;
        default:       av = a.line?.h ?? -1;        bv = b.line?.h ?? -1;
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [data, selectedGamePk, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const SortTh = ({ col, label, title }: { col: string; label: string; title?: string }) => (
    <th
      onClick={() => handleSort(col)}
      title={title}
      className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap hover:text-white transition-colors ${sortCol === col ? 'text-blue-400' : 'text-gray-500'}`}
    >
      {label}{sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );

  return (
    <div className="bg-[#1a1a2e] rounded-xl overflow-hidden mb-6 shadow-xl">
      {/* Panel header */}
      <div className="bg-[#16213e] border-b border-gray-700 px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-white font-bold text-base">📅 Daily Hitters</h2>
              {data?.games.some(g => {
                const s = g.status.toLowerCase();
                return !s.includes('final') && !s.includes('postponed') && !s.includes('cancelled') && !s.includes('scheduled');
              }) && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 bg-red-600/20 border border-red-500/40 rounded text-[10px] text-red-400 font-bold uppercase tracking-wide">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                  Live
                </span>
              )}
            </div>
            <p className="text-gray-500 text-xs mt-0.5">
              {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ` : ''}
              Click a game to filter hitters
            </p>
          </div>

          {/* Date input with prev/next arrows */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => shiftDate(-1)}
              className="px-2 py-1.5 bg-[#0d1b2a] hover:bg-[#1a2940] border border-gray-600 hover:border-blue-500 text-gray-300 hover:text-white rounded-lg text-sm transition-colors"
              title="Previous day"
            >←</button>
            <input
              type="date"
              value={date}
              onChange={e => handleDateChange(e.target.value)}
              className="bg-[#0d1b2a] text-white border border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => shiftDate(1)}
              className="px-2 py-1.5 bg-[#0d1b2a] hover:bg-[#1a2940] border border-gray-600 hover:border-blue-500 text-gray-300 hover:text-white rounded-lg text-sm transition-colors"
              title="Next day"
            >→</button>
          </div>

          {/* League selector */}
          <div className="flex items-center rounded-lg overflow-hidden border border-gray-600 text-xs font-semibold">
            <button
              onClick={() => handleLeagueChange('mlb')}
              className={`px-3 py-1.5 transition-colors ${league === 'mlb' ? 'bg-blue-600 text-white' : 'bg-[#0d1b2a] text-gray-400 hover:text-white hover:bg-[#1a2940]'}`}
            >MLB</button>
            <button
              onClick={() => handleLeagueChange('aaa')}
              className={`px-3 py-1.5 transition-colors ${league === 'aaa' ? 'bg-purple-600 text-white' : 'bg-[#0d1b2a] text-gray-400 hover:text-white hover:bg-[#1a2940]'}`}
            >AAA</button>
            <button
              onClick={() => handleLeagueChange('low-a')}
              className={`px-3 py-1.5 transition-colors ${league === 'low-a' ? 'bg-green-600 text-white' : 'bg-[#0d1b2a] text-gray-400 hover:text-white hover:bg-[#1a2940]'}`}
            >Low-A</button>
          </div>

          {data && (
            <span className="ml-auto text-xs text-gray-400">
              {displayed.length} hitter{displayed.length !== 1 ? 's' : ''} · {data.games.length} game{data.games.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Games scoreboard strip — separated by league */}
      {data && data.games.length > 0 && (() => {
        const mlbGames = data.games.filter(g => g.sportId === 1);
        const wbcGames = data.games.filter(g => g.sportId === 51);
        const aaaGames = data.games.filter(g => g.sportId === 11);
        const lowAGames = data.games.filter(g => g.sportId === 14);
        const collegeGames = data.games.filter(g => g.sportId !== 1 && g.sportId !== 51 && g.sportId !== 11 && g.sportId !== 14);
        const renderGame = (g: DailyGame) => {
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
                <span className="text-gray-400 font-mono">vs</span>
              )}
              <span className="font-semibold">{g.homeTeam}</span>
              {homeLogo && <img src={homeLogo} alt={g.homeTeam} className="w-4 h-4 object-contain" />}
              {!final && <span className="text-yellow-500 text-[9px] font-bold ml-1">{g.status}</span>}
            </button>
          );
        };
        return (
          <div className="bg-[#0d1b2a] border-b border-gray-800">
            {/* MLB row */}
            {mlbGames.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider flex-shrink-0 w-10">MLB</span>
                {mlbGames.map(renderGame)}
                {selectedGamePk !== null && mlbGames.some(g => g.gamePk === selectedGamePk) && (
                  <button onClick={() => setSelectedGamePk(null)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded-lg hover:bg-[#16213e] transition-colors">✕ Show all</button>
                )}
              </div>
            )}
            {/* Divider between sections */}
            {mlbGames.length > 0 && wbcGames.length > 0 && (
              <div className="border-t border-gray-800/60" />
            )}
            {/* WBC row */}
            {wbcGames.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider flex-shrink-0 w-10">WBC</span>
                {wbcGames.map(renderGame)}
                {selectedGamePk !== null && wbcGames.some(g => g.gamePk === selectedGamePk) && (
                  <button onClick={() => setSelectedGamePk(null)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded-lg hover:bg-[#16213e] transition-colors">✕ Show all</button>
                )}
              </div>
            )}
            {/* Divider between sections */}
            {(mlbGames.length > 0 || wbcGames.length > 0) && aaaGames.length > 0 && (
              <div className="border-t border-gray-800/60" />
            )}
            {/* AAA row */}
            {aaaGames.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider flex-shrink-0 w-10">AAA</span>
                {aaaGames.map(renderGame)}
                {selectedGamePk !== null && aaaGames.some(g => g.gamePk === selectedGamePk) && (
                  <button onClick={() => setSelectedGamePk(null)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded-lg hover:bg-[#16213e] transition-colors">✕ Show all</button>
                )}
              </div>
            )}
            {/* Divider between sections */}
            {(mlbGames.length > 0 || wbcGames.length > 0 || aaaGames.length > 0) && lowAGames.length > 0 && (
              <div className="border-t border-gray-800/60" />
            )}
            {/* Low-A row */}
            {lowAGames.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="text-[10px] font-bold text-green-400 uppercase tracking-wider flex-shrink-0 w-10">Low-A</span>
                {lowAGames.map(renderGame)}
                {selectedGamePk !== null && lowAGames.some(g => g.gamePk === selectedGamePk) && (
                  <button onClick={() => setSelectedGamePk(null)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded-lg hover:bg-[#16213e] transition-colors">✕ Show all</button>
                )}
              </div>
            )}
            {/* Divider between sections */}
            {(mlbGames.length > 0 || wbcGames.length > 0 || aaaGames.length > 0 || lowAGames.length > 0) && collegeGames.length > 0 && (
              <div className="border-t border-gray-800/60" />
            )}
            {/* College row */}
            {collegeGames.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="text-[10px] font-bold text-green-400 uppercase tracking-wider flex-shrink-0 w-10">NCAA</span>
                {collegeGames.map(renderGame)}
                {selectedGamePk !== null && collegeGames.some(g => g.gamePk === selectedGamePk) && (
                  <button onClick={() => setSelectedGamePk(null)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded-lg hover:bg-[#16213e] transition-colors">✕ Show all</button>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-500 gap-3">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading hitters for {date}...</span>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="py-8 text-center text-red-400 text-sm">{error}</div>
      )}

      {/* No games */}
      {!loading && !error && data && data.hitters.length === 0 && (
        <div className="py-10 text-center text-gray-500 text-sm">
          No games found for {date}. Try a different date.
        </div>
      )}

      {/* Hitter table */}
      {!loading && !error && displayed.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/60 bg-[#0d1b2a]">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Hitter</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Matchup</th>
                <SortTh col="h"      label="H" />
                <SortTh col="ab"     label="AB" />
                <SortTh col="hr"     label="HR" />
                <SortTh col="rbi"    label="RBI" />
                <SortTh col="bb"     label="BB" />
                <SortTh col="k"      label="K" />
                <SortTh col="2b"     label="2B" />
                <SortTh col="sb"     label="SB" />
                {league === 'mlb' && (
                  <SortTh col="batspd" label="Avg BS" title="Average Bat Speed (today)" />
                )}
                <SortTh col="maxev"  label="Max EV" title="Max Exit Velocity (today)" />
                <SortTh col="barrel" label="Brls"   title="Barrels (today)" />
                <SortTh col="hh95"   label="95+"    title="Batted balls 95+ mph (today)" />
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Daily Card</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((h, idx) => {
                const line = h.line;
                const teamLogo = getMLBTeamLogoUrl(h.team);
                const oppLogo = getMLBTeamLogoUrl(h.opponent);
                const countryFlag = getCountryFlagUrl(h.team, 40);
                return (
                  <tr
                    key={`${h.playerId}-${idx}`}
                    className="border-b border-gray-800/60 hover:bg-[#16213e]/60 transition-colors"
                  >
                    {/* Name + team */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {countryFlag
                          ? <img src={countryFlag} alt={h.team} className="w-7 h-[18px] object-cover flex-shrink-0 rounded-sm" />
                          : teamLogo && <img src={teamLogo} alt={h.team} className="w-5 h-5 object-contain flex-shrink-0" />
                        }
                        <div>
                          <Link
                            href={`/player/${h.playerId}`}
                            className="text-white font-semibold hover:text-blue-400 transition-colors text-sm"
                          >
                            {h.name}
                          </Link>
                          <div className="text-xs text-gray-400">{h.team}</div>
                        </div>
                      </div>
                    </td>

                    {/* Matchup */}
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1 text-xs text-gray-400">
                        <span>{h.isHome ? 'vs' : '@'}</span>
                        {oppLogo && <img src={oppLogo} alt={h.opponent} className="w-4 h-4 object-contain" />}
                        <span className="font-semibold text-gray-300">{h.opponent}</span>
                      </div>
                    </td>

                    {/* Stat line */}
                    {line ? (
                      <>
                        <td className={`px-3 py-2.5 text-center font-bold ${hitColor(line.h)}`}>{line.h}</td>
                        <td className="px-3 py-2.5 text-center text-gray-300 font-semibold">{line.ab}</td>
                        <td className={`px-3 py-2.5 text-center font-semibold ${hrColor(line.hr)}`}>{line.hr || '—'}</td>
                        <td className="px-3 py-2.5 text-center text-gray-400">{line.rbi || '—'}</td>
                        <td className="px-3 py-2.5 text-center text-gray-400">{line.bb || '—'}</td>
                        <td className="px-3 py-2.5 text-center text-gray-400">{line.k || '—'}</td>
                        <td className="px-3 py-2.5 text-center text-gray-400">{line.doubles || '—'}</td>
                        <td className="px-3 py-2.5 text-center text-gray-400">{line.sb || '—'}</td>
                      </>
                    ) : (
                      <td colSpan={8} className="px-3 py-2.5 text-center text-gray-300 text-xs italic">
                        Stats pending
                      </td>
                    )}
                    {league === 'mlb' && (
                      <td className="px-3 py-2.5 text-center text-gray-400 text-xs">{h.batSpeed != null ? h.batSpeed.toFixed(1) : '—'}</td>
                    )}
                    <td className="px-3 py-2.5 text-center text-gray-400 text-xs">{h.maxEv != null ? h.maxEv.toFixed(1) : '—'}</td>
                    <td className="px-3 py-2.5 text-center text-gray-400 text-xs">{h.barrels != null ? h.barrels : '—'}</td>
                    <td className="px-3 py-2.5 text-center text-gray-400 text-xs">{h.hardHit95 != null ? h.hardHit95 : '—'}</td>

                    {/* Daily card link */}
                    <td className="px-3 py-2.5 text-center">
                      <Link
                        href={`/player/${h.playerId}/daily?date=${date}`}
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

// ─── Season Hitters Panel ──────────────────────────────────────────────────────

function SeasonHittersPanel() {
  const currentYear = new Date().getFullYear().toString();
  const [season, setSeason] = useState<string>(currentYear);
  const [league, setLeague] = useState<'mlb' | 'aaa' | 'low-a'>('mlb');
  const [data, setData] = useState<SeasonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minPa, setMinPa] = useState<number>(50);
  const [search, setSearch] = useState<string>('');
  const [sortCol, setSortCol] = useState<string>('hr');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const fetchSeason = useCallback(async (s: string, lg: 'mlb' | 'aaa' | 'low-a') => {
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch(`/api/season-hitters?season=${s}&league=${lg}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSeason(season, league); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLeagueChange = (lg: 'mlb' | 'aaa' | 'low-a') => {
    setLeague(lg);
    fetchSeason(season, lg);
  };

  const handleSeasonChange = (s: string) => {
    setSeason(s);
    fetchSeason(s, league);
  };

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const parseRate = (v: string | null): number => {
    if (v == null) return -1;
    return parseFloat(v) || -1;
  };

  const displayed = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    let list = data.hitters.filter(h => {
      if (h.pa < minPa) return false;
      if (q) return h.name.toLowerCase().includes(q) || h.team.toLowerCase().includes(q);
      return true;
    });
    return [...list].sort((a, b) => {
      let av: number, bv: number;
      switch (sortCol) {
        case 'pa':      av = a.pa;               bv = b.pa;               break;
        case 'ab':      av = a.ab;               bv = b.ab;               break;
        case 'h':       av = a.h;                bv = b.h;                break;
        case 'avg':     av = parseRate(a.avg);   bv = parseRate(b.avg);   break;
        case 'hr':      av = a.hr;               bv = b.hr;               break;
        case 'rbi':     av = a.rbi;              bv = b.rbi;              break;
        case 'bb':      av = a.bb;               bv = b.bb;               break;
        case 'k':       av = a.k;                bv = b.k;                break;
        case '2b':      av = a.doubles;          bv = b.doubles;          break;
        case 'sb':      av = a.sb;               bv = b.sb;               break;
        case 'obp':     av = parseRate(a.obp);   bv = parseRate(b.obp);   break;
        case 'slg':     av = parseRate(a.slg);   bv = parseRate(b.slg);   break;
        case 'ops':     av = parseRate(a.ops);   bv = parseRate(b.ops);   break;
        case 'avgev':   av = a.avgEv      ?? -1; bv = b.avgEv      ?? -1; break;
        case 'barrel':  av = a.barrelPct  ?? -1; bv = b.barrelPct  ?? -1; break;
        case 'hh':      av = a.hardHitPct ?? -1; bv = b.hardHitPct ?? -1; break;
        case 'batspd':  av = a.avgBatSpeed ?? -1; bv = b.avgBatSpeed ?? -1; break;
        default:        av = a.hr;               bv = b.hr;
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [data, minPa, search, sortCol, sortDir]);

  const SortTh = ({ col, label, title }: { col: string; label: string; title?: string }) => (
    <th
      onClick={() => handleSort(col)}
      title={title}
      className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap hover:text-white transition-colors ${sortCol === col ? 'text-blue-400' : 'text-gray-500'}`}
    >
      {label}{sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );

  const fmtRate = (v: string | null) => {
    if (v == null) return '—';
    // strip leading zero: ".312" not "0.312"
    return v.startsWith('0.') ? v.slice(1) : v;
  };

  const yearOptions = [];
  for (let y = parseInt(currentYear); y >= 2015; y--) yearOptions.push(y.toString());

  return (
    <div className="bg-[#1a1a2e] rounded-xl overflow-hidden mb-6 shadow-xl">
      {/* Panel header */}
      <div className="bg-[#16213e] border-b border-gray-700 px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h2 className="text-white font-bold text-base">📊 Season Hitters</h2>
            <p className="text-gray-500 text-xs mt-0.5">Season totals · Click a column header to sort</p>
          </div>

          {/* Season selector */}
          <select
            value={season}
            onChange={e => handleSeasonChange(e.target.value)}
            className="bg-[#0d1b2a] text-white border border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          {/* League selector */}
          <div className="flex items-center rounded-lg overflow-hidden border border-gray-600 text-xs font-semibold">
            <button
              onClick={() => handleLeagueChange('mlb')}
              className={`px-3 py-1.5 transition-colors ${league === 'mlb' ? 'bg-blue-600 text-white' : 'bg-[#0d1b2a] text-gray-400 hover:text-white hover:bg-[#1a2940]'}`}
            >MLB</button>
            <button
              onClick={() => handleLeagueChange('aaa')}
              className={`px-3 py-1.5 transition-colors ${league === 'aaa' ? 'bg-purple-600 text-white' : 'bg-[#0d1b2a] text-gray-400 hover:text-white hover:bg-[#1a2940]'}`}
            >AAA</button>
            <button
              onClick={() => handleLeagueChange('low-a')}
              className={`px-3 py-1.5 transition-colors ${league === 'low-a' ? 'bg-green-600 text-white' : 'bg-[#0d1b2a] text-gray-400 hover:text-white hover:bg-[#1a2940]'}`}
            >Low-A</button>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search player or team…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-[#0d1b2a] text-white border border-gray-600 rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-600"
          />

          {/* Min PA filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 whitespace-nowrap">Min PA</label>
            <input
              type="number"
              value={minPa}
              onChange={e => setMinPa(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-16 bg-[#0d1b2a] text-white border border-gray-600 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {data && (
            <span className="ml-auto text-xs text-gray-400">
              {displayed.length} hitter{displayed.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-500 gap-3">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading {season} season stats…</span>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="py-8 text-center text-red-400 text-sm">{error}</div>
      )}

      {/* Empty */}
      {!loading && !error && data && displayed.length === 0 && (
        <div className="py-10 text-center text-gray-500 text-sm">
          No hitters found. Try lowering the Min PA.
        </div>
      )}

      {/* Table */}
      {!loading && !error && displayed.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/60 bg-[#0d1b2a]">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Hitter</th>
                <SortTh col="pa"     label="PA" />
                <SortTh col="avg"    label="AVG" />
                <SortTh col="h"      label="H" />
                <SortTh col="ab"     label="AB" />
                <SortTh col="hr"     label="HR" />
                <SortTh col="rbi"    label="RBI" />
                <SortTh col="bb"     label="BB" />
                <SortTh col="k"      label="K" />
                <SortTh col="2b"     label="2B" />
                <SortTh col="sb"     label="SB" />
                <SortTh col="obp"    label="OBP" />
                <SortTh col="slg"    label="SLG" />
                <SortTh col="ops"    label="OPS" />
                {league === 'mlb' && (
                  <>
                    <SortTh col="batspd" label="Avg BS"  title="Average Bat Speed (season)" />
                    <SortTh col="avgev"  label="Avg EV"  title="Average Exit Velocity (season)" />
                    <SortTh col="barrel" label="Brls%"   title="Barrel Rate (season)" />
                    <SortTh col="hh"     label="HH%"     title="Hard Hit % (season)" />
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {displayed.map((h, idx) => {
                const teamLogo = getMLBTeamLogoUrl(h.team);
                return (
                  <tr
                    key={`${h.playerId}-${idx}`}
                    className="border-b border-gray-800/60 hover:bg-[#16213e]/60 transition-colors"
                  >
                    {/* Name + team */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {teamLogo && <img src={teamLogo} alt={h.team} className="w-5 h-5 object-contain flex-shrink-0" />}
                        <div>
                          <Link
                            href={`/player/${h.playerId}`}
                            className="text-white font-semibold hover:text-blue-400 transition-colors text-sm"
                          >
                            {h.name}
                          </Link>
                          <div className="text-xs text-gray-400">{h.team}</div>
                        </div>
                      </div>
                    </td>

                    {/* Stats */}
                    <td className="px-3 py-2.5 text-center text-gray-300 font-semibold">{h.pa}</td>
                    <td className="px-3 py-2.5 text-center font-bold text-gray-200">{fmtRate(h.avg)}</td>
                    <td className={`px-3 py-2.5 text-center font-bold ${hitColor(h.h)}`}>{h.h}</td>
                    <td className="px-3 py-2.5 text-center text-gray-300 font-semibold">{h.ab}</td>
                    <td className={`px-3 py-2.5 text-center font-semibold ${hrColor(h.hr)}`}>{h.hr || '—'}</td>
                    <td className="px-3 py-2.5 text-center text-gray-400">{h.rbi || '—'}</td>
                    <td className="px-3 py-2.5 text-center text-gray-400">{h.bb || '—'}</td>
                    <td className="px-3 py-2.5 text-center text-gray-400">{h.k || '—'}</td>
                    <td className="px-3 py-2.5 text-center text-gray-400">{h.doubles || '—'}</td>
                    <td className="px-3 py-2.5 text-center text-gray-400">{h.sb || '—'}</td>
                    <td className="px-3 py-2.5 text-center text-gray-300">{fmtRate(h.obp)}</td>
                    <td className="px-3 py-2.5 text-center text-gray-300">{fmtRate(h.slg)}</td>
                    <td className="px-3 py-2.5 text-center font-semibold text-gray-200">{fmtRate(h.ops)}</td>
                    {league === 'mlb' && (
                      <>
                        <td className="px-3 py-2.5 text-center text-gray-400 text-xs">{h.avgBatSpeed != null ? h.avgBatSpeed.toFixed(1) : '—'}</td>
                        <td className="px-3 py-2.5 text-center text-gray-400 text-xs">{h.avgEv != null ? h.avgEv.toFixed(1) : '—'}</td>
                        <td className="px-3 py-2.5 text-center text-gray-400 text-xs">{h.barrelPct != null ? h.barrelPct.toFixed(1) + '%' : '—'}</td>
                        <td className="px-3 py-2.5 text-center text-gray-400 text-xs">{h.hardHitPct != null ? h.hardHitPct.toFixed(1) + '%' : '—'}</td>
                      </>
                    )}
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
  const [pullAirMin, setPullAirMin] = useState<string>('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showDailyPanel, setShowDailyPanel] = useState(false);
  const [showSeasonPanel, setShowSeasonPanel] = useState(false);

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
  const isAAA = selectedDataset !== 'mlb2025'; // All non-MLB datasets use AAA-style display

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
      filtered = filtered.filter((p) => p.age !== undefined && p.age >= parseInt(ageMin));
    }
    if (ageMax) {
      filtered = filtered.filter((p) => p.age !== undefined && p.age <= parseInt(ageMax));
    }

    // Filter by bat speed
    if (batSpeedMin) {
      filtered = filtered.filter((p) => p.bat_speed !== undefined && p.bat_speed >= parseFloat(batSpeedMin));
    }

    // Filter by average exit velocity
    if (avgEvMin) {
      filtered = filtered.filter((p) => (p.avg_ev || 0) >= parseFloat(avgEvMin));
    }

    // Filter by pull air %
    if (pullAirMin) {
      filtered = filtered.filter((p) => (p['pull_air%'] || 0) >= parseFloat(pullAirMin));
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
        case 'slg': {
          const aSLG = typeof a.slg === 'number' ? a.slg : (typeof a.slg === 'string' ? parseFloat(a.slg) || 0 : 0);
          const bSLG = typeof b.slg === 'number' ? b.slg : (typeof b.slg === 'string' ? parseFloat(b.slg) || 0 : 0);
          return bSLG - aSLG;
        }
        case 'ba': {
          const aBA = a.avg !== undefined ? a.avg : (typeof a.ba === 'number' ? a.ba : (typeof a.ba === 'string' ? parseFloat(a.ba) || 0 : 0));
          const bBA = b.avg !== undefined ? b.avg : (typeof b.ba === 'number' ? b.ba : (typeof b.ba === 'string' ? parseFloat(b.ba) || 0 : 0));
          return bBA - aBA;
        }
        case 'obp': {
          const aOBP = typeof a.obp === 'number' ? a.obp : (typeof a.obp === 'string' ? parseFloat(a.obp) || 0 : 0);
          const bOBP = typeof b.obp === 'number' ? b.obp : (typeof b.obp === 'string' ? parseFloat(b.obp) || 0 : 0);
          return bOBP - aOBP;
        }
        default:
          return 0;
      }
    });

    return sorted;
  }, [allPlayers, searchQuery, selectedTeam, sortBy, ageMin, ageMax, batSpeedMin, avgEvMin, pullAirMin]);

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
              <p className="text-gray-400 dark:text-gray-300 mt-1">
                {filteredAndSortedPlayers.length} players
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
                📅 Daily Hitters
              </button>
              <button
                onClick={() => setShowSeasonPanel(v => !v)}
                className={`px-4 py-2 font-medium rounded-lg transition-colors text-sm border ${
                  showSeasonPanel
                    ? 'bg-blue-600 border-blue-500 text-white hover:bg-blue-700'
                    : 'bg-gray-900 border-gray-600 text-gray-300 hover:bg-gray-800 hover:border-blue-500 hover:text-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200'
                }`}
              >
                📊 Season Hitters
              </button>
              <a
                href="/leaderboard"
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-lg transition-colors text-sm"
              >
                Leaderboard
              </a>
              <a
                href="/barrels"
                className="px-4 py-2 bg-orange-800 hover:bg-orange-700 text-white font-medium rounded-lg transition-colors text-sm"
              >
                🛢️ Barrels
              </a>
              <a
                href="/overslot"
                className="px-4 py-2 bg-sky-700 hover:bg-sky-600 text-white font-medium rounded-lg transition-colors text-sm"
              >
                🎓 College Stats
              </a>
              <a
                href="/grades"
                className="px-4 py-2 bg-indigo-700 hover:bg-indigo-600 text-white font-medium rounded-lg transition-colors text-sm"
              >
                📋 Scout Grades
              </a>
              <a
                href="/hs"
                className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white font-medium rounded-lg transition-colors text-sm"
              >
                🏫 HS Prospects
              </a>
              <a
                href="/spring-breakout"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors text-sm"
              >
                🌱 Spring Breakout
              </a>
              <a
                href="/pitchers"
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors text-sm"
              >
                View Pitchers
              </a>
              <a
                href="/similarity"
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors text-sm"
              >
                Custom Similarity Search
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

        {/* Daily Hitters Panel */}
        {showDailyPanel && <DailyHittersPanel />}

        {/* Season Hitters Panel */}
        {showSeasonPanel && <SeasonHittersPanel />}

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
              <label htmlFor="search-input" className="block text-sm font-medium text-gray-300 dark:text-gray-300 mb-2">
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
              <label htmlFor="team-filter" className="block text-sm font-medium text-gray-300 dark:text-gray-300 mb-2">
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
              <label htmlFor="sort-select" className="block text-sm font-medium text-gray-300 dark:text-gray-300 mb-2">
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
                {selectedDataset === 'a2025' && (
                  <>
                    <option value="ba">BA</option>
                    <option value="obp">OBP</option>
                    <option value="slg">SLG</option>
                  </>
                )}
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
              <h3 className="text-sm font-semibold text-gray-300 dark:text-gray-300 mb-3">Advanced Filters</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* Age Range */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 dark:text-gray-300 mb-2">
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
                  <label className="block text-sm font-medium text-gray-300 dark:text-gray-300 mb-2">
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
                  <label className="block text-sm font-medium text-gray-300 dark:text-gray-300 mb-2">
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

                {/* Pull Air % Min */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 dark:text-gray-300 mb-2">
                    Min Pull Air %
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 25"
                    value={pullAirMin}
                    onChange={(e) => setPullAirMin(e.target.value)}
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
                      setPullAirMin('');
                    }}
                    className="w-full px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-300 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm font-medium"
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
            <p className="text-gray-400 dark:text-gray-300 text-lg">No players found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAndSortedPlayers.map((player) => (
              <PlayerCard
                key={player.player_id || player.full_name}
                player={player}
                isSelected={player.player_id ? selectedPlayers.includes(player.player_id) : false}
                onSelect={handlePlayerSelection}
                selectionDisabled={!player.player_id || (selectedPlayers.length >= 2 && !selectedPlayers.includes(player.player_id))}
                isAAA={isAAA}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
