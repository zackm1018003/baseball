'use client';

import { use, useState, useEffect, useCallback } from 'react';
import { getPitcherById, getPitcherByName } from '@/lib/pitcher-database';
import { DEFAULT_DATASET_ID, DATASETS } from '@/lib/datasets';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import Image from 'next/image';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DailyPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string }>;
}

interface PitchType {
  name: string;
  count: number;
  usage: number;
  velo: number | null;
  spin: number | null;
  h_movement: number | null;
  v_movement: number | null;
  vaa: number | null;
  whiff: number | null;
  whiffs: number;
}

interface GameLine {
  date: string;
  ip: string;
  h: number;
  er: number;
  bb: number;
  k: number;
  hr: number;
  pitches: number;
  strikes: number;
  bf: number;
  era: string | null;
}

interface GameInfo {
  gamePk: number | null;
  opponent: string | null;
  opponentFull: string | null;
  team: string | null;
  isHome: boolean | null;
  date: string;
}

interface RawDot {
  hb: number;
  ivb: number;
  pitchType: string;
  px: number | null;
  pz: number | null;
  isWhiff: boolean;
}

interface PitchData {
  totalPitches: number;
  pitchTypes: PitchType[];
  rawDots: RawDot[];
  armAngle: number | null;
  strikePct: number | null;
  swingAndMissPct: number | null;
  totalWhiffs: number;
}

interface AvailableDate {
  date: string;
  opponent: string;
  ip: string;
  er: number;
  k: number;
  gamePk?: number;
}

interface DailyData {
  playerId: number;
  playerName: string | null;
  date: string;
  gameLine: GameLine;
  gameInfo: GameInfo;
  pitchData: PitchData | null;
  availableDates: AvailableDate[];
}

// ─── Pitch colors (match season card) ────────────────────────────────────────

const PITCH_COLORS: Record<string, { color: string; bg: string; text: string }> = {
  '4-Seam Fastball': { color: '#D22D49', bg: '#D22D49', text: '#fff' },
  'Sinker':          { color: '#C75B12', bg: '#C75B12', text: '#fff' },
  'Cutter':          { color: '#933F2C', bg: '#933F2C', text: '#fff' },
  'Changeup':        { color: '#3BBB38', bg: '#3BBB38', text: '#fff' },
  'Splitter':        { color: '#1A8B6E', bg: '#1A8B6E', text: '#fff' },
  'Curveball':       { color: '#00D1ED', bg: '#00D1ED', text: '#333' },
  'Knuckle Curve':   { color: '#6236CD', bg: '#6236CD', text: '#fff' },
  'Slider':          { color: '#EFE514', bg: '#EFE514', text: '#333' },
  'Sweeper':         { color: '#E66B22', bg: '#E66B22', text: '#fff' },
  'Slurve':          { color: '#3B44CE', bg: '#3B44CE', text: '#fff' },
};

const PITCH_SHORT: Record<string, string> = {
  '4-Seam Fastball': 'FF', 'Sinker': 'SI', 'Cutter': 'FC',
  'Changeup': 'CH', 'Splitter': 'FS', 'Curveball': 'CU',
  'Knuckle Curve': 'KC', 'Slider': 'SL', 'Sweeper': 'ST', 'Slurve': 'SV',
};

