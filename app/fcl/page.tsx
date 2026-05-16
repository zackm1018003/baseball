'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Pitch {
  pitchNumber:   number;
  pitchType:     string | null;
  pitchTypeCode: string | null;
  callCode:      string | null;
  callDesc:      string | null;
  isInPlay:      boolean;
  isBall:        boolean;
  isStrike:      boolean;
  startSpeed:    number | null;
  spinRate:      number | null;
  breakHoriz:    number | null;
  breakVert:     number | null;
  zone:          number | null;
  pX:            number | null;
  pZ:            number | null;
  szTop:         number | null;
  szBot:         number | null;
  launchSpeed:   number | null;
  launchAngle:   number | null;
  totalDistance: number | null;
  trajectory:    string | null;
  hardness:      string | null;
}

interface Play {
  atBatIndex:    number;
  inning:        number;
  halfInning:    string;
  isTopInning:   boolean;
  event:         string;
  eventType:     string;
  description:   string;
  rbi:           number;
  isOut:         boolean;
  isScoringPlay: boolean;
  awayScore:     number;
  homeScore:     number;
  balls:         number;
  strikes:       number;
  outs:          number;
  batter:        { id: number; name: string };
  pitcher:       { id: number; name: string };
  batSide:       string;
  pitchHand:     string;
  pitches:       Pitch[];
  launchSpeed:   number | null;
  launchAngle:   number | null;
  totalDistance: number | null;
  trajectory:    string | null;
}

interface TeamInfo { id: number; name: string; abbr: string; score: number; }
interface GameFeed {
  gamePk:      string;
  status:      string;
  inning:      number | null;
  halfInning:  string | null;
  away:        TeamInfo;
  home:        TeamInfo;
  dateTime:    string;
  plays:       Play[];
  hasStatcast: boolean;
}

