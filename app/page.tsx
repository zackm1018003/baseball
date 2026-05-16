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

// ─── FCL types ────────────────────────────────────────────────────────────────

interface FclScheduleGame {
  gamePk: number;
  status: string;
  teams: {
    away: { team: { id: number; name: string; abbreviation: string }; score?: number };
    home: { team: { id: number; name: string; abbreviation: string }; score?: number };
  };
}

interface FclPlay {
  atBatIndex:    number;
  inning:        number;
  halfInning:    string;
  isTopInning:   boolean;
  event:         string;
  description:   string;
  isScoringPlay: boolean;
  rbi:           number;
  batter:        { id: number; name: string };
  pitcher:       { id: number; name: string };
  launchSpeed:   number | null;
  launchAngle:   number | null;
  totalDistance: number | null;
  trajectory:    string | null;
}

interface FclGameFeed {
  gamePk:     string;
  status:     string;
  inning:     number | null;
  halfInning: string | null;
  away:       { id: number; name: string; abbr: string; score: number };
  home:       { id: number; name: string; abbr: string; score: number };
  plays:      FclPlay[];
  hasStatcast: boolean;
}

interface FclPlayerStat {
  batterId:   number;
  batterName: string;
  teamAbbr:   string;
  oppAbbr:    string;
  gamePks:    number[];
  pa: number; ab: number; h: number; hr: number;
  rbi: number; bb: number; k: number; doubles: number; triples: number;
  maxEv: number | null;
  barrels: number;
  hasStatcast: boolean;
}

function evColor(ev: number): string {
  if (ev >= 100) return 'text-green-400 font-bold';
  if (ev >= 90)  return 'text-lime-400';
  if (ev >= 80)  return 'text-yellow-400';
  return 'text-red-400';
}

function isBarrel(ev: number | null, la: number | null): boolean {
  if (ev == null || la == null) return false;
  if (ev < 98) return false;
  if (la >= 26 && la <= 30) return true;
  if (la > 30 && la <= 50) return ev >= 98 + (la - 30) * 2;
  if (la >= 8  && la < 26)  return ev >= 98 + (26 - la) * 2;
  return false;
}

function hitColor(h: number): string {
  if (h >= 4) return 'text-green-400';
  if (h >= 3) return 'text-green-300';
  if (h >= 2) return 'text-yellow-400';
  if (h >= 1) return 'text-ink-2';
  return 'text-red-400';
}

function hrColor(hr: number): string {
  if (hr >= 2) return 'text-green-400';
  if (hr >= 1) return 'text-yellow-400';
  return 'text-ink-4';
}

// ─── Daily Hitters Panel ───────────────────────────────────────────────────────

