'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import Link from 'next/link';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface HitterLine {
  ab: number; h: number; hr: number; rbi: number;
  bb: number; k: number; doubles: number; triples: number; sb: number;
}

interface EvData {
  avgEv: number; maxEv: number; hardHits: number; balls: number;
}

interface SpringHitter {
  playerId: number;
  name: string;
  team: string;
  opponent: string;
  isHome: boolean;
  gamePk: number;
  line: HitterLine | null;
  ev: EvData | null;
}

interface PitcherLine {
  ip: string; h: number; er: number; bb: number;
  k: number; hr: number; pitches: number; bf: number;
}

interface SpringPitcher {
  playerId: number;
  name: string;
  team: string;
  opponent: string;
  isHome: boolean;
  gamePk: number;
  line: PitcherLine | null;
  whiffs: number | null;
  velocity: number | null;
}

interface SpringGame {
  gamePk: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  sportId: number;
  seriesDescription?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function hitColor(h: number): string {
  if (h >= 4) return 'text-blue-400';
  if (h >= 3) return 'text-blue-300';
  if (h >= 2) return 'text-yellow-400';
  if (h >= 1) return 'text-ink-2';
  return 'text-red-400';
}

function evColor(ev: number): string {
  if (ev >= 100) return 'text-blue-400';
  if (ev >= 95) return 'text-yellow-400';
  if (ev >= 90) return 'text-ink-2';
  return 'text-ink-4';
}

function veloColor(v: number): string {
  if (v >= 100) return 'text-blue-400';
  if (v >= 97) return 'text-yellow-400';
  if (v >= 93) return 'text-ink-2';
  return 'text-ink-4';
}

function whiffColor(w: number): string {
  if (w >= 8) return 'text-blue-400';
  if (w >= 5) return 'text-yellow-400';
  if (w >= 2) return 'text-ink-2';
  return 'text-ink-4';
}

// ─── Games Scoreboard Strip ─────────────────────────────────────────────────────

function GamesStrip({
  games,
  selectedGamePk,
  onGameClick,
  onClearFilter,
}: {
  games: SpringGame[];
  selectedGamePk: number | null;
  onGameClick: (pk: number) => void;
  onClearFilter: () => void;
}) {
  if (games.length === 0) return null;

  return (
    <div className="bg-panel border-b border-blue-900/40">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider flex-shrink-0">
          Spring Breakout
        </span>
        {games.map(g => {
          const homeLogo = getMLBTeamLogoUrl(g.homeTeam);
          const awayLogo = getMLBTeamLogoUrl(g.awayTeam);
          const final = g.status.toLowerCase().includes('final') || g.status.toLowerCase().includes('game over');
          const isSelected = selectedGamePk === g.gamePk;
          return (
            <button
              key={g.gamePk}
              onClick={() => onGameClick(g.gamePk)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap flex-shrink-0 border transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-deep border-ink text-deep-fg'
                  : 'bg-bone border-transparent hover:border-ink hover:bg-bone text-ink-2'
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
        })}
        {selectedGamePk !== null && (
          <button
            onClick={onClearFilter}
            className="flex items-center gap-1 text-xs text-ink-4 hover:text-ink-2 px-2 py-1.5 hover:bg-bone transition-colors"
          >
            ✕ Show all
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Hitters Tab ───────────────────────────────────────────────────────────────

function HittersTab({
  date,
  selectedGamePk,
  onGamesLoaded,
}: {
  date: string;
  selectedGamePk: number | null;
  onGamesLoaded: (games: SpringGame[]) => void;
}) {
  const [data, setData] = useState<{ date: string; games: SpringGame[]; hitters: SpringHitter[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchDay = useCallback(async (d: string, silent = false) => {
    if (!silent) { setLoading(true); setError(null); setData(null); }
    try {
      const res = await fetch(`/api/spring-breakout-hitters?date=${d}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setData(json);
      setLastRefresh(new Date());
      onGamesLoaded(json.games ?? []);
    } catch (e: unknown) {
      if (!silent) setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [onGamesLoaded]);

  useEffect(() => { fetchDay(date); }, [date, fetchDay]);

  // Auto-refresh every 60s for live games
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

  const displayed = useMemo(() => {
    if (!data) return [];
    let list = data.hitters;
    if (selectedGamePk !== null) list = list.filter(h => h.gamePk === selectedGamePk);
    return list;
  }, [data, selectedGamePk]);

  if (loading) return (
    <div className="flex items-center justify-center py-16 gap-3 text-ink-4">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent animate-spin" />
      <span className="text-sm">Loading hitters for {date}…</span>
    </div>
  );

  if (error) return (
    <div className="py-10 text-center text-red-400 text-sm">{error}</div>
  );

  if (data && displayed.length === 0) return (
    <div className="py-14 text-center text-ink-4 text-sm">
      No Spring Breakout hitter data found for {date}.<br />
      <span className="text-xs text-ink-3">Spring Breakout typically runs mid-March. Try navigating to those dates.</span>
    </div>
  );

  if (!data) return null;

  return (
    <div>
      {lastRefresh && (
        <div className="px-4 py-2 text-xs text-ink-3 border-b border-ink/10">
          Updated {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {displayed.length} hitter{displayed.length !== 1 ? 's' : ''}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/20/60 bg-panel">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider">Hitter</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">Matchup</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-blue-400 uppercase tracking-wider">H ↓</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">AB</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">HR</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">RBI</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">BB</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">K</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">2B</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">SB</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-yellow-400 uppercase tracking-wider">Avg EV</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-yellow-400 uppercase tracking-wider">Max EV</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">Daily</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((h, idx) => {
              const line = h.line;
              const teamLogo = getMLBTeamLogoUrl(h.team);
              const oppLogo = getMLBTeamLogoUrl(h.opponent);
              return (
                <tr
                  key={`${h.playerId}-${idx}`}
                  className="border-b border-ink/10/60 hover:bg-bone/40 transition-colors"
                >
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

                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1 text-xs text-ink-3">
                      <span>{h.isHome ? 'vs' : '@'}</span>
                      {oppLogo && <img src={oppLogo} alt={h.opponent} className="w-4 h-4 object-contain" />}
                      <span className="font-semibold text-ink-2">{h.opponent}</span>
                    </div>
                  </td>

                  {line ? (
                    <>
                      <td className={`px-3 py-2.5 text-center font-bold ${hitColor(line.h)}`}>{line.h}</td>
                      <td className="px-3 py-2.5 text-center text-ink-2 font-semibold">{line.ab}</td>
                      <td className="px-3 py-2.5 text-center font-semibold text-ink-3">{line.hr || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-ink-3">{line.rbi || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-ink-3">{line.bb || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-ink-3">{line.k || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-ink-3">{line.doubles || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-ink-3">{line.sb || '—'}</td>
                    </>
                  ) : (
                    <td colSpan={8} className="px-3 py-2.5 text-center text-ink-2 text-xs italic">Stats pending</td>
                  )}

                  {/* EV from Savant */}
                  <td className={`px-3 py-2.5 text-center font-semibold text-xs ${h.ev ? evColor(h.ev.avgEv) : 'text-ink-2'}`}>
                    {h.ev ? `${h.ev.avgEv}` : '—'}
                  </td>
                  <td className={`px-3 py-2.5 text-center font-semibold text-xs ${h.ev ? evColor(h.ev.maxEv) : 'text-ink-2'}`}>
                    {h.ev ? `${h.ev.maxEv}` : '—'}
                  </td>

                  <td className="px-3 py-2.5 text-center">
                    <Link
                      href={`/player/${h.playerId}/daily?date=${date}`}
                      className="inline-block px-2.5 py-1 bg-panel hover:bg-bone border border-ink/20 hover:border-ink text-ink-3 hover:text-ink rounded text-xs font-semibold transition-colors"
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
    </div>
  );
}

// ─── Pitchers Tab ──────────────────────────────────────────────────────────────

function PitchersTab({
  date,
  selectedGamePk,
  onGamesLoaded,
}: {
  date: string;
  selectedGamePk: number | null;
  onGamesLoaded: (games: SpringGame[]) => void;
}) {
  const [data, setData] = useState<{ date: string; games: SpringGame[]; pitchers: SpringPitcher[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchDay = useCallback(async (d: string, silent = false) => {
    if (!silent) { setLoading(true); setError(null); setData(null); }
    try {
      const res = await fetch(`/api/spring-breakout-pitchers?date=${d}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setData(json);
      setLastRefresh(new Date());
      onGamesLoaded(json.games ?? []);
    } catch (e: unknown) {
      if (!silent) setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [onGamesLoaded]);

  useEffect(() => { fetchDay(date); }, [date, fetchDay]);

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

  const displayed = useMemo(() => {
    if (!data) return [];
    let list = data.pitchers;
    if (selectedGamePk !== null) list = list.filter(p => p.gamePk === selectedGamePk);
    return list;
  }, [data, selectedGamePk]);

  if (loading) return (
    <div className="flex items-center justify-center py-16 gap-3 text-ink-4">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent animate-spin" />
      <span className="text-sm">Loading pitchers for {date}…</span>
    </div>
  );

  if (error) return (
    <div className="py-10 text-center text-red-400 text-sm">{error}</div>
  );

  if (data && displayed.length === 0) return (
    <div className="py-14 text-center text-ink-4 text-sm">
      No Spring Breakout pitcher data found for {date}.<br />
      <span className="text-xs text-ink-3">Spring Breakout typically runs mid-March. Try navigating to those dates.</span>
    </div>
  );

  if (!data) return null;

  return (
    <div>
      {lastRefresh && (
        <div className="px-4 py-2 text-xs text-ink-3 border-b border-ink/10">
          Updated {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {displayed.length} pitcher{displayed.length !== 1 ? 's' : ''}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/20/60 bg-panel">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-4 uppercase tracking-wider">Pitcher</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">Matchup</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-blue-400 uppercase tracking-wider">K ↓</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">IP</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">H</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">ER</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">BB</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">HR</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">P</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-yellow-400 uppercase tracking-wider">Whiffs</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-yellow-400 uppercase tracking-wider">Top Velo</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-ink-4 uppercase tracking-wider">Daily</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((p, idx) => {
              const line = p.line;
              const teamLogo = getMLBTeamLogoUrl(p.team);
              const oppLogo = getMLBTeamLogoUrl(p.opponent);
              return (
                <tr
                  key={`${p.playerId}-${idx}`}
                  className="border-b border-ink/10/60 hover:bg-bone/40 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {teamLogo && <img src={teamLogo} alt={p.team} className="w-5 h-5 object-contain flex-shrink-0" />}
                      <div>
                        <Link
                          href={`/pitcher/${p.playerId}`}
                          className="text-ink font-semibold hover:text-blue-400 transition-colors text-sm"
                        >
                          {p.name}
                        </Link>
                        <div className="text-xs text-ink-3">{p.team}</div>
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1 text-xs text-ink-3">
                      <span>{p.isHome ? 'vs' : '@'}</span>
                      {oppLogo && <img src={oppLogo} alt={p.opponent} className="w-4 h-4 object-contain" />}
                      <span className="font-semibold text-ink-2">{p.opponent}</span>
                    </div>
                  </td>

                  {line ? (
                    <>
                      <td className="px-3 py-2.5 text-center font-bold text-blue-400">{line.k}</td>
                      <td className="px-3 py-2.5 text-center text-ink-2 font-semibold">{line.ip}</td>
                      <td className="px-3 py-2.5 text-center text-ink-3">{line.h}</td>
                      <td className="px-3 py-2.5 text-center text-ink-3">{line.er}</td>
                      <td className="px-3 py-2.5 text-center text-ink-3">{line.bb}</td>
                      <td className="px-3 py-2.5 text-center text-ink-3">{line.hr || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-ink-4 text-xs">{line.pitches || '—'}</td>
                    </>
                  ) : (
                    <td colSpan={7} className="px-3 py-2.5 text-center text-ink-2 text-xs italic">Stats pending</td>
                  )}

                  <td className={`px-3 py-2.5 text-center font-semibold text-xs ${p.whiffs != null ? whiffColor(p.whiffs) : 'text-ink-2'}`}>
                    {p.whiffs != null ? p.whiffs : '—'}
                  </td>
                  <td className={`px-3 py-2.5 text-center font-semibold text-xs ${p.velocity != null ? veloColor(p.velocity) : 'text-ink-2'}`}>
                    {p.velocity != null ? `${p.velocity.toFixed(1)}` : '—'}
                  </td>

                  <td className="px-3 py-2.5 text-center">
                    <Link
                      href={`/pitcher/${p.playerId}/daily?date=${date}`}
                      className="inline-block px-2.5 py-1 bg-panel hover:bg-bone border border-ink/20 hover:border-ink text-ink-3 hover:text-ink rounded text-xs font-semibold transition-colors"
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
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function SpringBreakoutPage() {
  const [date, setDate] = useState<string>(today());
  const [activeTab, setActiveTab] = useState<'hitters' | 'pitchers'>('hitters');
  const [games, setGames] = useState<SpringGame[]>([]);
  const [selectedGamePk, setSelectedGamePk] = useState<number | null>(null);

  const handleGamesLoaded = useCallback((g: SpringGame[]) => {
    setGames(prev => {
      // Merge: prefer the freshest data while keeping games from either tab
      if (g.length > 0) return g;
      return prev;
    });
  }, []);

  const shiftDate = (days: number) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + days);
    const next = d.toISOString().slice(0, 10);
    setDate(next);
    setSelectedGamePk(null);
    setGames([]);
  };

  const handleDateChange = (d: string) => {
    setDate(d);
    setSelectedGamePk(null);
    setGames([]);
  };

  const handleGameClick = (gamePk: number) => {
    setSelectedGamePk(prev => prev === gamePk ? null : gamePk);
  };

  // Detect live games
  const hasLive = games.some(g => {
    const s = g.status.toLowerCase();
    return !s.includes('final') && !s.includes('postponed') && !s.includes('cancelled') && !s.includes('scheduled');
  });

  return (
    <div className="min-h-screen bg-page">
      {/* Header */}
      <header className="bg-panel border-b border-blue-900/50">
        <div className="container mx-auto px-4 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <Link href="/" className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors">
                  ← Home
                </Link>
                <span className="text-ink-2">|</span>
                <h1 className="text-2xl font-bold text-ink">
                  🌱 Spring Breakout
                </h1>
                {hasLive && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 bg-red-600/20 border border-red-500/40 rounded text-[10px] text-red-400 font-bold uppercase tracking-wide">
                    <span className="w-1.5 h-1.5 bg-red-500 animate-pulse inline-block" />
                    Live
                  </span>
                )}
              </div>
              <p className="text-ink-4 text-xs mt-1">
                Daily hitter & pitcher cards from Spring Breakout games · Statcast data via Baseball Savant
              </p>
            </div>

            {/* Date picker */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => shiftDate(-1)}
                className="px-2 py-1.5 bg-panel hover:bg-bone border border-ink/20 hover:border-ink text-ink-2 hover:text-ink text-sm transition-colors"
                title="Previous day"
              >←</button>
              <input
                type="date"
                value={date}
                onChange={e => handleDateChange(e.target.value)}
                className="bg-panel text-ink border border-ink/20 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/40"
              />
              <button
                onClick={() => shiftDate(1)}
                className="px-2 py-1.5 bg-panel hover:bg-bone border border-ink/20 hover:border-ink text-ink-2 hover:text-ink text-sm transition-colors"
                title="Next day"
              >→</button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="container mx-auto px-4 py-6">
        <div className="bg-panel overflow-hidden border border-blue-900/40">

          {/* Games strip */}
          <GamesStrip
            games={games}
            selectedGamePk={selectedGamePk}
            onGameClick={handleGameClick}
            onClearFilter={() => setSelectedGamePk(null)}
          />

          {/* Tabs */}
          <div className="flex border-b border-ink/10 bg-page">
            <button
              onClick={() => setActiveTab('hitters')}
              className={`px-6 py-3 text-sm font-semibold transition-colors border-b-2 ${
                activeTab === 'hitters'
                  ? 'border-blue-400 text-blue-400'
                  : 'border-transparent text-ink-4 hover:text-ink-2'
              }`}
            >
              🏏 Hitters
            </button>
            <button
              onClick={() => setActiveTab('pitchers')}
              className={`px-6 py-3 text-sm font-semibold transition-colors border-b-2 ${
                activeTab === 'pitchers'
                  ? 'border-blue-400 text-blue-400'
                  : 'border-transparent text-ink-4 hover:text-ink-2'
              }`}
            >
              ⚾ Pitchers
            </button>
          </div>

          {/* Tab content — both tabs are always mounted so they can fetch independently */}
          <div className={activeTab === 'hitters' ? 'block' : 'hidden'}>
            <HittersTab
              date={date}
              selectedGamePk={selectedGamePk}
              onGamesLoaded={handleGamesLoaded}
            />
          </div>
          <div className={activeTab === 'pitchers' ? 'block' : 'hidden'}>
            <PitchersTab
              date={date}
              selectedGamePk={selectedGamePk}
              onGamesLoaded={handleGamesLoaded}
            />
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-6 text-xs text-ink-3 px-1">
          <div>
            <span className="font-semibold text-ink-4">Hitters EV colors: </span>
            <span className="text-blue-400">≥100 mph</span>
            {' · '}
            <span className="text-yellow-400">≥95</span>
            {' · '}
            <span className="text-ink-2">≥90</span>
          </div>
          <div>
            <span className="font-semibold text-ink-4">Pitcher velo: </span>
            <span className="text-blue-400">≥100 mph</span>
            {' · '}
            <span className="text-yellow-400">≥97</span>
            {' · '}
            <span className="text-ink-2">≥93</span>
          </div>
          <div>
            <span className="font-semibold text-ink-4">Whiffs: </span>
            <span className="text-blue-400">≥8</span>
            {' · '}
            <span className="text-yellow-400">≥5</span>
            {' · '}
            <span className="text-ink-2">≥2</span>
          </div>
          <div className="text-ink-2">EV & whiff data from Baseball Savant · Click a game to filter</div>
        </div>
      </div>
    </div>
  );
}