interface ScheduleGame {
  gamePk:       number;
  status:       string;
  teams:        { away: { team: { id: number; name: string; abbreviation: string }; score?: number };
                  home: { team: { id: number; name: string; abbreviation: string }; score?: number } };
  gameDate:     string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PITCH_COLORS: Record<string, string> = {
  'FF': '#e63946', // 4-seam  red
  'SI': '#f4a261', // sinker  orange
  'FC': '#e9c46a', // cutter  yellow
  'SL': '#2a9d8f', // slider  teal
  'CU': '#457b9d', // curve   blue
  'CH': '#6a4c93', // change  purple
  'KC': '#8ecae6', // knuckle-curve
  'FS': '#a8dadc', // splitter
  'default': '#94a3b8',
};

function pitchColor(code: string | null) {
  if (!code) return PITCH_COLORS.default;
  return PITCH_COLORS[code] ?? PITCH_COLORS.default;
}

function eventColor(event: string): string {
  if (!event) return '#6b7280';
  const e = event.toLowerCase();
  if (e.includes('home run'))     return '#f59e0b';
  if (e.includes('triple'))       return '#10b981';
  if (e.includes('double'))       return '#3b82f6';
  if (e.includes('single'))       return '#22c55e';
  if (e.includes('walk') || e.includes('hit by pitch')) return '#8b5cf6';
  if (e.includes('strikeout'))    return '#ef4444';
  if (e.includes('error'))        return '#f97316';
  return '#9ca3af';
}

function trajectoryLabel(traj: string | null): string {
  if (!traj) return '';
  const map: Record<string, string> = {
    ground_ball: 'Ground Ball', fly_ball: 'Fly Ball',
    line_drive: 'Line Drive', popup: 'Pop Up', bunt_grounder: 'Bunt',
  };
  return map[traj] ?? traj;
}

function evQuality(ev: number): string {
  if (ev >= 100) return '#16a34a';
  if (ev >= 90)  return '#84cc16';
  if (ev >= 80)  return '#ca8a04';
  return '#ef4444';
}

function laLabel(angle: number): string {
  if (angle >= 25 && angle <= 50) return '↑ Fly Ball zone';
  if (angle >= 10 && angle < 25)  return '↑ Line drive zone';
  if (angle < 10 && angle >= -10) return '→ Ground ball';
  if (angle > 50)                 return '↑↑ Pop-up';
  return '↓ Under';
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ─── Strike Zone SVG ─────────────────────────────────────────────────────────
// pX range: -1.5 to 1.5 ft  (positive = right from catcher's view)
// pZ range: 1.0 to 4.5 ft

const SZ_W = 180;  // SVG width px
const SZ_H = 200;  // SVG height px
const PAD  = 24;   // padding

function xToSvg(px: number) {
  // pX -1.5 → PAD, pX +1.5 → SZ_W - PAD
  return PAD + ((px + 1.5) / 3.0) * (SZ_W - 2 * PAD);
}
function zToSvg(pz: number) {
  // pZ 4.5 → PAD (top), pZ 1.0 → SZ_H - PAD (bottom)
  return PAD + ((4.5 - pz) / 3.5) * (SZ_H - 2 * PAD);
}

function StrikeZone({ pitches, szTop, szBot }: {
  pitches: Pitch[];
  szTop: number;
  szBot: number;
}) {
  // Strike zone in SVG coords
  const zoneLeft  = xToSvg(-0.708);   // half plate width = 8.5/12 = ~0.708 ft
  const zoneRight = xToSvg(0.708);
  const zoneTop   = zToSvg(szTop || 3.5);
  const zoneBot   = zToSvg(szBot || 1.6);

  // 3×3 grid lines
  const thirdW = (zoneRight - zoneLeft) / 3;
  const thirdH = (zoneBot - zoneTop) / 3;

  return (
    <svg width={SZ_W} height={SZ_H} style={{ background: '#0a0a0a', borderRadius: 8 }}>
      {/* Strike zone box */}
      <rect x={zoneLeft} y={zoneTop} width={zoneRight - zoneLeft} height={zoneBot - zoneTop}
        fill="none" stroke="#3f3f46" strokeWidth={1.5} />
      {/* 3×3 grid */}
      {[1, 2].map(i => (
        <g key={i}>
          <line x1={zoneLeft + thirdW * i} y1={zoneTop}
                x2={zoneLeft + thirdW * i} y2={zoneBot} stroke="#27272a" strokeWidth={1} />
          <line x1={zoneLeft} y1={zoneTop + thirdH * i}
                x2={zoneRight} y2={zoneTop + thirdH * i} stroke="#27272a" strokeWidth={1} />
        </g>
      ))}
      {/* Home plate outline */}
      <rect x={xToSvg(-0.708)} y={SZ_H - PAD + 2} width={zoneRight - zoneLeft} height={6}
        fill="#27272a" rx={1} />

      {/* Pitches */}
      {pitches.map((p, i) => {
        if (p.pX == null || p.pZ == null) return null;
        const cx = xToSvg(p.pX);
        const cy = zToSvg(p.pZ);
        const col = pitchColor(p.pitchTypeCode);
        const isLast = i === pitches.length - 1;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={isLast ? 9 : 7}
              fill={col} fillOpacity={0.85} stroke={isLast ? '#fff' : 'none'} strokeWidth={1.5} />
            <text x={cx} y={cy + 4} textAnchor="middle"
              fontSize={isLast ? 9 : 8} fill="#fff" fontWeight="bold">
              {p.pitchNumber}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── At-Bat Detail Card ───────────────────────────────────────────────────────

function AtBatCard({ play, away, home, onClose }: {
  play: Play;
  away: TeamInfo;
  home: TeamInfo;
  onClose: () => void;
}) {
  const hasStatcast = play.launchSpeed != null;
  const pitchesWithPx = play.pitches.filter(p => p.pX != null);
  const szTop = pitchesWithPx[0]?.szTop ?? 3.5;
  const szBot = pitchesWithPx[0]?.szBot ?? 1.6;
  const lastPitch = play.pitches[play.pitches.length - 1];

  const inningLabel = `${play.isTopInning ? 'Top' : 'Bot'} ${play.inning}`;
  const scoreLabel  = `${away.abbr} ${play.awayScore}, ${home.abbr} ${play.homeScore}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="bg-[#111] border border-[#2a2a2a] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#222]">
          <span className="text-xs font-bold text-ink-3">At Bat Details</span>
          <button onClick={onClose} className="text-ink-4 hover:text-white text-sm">✕</button>
        </div>

        {/* Context */}
        <div className="px-4 py-2 border-b border-[#1a1a1a] flex gap-3 text-xs text-ink-4">
          <span>{inningLabel}</span>
          <span>|</span>
          <span>{scoreLabel}</span>
        </div>

        {/* Result */}
        <div className="px-4 pt-3 pb-2">
          <div className="text-xl font-bold" style={{ color: eventColor(play.event) }}>
            {play.event}
          </div>
          <p className="text-ink-2 text-sm mt-1 leading-snug">{play.description}</p>
        </div>

        {/* Statcast stats */}
        {hasStatcast && (
          <div className="mx-4 mb-3 grid grid-cols-3 gap-2">
            <div className="bg-[#1a1a1a] rounded-xl p-3 text-center">
              <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Exit Velo</div>
              <div className="text-lg font-bold font-mono"
                style={{ color: evQuality(play.launchSpeed!) }}>
                {play.launchSpeed?.toFixed(1)}
              </div>
              <div className="text-[10px] text-ink-5">mph</div>
            </div>
            <div className="bg-[#1a1a1a] rounded-xl p-3 text-center">
              <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Distance</div>
              <div className="text-lg font-bold font-mono text-gray-200">
                {play.totalDistance ? `${play.totalDistance}` : '—'}
              </div>
              <div className="text-[10px] text-ink-5">ft</div>
            </div>
            <div className="bg-[#1a1a1a] rounded-xl p-3 text-center">
              <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Launch Ang</div>
              <div className="text-lg font-bold font-mono text-gray-200">
                {play.launchAngle != null ? `${play.launchAngle}°` : '—'}
              </div>
              <div className="text-[10px] text-ink-5"
                style={{ color: play.launchAngle != null && play.launchAngle >= 10 && play.launchAngle <= 50 ? '#22c55e' : '#6b7280' }}>
                {play.launchAngle != null ? laLabel(play.launchAngle) : ''}
              </div>
            </div>
          </div>
        )}

        {/* Trajectory badge */}
        {play.trajectory && (
          <div className="px-4 mb-3">
            <span className="text-xs bg-[#1e1e1e] border border-[#333] rounded-full px-3 py-1 text-ink-3">
              {trajectoryLabel(play.trajectory)}
            </span>
          </div>
        )}

        {/* Matchup + count */}
        <div className="px-4 pb-3 flex items-center gap-3 border-b border-[#1a1a1a]">
          <div className="text-center">
            <div className="w-10 h-10 rounded-full bg-[#1e1e1e] flex items-center justify-center text-lg mb-1">⚾</div>
            <div className="text-xs text-ink-2 font-medium">{play.pitcher.name}</div>
            <div className="text-[10px] text-ink-5">{play.pitchHand}HP</div>
          </div>
          <div className="flex-1 text-center">
            <div className="text-xs text-ink-4 mb-1">
              {play.balls}-{play.strikes}, {play.outs} out{play.outs !== 1 ? 's' : ''}
            </div>
            {/* Count dots */}
            <div className="flex justify-center gap-1.5">
              {[0,1,2].map(i => (
                <div key={i} className="w-3 h-3 rounded-full border border-[#555]"
                  style={{ background: i < play.balls ? '#22c55e' : 'transparent' }} />
              ))}
              {[0,1].map(i => (
                <div key={i} className="w-3 h-3 rounded-full border border-[#555]"
                  style={{ background: i < play.strikes ? '#ef4444' : 'transparent' }} />
              ))}
            </div>
          </div>
          <div className="text-center">
            <div className="w-10 h-10 rounded-full bg-[#1e1e1e] flex items-center justify-center text-lg mb-1">🧢</div>
            <div className="text-xs text-ink-2 font-medium">{play.batter.name.split(' ').pop()}</div>
            <div className="text-[10px] text-ink-5">{play.batSide}HB</div>
          </div>
        </div>

        {/* Pitch sequence table */}
        {play.pitches.length > 0 && (
          <div className="px-4 py-3 border-b border-[#1a1a1a]">
            <div className="text-[10px] text-ink-5 uppercase tracking-widest mb-2">Pitch Sequence</div>
            <div className="space-y-1">
              {play.pitches.map(p => (
                <div key={p.pitchNumber} className="flex items-center gap-2 text-xs">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-ink flex-shrink-0"
                    style={{ background: pitchColor(p.pitchTypeCode) }}>
                    {p.pitchNumber}
                  </div>
                  <span className="text-ink-3 w-28 truncate">{p.pitchType ?? '—'}</span>
                  <span className="text-ink-2 font-mono w-14">
                    {p.startSpeed ? `${p.startSpeed} mph` : '—'}
                  </span>
                  <span className="text-ink-4 w-24 truncate">{p.callDesc ?? '—'}</span>
                  {p.isInPlay && p.launchSpeed && (
                    <span className="ml-auto text-[10px] font-mono"
                      style={{ color: evQuality(p.launchSpeed) }}>
                      {p.launchSpeed.toFixed(0)} mph EV
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Spin & movement for last pitch */}
        {lastPitch?.startSpeed && lastPitch.spinRate && (
          <div className="px-4 py-3 border-b border-[#1a1a1a] flex gap-4 text-xs">
            <div>
              <span className="text-ink-4">Spin Rate </span>
              <span className="text-gray-200 font-mono font-bold">{lastPitch.spinRate} rpm</span>
            </div>
            {lastPitch.breakVert != null && (
              <div>
                <span className="text-ink-4">iVB </span>
                <span className="text-gray-200 font-mono font-bold">{lastPitch.breakVert.toFixed(1)}&quot;</span>
              </div>
            )}
            {lastPitch.breakHoriz != null && (
              <div>
                <span className="text-ink-4">HB </span>
                <span className="text-gray-200 font-mono font-bold">{lastPitch.breakHoriz.toFixed(1)}&quot;</span>
              </div>
            )}
          </div>
        )}

        {/* Strike zone */}
        {pitchesWithPx.length > 0 && (
          <div className="flex flex-col items-center py-3">
            <div className="text-[10px] text-ink-5 uppercase tracking-widest mb-2">Pitch Location</div>
            <StrikeZone pitches={pitchesWithPx} szTop={szTop} szBot={szBot} />
            {/* Legend */}
            <div className="flex flex-wrap gap-2 mt-2 px-4 justify-center">
              {[...new Map(pitchesWithPx.map(p => [p.pitchTypeCode, p])).values()].map(p => (
                <div key={p.pitchTypeCode} className="flex items-center gap-1 text-[10px] text-ink-4">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: pitchColor(p.pitchTypeCode) }} />
                  {p.pitchType ?? '—'}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Play Row ─────────────────────────────────────────────────────────────────

function PlayRow({ play, onClick }: { play: Play; onClick: () => void }) {
  const hasData = play.launchSpeed != null;
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2.5 border-b border-[#1a1a1a] hover:bg-[#161616] cursor-pointer transition-colors"
    >
      {/* Inning badge */}
      <div className="w-10 text-center flex-shrink-0">
        <div className="text-[10px] text-ink-5">{play.isTopInning ? '▲' : '▼'}{play.inning}</div>
      </div>

      {/* Result dot */}
      <div className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: eventColor(play.event) }} />

      {/* Batter + event */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink font-medium truncate">{play.batter.name}</div>
        <div className="text-xs truncate" style={{ color: eventColor(play.event) }}>
          {play.event}
          {play.isScoringPlay && <span className="ml-1 text-amber-400">★</span>}
        </div>
      </div>

      {/* Statcast pill */}
      {hasData ? (
        <div className="flex gap-2 text-xs font-mono flex-shrink-0">
          <span style={{ color: evQuality(play.launchSpeed!) }}>
            {play.launchSpeed?.toFixed(0)} mph
          </span>
          {play.launchAngle != null && (
            <span className="text-ink-4">{play.launchAngle}°</span>
          )}
        </div>
      ) : (
        <div className="text-xs text-ink-5 flex-shrink-0 font-mono">
          {play.pitches.length > 0 ? `${play.pitches.length}p` : ''}
        </div>
      )}

      <div className="text-ink-5 text-xs flex-shrink-0">›</div>
    </div>
  );
}

// ─── Game Panel ───────────────────────────────────────────────────────────────

function GamePanel({ gamePk, onBack }: { gamePk: number; onBack: () => void }) {
  const [game, setGame]     = useState<GameFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [selectedPlay, setSelectedPlay] = useState<Play | null>(null);
  const [inningFilter, setInningFilter] = useState<number | 'all'>('all');

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/fcl-game?mode=game&gamePk=${gamePk}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setGame(d); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [gamePk]);

  if (loading) return (
    <div className="flex items-center justify-center h-64 gap-3">
      <div className="w-5 h-5 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
      <span className="text-ink-4 text-sm">Loading game data…</span>
    </div>
  );
  if (error) return <div className="p-6 text-red-500 text-sm">{error}</div>;
  if (!game)  return null;

  // Filter to at-bats only (skip non-pitching events)
  const plays = game.plays.filter(p => p.pitches.length > 0 || p.event);
  const innings = [...new Set(plays.map(p => p.inning))].sort((a, b) => a - b);
  const filtered = inningFilter === 'all' ? plays : plays.filter(p => p.inning === inningFilter);
  const statcastCount = plays.filter(p => p.launchSpeed != null).length;

  return (
    <div>
      {/* Game header */}
      <div className="bg-[#141414] border border-[#222] rounded-xl mb-4 p-4">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onBack} className="text-ink-4 hover:text-white text-sm">← Games</button>
          <div className="text-xs text-ink-5 ml-auto">
            {game.status}
            {game.hasStatcast && (
              <span className="ml-2 text-green-600">● Statcast</span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-center">
            <div className="text-sm font-bold text-ink-2">{game.away.abbr}</div>
            <div className="text-3xl font-bold font-mono text-ink mt-1">{game.away.score}</div>
          </div>
          <div className="text-center text-ink-5 text-xs">
            {game.inning != null ? `${game.halfInning?.slice(0,3)} ${game.inning}` : 'Final'}
          </div>
          <div className="text-center">
            <div className="text-sm font-bold text-ink-2">{game.home.abbr}</div>
            <div className="text-3xl font-bold font-mono text-ink mt-1">{game.home.score}</div>
          </div>
        </div>
        {game.hasStatcast && (
          <div className="mt-2 text-center text-[10px] text-ink-5">
            {statcastCount} plays with exit velocity data
          </div>
        )}
      </div>

      {/* Inning filter */}
      <div className="flex gap-1 flex-wrap mb-3">
        <button
          onClick={() => setInningFilter('all')}
          className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
            inningFilter === 'all' ? 'bg-white text-black' : 'bg-[#1c1c1c] text-ink-3 hover:text-white'
          }`}
        >All</button>
        {innings.map(inn => (
          <button
            key={inn}
            onClick={() => setInningFilter(inn)}
            className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
              inningFilter === inn ? 'bg-white text-black' : 'bg-[#1c1c1c] text-ink-3 hover:text-white'
            }`}
          >{inn}</button>
        ))}
      </div>

      {/* Play list */}
      <div className="bg-[#141414] border border-[#222] rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-ink-5 text-sm">No plays available</div>
        ) : (
          filtered.map(play => (
            <PlayRow key={play.atBatIndex} play={play} onClick={() => setSelectedPlay(play)} />
          ))
        )}
      </div>

      {/* At-bat detail modal */}
      {selectedPlay && (
        <AtBatCard
          play={selectedPlay}
          away={game.away}
          home={game.home}
          onClose={() => setSelectedPlay(null)}
        />
      )}
    </div>
  );
}

// ─── Schedule Card ────────────────────────────────────────────────────────────

function ScheduleCard({ game, onClick }: {
  game: ScheduleGame;
  onClick: () => void;
}) {
  const isFinal    = game.status === 'Final';
  const isLive     = game.status === 'In Progress';
  const isUpcoming = !isFinal && !isLive;
  const away = game.teams.away;
  const home = game.teams.home;
  const time = new Date(game.gameDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <div
      onClick={onClick}
      className="bg-[#141414] border border-[#222] rounded-xl p-4 cursor-pointer hover:border-[#333] hover:bg-[#181818] transition-all"
    >
      <div className="flex items-center gap-3">
        {/* Away */}
        <div className="flex-1 text-right">
          <div className="text-sm font-bold text-gray-200">{away.team.abbreviation}</div>
          {!isUpcoming && <div className="text-2xl font-bold font-mono text-ink">{away.score ?? 0}</div>}
        </div>

        {/* Center */}
        <div className="text-center w-16">
          {isUpcoming && <div className="text-xs text-ink-4">{time}</div>}
          {isLive     && <div className="text-xs text-green-500 font-bold animate-pulse">LIVE</div>}
          {isFinal    && <div className="text-xs text-ink-5">Final</div>}
          <div className="text-ink-5 text-xs mt-0.5">@</div>
        </div>

        {/* Home */}
        <div className="flex-1">
          <div className="text-sm font-bold text-gray-200">{home.team.abbreviation}</div>
          {!isUpcoming && <div className="text-2xl font-bold font-mono text-ink">{home.score ?? 0}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FCLPage() {
  const [dates, setDates]           = useState<string[]>([]);
  const [selectedDate, setDate]     = useState('');
  const [games, setGames]           = useState<ScheduleGame[]>([]);
  const [schedLoading, setSchedLoad]= useState(true);
  const [selectedGame, setSelectedGame] = useState<number | null>(null);

  // Build date range (last 14 days + today)
  useEffect(() => {
    const today = new Date();
    const arr: string[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      arr.push(d.toISOString().slice(0, 10));
    }
    setDates(arr);
    setDate(arr[arr.length - 1]); // today
  }, []);

  const loadSchedule = useCallback((date: string) => {
    if (!date) return;
    setSchedLoad(true);
    fetch(`/api/fcl-game?mode=schedule&startDate=${date}&endDate=${date}`)
      .then(r => r.json())
      .then(d => {
        const dayGames = (d.dates?.[0]?.games ?? []).map((g: Record<string, unknown>) => ({
          gamePk: g.gamePk,
          status: (g.status as Record<string, unknown>)?.detailedState ?? '',
          gameDate: g.gameDate,
          teams: g.teams,
        }));
        setGames(dayGames);
      })
      .catch(() => setGames([]))
      .finally(() => setSchedLoad(false));
  }, []);

  useEffect(() => {
    if (selectedDate) loadSchedule(selectedDate);
  }, [selectedDate, loadSchedule]);

  if (selectedGame) {
    return (
      <div className="min-h-screen bg-[#0c0c0c] text-ink">
        <div className="max-w-lg mx-auto px-4 py-6">
          <GamePanel gamePk={selectedGame} onBack={() => setSelectedGame(null)} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-ink">
      <div className="max-w-lg mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/overslot" className="text-ink-4 hover:text-white text-sm">← Stats</Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold">FCL Gameday</h1>
            <p className="text-ink-4 text-xs mt-0.5">Florida Complex League · MLB Stats API</p>
          </div>
        </div>

        {/* Date picker */}
        <div className="flex gap-1 overflow-x-auto pb-2 mb-5 scrollbar-none">
          {dates.map(d => {
            const label = new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const isToday = d === dates[dates.length - 1];
            return (
              <button
                key={d}
                onClick={() => setDate(d)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  d === selectedDate
                    ? 'bg-white text-black'
                    : 'bg-[#1c1c1c] text-ink-3 hover:text-white'
                }`}
              >
                {isToday ? 'Today' : label}
              </button>
            );
          })}
        </div>

        {/* Date label */}
        <div className="text-sm text-ink-4 mb-3">
          {selectedDate && formatDate(selectedDate + 'T12:00:00')}
        </div>

        {/* Games */}
        {schedLoading ? (
          <div className="flex items-center justify-center h-32 gap-3">
            <div className="w-4 h-4 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
            <span className="text-ink-5 text-sm">Loading…</span>
          </div>
        ) : games.length === 0 ? (
          <div className="text-center py-16 text-ink-5">
            <div className="text-4xl mb-3">⚾</div>
            <p>No FCL games on {selectedDate && formatDate(selectedDate + 'T12:00:00')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {games.map(g => (
              <ScheduleCard
                key={g.gamePk}
                game={g}
                onClick={() => setSelectedGame(g.gamePk)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
