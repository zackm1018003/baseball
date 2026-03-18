'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { getAllPitchers, getPitcherTeams, searchPitchers } from '@/lib/pitcher-database';
import { useRouter } from 'next/navigation';
import { DATASETS, DEFAULT_DATASET_ID } from '@/lib/datasets';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import { getCountryFlagUrl } from '@/lib/country-flags';
import PitcherCard from '@/components/PitcherCard';
import Link from 'next/link';

// ─── Team Season types ─────────────────────────────────────────────────────────

interface TeamInfo {
  id: number;
  name: string;
  abbreviation: string;
  locationName: string;
  teamName: string;
  sportId: number;
}

interface SeasonGame {
  gamePk: number;
  date: string;
  homeTeam: string;
  homeTeamAbbr: string;
  homeTeamId: number;
  awayTeam: string;
  awayTeamAbbr: string;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
  status: string;
  sportId: number;
  isHome: boolean;
}

interface GamePitcherLine {
  ip: string;
  h: number;
  er: number;
  bb: number;
  k: number;
  hr: number;
  pitches: number;
  bf: number;
}

interface GamePitcher {
  playerId: number;
  name: string;
  team: string;
  opponent: string;
  isHome: boolean;
  line: GamePitcherLine | null;
  whiffs: number | null;
}

// ─── Team Season Panel ─────────────────────────────────────────────────────────