function DailyHittersPanel() {
  const [date, setDate] = useState<string>(today());
  const [league, setLeague] = useState<'mlb' | 'aaa' | 'low-a' | 'fcl' | 'acl'>('mlb');
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGamePk, setSelectedGamePk] = useState<number | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [sortCol, setSortCol] = useState<string>('h');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  // FCL-specific state
  const [fclGames, setFclGames] = useState<FclScheduleGame[]>([]);
  const [fclAllFeeds, setFclAllFeeds] = useState<FclGameFeed[]>([]);
  const [fclFeedsLoading, setFclFeedsLoading] = useState(false);
  const [fclSortCol, setFclSortCol] = useState<string>('h');
  const [fclSortDir, setFclSortDir] = useState<'desc' | 'asc'>('desc');

  const handleFclSort = (col: string) => {
    if (fclSortCol === col) setFclSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setFclSortCol(col); setFclSortDir('desc'); }
  };

  // Aggregate all FCL feeds into per-player stats
  const fclPlayerStats = useMemo<FclPlayerStat[]>(() => {
    if (fclAllFeeds.length === 0) return [];
    const byPlayer = new Map<number, FclPlayerStat>();
    for (const feed of fclAllFeeds) {
      for (const play of feed.plays) {
        const id = play.batter.id;
        // Determine which side this batter is on
        const isAway = play.isTopInning;
        const teamAbbr = isAway ? feed.away.abbr : feed.home.abbr;
        const oppAbbr  = isAway ? feed.home.abbr : feed.away.abbr;
        if (!byPlayer.has(id)) {
          byPlayer.set(id, {
            batterId: id, batterName: play.batter.name,
            teamAbbr, oppAbbr,
            gamePks: [],
            pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 0, doubles: 0, triples: 0,
            maxEv: null, barrels: 0, hasStatcast: false,
          });
        }
        const s = byPlayer.get(id)!;
        const gk = Number(feed.gamePk);
        if (!s.gamePks.includes(gk)) s.gamePks.push(gk);
        s.pa++;
        s.rbi += play.rbi ?? 0;
        const ev = (play.event ?? '').toLowerCase();
        if (ev === 'single')   { s.h++; s.ab++; }
        else if (ev === 'double') { s.h++; s.ab++; s.doubles++; }
        else if (ev === 'triple') { s.h++; s.ab++; s.triples++; }
        else if (ev === 'home run') { s.h++; s.ab++; s.hr++; }
        else if (ev.includes('strikeout')) { s.k++; s.ab++; }
        else if (ev === 'walk' || ev === 'intent walk' || ev === 'hit by pitch') { s.bb++; }
        else if (!ev.includes('sac') && !ev.includes('interference')) { s.ab++; }
        if (play.launchSpeed != null) {
          s.maxEv = s.maxEv == null ? play.launchSpeed : Math.max(s.maxEv, play.launchSpeed);
          s.hasStatcast = true;
        }
        if (isBarrel(play.launchSpeed, play.launchAngle)) s.barrels++;
      }
    }
    return [...byPlayer.values()];
  }, [fclAllFeeds]);

  const fclSortedPlayers = useMemo(() => {
    return [...fclPlayerStats].sort((a, b) => {
      let av: number, bv: number;
      switch (fclSortCol) {
        case 'h':      av = a.h;           bv = b.h;           break;
        case 'ab':     av = a.ab;          bv = b.ab;          break;
        case 'hr':     av = a.hr;          bv = b.hr;          break;
        case 'rbi':    av = a.rbi;         bv = b.rbi;         break;
        case 'bb':     av = a.bb;          bv = b.bb;          break;
        case 'k':      av = a.k;           bv = b.k;           break;
        case '2b':     av = a.doubles;     bv = b.doubles;     break;
        case 'ev':     av = a.maxEv ?? -1; bv = b.maxEv ?? -1; break;
        case 'barrel': av = a.barrels;     bv = b.barrels;     break;
        default:       av = a.h;           bv = b.h;
      }
      return fclSortDir === 'desc' ? bv - av : av - bv;
    });
  }, [fclPlayerStats, fclSortCol, fclSortDir]);

  const fetchAllFclFeeds = useCallback(async (games: FclScheduleGame[]) => {
    if (games.length === 0) { setFclAllFeeds([]); return; }
    setFclFeedsLoading(true);
    try {
      const results = await Promise.all(
        games.map(g =>
          fetch(`/api/fcl-game?mode=game&gamePk=${g.gamePk}`)
            .then(r => r.json())
            .catch(() => null)
        )
      );
      setFclAllFeeds(results.filter(Boolean) as FclGameFeed[]);
    } finally {
      setFclFeedsLoading(false);
    }
  }, []);

  const fetchFclSchedule = useCallback(async (d: string, lg: 'fcl' | 'acl' = 'fcl', silent = false) => {
    if (!silent) { setLoading(true); setError(null); setFclGames([]); setFclAllFeeds([]); }
    try {
      const res = await fetch(`/api/fcl-game?mode=schedule&league=${lg}&startDate=${d}&endDate=${d}`);
      const json = await res.json();
      const games: FclScheduleGame[] = [];
      for (const entry of (json.dates ?? [])) {
        for (const g of (entry.games ?? [])) {
          games.push({
            gamePk: g.gamePk,
            status: (g.status?.detailedState ?? g.status ?? ''),
            teams: g.teams,
          });
        }
      }
      setFclGames(games);
      setLastRefresh(new Date());
      await fetchAllFclFeeds(games);
    } catch (e: unknown) {
      if (!silent) setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [fetchAllFclFeeds]);

  const fetchDay = useCallback(async (d: string, lg: 'mlb' | 'aaa' | 'low-a' | 'fcl' | 'acl', silent = false) => {
    if (lg === 'fcl' || lg === 'acl') { fetchFclSchedule(d, lg, silent); return; }
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
  }, [fetchFclSchedule]);

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

  const handleLeagueChange = (lg: 'mlb' | 'aaa' | 'low-a' | 'fcl' | 'acl') => {
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
      className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap hover:text-ink transition-colors ${sortCol === col ? 'text-blue-400' : 'text-ink-4'}`}
    >
      {label}{sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );

  return (
    <div className="bg-panel overflow-hidden mb-6">
      {/* Panel header */}
      <div className="bg-panel border-b border-ink/20 px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-ink font-bold text-base">📅 Daily Hitters</h2>
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
              Click a game to filter hitters
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

          {/* League selector */}
          <div className="flex items-center overflow-hidden border border-ink/30 text-xs font-semibold">
            <button
              onClick={() => handleLeagueChange('mlb')}
              className={`px-3 py-1.5 transition-colors ${league === 'mlb' ? 'bg-deep text-deep-fg' : 'bg-bone text-ink-3 hover:text-ink hover:bg-bone'}`}
            >MLB</button>
            <button
              onClick={() => handleLeagueChange('aaa')}
              className={`px-3 py-1.5 transition-colors ${league === 'aaa' ? 'bg-accent text-ink' : 'bg-bone text-ink-3 hover:text-ink hover:bg-bone'}`}
            >AAA</button>
            <button
              onClick={() => handleLeagueChange('low-a')}
              className={`px-3 py-1.5 transition-colors ${league === 'low-a' ? 'bg-green-600 text-ink' : 'bg-bone text-ink-3 hover:text-ink hover:bg-bone'}`}
            >Low-A</button>
            <button
              onClick={() => handleLeagueChange('fcl')}
              className={`px-3 py-1.5 transition-colors ${league === 'fcl' ? 'bg-sky-600 text-ink' : 'bg-bone text-ink-3 hover:text-ink hover:bg-bone'}`}
            >⚾ FCL</button>
            <button
              onClick={() => handleLeagueChange('acl')}
              className={`px-3 py-1.5 transition-colors ${league === 'acl' ? 'bg-amber-600 text-ink' : 'bg-bone text-ink-3 hover:text-ink hover:bg-bone'}`}
            >🌵 ACL</button>
          </div>

          {data && league !== 'fcl' && (
            <span className="ml-auto text-xs text-ink-3">
              {displayed.length} hitter{displayed.length !== 1 ? 's' : ''} · {data.games.length} game{data.games.length !== 1 ? 's' : ''}
            </span>
          )}
          {(league === 'fcl' || league === 'acl') && !loading && (
            <span className="ml-auto text-xs text-ink-3">
              {fclGames.length} {league.toUpperCase()} game{fclGames.length !== 1 ? 's' : ''}
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
        return (
          <div className="bg-bone border-b border-ink/10">
            {/* MLB row */}
            {mlbGames.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider flex-shrink-0 w-10">MLB</span>
                {mlbGames.map(renderGame)}
                {selectedGamePk !== null && mlbGames.some(g => g.gamePk === selectedGamePk) && (
                  <button onClick={() => setSelectedGamePk(null)} className="flex items-center gap-1 text-xs text-ink-4 hover:text-ink-2 px-2 py-1.5 hover:bg-panel transition-colors">✕ Show all</button>
                )}
              </div>
            )}
            {/* Divider between sections */}
            {mlbGames.length > 0 && wbcGames.length > 0 && (
              <div className="border-t border-ink/10/60" />
            )}
            {/* WBC row */}
            {wbcGames.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider flex-shrink-0 w-10">WBC</span>
                {wbcGames.map(renderGame)}
                {selectedGamePk !== null && wbcGames.some(g => g.gamePk === selectedGamePk) && (
                  <button onClick={() => setSelectedGamePk(null)} className="flex items-center gap-1 text-xs text-ink-4 hover:text-ink-2 px-2 py-1.5 hover:bg-panel transition-colors">✕ Show all</button>
                )}
              </div>
            )}
            {/* Divider between sections */}
            {(mlbGames.length > 0 || wbcGames.length > 0) && aaaGames.length > 0 && (
              <div className="border-t border-ink/10/60" />
            )}
            {/* AAA row */}
            {aaaGames.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider flex-shrink-0 w-10">AAA</span>
                {aaaGames.map(renderGame)}
                {selectedGamePk !== null && aaaGames.some(g => g.gamePk === selectedGamePk) && (
                  <button onClick={() => setSelectedGamePk(null)} className="flex items-center gap-1 text-xs text-ink-4 hover:text-ink-2 px-2 py-1.5 hover:bg-panel transition-colors">✕ Show all</button>
                )}
              </div>
            )}
            {/* Divider between sections */}
            {(mlbGames.length > 0 || wbcGames.length > 0 || aaaGames.length > 0) && lowAGames.length > 0 && (
              <div className="border-t border-ink/10/60" />
            )}
            {/* Low-A row */}
            {lowAGames.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="text-[10px] font-bold text-green-400 uppercase tracking-wider flex-shrink-0 w-10">Low-A</span>
                {lowAGames.map(renderGame)}
                {selectedGamePk !== null && lowAGames.some(g => g.gamePk === selectedGamePk) && (
                  <button onClick={() => setSelectedGamePk(null)} className="flex items-center gap-1 text-xs text-ink-4 hover:text-ink-2 px-2 py-1.5 hover:bg-panel transition-colors">✕ Show all</button>
                )}
              </div>
            )}
            {/* Divider between sections */}
            {(mlbGames.length > 0 || wbcGames.length > 0 || aaaGames.length > 0 || lowAGames.length > 0) && collegeGames.length > 0 && (
              <div className="border-t border-ink/10/60" />
            )}
            {/* College row */}
            {collegeGames.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="text-[10px] font-bold text-green-400 uppercase tracking-wider flex-shrink-0 w-10">NCAA</span>
                {collegeGames.map(renderGame)}
                {selectedGamePk !== null && collegeGames.some(g => g.gamePk === selectedGamePk) && (
                  <button onClick={() => setSelectedGamePk(null)} className="flex items-center gap-1 text-xs text-ink-4 hover:text-ink-2 px-2 py-1.5 hover:bg-panel transition-colors">✕ Show all</button>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* FCL / ACL scoreboard strip */}
      {(league === 'fcl' || league === 'acl') && !loading && fclGames.length > 0 && (
        <div className="bg-bone border-b border-ink/10">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2">
            <span className={`text-[10px] font-bold uppercase tracking-wider flex-shrink-0 w-10 ${league === 'acl' ? 'text-amber-400' : 'text-sky-400'}`}>{league.toUpperCase()}</span>
            {fclGames.map(g => {
              const isFinal = g.status.toLowerCase().includes('final') || g.status.toLowerCase().includes('game over');
              const awayAbbr = g.teams.away.team.abbreviation;
              const homeAbbr = g.teams.home.team.abbreviation;
              const awayScore = g.teams.away.score ?? 0;
              const homeScore = g.teams.home.score ?? 0;
              return (
                <div
                  key={g.gamePk}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap flex-shrink-0 border bg-panel border-transparent text-ink-2"
                >
                  <span className="font-semibold">{awayAbbr}</span>
                  {isFinal ? (
                    <span className="text-ink-3 font-mono">{awayScore}–{homeScore}</span>
                  ) : (
                    <span className="text-ink-3 font-mono">vs</span>
                  )}
                  <span className="font-semibold">{homeAbbr}</span>
                  {!isFinal && <span className="text-yellow-500 text-[9px] font-bold ml-1">{g.status}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* FCL / ACL aggregate player table */}
      {(league === 'fcl' || league === 'acl') && (
        <>
          {(loading || fclFeedsLoading) && (
            <div className="flex items-center justify-center py-12 text-ink-4 gap-3">
              <div className="w-5 h-5 border-2 border-sky-400 border-t-transparent animate-spin" />
              <span className="text-sm">
                {loading ? `Loading ${league.toUpperCase()} schedule…` : `Loading game data… (${fclAllFeeds.length}/${fclGames.length})`}
              </span>
            </div>
          )}
          {!loading && !fclFeedsLoading && fclGames.length === 0 && (
            <div className="py-10 text-center text-ink-4 text-sm">
              No {league.toUpperCase()} games found for {date}. Try a different date.
            </div>
          )}
          {!loading && !fclFeedsLoading && fclSortedPlayers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/20/60 bg-bone">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider">Hitter</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">Matchup</th>
                    {([
                      { col: 'h',      label: 'H' },
                      { col: 'ab',     label: 'AB' },
                      { col: 'hr',     label: 'HR' },
                      { col: 'rbi',    label: 'RBI' },
                      { col: 'bb',     label: 'BB' },
                      { col: 'k',      label: 'K' },
                      { col: '2b',     label: '2B' },
                      { col: 'ev',     label: 'Max EV', title: 'Max exit velocity (all games today)' },
                      { col: 'barrel', label: 'Brls',   title: 'Total barrels (all games today)' },
                    ] as { col: string; label: string; title?: string }[]).map(({ col, label, title }) => {
                      const active = fclSortCol === col;
                      return (
                        <th
                          key={col}
                          onClick={() => handleFclSort(col)}
                          title={title}
                          className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap hover:text-ink transition-colors ${active ? 'text-blue-400' : 'text-ink-4'}`}
                        >
                          {label}{active ? (fclSortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                        </th>
                      );
                    })}
                    <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">Card</th>
                  </tr>
                </thead>
                <tbody>
                  {fclSortedPlayers.map((p, idx) => (
                    <tr
                      key={`${p.batterId}-${idx}`}
                      className={`border-b border-ink/10/60 hover:bg-panel/60 transition-colors ${p.barrels > 0 ? 'bg-orange-900/10' : ''}`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="text-ink font-semibold text-sm">{p.batterName}</div>
                        <div className="text-xs text-ink-3">{p.teamAbbr}</div>
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-ink-3">{p.oppAbbr}</td>
                      <td className={`px-3 py-2.5 text-center font-bold ${hitColor(p.h)}`}>{p.h}</td>
                      <td className="px-3 py-2.5 text-center text-ink-2 font-semibold">{p.ab}</td>
                      <td className={`px-3 py-2.5 text-center font-semibold ${hrColor(p.hr)}`}>{p.hr || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-ink-3">{p.rbi || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-ink-3">{p.bb || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-ink-3">{p.k || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-ink-3">{p.doubles || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-xs font-mono">
                        {p.maxEv != null
                          ? <span className={evColor(p.maxEv)}>{p.maxEv.toFixed(1)}</span>
                          : <span className="text-ink-5">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center text-sm">
                        {p.barrels > 0
                          ? <span className="text-orange-400 font-bold">{p.barrels === 1 ? '🛢️' : `🛢️×${p.barrels}`}</span>
                          : <span className="text-ink-5">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <a
                          href={`/fcl/player?batterId=${p.batterId}&gamePk=${p.gamePks[0]}&date=${date}&league=${league}`}
                          target="_blank"
                          className="inline-block px-2 py-1 bg-bone hover:bg-sky-900/40 border border-ink/20 hover:border-sky-500 text-ink-3 hover:text-ink rounded text-xs font-semibold transition-colors"
                        >📅</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && !fclFeedsLoading && fclGames.length > 0 && fclSortedPlayers.length === 0 && fclAllFeeds.length > 0 && (
            <div className="py-10 text-center text-ink-4 text-sm">No player data available yet.</div>
          )}
        </>
      )}

      {/* Loading (MLB/AAA/Low-A only — FCL has its own spinner above) */}
      {loading && league !== 'fcl' && league !== 'acl' && (
        <div className="flex items-center justify-center py-12 text-ink-4 gap-3">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent animate-spin" />
          <span className="text-sm">Loading hitters for {date}…</span>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="py-8 text-center text-red-400 text-sm">{error}</div>
      )}

      {/* No games */}
      {!loading && !error && data && data.hitters.length === 0 && league !== 'fcl' && league !== 'acl' && (
        <div className="py-10 text-center text-ink-4 text-sm">
          No games found for {date}. Try a different date.
        </div>
      )}

      {/* Hitter table */}
      {league !== 'fcl' && league !== 'acl' && !loading && !error && displayed.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/20/60 bg-bone">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider">Hitter</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">Matchup</th>
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
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">Daily Card</th>
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
                    className="border-b border-ink/10/60 hover:bg-panel/60 transition-colors"
                  >
                    {/* Name + team */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {countryFlag
                          ? <img src={countryFlag} alt={h.team} className="w-7 h-[18px] object-cover flex-shrink-0" />
                          : teamLogo && <img src={teamLogo} alt={h.team} className="w-5 h-5 object-contain flex-shrink-0" />
                        }
                        <div>
                          <Link
                            href={`/player/${h.playerId}`}
                            className="text-ink font-semibold hover:text-blue-400 transition-colors text-sm"
                          >
                            {h.name}
                          </Link>
                          <div className="text-xs text-ink-3">{h.team}</div>
                        </div>
                      </div>
                    </td>

                    {/* Matchup */}
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1 text-xs text-ink-3">
                        <span>{h.isHome ? 'vs' : '@'}</span>
                        {oppLogo && <img src={oppLogo} alt={h.opponent} className="w-4 h-4 object-contain" />}
                        <span className="font-semibold text-ink-2">{h.opponent}</span>
                      </div>
                    </td>

                    {/* Stat line */}
                    {line ? (
                      <>
                        <td className={`px-3 py-2.5 text-center font-bold ${hitColor(line.h)}`}>{line.h}</td>
                        <td className="px-3 py-2.5 text-center text-ink-2 font-semibold">{line.ab}</td>
                        <td className={`px-3 py-2.5 text-center font-semibold ${hrColor(line.hr)}`}>{line.hr || '—'}</td>
                        <td className="px-3 py-2.5 text-center text-ink-3">{line.rbi || '—'}</td>
                        <td className="px-3 py-2.5 text-center text-ink-3">{line.bb || '—'}</td>
                        <td className="px-3 py-2.5 text-center text-ink-3">{line.k || '—'}</td>
                        <td className="px-3 py-2.5 text-center text-ink-3">{line.doubles || '—'}</td>
                        <td className="px-3 py-2.5 text-center text-ink-3">{line.sb || '—'}</td>
                      </>
                    ) : (
                      <td colSpan={8} className="px-3 py-2.5 text-center text-ink-2 text-xs italic">
                        Stats pending
                      </td>
                    )}
                    {league === 'mlb' && (
                      <td className="px-3 py-2.5 text-center text-ink-3 text-xs">{h.batSpeed != null ? h.batSpeed.toFixed(1) : '—'}</td>
                    )}
                    <td className="px-3 py-2.5 text-center text-ink-3 text-xs">{h.maxEv != null ? h.maxEv.toFixed(1) : '—'}</td>
                    <td className="px-3 py-2.5 text-center text-ink-3 text-xs">{h.barrels != null ? h.barrels : '—'}</td>
                    <td className="px-3 py-2.5 text-center text-ink-3 text-xs">{h.hardHit95 != null ? h.hardHit95 : '—'}</td>

                    {/* Daily card link */}
                    <td className="px-3 py-2.5 text-center">
                      <Link
                        href={`/player/${h.playerId}/daily?date=${date}`}
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
      className={`px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap hover:text-ink transition-colors ${sortCol === col ? 'text-blue-400' : 'text-ink-4'}`}
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
    <div className="bg-panel overflow-hidden mb-6">
      {/* Panel header */}
      <div className="bg-panel border-b border-ink/20 px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h2 className="text-ink font-bold text-base">📊 Season Hitters</h2>
            <p className="text-ink-4 text-xs mt-0.5">Season totals · Click a column header to sort</p>
          </div>

          {/* Season selector */}
          <select
            value={season}
            onChange={e => handleSeasonChange(e.target.value)}
            className="bg-bone text-ink border border-ink/30 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/40"
          >
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          {/* League selector */}
          <div className="flex items-center overflow-hidden border border-ink/30 text-xs font-semibold">
            <button
              onClick={() => handleLeagueChange('mlb')}
              className={`px-3 py-1.5 transition-colors ${league === 'mlb' ? 'bg-deep text-deep-fg' : 'bg-bone text-ink-3 hover:text-ink hover:bg-bone'}`}
            >MLB</button>
            <button
              onClick={() => handleLeagueChange('aaa')}
              className={`px-3 py-1.5 transition-colors ${league === 'aaa' ? 'bg-accent text-ink' : 'bg-bone text-ink-3 hover:text-ink hover:bg-bone'}`}
            >AAA</button>
            <button
              onClick={() => handleLeagueChange('low-a')}
              className={`px-3 py-1.5 transition-colors ${league === 'low-a' ? 'bg-green-600 text-ink' : 'bg-bone text-ink-3 hover:text-ink hover:bg-bone'}`}
            >Low-A</button>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search player or team…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-bone text-ink border border-ink/30 px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-ink/40 placeholder-gray-600"
          />

          {/* Min PA filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-4 whitespace-nowrap">Min PA</label>
            <input
              type="number"
              value={minPa}
              onChange={e => setMinPa(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-16 bg-bone text-ink border border-ink/30 px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-ink/40"
            />
          </div>

          {data && (
            <span className="ml-auto text-xs text-ink-3">
              {displayed.length} hitter{displayed.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-ink-4 gap-3">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent animate-spin" />
          <span className="text-sm">Loading {season} season stats…</span>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="py-8 text-center text-red-400 text-sm">{error}</div>
      )}

      {/* Empty */}
      {!loading && !error && data && displayed.length === 0 && (
        <div className="py-10 text-center text-ink-4 text-sm">
          No hitters found. Try lowering the Min PA.
        </div>
      )}

      {/* Table */}
      {!loading && !error && displayed.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/20/60 bg-bone">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider">Hitter</th>
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
                    className="border-b border-ink/10/60 hover:bg-panel/60 transition-colors"
                  >
                    {/* Name + team */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {teamLogo && <img src={teamLogo} alt={h.team} className="w-5 h-5 object-contain flex-shrink-0" />}
                        <div>
                          <Link
                            href={`/player/${h.playerId}`}
                            className="text-ink font-semibold hover:text-blue-400 transition-colors text-sm"
                          >
                            {h.name}
                          </Link>
                          <div className="text-xs text-ink-3">{h.team}</div>
                        </div>
                      </div>
                    </td>

                    {/* Stats */}
                    <td className="px-3 py-2.5 text-center text-ink-2 font-semibold">{h.pa}</td>
                    <td className="px-3 py-2.5 text-center font-bold text-ink-2">{fmtRate(h.avg)}</td>
                    <td className={`px-3 py-2.5 text-center font-bold ${hitColor(h.h)}`}>{h.h}</td>
                    <td className="px-3 py-2.5 text-center text-ink-2 font-semibold">{h.ab}</td>
                    <td className={`px-3 py-2.5 text-center font-semibold ${hrColor(h.hr)}`}>{h.hr || '—'}</td>
                    <td className="px-3 py-2.5 text-center text-ink-3">{h.rbi || '—'}</td>
                    <td className="px-3 py-2.5 text-center text-ink-3">{h.bb || '—'}</td>
                    <td className="px-3 py-2.5 text-center text-ink-3">{h.k || '—'}</td>
                    <td className="px-3 py-2.5 text-center text-ink-3">{h.doubles || '—'}</td>
                    <td className="px-3 py-2.5 text-center text-ink-3">{h.sb || '—'}</td>
                    <td className="px-3 py-2.5 text-center text-ink-2">{fmtRate(h.obp)}</td>
                    <td className="px-3 py-2.5 text-center text-ink-2">{fmtRate(h.slg)}</td>
                    <td className="px-3 py-2.5 text-center font-semibold text-ink-2">{fmtRate(h.ops)}</td>
                    {league === 'mlb' && (
                      <>
                        <td className="px-3 py-2.5 text-center text-ink-3 text-xs">{h.avgBatSpeed != null ? h.avgBatSpeed.toFixed(1) : '—'}</td>
                        <td className="px-3 py-2.5 text-center text-ink-3 text-xs">{h.avgEv != null ? h.avgEv.toFixed(1) : '—'}</td>
                        <td className="px-3 py-2.5 text-center text-ink-3 text-xs">{h.barrelPct != null ? h.barrelPct.toFixed(1) + '%' : '—'}</td>
                        <td className="px-3 py-2.5 text-center text-ink-3 text-xs">{h.hardHitPct != null ? h.hardHitPct.toFixed(1) + '%' : '—'}</td>
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
    <div className="min-h-screen bg-page">
      {/* Header */}
      <header className="bg-panel border-b border-ink/20">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-4">
                <h1 className="font-display text-3xl uppercase tracking-[0.02em] text-ink">
                  MLB Player Stat Database
                </h1>
                {/* Dataset Selector */}
                <select
                  value={selectedDataset}
                  onChange={(e) => setSelectedDataset(e.target.value)}
                  className="px-3 py-1 text-sm bg-deep hover:bg-panel text-deep-fg font-medium border-0 cursor-pointer transition-colors"
                >
                  {DATASETS.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-ink-3-2 mt-1">
                {filteredAndSortedPlayers.length} players
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
                📅 Daily Hitters
              </button>
              <button
                onClick={() => setShowSeasonPanel(v => !v)}
                className={`px-4 py-2 font-medium transition-colors text-sm border ${
                  showSeasonPanel
                    ? 'bg-deep border-blue-500 text-ink hover:bg-deep'
                    : 'bg-page border-ink/30 text-ink-2 hover:bg-panel hover:border-ink hover:text-ink text-ink-2'
                }`}
              >
                📊 Season Hitters
              </button>
              <a
                href="/leaderboard"
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-ink font-medium transition-colors text-sm"
              >
                Leaderboard
              </a>
              <a
                href="/barrels"
                className="px-4 py-2 bg-orange-800 hover:bg-orange-700 text-ink font-medium transition-colors text-sm"
              >
                🛢️ Barrels
              </a>
              <a
                href="/overslot"
                className="px-4 py-2 bg-sky-700 hover:bg-sky-600 text-ink font-medium transition-colors text-sm"
              >
                🎓 College Stats
              </a>
              <a
                href="/grades"
                className="px-4 py-2 bg-deep hover:bg-panel text-ink font-medium transition-colors text-sm"
              >
                📋 Scout Grades
              </a>
              <a
                href="/hs"
                className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-ink font-medium transition-colors text-sm"
              >
                🏫 HS Prospects
              </a>
              <a
                href="/spring-breakout"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-ink font-medium transition-colors text-sm"
              >
                🌱 Spring Breakout
              </a>
              <a
                href="/pitchers"
                className="px-4 py-2 bg-accent hover:bg-accent text-ink font-medium transition-colors text-sm"
              >
                View Pitchers
              </a>
              <a
                href="/similarity"
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-ink font-medium transition-colors text-sm"
              >
                Custom Similarity Search
              </a>
              <a
                href="/fcl"
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-ink font-medium transition-colors text-sm"
              >
                ⚾ FCL Gameday
              </a>
              <div className="text-sm text-ink-4-3 italic">
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
          <div className="bg-deep text-ink p-4 mb-6 flex items-center justify-between">
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
              className="bg-panel text-signature px-6 py-2 font-semibold hover:bg-bone transition-colors"
            >
              Compare Players →
            </a>
          </div>
        )}

        <div className="bg-panel p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div>
              <label htmlFor="search-input" className="block text-sm font-medium text-ink-2 mb-2">
                Search Players
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

            {/* Team Filter */}
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
                {teams.map((team) => (
                  <option key={team} value={team}>
                    {team}
                  </option>
                ))}
              </select>
            </div>

            {/* Sort */}
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
              className="text-sm text-signature hover:underline"
            >
              {showAdvancedFilters ? '− Hide Advanced Filters' : '+ Show Advanced Filters'}
            </button>
          </div>

          {/* Advanced Filters */}
          {showAdvancedFilters && (
            <div className="mt-4 pt-4 border-t border-ink/20">
              <h3 className="text-sm font-semibold text-ink-2 mb-3">Advanced Filters</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* Age Range */}
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2">
                    Age Range
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      value={ageMin}
                      onChange={(e) => setAgeMin(e.target.value)}
                      className="w-full px-3 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink focus:bg-panel outline-none text-ink text-sm"
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      value={ageMax}
                      onChange={(e) => setAgeMax(e.target.value)}
                      className="w-full px-3 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink focus:bg-panel outline-none text-ink text-sm"
                    />
                  </div>
                </div>

                {/* Bat Speed Min */}
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2">
                    Min Bat Speed
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 72"
                    value={batSpeedMin}
                    onChange={(e) => setBatSpeedMin(e.target.value)}
                    className="w-full px-3 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink focus:bg-panel outline-none text-ink text-sm"
                  />
                </div>

                {/* Avg EV Min */}
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2">
                    Min Avg EV
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 90"
                    value={avgEvMin}
                    onChange={(e) => setAvgEvMin(e.target.value)}
                    className="w-full px-3 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink focus:bg-panel outline-none text-ink text-sm"
                  />
                </div>

                {/* Pull Air % Min */}
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2">
                    Min Pull Air %
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 25"
                    value={pullAirMin}
                    onChange={(e) => setPullAirMin(e.target.value)}
                    className="w-full px-3 py-2 bg-bone border-2 border-ink/20 focus:ring-2 focus:ring-ink/40 focus:border-ink focus:bg-panel outline-none text-ink text-sm"
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
                    className="w-full px-4 py-2 bg-bone text-ink-2 hover:bg-bone transition-colors text-sm font-medium"
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
          <div className="bg-panel p-8 text-center">
            <p className="text-ink-3-2 text-lg">No players found</p>
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