function pitchColors(name: string) {
  return PITCH_COLORS[name] || { color: '#888', bg: '#888', text: '#fff' };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseIp(ip: string): number {
  if (!ip) return 0;
  const parts = ip.split('.');
  return (parseInt(parts[0]) || 0) + (parseInt(parts[1]) || 0) / 3;
}

function ipQualityLabel(ip: string): { label: string; color: string } {
  const n = parseIp(ip);
  if (n >= 7) return { label: 'Complete Game / Deep', color: '#22c55e' };
  if (n >= 6) return { label: 'Quality Start',        color: '#86efac' };
  if (n >= 5) return { label: 'Solid Outing',         color: '#fbbf24' };
  if (n >= 3) return { label: 'Mediocre',             color: '#fb923c' };
  return           { label: 'Short Outing',           color: '#f87171' };
}


function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Pitch Location Chart — catcher's POV, strike zone overlay ───────────────

function PitchLocationChart({ rawDots }: { rawDots: RawDot[] }) {
  // Filter to dots with valid plate location
  const dots = rawDots.filter(d => d.px !== null && d.pz !== null);
  if (dots.length === 0) return null;

  const size = 320;
  // Display window: ±2.5 ft horizontal, 0–5 ft vertical (catcher POV)
  const xMin = -2.5, xMax = 2.5;
  const zMin = 0,    zMax = 5;
  const pad = 28;
  const w = size - pad * 2;
  const h = size - pad * 2;

  const toSvgX = (px: number) => pad + ((px - xMin) / (xMax - xMin)) * w;
  const toSvgY = (pz: number) => pad + ((zMax - pz) / (zMax - zMin)) * h;

  // Strike zone: ~17in wide (0.708 ft each side), bottom ~1.5ft, top ~3.5ft (avg)
  const szLeft  = toSvgX(-0.708);
  const szRight = toSvgX(0.708);
  const szTop   = toSvgY(3.5);
  const szBot   = toSvgY(1.5);

  // Inner thirds grid
  const thirdW = (szRight - szLeft) / 3;
  const thirdH = (szBot - szTop) / 3;

  return (
    <div className="flex flex-col items-center">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Pitch Location (Catcher&apos;s View)
      </h3>
      <svg width={size} height={size} className="bg-[#1a2940] rounded-lg">
        {/* Outer shadow zone (~1 ball outside) */}
        <rect
          x={szLeft - 8} y={szTop - 8}
          width={szRight - szLeft + 16} height={szBot - szTop + 16}
          fill="none" stroke="#2a3f58" strokeWidth="1" strokeDasharray="3,3"
        />

        {/* Strike zone box */}
        <rect
          x={szLeft} y={szTop}
          width={szRight - szLeft} height={szBot - szTop}
          fill="rgba(255,255,255,0.04)" stroke="#4a6a88" strokeWidth="1.5"
        />

        {/* Inner thirds grid */}
        {[1, 2].map(i => (
          <g key={i}>
            <line x1={szLeft + thirdW * i} y1={szTop} x2={szLeft + thirdW * i} y2={szBot} stroke="#2a3f58" strokeWidth="0.8" />
            <line x1={szLeft} y1={szTop + thirdH * i} x2={szRight} y2={szTop + thirdH * i} stroke="#2a3f58" strokeWidth="0.8" />
          </g>
        ))}

        {/* Home plate shape at bottom */}
        <polygon
          points={`${toSvgX(-0.708)},${size - pad + 6} ${toSvgX(0.708)},${size - pad + 6} ${toSvgX(0.708)},${size - pad + 12} ${toSvgX(0)},${size - pad + 18} ${toSvgX(-0.708)},${size - pad + 12}`}
          fill="#334" stroke="#556" strokeWidth="1"
        />

        {/* Axis labels */}
        <text x={pad} y={pad - 8} fontSize="8" fill="#5a7a94" textAnchor="middle">← 1B</text>
        <text x={size - pad} y={pad - 8} fontSize="8" fill="#5a7a94" textAnchor="middle">3B →</text>

        {/* Pitch dots */}
        {dots.map((dot, i) => {
          const cx = toSvgX(dot.px!);
          const cy = toSvgY(dot.pz!);
          const col = pitchColors(dot.pitchType).color;
          if (dot.isWhiff) {
            // X mark for whiffs
            const s = 4;
            return (
              <g key={i}>
                <line x1={cx - s} y1={cy - s} x2={cx + s} y2={cy + s} stroke={col} strokeWidth="2" opacity="0.9" />
                <line x1={cx + s} y1={cy - s} x2={cx - s} y2={cy + s} stroke={col} strokeWidth="2" opacity="0.9" />
              </g>
            );
          }
          return <circle key={i} cx={cx} cy={cy} r="4" fill={col} opacity="0.65" />;
        })}

        {/* Legend: dot = pitch, X = whiff */}
        <circle cx={pad + 6} cy={size - 10} r="3" fill="#888" opacity="0.8" />
        <text x={pad + 12} y={size - 7} fontSize="8" fill="#5a7a94">pitch</text>
        <line x1={pad + 42} y1={size - 13} x2={pad + 48} y2={size - 7} stroke="#ccc" strokeWidth="1.5" />
        <line x1={pad + 48} y1={size - 13} x2={pad + 42} y2={size - 7} stroke="#ccc" strokeWidth="1.5" />
        <text x={pad + 52} y={size - 7} fontSize="8" fill="#5a7a94">whiff</text>
      </svg>
    </div>
  );
}

// ─── Pitch Movement Chart — one dot per actual pitch ─────────────────────────

function PitchMovementChart({ rawDots, throws, armAngle }: { rawDots: RawDot[]; throws?: string; armAngle?: number }) {
  const size = 400;
  const center = size / 2;
  const maxInches = 24;
  const scale = (center - 30) / maxInches;

  const armLine = armAngle !== undefined ? (() => {
    const angleRad = (armAngle * Math.PI) / 180;
    const dir = throws === 'L' ? -1 : 1;
    const len = size * 0.45;
    const dx = dir * Math.cos(angleRad) * len;
    const dy = Math.sin(angleRad) * len;
    return { x1: center, y1: center, x2: center + dx, y2: center - dy };
  })() : null;

  return (
    <div className="flex justify-center">
      <svg width={size} height={size} className="bg-[#1a2940] rounded-lg">
        {/* Grid lines */}
        <line x1={center} y1={20} x2={center} y2={size - 20} stroke="#3a4f66" strokeWidth="1" />
        <line x1={20} y1={center} x2={size - 20} y2={center} stroke="#3a4f66" strokeWidth="1" />

        {/* Concentric guides with inch labels */}
        {[6, 12, 18, 24].map(inches => (
          <g key={inches}>
            <circle cx={center} cy={center} r={inches * scale}
              fill="none" stroke="#3a4f66" strokeWidth="0.5" strokeDasharray="3,3" />
            <text x={center + inches * scale + 2} y={center - 3} fontSize="8" fill="#5a7a94">{inches}&quot;</text>
            <text x={center - inches * scale - 2} y={center - 3} fontSize="8" fill="#5a7a94" textAnchor="end">{inches}&quot;</text>
            <text x={center + 3} y={center - inches * scale + 3} fontSize="8" fill="#5a7a94">{inches}&quot;</text>
            <text x={center + 3} y={center + inches * scale + 3} fontSize="8" fill="#5a7a94">{inches}&quot;</text>
          </g>
        ))}

        {/* Arm angle line */}
        {armLine && (
          <>
            <line
              x1={armLine.x1} y1={armLine.y1}
              x2={armLine.x2} y2={armLine.y2}
              stroke="#c0c8d4" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.6"
            />
            <text
              x={armLine.x2 + (throws === 'L' ? -4 : 4)}
              y={armLine.y2 - 6}
              textAnchor={throws === 'L' ? 'end' : 'start'}
              fontSize="10" fill="#c0c8d4" opacity="0.8"
            >
              {armAngle?.toFixed(0)}°
            </text>
          </>
        )}

        {/* Axis labels */}
        <text x={center} y={15} textAnchor="middle" fontSize="9" fill="#7a8fa5">Induced Vertical Break (in)</text>
        <text x={size - 5} y={center - 5} textAnchor="end" fontSize="9" fill="#7a8fa5">
          {throws === 'R' ? 'Arm Side →' : '← Arm Side'}
        </text>
        <text x={5} y={center - 5} textAnchor="start" fontSize="9" fill="#7a8fa5">
          {throws === 'R' ? '← Glove Side' : 'Glove Side →'}
        </text>

        {/* One dot per actual pitch */}
        {rawDots.map((dot, i) => (
          <circle
            key={i}
            cx={center + dot.hb * scale}
            cy={center - dot.ivb * scale}
            r="4"
            fill={pitchColors(dot.pitchType).color}
            opacity="0.75"
          />
        ))}
      </svg>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PitcherDailyPage({ params, searchParams }: DailyPageProps) {
  const { id } = use(params);
  const { date: initialDate } = use(searchParams);

  const [selectedDataset, setSelectedDataset] = useState(DEFAULT_DATASET_ID);
  const [imageError, setImageError] = useState(0);
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(initialDate ?? today());

  useEffect(() => {
    const saved = localStorage.getItem('selectedPitcherDataset');
    if (saved) setSelectedDataset(saved);
  }, []);

  // Resolve pitcher from static JSON
  const isNumericId = /^\d+$/.test(id);
  let pitcher = isNumericId
    ? getPitcherById(parseInt(id), selectedDataset)
    : getPitcherByName(decodeURIComponent(id), selectedDataset);
  if (!pitcher) {
    for (const dataset of DATASETS) {
      pitcher = isNumericId
        ? getPitcherById(parseInt(id), dataset.id)
        : getPitcherByName(decodeURIComponent(id), dataset.id);
      if (pitcher) break;
    }
  }

  const playerId = pitcher?.player_id ?? (isNumericId ? parseInt(id) : null);

  const fetchData = useCallback(async (date?: string, silent = false) => {
    if (!playerId) return;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const dateQuery = date ? `&date=${date}` : '';
      const res = await fetch(`/api/pitcher-daily?playerId=${playerId}${dateQuery}`);
      const json = await res.json();
      if (!res.ok) {
        if (!silent) {
          setError(json.error || 'Failed to load game data');
          if (json.availableDates) {
            setData(prev => prev ? { ...prev, availableDates: json.availableDates } : null);
          }
        }
      } else {
        setData(json);
        setSelectedDate(json.date);
      }
    } catch {
      if (!silent) setError('Network error — could not load game data');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [playerId]);

  useEffect(() => { fetchData(initialDate ?? undefined); }, [fetchData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 90s when viewing today's date
  useEffect(() => {
    const isViewingToday = selectedDate === today();
    if (!isViewingToday || loading) return;
    const interval = setInterval(() => fetchData(selectedDate, true), 90_000);
    return () => clearInterval(interval);
  }, [selectedDate, loading, fetchData]);

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    fetchData(date);
  };

  // Use playerId from static DB or from URL — works for any MLB player
  const resolvedPlayerId = playerId;
  const displayName = pitcher?.full_name ?? data?.playerName ?? `Player ${id}`;

  const imageSources = [
    resolvedPlayerId ? getMLBStaticPlayerImage(resolvedPlayerId, { width: 426 }) : null,
    resolvedPlayerId ? getESPNPlayerImage(resolvedPlayerId) : null,
    '/api/placeholder/400/400',
  ].filter(Boolean) as string[];
  const currentImage = imageSources[Math.min(imageError, imageSources.length - 1)];

  const teamLogo = pitcher?.team ? getMLBTeamLogoUrl(pitcher.team) : (data?.gameInfo?.team ? getMLBTeamLogoUrl(data.gameInfo.team) : null);
  const opponentLogo = data?.gameInfo?.opponent ? getMLBTeamLogoUrl(data.gameInfo.opponent) : null;
  const pitches = data?.pitchData?.pitchTypes ?? [];
  const gameLine = data?.gameLine;
  const gameInfo = data?.gameInfo;
  const availableDates = data?.availableDates ?? [];
  const ipLabel = gameLine ? ipQualityLabel(gameLine.ip) : null;
  // Use Statcast pitch count if available (more accurate for Spring Training)
  const totalPitches = data?.pitchData?.totalPitches || gameLine?.pitches || 0;
  const strikePct = data?.pitchData?.strikePct != null
    ? data.pitchData.strikePct
    : (gameLine && gameLine.pitches > 0
      ? Math.round((gameLine.strikes / gameLine.pitches) * 1000) / 10
      : null);

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-white">
      {/* Nav */}
      <header className="bg-[#16213e] border-b border-gray-700">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/pitchers" className="text-blue-400 hover:text-blue-300 font-medium text-sm">
              ← Back to Pitchers
            </Link>
            {pitcher && (
              <Link
                href={`/pitcher/${id}`}
                className="px-3 py-1.5 bg-[#0d1b2a] hover:bg-[#1a2940] border border-gray-600 hover:border-blue-500 text-gray-300 hover:text-white rounded-lg text-xs font-semibold transition-colors"
              >
                📊 Season Card
              </Link>
            )}
            <Link href="/" className="text-green-400 hover:text-green-300 font-medium text-sm">
              View Hitters →
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-7xl">

        {/* ── TOP ROW: Location Chart | Player Info | Movement Chart ─── */}
        <div className="bg-[#16213e] rounded-xl p-6 mb-6">
          <div className="flex flex-wrap lg:flex-nowrap gap-6 items-start justify-center">

            {/* LEFT: Pitch location chart */}
            <div className="flex-shrink-0">
              {(data?.pitchData?.rawDots?.length ?? 0) > 0 ? (
                <PitchLocationChart rawDots={data!.pitchData!.rawDots} />
              ) : (
                <div className="w-[320px] h-[320px] bg-[#1a2940] rounded-lg flex items-center justify-center">
                  <p className="text-gray-600 text-xs text-center px-6">
                    {loading ? 'Loading...' : 'No Statcast data available'}
                  </p>
                </div>
              )}
            </div>

            {/* CENTER: Photo + name + bio + stats + date picker */}
            <div className="flex flex-col items-center min-w-0 flex-1 max-w-sm">

              {/* Name + team logo */}
              <div className="flex items-center gap-2 mb-1 w-full justify-center">
                <h1 className="text-2xl font-bold truncate text-center">{displayName}</h1>
                {teamLogo && <img src={teamLogo} alt={pitcher?.team || gameInfo?.team || ''} className="w-8 h-8 object-contain flex-shrink-0" />}
              </div>

              {/* Bio line */}
              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-gray-400 mb-3">
                {pitcher?.throws && <span>{pitcher.throws}HP</span>}
                {(pitcher?.team || gameInfo?.team) && <span>{pitcher?.team || gameInfo?.team}</span>}
                {gameInfo && (
                  <>
                    <span className="text-gray-600">·</span>
                    <span>{gameInfo.date}</span>
                    <span className="text-gray-600">·</span>
                    <span className="flex items-center gap-1">
                      {gameInfo.isHome ? 'vs' : '@'}
                      {opponentLogo && <img src={opponentLogo} alt={gameInfo.opponent || ''} className="w-4 h-4 object-contain inline" />}
                      <span className="font-semibold text-white">{gameInfo.opponentFull || gameInfo.opponent}</span>
                    </span>
                  </>
                )}
              </div>

              {/* Player photo */}
              <div className="relative w-48 h-48 rounded-xl overflow-hidden bg-gray-700 border-2 border-gray-600 mb-3">
                <Image
                  src={currentImage || '/api/placeholder/400/400'}
                  alt={displayName}
                  fill
                  className="object-cover"
                  onError={() => setImageError(e => Math.min(e + 1, imageSources.length - 1))}
                  unoptimized
                />
              </div>

              {/* IP quality badge */}
              {ipLabel && gameLine && !loading && (
                <div className="mb-3">
                  <span
                    className="inline-block px-3 py-1 rounded-full text-xs font-bold"
                    style={{ backgroundColor: ipLabel.color, color: '#111' }}
                  >
                    {ipLabel.label}
                  </span>
                </div>
              )}

              {/* Game line stat boxes */}
              {gameLine && !loading && (
                <div className="grid grid-cols-4 gap-2 w-full mb-3">
                  {[
                    { label: 'IP',   value: gameLine.ip },
                    { label: 'H',    value: String(gameLine.h) },
                    { label: 'ER',   value: String(gameLine.er) },
                    { label: 'BB',   value: String(gameLine.bb) },
                    { label: 'K',    value: String(gameLine.k) },
                    { label: 'HR',   value: String(gameLine.hr) },
                    { label: 'P',    value: totalPitches ? String(totalPitches) : '—' },
                    { label: 'STR%', value: strikePct != null ? `${strikePct}%` : '—' },
                  ].map(s => (
                    <div key={s.label} className="rounded-lg px-2 py-2 text-center bg-[#0d1b2a]">
                      <div className="text-[9px] text-gray-400 uppercase font-semibold">{s.label}</div>
                      <div className="text-lg font-bold">{s.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Date picker */}
              <div className="w-full">
                <label className="text-[9px] text-gray-500 uppercase font-semibold tracking-wider mb-1 block text-center">
                  Game Date
                </label>
                {availableDates.length > 0 ? (
                  <select
                    value={selectedDate}
                    onChange={e => handleDateChange(e.target.value)}
                    className="w-full bg-[#0d1b2a] text-white border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {availableDates.map(d => (
                      <option key={d.date} value={d.date}>
                        {d.date} vs {d.opponent}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={e => handleDateChange(e.target.value)}
                    className="w-full bg-[#0d1b2a] text-white border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
                {availableDates.length > 0 && (
                  <p className="text-[9px] text-gray-600 text-center mt-1">{availableDates.length} appearances</p>
                )}
              </div>

              {/* Loading */}
              {loading && (
                <div className="flex items-center gap-3 mt-4">
                  <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-gray-400 text-sm">Loading game data...</span>
                </div>
              )}

              {/* Error */}
              {!loading && error && (
                <div className="mt-3 bg-[#0d1b2a] rounded-lg p-3 w-full">
                  <p className="text-red-400 text-sm">{error}</p>
                  {availableDates.length > 0 && (
                    <p className="text-gray-500 text-xs mt-1">Select a date above to view a different game.</p>
                  )}
                </div>
              )}
            </div>

            {/* RIGHT: Movement chart */}
            <div className="flex-shrink-0 flex flex-col items-center">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Pitch Movement — {gameInfo?.date ?? selectedDate}
              </h3>
              {(data?.pitchData?.rawDots?.length ?? 0) > 0 ? (
                <PitchMovementChart
                  rawDots={data!.pitchData!.rawDots}
                  throws={pitcher?.throws}
                  armAngle={pitcher?.arm_angle ?? data?.pitchData?.armAngle ?? undefined}
                />
              ) : (
                <div className="w-[400px] h-[400px] bg-[#1a2940] rounded-lg flex items-center justify-center">
                  <p className="text-gray-600 text-xs text-center px-6">
                    {loading ? 'Loading...' : 'No Statcast data available for this game'}
                  </p>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── Pitch type pills ─── */}
        {pitches.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {pitches.map(p => {
              const col = pitchColors(p.name);
              return (
                <span
                  key={p.name}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                  style={{ backgroundColor: col.bg, color: col.text }}
                >
                  {p.name}
                  <span className="opacity-75">({p.count})</span>
                </span>
              );
            })}
          </div>
        )}

        {/* ── Pitch stats table (full-width, matching season card style) ─── */}
        {pitches.length > 0 && (
          <div className="bg-[#16213e] rounded-xl overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 bg-[#0d1b2a]">
                    {['Pitch', 'Pitches', 'Usage', 'Velocity', 'IVB', 'HB', 'Spin', 'VAA', 'Whiff%', 'Whiffs'].map(h => (
                      <th key={h} className="px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pitches.map(p => {
                    const col = pitchColors(p.name);
                    return (
                      <tr key={p.name} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                        <td className="px-3 py-3 text-center">
                          <span
                            className="inline-block px-3 py-1 rounded-md text-xs font-bold whitespace-nowrap"
                            style={{ backgroundColor: col.bg, color: col.text }}
                          >
                            {p.name}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center font-semibold">{p.count}</td>
                        <td className="px-3 py-3 text-center font-semibold">{p.usage.toFixed(1)}%</td>
                        <td className="px-3 py-3 text-center font-semibold">{p.velo?.toFixed(1) ?? '—'}</td>
                        <td className="px-3 py-3 text-center font-semibold">{p.v_movement?.toFixed(1) ?? '—'}</td>
                        <td className="px-3 py-3 text-center font-semibold">{p.h_movement?.toFixed(1) ?? '—'}</td>
                        <td className="px-3 py-3 text-center font-semibold">{p.spin ?? '—'}</td>
                        <td className="px-3 py-3 text-center font-semibold">
                          {p.vaa !== null ? `${p.vaa.toFixed(1)}°` : '—'}
                        </td>
                        <td className="px-3 py-3 text-center font-semibold">
                          {p.whiff !== null ? `${p.whiff.toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-3 py-3 text-center font-semibold">
                          {p.whiffs > 0 ? p.whiffs : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-[#0d1b2a] font-bold border-t border-gray-600">
                    <td className="px-3 py-3 text-center">
                      <span className="inline-block px-3 py-1 rounded-md text-xs font-bold bg-gray-600 text-white">All</span>
                    </td>
                    <td className="px-3 py-3 text-center">{data?.pitchData?.totalPitches ?? '—'}</td>
                    <td className="px-3 py-3 text-center">100.0%</td>
                    <td className="px-3 py-3 text-center">—</td>
                    <td className="px-3 py-3 text-center">—</td>
                    <td className="px-3 py-3 text-center">—</td>
                    <td className="px-3 py-3 text-center">—</td>
                    <td className="px-3 py-3 text-center">—</td>
                    <td className="px-3 py-3 text-center">
                      {data?.pitchData?.swingAndMissPct != null ? `${data.pitchData.swingAndMissPct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {data?.pitchData?.totalWhiffs != null && data.pitchData.totalWhiffs > 0 ? data.pitchData.totalWhiffs : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {/* SwStr% footer */}
            {(data?.pitchData?.swingAndMissPct != null || strikePct != null) && (
              <div className="px-4 py-2 border-t border-gray-700 text-xs text-gray-500 flex gap-6">
                {strikePct != null && (
                  <span>Strike%: <span className="text-white font-semibold">{strikePct.toFixed(1)}%</span></span>
                )}
                {data?.pitchData?.swingAndMissPct != null && (
                  <span>SwStr%: <span className="text-white font-semibold">{data.pitchData.swingAndMissPct.toFixed(1)}%</span></span>
                )}
              </div>
            )}
          </div>
        )}

        {/* No Statcast message */}
        {!loading && !error && gameLine && pitches.length === 0 && (
          <div className="bg-[#16213e] rounded-xl p-8 text-center mb-6">
            <p className="text-gray-400 text-sm">No Statcast pitch data available for this game.</p>
            <p className="text-gray-600 text-xs mt-1">Statcast data typically posts within a few hours of game completion.</p>
          </div>
        )}

        <div className="text-center text-gray-600 text-xs py-4">
          Data: MLB Stats API · Baseball Savant
        </div>
      </div>
    </div>
  );
}