function TeamSeasonPanel() {
  const [sport, setSport] = useState<'mlb' | 'college'>('mlb');
  const [season, setSeason] = useState<string>('2025');
  const [allTeams, setAllTeams] = useState<{ mlb: TeamInfo[]; college: TeamInfo[] }>({ mlb: [], college: [] });
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<TeamInfo | null>(null);
  const [games, setGames] = useState<SeasonGame[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [expandedGame, setExpandedGame] = useState<number | null>(null);
  const [gamePitchers, setGamePitchers] = useState<Record<number, GamePitcher[]>>({});
  const [pitchersLoading, setPitchersLoading] = useState<number | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // Fetch teams list
  useEffect(() => {
    setTeamsLoading(true);
    fetch(`/api/teams?season=${season}`)
      .then(r => r.json())
      .then(data => setAllTeams({ mlb: data.mlb ?? [], college: data.college ?? [] }))
      .catch(() => {})
      .finally(() => setTeamsLoading(false));
  }, [season]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const teams = sport === 'mlb' ? allTeams.mlb : allTeams.college;

  const filteredTeams = useMemo(() => {
    const q = teamSearch.toLowerCase();
    if (!q) return teams.slice(0, 12);
    return teams.filter(t =>
      t.name.toLowerCase().includes(q) || t.abbreviation.toLowerCase().includes(q)
    ).slice(0, 12);
  }, [teams, teamSearch]);

  const handleTeamSelect = async (team: TeamInfo) => {
    setSelectedTeam(team);
    setTeamSearch(team.name);
    setShowDropdown(false);
    setGames([]);
    setExpandedGame(null);
    setGamePitchers({});
    setGamesLoading(true);
    try {
      const res = await fetch(`/api/team-season?teamId=${team.id}&season=${season}`);
      const data = await res.json();
      setGames(data.games ?? []);
    } catch { /* ignore */ }
    finally { setGamesLoading(false); }
  };

  const handleGameExpand = async (gamePk: number) => {
    if (expandedGame === gamePk) { setExpandedGame(null); return; }
    setExpandedGame(gamePk);
    if (gamePitchers[gamePk]) return;
    setPitchersLoading(gamePk);
    try {
      const res = await fetch(`/api/game-pitchers?gamePk=${gamePk}`);
      const data = await res.json();
      setGamePitchers(prev => ({ ...prev, [gamePk]: data.pitchers ?? [] }));
    } catch { /* ignore */ }
    finally { setPitchersLoading(null); }
  };

  const isFinal = (status: string) => {
    const s = status.toLowerCase();
    return s.includes('final') || s.includes('game over') || s.includes('completed');
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' });
  };

  const statColor = (stat: string, value: number): string => {
    const t: Record<string, { great: number; good: number; bad: number; lower: boolean }> = {
      er:  { great: 0, good: 1, bad: 3, lower: true },
      h:   { great: 2, good: 4, bad: 7, lower: true },
      bb:  { great: 0, good: 1, bad: 3, lower: true },
      hr:  { great: 0, good: 0, bad: 1, lower: true },
      k:   { great: 8, good: 5, bad: 2, lower: false },
    };
    const th = t[stat];
    if (!th) return '';
    if (th.lower) {
      if (value <= th.great) return 'text-green-400';
      if (value <= th.good)  return 'text-green-300';
      if (value <= th.bad)   return 'text-yellow-400';
      return 'text-red-400';
    } else {
      if (value >= th.great) return 'text-green-400';
      if (value >= th.good)  return 'text-green-300';
      if (value >= th.bad)   return 'text-yellow-400';
      return 'text-red-400';
    }
  };

  const ipColor = (ip: string): string => {
    const n = (parseInt(ip.split('.')[0]) || 0) + (parseInt(ip.split('.')[1]) || 0) / 3;
    if (n >= 7) return 'text-green-400';
    if (n >= 6) return 'text-green-300';
    if (n >= 5) return 'text-yellow-400';
    if (n >= 3) return 'text-orange-400';
    return 'text-red-400';
  };

  const completedGames = games.filter(g => isFinal(g.status));
  const wins = completedGames.filter(g => {
    const scored = g.isHome ? g.homeScore : g.awayScore;
    const allowed = g.isHome ? g.awayScore : g.homeScore;
    return scored > allowed;
  }).length;

  return (
    <div className="bg-[#1a1a2e] rounded-xl overflow-hidden mb-6 shadow-xl">
      {/* Header */}
      <div className="bg-[#16213e] border-b border-gray-700 px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h2 className="text-white font-bold text-base">🏟️ Team Season Games</h2>
            <p className="text-gray-500 text-xs mt-0.5">Select a team to see their full season with pitcher stats</p>
          </div>

          {/* Sport toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-600">
            <button
              onClick={() => { setSport('mlb'); setSelectedTeam(null); setTeamSearch(''); setGames([]); }}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${sport === 'mlb' ? 'bg-blue-600 text-white' : 'bg-[#0d1b2a] text-gray-400 hover:text-white'}`}
            >MLB</button>
            <button
              onClick={() => { setSport('college'); setSelectedTeam(null); setTeamSearch(''); setGames([]); }}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${sport === 'college' ? 'bg-green-600 text-white' : 'bg-[#0d1b2a] text-gray-400 hover:text-white'}`}
            >NCAA</button>
          </div>

          {/* Season selector */}
          <select
            value={season}
            onChange={e => { setSeason(e.target.value); setSelectedTeam(null); setTeamSearch(''); setGames([]); }}
            className="bg-[#0d1b2a] text-white border border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {['2026', '2025', '2024', '2023'].map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          {/* Team search */}
          <div className="relative flex-1 min-w-[220px]" ref={searchRef}>
            <input
              type="text"
              placeholder={teamsLoading ? 'Loading teams...' : `Search ${sport === 'mlb' ? 'MLB' : 'college'} teams...`}
              value={teamSearch}
              onChange={e => { setTeamSearch(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              className="w-full bg-[#0d1b2a] text-white border border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-600"
            />
            {showDropdown && filteredTeams.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-[#0d1b2a] border border-gray-600 rounded-lg overflow-hidden z-50 shadow-xl max-h-60 overflow-y-auto">
                {filteredTeams.map(team => (
                  <button
                    key={team.id}
                    onClick={() => handleTeamSelect(team)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-[#16213e] hover:text-white transition-colors flex items-center gap-2"
                  >
                    {sport === 'mlb' && getMLBTeamLogoUrl(team.abbreviation) && (
                      <img src={getMLBTeamLogoUrl(team.abbreviation)!} alt="" className="w-5 h-5 object-contain flex-shrink-0" />
                    )}
                    <span className="font-semibold">{team.name}</span>
                    {team.abbreviation && <span className="text-gray-600 text-xs">{team.abbreviation}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Record summary */}
          {selectedTeam && games.length > 0 && (
            <span className="ml-auto text-xs text-gray-500">
              {completedGames.length} games · {wins}–{completedGames.length - wins}
            </span>
          )}
        </div>
      </div>

      {/* Loading games */}
      {gamesLoading && (
        <div className="flex items-center justify-center py-12 text-gray-500 gap-3">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading {selectedTeam?.name} {season} schedule...</span>
        </div>
      )}

      {/* No team selected */}
      {!gamesLoading && !selectedTeam && (
        <div className="py-10 text-center text-gray-600 text-sm">
          Search for a team above to see their season games
        </div>
      )}

      {/* Games list */}
      {!gamesLoading && games.length > 0 && (
        <div className="divide-y divide-gray-800/60">
          {games.map(game => {
            const final = isFinal(game.status);
            const teamScore = game.isHome ? game.homeScore : game.awayScore;
            const oppScore = game.isHome ? game.awayScore : game.homeScore;
            const won = final && teamScore > oppScore;
            const lost = final && teamScore < oppScore;
            const opponent = game.isHome ? game.awayTeam : game.homeTeam;
            const oppAbbr = game.isHome ? game.awayTeamAbbr : game.homeTeamAbbr;
            const oppLogo = getMLBTeamLogoUrl(oppAbbr);
            const isExpanded = expandedGame === game.gamePk;
            const isLoadingPitchers = pitchersLoading === game.gamePk;

            return (
              <div key={game.gamePk}>
                <button
                  onClick={() => final ? handleGameExpand(game.gamePk) : undefined}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-sm transition-colors text-left ${
                    final
                      ? 'hover:bg-[#16213e]/60 cursor-pointer'
                      : 'cursor-default opacity-60'
                  } ${isExpanded ? 'bg-[#16213e]/80' : ''}`}
                >
                  {/* Date */}
                  <span className="text-gray-500 text-xs w-20 flex-shrink-0">{formatDate(game.date)}</span>

                  {/* Home/Away */}
                  <span className="text-gray-600 text-xs w-4 flex-shrink-0">{game.isHome ? 'vs' : '@'}</span>

                  {/* Opponent */}
                  <div className="flex items-center gap-1.5 w-48 flex-shrink-0">
                    {oppLogo && <img src={oppLogo} alt={oppAbbr} className="w-5 h-5 object-contain" />}
                    <span className="text-gray-200 font-semibold truncate">{opponent}</span>
                  </div>

                  {/* Score / Status */}
                  {final ? (
                    <div className="flex items-center gap-2">
                      <span className={`font-bold text-sm px-1.5 rounded text-xs ${won ? 'text-green-400' : lost ? 'text-red-400' : 'text-gray-400'}`}>
                        {won ? 'W' : lost ? 'L' : 'T'}
                      </span>
                      <span className="text-white font-mono font-semibold">{teamScore}–{oppScore}</span>
                    </div>
                  ) : (
                    <span className="text-yellow-500 text-xs font-semibold">{game.status}</span>
                  )}

                  {/* Expand hint */}
                  {final && (
                    <span className="ml-auto text-gray-600 text-xs">{isExpanded ? '▲ Hide pitchers' : '▼ See pitchers'}</span>
                  )}
                </button>

                {/* Expanded pitcher stats */}
                {isExpanded && (
                  <div className="bg-[#0d1b2a] border-t border-gray-800 px-5 py-3">
                    {isLoadingPitchers && (
                      <div className="flex items-center gap-2 py-4 text-gray-500 text-sm">
                        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                        Loading pitcher data...
                      </div>
                    )}
                    {!isLoadingPitchers && gamePitchers[game.gamePk] && (
                      gamePitchers[game.gamePk].length === 0 ? (
                        <p className="text-gray-600 text-sm py-2">No pitcher data available for this game.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-600 uppercase tracking-wider">
                              <th className="text-left pb-2 pr-4">Pitcher</th>
                              <th className="text-center pb-2 px-2">IP</th>
                              <th className="text-center pb-2 px-2">H</th>
                              <th className="text-center pb-2 px-2">ER</th>
                              <th className="text-center pb-2 px-2">BB</th>
                              <th className="text-center pb-2 px-2">K</th>
                              <th className="text-center pb-2 px-2">HR</th>
                              <th className="text-center pb-2 px-2">P</th>
                              <th className="text-center pb-2 px-2 text-blue-400">Whiffs</th>
                              <th className="text-center pb-2 px-2">Card</th>
                            </tr>
                          </thead>
                          <tbody>
                            {gamePitchers[game.gamePk].map((p, i) => {
                              const l = p.line;
                              const teamLogo = getMLBTeamLogoUrl(p.team);
                              const isStarter = l ? (parseInt(l.ip.split('.')[0]) || 0) + (parseInt(l.ip.split('.')[1]) || 0) / 3 >= 3 : false;
                              return (
                                <tr key={`${p.playerId}-${i}`} className="border-t border-gray-800/40">
                                  <td className="py-1.5 pr-4">
                                    <div className="flex items-center gap-1.5">
                                      {teamLogo && <img src={teamLogo} alt={p.team} className="w-4 h-4 object-contain" />}
                                      <Link
                                        href={`/pitcher/${p.playerId}`}
                                        className="text-white hover:text-blue-400 transition-colors font-semibold"
                                      >
                                        {p.name}
                                      </Link>
                                      <span className="text-gray-700">{p.team}</span>
                                      {isStarter && <span className="text-blue-500 text-[10px]">SP</span>}
                                    </div>
                                  </td>
                                  {l ? (
                                    <>
                                      <td className={`text-center px-2 font-bold ${ipColor(l.ip)}`}>{l.ip}</td>
                                      <td className={`text-center px-2 font-semibold ${statColor('h', l.h)}`}>{l.h}</td>
                                      <td className={`text-center px-2 font-semibold ${statColor('er', l.er)}`}>{l.er}</td>
                                      <td className={`text-center px-2 font-semibold ${statColor('bb', l.bb)}`}>{l.bb}</td>
                                      <td className={`text-center px-2 font-semibold ${statColor('k', l.k)}`}>{l.k}</td>
                                      <td className={`text-center px-2 font-semibold ${statColor('hr', l.hr)}`}>{l.hr}</td>
                                      <td className="text-center px-2 text-gray-500">{l.pitches || '—'}</td>
                                      <td className="text-center px-2 font-bold text-blue-300">
                                        {p.whiffs != null && p.whiffs > 0 ? p.whiffs : '—'}
                                      </td>
                                    </>
                                  ) : (
                                    <td colSpan={8} className="text-center text-gray-700 italic">Stats pending</td>
                                  )}
                                  <td className="text-center px-2">
                                    <Link
                                      href={`/pitcher/${p.playerId}`}
                                      className="inline-block px-2 py-0.5 bg-[#16213e] hover:bg-blue-900/40 border border-gray-700 hover:border-blue-500 text-gray-400 hover:text-white rounded text-[10px] transition-colors"
                                    >
                                      →
                                    </Link>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty schedule */}
      {!gamesLoading && selectedTeam && games.length === 0 && (
        <div className="py-10 text-center text-gray-600 text-sm">
          No games found for {selectedTeam.name} in {season}.
        </div>
      )}
    </div>
  );
}

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
  whiffs: number | null;
  velocity: number | null;
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Daily panel component ─────────────────────────────────────────────────────

function DailyPitchersPanel() {
  const [date, setDate] = useState<string>(today());
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGamePk, setSelectedGamePk] = useState<number | null>(null);
  const [showOnlyStarters, setShowOnlyStarters] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [sortCol, setSortCol] = useState<string>('whiffs');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const fetchDay = useCallback(async (d: string, silent = false) => {
    if (!silent) { setLoading(true); setError(null); setData(null); setSelectedGamePk(null); }
    try {
      const res = await fetch(`/api/daily-pitchers?date=${d}`);
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

  useEffect(() => { fetchDay(date); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 60 seconds when viewing today's date (handles pre-game → live transitions)
  useEffect(() => {
    if (date !== today()) return;
    const allFinal = (data?.games.length ?? 0) > 0 && data!.games.every(g => {
      const s = g.status.toLowerCase();
      return s.includes('final') || s.includes('postponed') || s.includes('cancelled') || s.includes('game over');
    });
    if (allFinal) return;
    const interval = setInterval(() => fetchDay(date, true), 60_000);
    return () => clearInterval(interval);
  }, [date, data, fetchDay]);

  const handleDateChange = (d: string) => {
    setDate(d);
    fetchDay(d);
  };

  const shiftDate = (days: number) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + days);
    handleDateChange(d.toISOString().slice(0, 10));
  };

  const handleGameClick = (gamePk: number) => {
    setSelectedGamePk(prev => prev === gamePk ? null : gamePk);
  };

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const displayed = useMemo(() => {
    if (!data) return [];
    let list = data.pitchers;
    if (selectedGamePk !== null) list = list.filter(p => p.gamePk === selectedGamePk);
    if (showOnlyStarters) list = list.filter(p => parseIp(p.line?.ip ?? '0') >= 3);

    const dir = sortDir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
      switch (sortCol) {
        case 'ip':       return dir * (parseIp(b.line?.ip ?? '0') - parseIp(a.line?.ip ?? '0'));
        case 'k':        return dir * ((b.line?.k ?? -1) - (a.line?.k ?? -1));
        case 'er':       return dir * ((b.line?.er ?? -1) - (a.line?.er ?? -1));
        case 'bb':       return dir * ((b.line?.bb ?? -1) - (a.line?.bb ?? -1));
        case 'hr':       return dir * ((b.line?.hr ?? -1) - (a.line?.hr ?? -1));
        case 'h':        return dir * ((b.line?.h ?? -1) - (a.line?.h ?? -1));
        case 'pitches':  return dir * ((b.line?.pitches ?? -1) - (a.line?.pitches ?? -1));
        case 'whiffs':   return dir * ((b.whiffs ?? -1) - (a.whiffs ?? -1));
        case 'velocity': return dir * ((b.velocity ?? -1) - (a.velocity ?? -1));
        default:         return 0;
      }
    });
  }, [data, selectedGamePk, showOnlyStarters, sortCol, sortDir]);

  return (
    <div className="bg-[#1a1a2e] rounded-xl overflow-hidden mb-6 shadow-xl">
      {/* Panel header */}
      <div className="bg-[#16213e] border-b border-gray-700 px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-white font-bold text-base">📅 Daily Pitchers</h2>
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
              Click a game to filter pitchers
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

      {/* Games scoreboard strip — separated by league */}
      {data && data.games.length > 0 && (() => {
        const mlbGames = data.games.filter(g => g.sportId === 1);
        const wbcGames = data.games.filter(g => g.sportId === 51);
        const collegeGames = data.games.filter(g => g.sportId !== 1 && g.sportId !== 51);
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
                <span className="text-gray-600 font-mono">vs</span>
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
            {/* Divider */}
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
            {/* Divider */}
            {(mlbGames.length > 0 || wbcGames.length > 0) && collegeGames.length > 0 && (
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
          {data.games.length > 0
            ? `${data.games.length} game${data.games.length !== 1 ? 's' : ''} scheduled — pitcher data will appear once games begin.`
            : `No games found for ${date}. Try a different date.`}
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
                {(['ip','h','er','bb','k','hr'] as const).map(col => (
                  <th key={col} onClick={() => handleSort(col)}
                    className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-white ${sortCol === col ? 'text-white' : 'text-gray-500'}`}>
                    {col.toUpperCase()}{sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
                <th onClick={() => handleSort('pitches')}
                  className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-white ${sortCol === 'pitches' ? 'text-white' : 'text-gray-500'}`}>
                  P{sortCol === 'pitches' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
                <th onClick={() => handleSort('velocity')}
                  className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-white ${sortCol === 'velocity' ? 'text-orange-400' : 'text-orange-500/70'}`}>
                  Top Velo{sortCol === 'velocity' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
                <th onClick={() => handleSort('whiffs')}
                  className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-white ${sortCol === 'whiffs' ? 'text-blue-300' : 'text-blue-400/70'}`}>
                  Whiffs{sortCol === 'whiffs' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Daily Card</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((p, idx) => {
                const line = p.line;
                const teamLogo = getMLBTeamLogoUrl(p.team);
                const oppLogo = getMLBTeamLogoUrl(p.opponent);
                const countryFlag = getCountryFlagUrl(p.team, 40);
                const isStarter = parseIp(line?.ip ?? '0') >= 3;
                return (
                  <tr
                    key={`${p.playerId}-${idx}`}
                    className="border-b border-gray-800/60 hover:bg-[#16213e]/60 transition-colors"
                  >
                    {/* Name + team */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {countryFlag
                          ? <img src={countryFlag} alt={p.team} className="w-7 h-[18px] object-cover flex-shrink-0 rounded-sm" />
                          : teamLogo && <img src={teamLogo} alt={p.team} className="w-5 h-5 object-contain flex-shrink-0" />
                        }
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
                        <td className={`px-3 py-2.5 text-center font-bold text-xs ${
                          p.velocity == null ? 'text-gray-600' :
                          p.velocity >= 96 ? 'text-green-400' :
                          p.velocity >= 93 ? 'text-green-300' :
                          p.velocity >= 90 ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {p.velocity != null ? p.velocity.toFixed(1) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold text-blue-300">
                          {p.whiffs != null && p.whiffs > 0 ? p.whiffs : '—'}
                        </td>
                      </>
                    ) : (
                      <td colSpan={9} className="px-3 py-2.5 text-center text-gray-700 text-xs italic">
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
  const [showSeasonPanel, setShowSeasonPanel] = useState(false);
  const [showSpringSearch, setShowSpringSearch] = useState(false);
  const [springQuery, setSpringQuery] = useState('');
  const router = useRouter();

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

  const springSearchResults = useMemo(() => {
    if (!springQuery.trim()) return [];
    return searchPitchers(springQuery, selectedDataset).slice(0, 8);
  }, [springQuery, selectedDataset]);

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
              <button
                onClick={() => setShowSeasonPanel(v => !v)}
                className={`px-4 py-2 font-medium rounded-lg transition-colors text-sm border ${
                  showSeasonPanel
                    ? 'bg-green-700 border-green-500 text-white hover:bg-green-800'
                    : 'bg-gray-900 border-gray-600 text-gray-300 hover:bg-gray-800 hover:border-green-500 hover:text-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200'
                }`}
              >
                🏟️ Team Season
              </button>
              <button
                onClick={() => { setShowSpringSearch(v => !v); setSpringQuery(''); }}
                className={`px-4 py-2 font-medium rounded-lg transition-colors text-sm border ${
                  showSpringSearch
                    ? 'bg-green-600 border-green-400 text-white hover:bg-green-700'
                    : 'bg-gray-900 border-gray-600 text-gray-300 hover:bg-gray-800 hover:border-green-400 hover:text-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200'
                }`}
              >
                🌱 Spring Training
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

      {/* Spring Training Search Panel */}
      {showSpringSearch && (
        <div className="bg-[#0d1421] border-b border-green-800/40">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center gap-4">
              <span className="text-green-400 text-sm font-semibold whitespace-nowrap">🌱 Spring Training — Search Pitcher:</span>
              <div className="relative flex-1 max-w-sm">
                <input
                  type="text"
                  placeholder="Type a pitcher name..."
                  value={springQuery}
                  onChange={e => setSpringQuery(e.target.value)}
                  autoFocus
                  className="w-full bg-[#16213e] border border-green-700/60 focus:border-green-400 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder-gray-500 transition-colors"
                />
                {springSearchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-[#0d1421] border border-gray-600 rounded-lg shadow-2xl z-50 overflow-hidden">
                    {springSearchResults.map(p => (
                      <button
                        key={p.player_id}
                        onClick={() => {
                          router.push(`/pitcher/${p.player_id}/spring-summary`);
                          setShowSpringSearch(false);
                          setSpringQuery('');
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-[#1a2940] transition-colors text-left"
                      >
                        {p.player_id && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_60,q_auto:best/v1/people/${p.player_id}/headshot/silo/current`}
                            alt={p.full_name}
                            className="w-8 h-8 rounded-full object-cover flex-shrink-0 bg-gray-700"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-white truncate">{p.full_name}</div>
                          <div className="text-[10px] text-gray-400">{p.team} · {p.throws}HP</div>
                        </div>
                        <span className="text-[10px] text-green-500 font-semibold whitespace-nowrap">Spring Summary →</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="container mx-auto px-4 py-6">

        {/* Daily Pitchers Panel */}
        {showDailyPanel && <DailyPitchersPanel />}

        {/* Team Season Panel */}
        {showSeasonPanel && <TeamSeasonPanel />}

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
