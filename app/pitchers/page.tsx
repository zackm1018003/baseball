'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { getAllPitchers, getPitcherTeams, searchPitchers, searchAllPitchers } from '@/lib/pitcher-database';
import { useRouter } from 'next/navigation';
import { DATASETS, DEFAULT_DATASET_ID } from '@/lib/datasets';
import { getMLBTeamLogoUrl, getMLBTeamAbbrFromLogoId } from '@/lib/mlb-team-logos';
import { getCountryFlagUrl } from '@/lib/country-flags';
import PitcherCard from '@/components/PitcherCard';
import { INTL_PROSPECTS } from '@/lib/trackman';
import { detectFormat, listPitchersFromCsv, UPLOAD_LIST_KEY, uploadCsvKey, type UploadEntry } from '@/lib/intl-upload';
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
    <div className="bg-panel overflow-hidden mb-6">
      {/* Header */}
      <div className="bg-panel border-b border-ink/20 px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h2 className="text-ink font-bold text-base">🏟️ Team Season Games</h2>
            <p className="text-ink-4 text-xs mt-0.5">Select a team to see their full season with pitcher stats</p>
          </div>

          {/* Sport toggle */}
          <div className="flex overflow-hidden border border-ink/30">
            <button
              onClick={() => { setSport('mlb'); setSelectedTeam(null); setTeamSearch(''); setGames([]); }}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${sport === 'mlb' ? 'bg-deep text-deep-fg' : 'bg-bone text-ink-3 hover:text-ink'}`}
            >MLB</button>
            <button
              onClick={() => { setSport('college'); setSelectedTeam(null); setTeamSearch(''); setGames([]); }}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${sport === 'college' ? 'bg-green-600 text-ink' : 'bg-bone text-ink-3 hover:text-ink'}`}
            >NCAA</button>
          </div>

          {/* Season selector */}
          <select
            value={season}
            onChange={e => { setSeason(e.target.value); setSelectedTeam(null); setTeamSearch(''); setGames([]); }}
            className="bg-bone text-ink border border-ink/30 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/40"
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
              className="w-full bg-bone text-ink border border-ink/30 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/40 placeholder-gray-600"
            />
            {showDropdown && filteredTeams.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-bone border border-ink/30 overflow-hidden z-50 max-h-60 overflow-y-auto">
                {filteredTeams.map(team => (
                  <button
                    key={team.id}
                    onClick={() => handleTeamSelect(team)}
                    className="w-full text-left px-3 py-2 text-sm text-ink-2 hover:bg-panel hover:text-ink transition-colors flex items-center gap-2"
                  >
                    {sport === 'mlb' && getMLBTeamLogoUrl(team.abbreviation) && (
                      <img src={getMLBTeamLogoUrl(team.abbreviation)!} alt="" className="w-5 h-5 object-contain flex-shrink-0" />
                    )}
                    <span className="font-semibold">{team.name}</span>
                    {team.abbreviation && <span className="text-ink-3 text-xs">{team.abbreviation}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Record summary */}
          {selectedTeam && games.length > 0 && (
            <span className="ml-auto text-xs text-ink-4">
              {completedGames.length} games · {wins}–{completedGames.length - wins}
            </span>
          )}
        </div>
      </div>

      {/* Loading games */}
      {gamesLoading && (
        <div className="flex items-center justify-center py-12 text-ink-4 gap-3">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent animate-spin" />
          <span className="text-sm">Loading {selectedTeam?.name} {season} schedule...</span>
        </div>
      )}

      {/* No team selected */}
      {!gamesLoading && !selectedTeam && (
        <div className="py-10 text-center text-ink-3 text-sm">
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
                      ? 'hover:bg-panel/60 cursor-pointer'
                      : 'cursor-default opacity-60'
                  } ${isExpanded ? 'bg-panel/80' : ''}`}
                >
                  {/* Date */}
                  <span className="text-ink-4 text-xs w-20 flex-shrink-0">{formatDate(game.date)}</span>

                  {/* Home/Away */}
                  <span className="text-ink-3 text-xs w-4 flex-shrink-0">{game.isHome ? 'vs' : '@'}</span>

                  {/* Opponent */}
                  <div className="flex items-center gap-1.5 w-48 flex-shrink-0">
                    {oppLogo && <img src={oppLogo} alt={oppAbbr} className="w-5 h-5 object-contain" />}
                    <span className="text-ink-2 font-semibold truncate">{opponent}</span>
                  </div>

                  {/* Score / Status */}
                  {final ? (
                    <div className="flex items-center gap-2">
                      <span className={`font-bold text-sm px-1.5 rounded text-xs ${won ? 'text-green-400' : lost ? 'text-red-400' : 'text-ink-3'}`}>
                        {won ? 'W' : lost ? 'L' : 'T'}
                      </span>
                      <span className="text-ink font-mono font-semibold">{teamScore}–{oppScore}</span>
                    </div>
                  ) : (
                    <span className="text-yellow-500 text-xs font-semibold">{game.status}</span>
                  )}

                  {/* Expand hint */}
                  {final && (
                    <span className="ml-auto text-ink-3 text-xs">{isExpanded ? '▲ Hide pitchers' : '▼ See pitchers'}</span>
                  )}
                </button>

                {/* Expanded pitcher stats */}
                {isExpanded && (
                  <div className="bg-bone border-t border-ink/10 px-5 py-3">
                    {isLoadingPitchers && (
                      <div className="flex items-center gap-2 py-4 text-ink-4 text-sm">
                        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent animate-spin" />
                        Loading pitcher data...
                      </div>
                    )}
                    {!isLoadingPitchers && gamePitchers[game.gamePk] && (
                      gamePitchers[game.gamePk].length === 0 ? (
                        <p className="text-ink-3 text-sm py-2">No pitcher data available for this game.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-ink-3 uppercase tracking-wider">
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
                                <tr key={`${p.playerId}-${i}`} className="border-t border-ink/10/40">
                                  <td className="py-1.5 pr-4">
                                    <div className="flex items-center gap-1.5">
                                      {teamLogo && <img src={teamLogo} alt={p.team} className="w-4 h-4 object-contain" />}
                                      <Link
                                        href={`/pitcher/${p.playerId}`}
                                        className="text-ink hover:text-blue-400 transition-colors font-semibold"
                                      >
                                        {p.name}
                                      </Link>
                                      <span className="text-ink-2">{p.team}</span>
                                      {isStarter && <span className="text-ink-2 text-[10px]">SP</span>}
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
                                      <td className="text-center px-2 text-ink-4">{l.pitches || '—'}</td>
                                      <td className="text-center px-2 font-bold text-blue-300">
                                        {p.whiffs != null && p.whiffs > 0 ? p.whiffs : '—'}
                                      </td>
                                    </>
                                  ) : (
                                    <td colSpan={8} className="text-center text-ink-2 italic">Stats pending</td>
                                  )}
                                  <td className="text-center px-2">
                                    <Link
                                      href={`/pitcher/${p.playerId}`}
                                      className="inline-block px-2 py-0.5 bg-panel hover:bg-bone border border-ink/20 hover:border-ink text-ink-3 hover:text-ink rounded text-[10px] transition-colors"
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
        <div className="py-10 text-center text-ink-3 text-sm">
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
  strikes: number;
}

interface DailyPitcher {
  playerId: number;
  name: string;
  team: string;
  opponent: string;
  isHome: boolean;
  gamePk: number;
  age: number | null;
  line: DailyPitcherLine | null;
  whiffs: number | null;
  whiffPct: number | null;
  strikePct: number | null;
  velocity: number | null;
  signingBonus: number | null;
}

interface DailyGame {
  gamePk: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  sportId: number;
  homeParentOrgId?: number | null;
  awayParentOrgId?: number | null;
}

interface DailyData {
  date: string;
  games: DailyGame[];
  pitchers: DailyPitcher[];
}

interface PitcherLogOuting {
  date: string;
  opponent: string;
  team: string | null;
  ip: string;
  h: number;
  er: number;
  bb: number;
  k: number;
  hr: number;
  pitches: number;
  bf: number;
  level: string;
  season: number;
  isHome?: boolean | null;
}

interface PitcherPerson {
  id: number;
  fullName: string;
  team: string | null;
  teamAbbr: string | null;
  position: string | null;
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

function fmtBonus(v: number | null): string {
  if (v == null) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
}

// ─── Daily panel component ─────────────────────────────────────────────────────

function DailyPitchersPanel() {
  const router = useRouter();
  const [date, setDate] = useState<string>(today());
  const [league, setLeague] = useState<'mlb' | 'aaa' | 'double-a' | 'high-a' | 'low-a' | 'cbb' | 'fcl' | 'dsl' | 'intl'>('mlb');
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGamePk, setSelectedGamePk] = useState<number | null>(null);
  const [showOnlyStarters, setShowOnlyStarters] = useState(false);
  const [minStrPct, setMinStrPct] = useState<string>('');

  // Uploaded international CSVs (client-side, persisted in localStorage)
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  useEffect(() => {
    try { const raw = localStorage.getItem(UPLOAD_LIST_KEY); if (raw) setUploads(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  const pitcherNameFromFile = (filename: string): string => {
    const base = filename.replace(/\.csv$/i, '');
    const m = base.match(/^([A-Za-z]+_[A-Za-z-]+)_pitch_data/i);
    if (m) return m[1].replace(/_/g, ' ');
    const tokens = base.split(/[_\s]+/).filter(t => /^[A-Za-z]/.test(t) && t.length > 1);
    if (tokens.length >= 2) return `${tokens[0]} ${tokens[1]}`;
    return base.replace(/_/g, ' ');
  };

  const handleCsvUpload = (file: File) => {
    setUploadError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const csv = String(reader.result || '');
        const fmt = detectFormat(csv);
        if (!fmt) { setUploadError('Unrecognized CSV format. Expected a TrackMan, movement (release_speed_mph), or showcase (velo_mph/ivb_in) feed.'); return; }
        const raw = listPitchersFromCsv(csv, fmt).filter(p => p.count >= 3);
        if (!raw.length) { setUploadError('No pitchers with enough pitches found in that CSV.'); return; }
        // For no-pitcher-column showcase files, derive the display name from the filename.
        const pitchers = (fmt === 'showcase' && raw.length === 1 && raw[0].name === '__showcase__')
          ? [{ name: pitcherNameFromFile(file.name), count: raw[0].count }]
          : raw;
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        localStorage.setItem(uploadCsvKey(id), csv);
        const entry: UploadEntry = { id, label: file.name.replace(/\.csv$/i, ''), fmt, pitchers };
        const next = [entry, ...uploads];
        setUploads(next);
        localStorage.setItem(UPLOAD_LIST_KEY, JSON.stringify(next));
      } catch { setUploadError('Could not read that file.'); }
    };
    reader.readAsText(file);
  };
  const removeUpload = (id: string) => {
    const next = uploads.filter(u => u.id !== id);
    setUploads(next);
    localStorage.setItem(UPLOAD_LIST_KEY, JSON.stringify(next));
    try { localStorage.removeItem(uploadCsvKey(id)); } catch { /* ignore */ }
  };
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [sortCol, setSortCol] = useState<string>('whiffs');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Pitcher lookup search
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchPeople, setSearchPeople] = useState<PitcherPerson[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedPitcherId, setSelectedPitcherId] = useState<number | null>(null);
  const [selectedPitcherName, setSelectedPitcherName] = useState<string | null>(null);
  const [pitcherLog, setPitcherLog] = useState<PitcherLogOuting[] | null>(null);
  const [pitcherLogLoading, setPitcherLogLoading] = useState(false);
  const [pitcherLogSeason, setPitcherLogSeason] = useState<string>('all');

  const fetchDay = useCallback(async (d: string, lg: string, silent = false) => {
    if (!silent) { setLoading(true); setError(null); setData(null); setSelectedGamePk(null); }
    try {
      const res = await fetch(`/api/daily-pitchers?date=${d}&league=${lg}`);
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

  const handleLeagueChange = (lg: 'mlb' | 'aaa' | 'double-a' | 'high-a' | 'low-a' | 'cbb' | 'fcl' | 'dsl' | 'intl') => {
    setLeague(lg);
    // International prospects are static CSV-backed cards — no daily API fetch.
    if (lg !== 'intl') fetchDay(date, lg);
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

  const handleNameSearch = useCallback(async (query: string, season: string) => {
    if (!query.trim()) return;
    setSearchLoading(true);
    setSearchPeople([]);
    setSelectedPitcherId(null);
    setSelectedPitcherName(null);
    setPitcherLog(null);
    try {
      const res = await fetch(`/api/pitcher-game-log?name=${encodeURIComponent(query)}&season=${season}`);
      const json = await res.json();
      const people: PitcherPerson[] = json.people ?? [];
      setSearchPeople(people);
      if (people.length === 1) {
        // Auto-load if only one match
        handleSelectPitcher(people[0].id, people[0].fullName, season);
      }
    } catch { /* ignore */ } finally {
      setSearchLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectPitcher = useCallback(async (playerId: number, name: string, season: string) => {
    setSelectedPitcherId(playerId);
    setSelectedPitcherName(name);
    setPitcherLogLoading(true);
    setPitcherLog(null);
    try {
      const res = await fetch(`/api/pitcher-game-log?playerId=${playerId}&season=${season}`);
      const json = await res.json();
      setPitcherLog(json.outings ?? []);
      if (json.playerName) setSelectedPitcherName(json.playerName);
    } catch { /* ignore */ } finally {
      setPitcherLogLoading(false);
    }
  }, []);

  const displayed = useMemo(() => {
    if (!data) return [];
    let list = data.pitchers;
    if (selectedGamePk !== null) list = list.filter(p => p.gamePk === selectedGamePk);
    if (showOnlyStarters) list = list.filter(p => parseIp(p.line?.ip ?? '0') >= 3);
    const strPctNum = parseFloat(minStrPct);
    if (!isNaN(strPctNum) && strPctNum > 0) list = list.filter(p => (p.strikePct ?? 0) >= strPctNum);

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
        case 'whiffs':    return dir * ((b.whiffs ?? -1) - (a.whiffs ?? -1));
        case 'whiffPct':  return dir * ((b.whiffPct ?? -1) - (a.whiffPct ?? -1));
        case 'strikePct': return dir * ((b.strikePct ?? -1) - (a.strikePct ?? -1));
        case 'velocity':  return dir * ((b.velocity ?? -1) - (a.velocity ?? -1));
        case 'bonus':     return dir * ((b.signingBonus ?? -1) - (a.signingBonus ?? -1));
        default:         return 0;
      }
    });
  }, [data, selectedGamePk, showOnlyStarters, minStrPct, sortCol, sortDir]);

  return (
    <div className="bg-panel overflow-hidden mb-6">
      {/* Panel header */}
      <div className="bg-panel border-b border-ink/20 px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-ink font-bold text-base">📅 Daily Pitchers</h2>
              {data?.games.some(g => {
                const s = g.status.toLowerCase();
                return !s.includes('final') && !s.includes('postponed') && !s.includes('cancelled') && !s.includes('scheduled');
              }) && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 bg-red-600/20 border border-red-500/40 rounded text-[10px] text-red-400 font-bold uppercase tracking-wide">
                  <span className="w-1.5 h-1.5 bg-red-500 animate-pulse inline-block" />
                  Live
                </span>
              )}
            </div>
            <p className="text-ink-4 text-xs mt-0.5">
              {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ` : ''}
              Click a game to filter pitchers
            </p>
          </div>

          {/* Date input with prev/next arrows */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => shiftDate(-1)}
              className="px-2 py-1.5 bg-bone hover:bg-bone border border-ink/30 hover:border-ink text-ink-2 hover:text-ink text-sm transition-colors"
              title="Previous day"
            >←</button>
            <input
              type="date"
              value={date}
              onChange={e => handleDateChange(e.target.value)}
              className="bg-bone text-ink border border-ink/30 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/40"
            />
            <button
              onClick={() => shiftDate(1)}
              className="px-2 py-1.5 bg-bone hover:bg-bone border border-ink/30 hover:border-ink text-ink-2 hover:text-ink text-sm transition-colors"
              title="Next day"
            >→</button>
          </div>

          {/* League tabs */}
          <div className="flex overflow-hidden border border-ink/20">
            <button
              onClick={() => handleLeagueChange('mlb')}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${league === 'mlb' ? 'bg-deep text-deep-fg' : 'bg-bone text-ink-3 hover:text-ink'}`}
            >MLB</button>
            <button
              onClick={() => handleLeagueChange('aaa')}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${league === 'aaa' ? 'bg-accent text-ink' : 'bg-bone text-ink-3 hover:text-ink'}`}
            >AAA</button>
            <button
              onClick={() => handleLeagueChange('double-a')}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${league === 'double-a' ? 'bg-violet-600 text-white' : 'bg-bone text-ink-3 hover:text-ink'}`}
            >AA</button>
            <button
              onClick={() => handleLeagueChange('high-a')}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${league === 'high-a' ? 'bg-teal-600 text-white' : 'bg-bone text-ink-3 hover:text-ink'}`}
            >High-A</button>
            <button
              onClick={() => handleLeagueChange('low-a')}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${league === 'low-a' ? 'bg-green-600 text-ink' : 'bg-bone text-ink-3 hover:text-ink'}`}
            >Low-A</button>
            <button
              onClick={() => handleLeagueChange('cbb')}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${league === 'cbb' ? 'bg-sky-700 text-ink' : 'bg-bone text-ink-3 hover:text-ink'}`}
            >🎓 CBB</button>
            <button
              onClick={() => handleLeagueChange('fcl')}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${league === 'fcl' ? 'bg-orange-600 text-white' : 'bg-bone text-ink-3 hover:text-ink'}`}
            >FCL/ACL</button>
            <button
              onClick={() => handleLeagueChange('dsl')}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${league === 'dsl' ? 'bg-emerald-600 text-white' : 'bg-bone text-ink-3 hover:text-ink'}`}
            >🌴 DSL</button>
            <button
              onClick={() => handleLeagueChange('intl')}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${league === 'intl' ? 'bg-indigo-600 text-white' : 'bg-bone text-ink-3 hover:text-ink'}`}
            >🌐 Int&apos;l Prospects</button>
          </div>

          {/* Starters only toggle */}
          <label className="flex items-center gap-2 text-sm text-ink-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOnlyStarters}
              onChange={e => setShowOnlyStarters(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            Starters only (3+ IP)
          </label>

          {/* Min STR% filter */}
          <label className="flex items-center gap-1.5 text-sm text-ink-3 select-none">
            <span>Min STR%</span>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              placeholder="—"
              value={minStrPct}
              onChange={e => setMinStrPct(e.target.value)}
              className="w-14 bg-bone text-ink border border-ink/30 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ink/40 text-center"
            />
          </label>

          {data && !searchMode && (
            <span className="ml-auto text-xs text-ink-3">
              {displayed.length} pitcher{displayed.length !== 1 ? 's' : ''} · {data.games.length} game{data.games.length !== 1 ? 's' : ''}
            </span>
          )}

          {/* Pitcher lookup toggle */}
          <button
            onClick={() => {
              setSearchMode(m => !m);
              setSearchQuery('');
              setSearchPeople([]);
              setSelectedPitcherId(null);
              setSelectedPitcherName(null);
              setPitcherLog(null);
            }}
            className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border transition-colors ${
              searchMode
                ? 'bg-sky-700 border-sky-500 text-white'
                : 'bg-bone border-ink/30 text-ink-3 hover:text-ink hover:border-ink'
            }`}
          >
            🔍 Pitcher Lookup
          </button>
        </div>

        {/* Search row */}
        {searchMode && (
          <div className="border-t border-ink/20 px-5 py-3 flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search pitcher name…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleNameSearch(searchQuery, pitcherLogSeason); }}
              className="bg-bone text-ink border border-ink/30 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 w-56"
              autoFocus
            />
            <select
              value={pitcherLogSeason}
              onChange={e => setPitcherLogSeason(e.target.value)}
              className="bg-bone text-ink border border-ink/30 px-2 py-1.5 text-sm focus:outline-none"
            >
              <option value="all">All seasons</option>
              {[2026, 2025, 2024, 2023, 2022].map(y => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
            <button
              onClick={() => handleNameSearch(searchQuery, pitcherLogSeason)}
              disabled={searchLoading || !searchQuery.trim()}
              className="px-3 py-1.5 bg-sky-700 text-white text-xs font-bold hover:bg-sky-600 disabled:opacity-40 transition-colors"
            >
              {searchLoading ? 'Searching…' : 'Search'}
            </button>
            {selectedPitcherName && (
              <span className="text-xs text-ink-3">
                Showing: <span className="text-ink font-semibold">{selectedPitcherName}</span>
                {pitcherLog && <span className="ml-1">· {pitcherLog.length} appearance{pitcherLog.length !== 1 ? 's' : ''}</span>}
              </span>
            )}
          </div>
        )}
      </div>

      {/* International prospects — static CSV-backed (TrackMan) pitcher cards */}
      {league === 'intl' && (
        <div className="px-4 py-6">
          {/* Upload a CSV → build cards */}
          <div className="border border-dashed border-ink/30 bg-bone p-4 mb-6" style={{ maxWidth: 760 }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="text-sm font-bold text-ink">Build cards from a CSV</div>
                <div className="text-xs text-ink-3 mt-0.5">Upload a TrackMan, movement (release_speed_mph), or showcase (velo_mph/ivb_in) pitch feed — cards are built automatically and saved in this browser.</div>
              </div>
              <label className="px-3 py-1.5 text-xs font-bold bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700 transition-colors flex-shrink-0">
                Upload CSV
                <input type="file" accept=".csv,text/csv" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvUpload(f); e.currentTarget.value = ''; }} />
              </label>
            </div>
            {uploadError && <div className="text-xs text-red-400 mt-2">{uploadError}</div>}
          </div>

          {/* Uploaded files */}
          {uploads.map(u => (
            <div key={u.id} className="mb-6" style={{ maxWidth: 760 }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-ink uppercase tracking-wide">
                  {u.label} <span className="text-ink-3 font-normal normal-case">· {u.fmt === 'movement' ? 'movement feed' : u.fmt === 'showcase' ? 'showcase feed' : 'TrackMan'} · {u.pitchers.length} pitcher{u.pitchers.length !== 1 ? 's' : ''}</span>
                </span>
                <button onClick={() => removeUpload(u.id)} className="text-[10px] text-red-400 hover:text-red-300">✕ Remove</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {u.pitchers.map(p => (
                  <Link
                    key={p.name}
                    href={`/pitcher/intl/daily?upload=${u.id}&pitcher=${encodeURIComponent(p.name)}`}
                    className="block bg-bone border border-ink/20 hover:border-ink hover:bg-panel p-3 transition-colors"
                  >
                    <div className="font-bold text-ink text-sm">{p.name.includes(',') ? p.name.replace(/^([^,]+),\s*(.+)$/, '$2 $1') : p.name}</div>
                    <div className="text-xs text-ink-3 mt-0.5">{p.count} pitches · uploaded</div>
                  </Link>
                ))}
              </div>
            </div>
          ))}

          {/* Committed prospects */}
          <p className="text-xs text-ink-3 mb-2 uppercase tracking-wide font-bold">Saved prospects</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" style={{ maxWidth: 760 }}>
            {INTL_PROSPECTS.map(p => (
              <Link
                key={p.slug}
                href={`/pitcher/intl/daily?intl=${p.slug}`}
                className="block bg-bone border border-ink/20 hover:border-ink hover:bg-panel p-4 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-ink text-sm">{p.name}</span>
                  <span className="text-[10px] font-semibold text-indigo-400">{p.throws}HP</span>
                </div>
                <div className="text-xs text-ink-3 mt-1">{p.team} · International</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Pitcher lookup results panel */}
      {searchMode && (
        <div className="border-b border-ink/20">
          {/* People picker — shown when multiple results */}
          {searchPeople.length > 1 && !selectedPitcherId && (
            <div className="px-5 py-3">
              <p className="text-xs text-ink-3 mb-2">{searchPeople.length} results — select a pitcher:</p>
              <div className="flex flex-wrap gap-2">
                {searchPeople.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectPitcher(p.id, p.fullName, pitcherLogSeason)}
                    className="px-3 py-1.5 text-xs bg-bone border border-ink/30 hover:border-sky-500 hover:text-sky-400 transition-colors text-ink"
                  >
                    <span className="font-semibold">{p.fullName}</span>
                    {(p.position || p.team) && (
                      <span className="text-ink-3 ml-1">· {[p.position, p.team].filter(Boolean).join(' — ')}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* No results */}
          {!searchLoading && searchPeople.length === 0 && searchQuery && !pitcherLogLoading && !pitcherLog && (
            <div className="px-5 py-6 text-sm text-ink-3">No pitchers found matching &quot;{searchQuery}&quot;.</div>
          )}

          {/* Log loading */}
          {pitcherLogLoading && (
            <div className="flex items-center gap-3 px-5 py-8 text-ink-4">
              <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent animate-spin" />
              <span className="text-sm">Loading game log…</span>
            </div>
          )}

          {/* Game log table */}
          {!pitcherLogLoading && pitcherLog && (
            <div className="overflow-x-auto">
              {pitcherLog.length === 0 ? (
                <div className="px-5 py-8 text-sm text-ink-3">
                  No appearances found for {pitcherLogSeason}. Try a different season.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink/20 bg-bone">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider">Pitcher</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider">Date</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider">Opp</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">Season</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">Level</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">IP</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">H</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">ER</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">BB</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">K</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">HR</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">P</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pitcherLog.map((o, i) => {
                      const ipNum = parseIp(o.ip);
                      return (
                        <tr
                          key={i}
                          onClick={() => router.push(`/pitcher/${selectedPitcherId}/daily?date=${o.date}`)}
                          className="border-b border-ink/10 hover:bg-sky-900/20 transition-colors cursor-pointer"
                          title={`Open ${selectedPitcherName} — ${o.date}`}
                        >
                          <td className="px-4 py-2 text-xs font-semibold text-sky-300">{selectedPitcherName}</td>
                          <td className="px-4 py-2 text-xs text-ink-2 font-mono">{o.date}</td>
                          <td className="px-3 py-2 text-xs">
                            <span className="text-ink-3 mr-1">{o.isHome ? 'vs' : '@'}</span>
                            <span className="font-semibold text-ink">{o.opponent}</span>
                          </td>
                          <td className="px-3 py-2 text-center text-xs text-ink-3 font-mono">{o.season}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 ${
                              o.level === 'MLB'    ? 'bg-blue-900/40 text-blue-300' :
                              o.level === 'AAA'    ? 'bg-purple-900/40 text-purple-300' :
                              o.level === 'AA'     ? 'bg-violet-900/40 text-violet-300' :
                              o.level === 'High-A' ? 'bg-teal-900/40 text-teal-300' :
                              o.level === 'Low-A'  ? 'bg-green-900/40 text-green-300' :
                              o.level === 'CBB'    ? 'bg-sky-900/40 text-sky-300' :
                              'bg-ink/10 text-ink-3'
                            }`}>{o.level}</span>
                          </td>
                          <td className={`px-3 py-2 text-center text-xs font-mono font-semibold ${ipColor(o.ip)}`}>{o.ip}</td>
                          <td className={`px-3 py-2 text-center text-xs font-mono ${ipNum >= 1 ? statColor('h', o.h) : ''}`}>{o.h}</td>
                          <td className={`px-3 py-2 text-center text-xs font-mono ${ipNum >= 1 ? statColor('er', o.er) : ''}`}>{o.er}</td>
                          <td className={`px-3 py-2 text-center text-xs font-mono ${ipNum >= 1 ? statColor('bb', o.bb) : ''}`}>{o.bb}</td>
                          <td className={`px-3 py-2 text-center text-xs font-mono ${ipNum >= 1 ? statColor('k', o.k) : ''}`}>{o.k}</td>
                          <td className={`px-3 py-2 text-center text-xs font-mono ${ipNum >= 1 ? statColor('hr', o.hr) : ''}`}>{o.hr}</td>
                          <td className="px-3 py-2 text-center text-xs font-mono text-ink-3">{o.pitches || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {/* Games scoreboard strip — separated by league */}
      {!searchMode && league !== 'intl' && data && data.games.length > 0 && (() => {
        const mlbGames     = data.games.filter(g => g.sportId === 1);
        const wbcGames     = data.games.filter(g => g.sportId === 51);
        const aaaGames     = data.games.filter(g => g.sportId === 11);
        const lowAGames    = data.games.filter(g => g.sportId === 14);
        const collegeGames = data.games.filter(g => g.sportId !== 1 && g.sportId !== 51 && g.sportId !== 11 && g.sportId !== 14);
        const renderGame = (g: DailyGame) => {
          const homeLogo = getMLBTeamLogoUrl(getMLBTeamAbbrFromLogoId(g.homeParentOrgId) ?? g.homeTeam);
          const awayLogo = getMLBTeamLogoUrl(getMLBTeamAbbrFromLogoId(g.awayParentOrgId) ?? g.awayTeam);
          const final = g.status.toLowerCase().includes('final') || g.status.toLowerCase().includes('game over');
          const isSelected = selectedGamePk === g.gamePk;
          return (
            <button
              key={g.gamePk}
              onClick={() => handleGameClick(g.gamePk)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap flex-shrink-0 border transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-deep border-ink text-deep-fg'
                  : 'bg-panel border-transparent hover:border-ink hover:bg-bone text-ink-2'
              }`}
            >
              {awayLogo && <img src={awayLogo} alt={g.awayTeam} className="w-4 h-4 object-contain" />}
              <span className="font-semibold">{g.awayTeam}</span>
              {final ? (
                <span className="text-ink-3 font-mono">{g.awayScore}–{g.homeScore}</span>
              ) : (
                <span className="text-ink-3 font-mono">vs</span>
              )}
              <span className="font-semibold">{g.homeTeam}</span>
              {homeLogo && <img src={homeLogo} alt={g.homeTeam} className="w-4 h-4 object-contain" />}
              {!final && <span className="text-yellow-500 text-[9px] font-bold ml-1">{g.status}</span>}
            </button>
          );
        };
        const rows: { label: string; color: string; games: DailyGame[] }[] = [
          { label: 'MLB',   color: 'text-blue-400',   games: mlbGames },
          { label: 'WBC',   color: 'text-red-400',    games: wbcGames },
          { label: 'AAA',   color: 'text-purple-400', games: aaaGames },
          { label: 'Low-A', color: 'text-green-400',  games: lowAGames },
          { label: 'NCAA',  color: 'text-yellow-400', games: collegeGames },
        ].filter(r => r.games.length > 0);
        return (
          <div className="bg-bone border-b border-ink/10">
            {rows.map((row, i) => (
              <div key={row.label}>
                {i > 0 && <div className="border-t border-ink/10/60" />}
                <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <span className={`text-[10px] font-bold uppercase tracking-wider flex-shrink-0 w-12 ${row.color}`}>{row.label}</span>
                  {row.games.map(renderGame)}
                  {selectedGamePk !== null && row.games.some(g => g.gamePk === selectedGamePk) && (
                    <button onClick={() => setSelectedGamePk(null)} className="flex items-center gap-1 text-xs text-ink-4 hover:text-ink-2 px-2 py-1.5 hover:bg-panel transition-colors">✕ Show all</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Loading */}
      {!searchMode && league !== 'intl' && loading && (
        <div className="flex items-center justify-center py-12 text-ink-4 gap-3">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent animate-spin" />
          <span className="text-sm">Loading pitchers for {date}...</span>
        </div>
      )}

      {/* Error */}
      {!searchMode && league !== 'intl' && !loading && error && (
        <div className="py-8 text-center text-red-400 text-sm">{error}</div>
      )}

      {/* No games */}
      {!searchMode && league !== 'intl' && !loading && !error && data && data.pitchers.length === 0 && (
        <div className="py-10 text-center text-ink-4 text-sm">
          {data.games.length > 0
            ? `${data.games.length} game${data.games.length !== 1 ? 's' : ''} scheduled — pitcher data will appear once games begin.`
            : `No games found for ${date}. Try a different date.`}
        </div>
      )}

      {/* Pitcher table */}
      {!searchMode && league !== 'intl' && !loading && !error && displayed.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/20/60 bg-bone">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider">Pitcher</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">Matchup</th>
                {(['ip','h','er','bb','k','hr'] as const).map(col => (
                  <th key={col} onClick={() => handleSort(col)}
                    className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-ink ${sortCol === col ? 'text-accent' : 'text-ink-4'}`}>
                    {col.toUpperCase()}{sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
                <th onClick={() => handleSort('pitches')}
                  className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-ink ${sortCol === 'pitches' ? 'text-accent' : 'text-ink-4'}`}>
                  P{sortCol === 'pitches' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
                <th onClick={() => handleSort('velocity')}
                  className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-ink ${sortCol === 'velocity' ? 'text-orange-400' : 'text-orange-500/70'}`}>
                  Top Velo{sortCol === 'velocity' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
                <th onClick={() => handleSort('whiffs')}
                  className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-ink ${sortCol === 'whiffs' ? 'text-blue-300' : 'text-blue-400/70'}`}>
                  Whiffs{sortCol === 'whiffs' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
                <th onClick={() => handleSort('whiffPct')}
                  className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-ink ${sortCol === 'whiffPct' ? 'text-blue-300' : 'text-blue-400/70'}`}>
                  Whiff%{sortCol === 'whiffPct' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
                <th onClick={() => handleSort('strikePct')}
                  className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-ink ${sortCol === 'strikePct' ? 'text-emerald-300' : 'text-emerald-500/70'}`}>
                  STR%{sortCol === 'strikePct' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
                {(league === 'fcl' || league === 'dsl') && (
                  <th onClick={() => handleSort('bonus')}
                    className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-ink ${sortCol === 'bonus' ? 'text-yellow-300' : 'text-yellow-500/70'}`}>
                    Bonus{sortCol === 'bonus' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </th>
                )}
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">Daily Card</th>
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
                    className="border-b border-ink/10/60 hover:bg-panel/60 transition-colors"
                  >
                    {/* Name + team */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {countryFlag
                          ? <img src={countryFlag} alt={p.team} className="w-7 h-[18px] object-cover flex-shrink-0" />
                          : teamLogo && <img src={teamLogo} alt={p.team} className="w-5 h-5 object-contain flex-shrink-0" />
                        }
                        <div>
                          <Link
                            href={league === 'fcl'
                              ? `/fcl/pitcher?pitcherId=${p.playerId}&date=${date}&gamePk=${p.gamePk}`
                              : `/pitcher/${p.playerId}`}
                            className="text-ink font-semibold hover:text-blue-400 transition-colors text-sm"
                          >
                            {p.name}
                          </Link>
                          <div className="text-xs text-ink-3 flex items-center gap-1">
                            <span>{p.team}</span>
                            {isStarter && <span className="text-ink-3">· SP</span>}
                            {p.age != null && <span className="text-ink-4">· {p.age}</span>}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Matchup */}
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1 text-xs text-ink-3">
                        <span>{p.isHome ? 'vs' : '@'}</span>
                        {oppLogo && <img src={oppLogo} alt={p.opponent} className="w-4 h-4 object-contain" />}
                        <span className="font-semibold text-ink-2">{p.opponent}</span>
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
                        <td className="px-3 py-2.5 text-center text-ink-3 text-xs">{line.pitches || '—'}</td>
                        <td className={`px-3 py-2.5 text-center font-bold text-xs ${
                          p.velocity == null ? 'text-ink-3' :
                          p.velocity >= 96 ? 'text-green-400' :
                          p.velocity >= 93 ? 'text-green-300' :
                          p.velocity >= 90 ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {p.velocity != null ? p.velocity.toFixed(1) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold text-blue-300">
                          {p.whiffs != null && p.whiffs > 0 ? p.whiffs : '—'}
                        </td>
                        <td className={`px-3 py-2.5 text-center font-bold text-xs ${
                          p.whiffPct == null ? 'text-ink-4' :
                          p.whiffPct >= 35 ? 'text-green-400' :
                          p.whiffPct >= 25 ? 'text-green-300' :
                          p.whiffPct >= 15 ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {p.whiffPct != null ? p.whiffPct.toFixed(1) + '%' : '—'}
                        </td>
                        <td className={`px-3 py-2.5 text-center font-bold text-xs ${
                          p.strikePct == null ? 'text-ink-4' :
                          p.strikePct >= 68 ? 'text-emerald-400' :
                          p.strikePct >= 64 ? 'text-emerald-300' :
                          p.strikePct >= 60 ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {p.strikePct != null ? p.strikePct.toFixed(1) + '%' : '—'}
                        </td>
                        {(league === 'fcl' || league === 'dsl') && (
                          <td className={`px-3 py-2.5 text-center font-semibold text-xs ${p.signingBonus != null ? 'text-yellow-300' : 'text-ink-5'}`}>
                            {fmtBonus(p.signingBonus)}
                          </td>
                        )}
                      </>
                    ) : (
                      <td colSpan={11} className="px-3 py-2.5 text-center text-ink-2 text-xs italic">
                        Stats pending
                      </td>
                    )}

                    {/* Daily card link */}
                    <td className="px-3 py-2.5 text-center">
                      <Link
                        href={league === 'fcl'
                          ? `/fcl/pitcher?pitcherId=${p.playerId}&date=${date}&gamePk=${p.gamePk}`
                          : `/pitcher/${p.playerId}/daily?date=${date}`}
                        className="inline-block px-2.5 py-1 bg-bone hover:bg-bone border border-ink/20 hover:border-ink text-ink-3 hover:text-ink rounded text-xs font-semibold transition-colors"
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
  const [springApiResults, setSpringApiResults] = useState<Array<{ player_id: number; full_name: string; team: string; throws: string }>>([]);
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

  // Static dataset search (fast, no network)
  const springStaticResults = useMemo(() => {
    if (!springQuery.trim()) return [];
    return searchAllPitchers(springQuery).slice(0, 8);
  }, [springQuery, selectedDataset]);

  // MLB API search fallback — finds players not in the local datasets
  useEffect(() => {
    if (springQuery.trim().length < 2) { setSpringApiResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/pitcher-search?q=${encodeURIComponent(springQuery)}`);
        const data = await res.json();
        setSpringApiResults(data.results ?? []);
      } catch { setSpringApiResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [springQuery]);

  // Merge: static results first, then any API results not already present
  const springSearchResults = useMemo(() => {
    const seen = new Set(springStaticResults.map(p => p.player_id));
    const apiOnly = springApiResults.filter(p => !seen.has(p.player_id));
    return [...springStaticResults, ...apiOnly].slice(0, 10);
  }, [springStaticResults, springApiResults]);

  return (
    <div className="min-h-screen bg-page">
      {/* Header */}
      <header className="bg-panel border-b border-ink/20">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-4">
                <h1 className="font-display text-3xl uppercase tracking-[0.02em] text-ink">
                  MLB Pitcher Stat Database
                </h1>
                <select
                  value={selectedDataset}
                  onChange={(e) => setSelectedDataset(e.target.value)}
                  className="px-3 py-1 text-sm bg-deep hover:bg-panel text-deep-fg font-medium border-0 cursor-pointer transition-colors"
                >
                  {DATASETS.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>{dataset.name}</option>
                  ))}
                </select>
              </div>
              <p className="text-ink-3-2 mt-1">
                {filteredAndSortedPitchers.length} pitchers
                {!isClient && <span className="text-xs ml-2">(Loading...)</span>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowDailyPanel(v => !v)}
                className={`px-4 py-2 font-medium transition-colors text-sm border ${
                  showDailyPanel
                    ? 'bg-deep border-blue-500 text-ink hover:bg-deep'
                    : 'bg-page border-ink/30 text-ink-2 hover:bg-panel hover:border-ink hover:text-ink text-ink-2'
                }`}
              >
                📅 Daily Pitchers
              </button>
              <button
                onClick={() => setShowSeasonPanel(v => !v)}
                className={`px-4 py-2 font-medium transition-colors text-sm border ${
                  showSeasonPanel
                    ? 'bg-green-700 border-green-500 text-ink hover:bg-green-800'
                    : 'bg-page border-ink/30 text-ink-2 hover:bg-panel hover:border-ink hover:text-ink text-ink-2'
                }`}
              >
                🏟️ Team Season
              </button>
              <button
                onClick={() => { setShowSpringSearch(v => !v); setSpringQuery(''); }}
                className={`px-4 py-2 font-medium transition-colors text-sm border ${
                  showSpringSearch
                    ? 'bg-green-600 border-green-400 text-ink hover:bg-green-700'
                    : 'bg-page border-ink/30 text-ink-2 hover:bg-panel hover:border-ink hover:text-ink text-ink-2'
                }`}
              >
                🌱 Spring Training
              </button>
              <a
                href="/"
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-ink font-medium transition-colors text-sm"
              >
                View Hitters
              </a>
              <div className="text-sm text-ink-4-3 italic">
                By: Zack McKeown
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Spring Training Search Panel */}
      {showSpringSearch && (
        <div className="bg-page border-b border-green-800/40">
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
                  className="w-full bg-panel border border-green-700/60 focus:border-green-400 text-ink text-sm px-3 py-2 outline-none placeholder-ink-4 transition-colors"
                />
                {springSearchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-page border border-ink/30 z-50 overflow-hidden">
                    {springSearchResults.map(p => (
                      <button
                        key={p.player_id}
                        onClick={() => {
                          router.push(`/pitcher/${p.player_id}/spring-summary`);
                          setShowSpringSearch(false);
                          setSpringQuery('');
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-bone transition-colors text-left"
                      >
                        {p.player_id && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_60,q_auto:best/v1/people/${p.player_id}/headshot/silo/current`}
                            alt={p.full_name}
                            className="w-8 h-8 object-cover flex-shrink-0 bg-bone"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-ink truncate">{p.full_name}</div>
                          <div className="text-[10px] text-ink-3">{p.team} · {p.throws}HP</div>
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
          <div className="bg-deep text-ink p-4 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-semibold">2 pitchers selected for comparison</span>
              <button onClick={() => setSelectedPitchers([])} className="text-sm underline hover:no-underline">
                Clear Selection
              </button>
            </div>
            <a
              href={`/compare-pitchers?pitcher1=${selectedPitchers[0]}&pitcher2=${selectedPitchers[1]}`}
              className="bg-panel text-signature px-6 py-2 font-semibold hover:bg-bone transition-colors"
            >
              Compare Pitchers →
            </a>
          </div>
        )}

        {/* Search and Filters */}
        <div className="bg-panel p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="search-input" className="block text-sm font-medium text-ink-2 mb-2">
                Search Pitchers
              </label>
              <input
                id="search-input"
                type="text"
                placeholder="Search by name or team..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink focus:bg-panel outline-none text-ink placeholder-ink-4"
              />
            </div>
            <div>
              <label htmlFor="team-filter" className="block text-sm font-medium text-ink-2 mb-2">
                Filter by Team
              </label>
              <select
                id="team-filter"
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                className="w-full px-4 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink focus:bg-panel outline-none text-ink"
              >
                <option value="all">All Teams</option>
                {teams.map((team) => <option key={team} value={team}>{team}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="sort-select" className="block text-sm font-medium text-ink-2 mb-2">
                Sort By
              </label>
              <select
                id="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full px-4 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink focus:bg-panel outline-none text-ink"
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
              className="text-sm text-signature hover:underline"
            >
              {showAdvancedFilters ? '− Hide Advanced Filters' : '+ Show Advanced Filters'}
            </button>
          </div>

          {showAdvancedFilters && (
            <div className="mt-4 pt-4 border-t border-ink/20">
              <h3 className="text-sm font-semibold text-ink-2 mb-3">Advanced Filters</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2">Age Range</label>
                  <div className="flex gap-2">
                    <input type="number" placeholder="Min" value={ageMin} onChange={e => setAgeMin(e.target.value)}
                      className="w-full px-3 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink focus:bg-panel outline-none text-ink text-sm" />
                    <input type="number" placeholder="Max" value={ageMax} onChange={e => setAgeMax(e.target.value)}
                      className="w-full px-3 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink focus:bg-panel outline-none text-ink text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2">Min FB Velo (mph)</label>
                  <input type="number" placeholder="e.g. 95" value={fbVeloMin} onChange={e => setFbVeloMin(e.target.value)}
                    className="w-full px-3 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink focus:bg-panel outline-none text-ink text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2">Max ERA</label>
                  <input type="number" step="0.1" placeholder="e.g. 3.5" value={eraMax} onChange={e => setEraMax(e.target.value)}
                    className="w-full px-3 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink focus:bg-panel outline-none text-ink text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2">Min K/9</label>
                  <input type="number" step="0.1" placeholder="e.g. 9.0" value={kPer9Min} onChange={e => setKPer9Min(e.target.value)}
                    className="w-full px-3 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink focus:bg-panel outline-none text-ink text-sm" />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={() => { setAgeMin(''); setAgeMax(''); setFbVeloMin(''); setEraMax(''); setKPer9Min(''); }}
                    className="w-full px-4 py-2 bg-bone text-ink-2 hover:bg-bone transition-colors text-sm font-medium"
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
          <div className="bg-panel p-8 text-center">
            <p className="text-ink-3-2 text-lg">No pitchers found</p>
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
