'use client';

import { use, useState, useEffect, useCallback } from 'react';
import { getPitcherById, getPitcherByName } from '@/lib/pitcher-database';
import { DEFAULT_DATASET_ID, DATASETS } from '@/lib/datasets';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import Image from 'next/image';
import Link from 'next/link';

interface DailyPageProps {
  params: Promise<{ id: string }>;
}

// ─── Pitch color palette (matches pitcher detail page) ───────────────────────
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

function pitchColors(name: string) {
  return PITCH_COLORS[name] || { color: '#888', bg: '#888', text: '#fff' };
}

// ─── Pitch abbreviations ──────────────────────────────────────────────────────
const PITCH_SHORT: Record<string, string> = {
  '4-Seam Fastball': 'FF',
  'Sinker': 'SI',
  'Cutter': 'FC',
  'Changeup': 'CH',
  'Splitter': 'FS',
  'Curveball': 'CU',
  'Knuckle Curve': 'KC',
  'Slider': 'SL',
  'Sweeper': 'ST',
  'Slurve': 'SV',
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface PitchType {
  name: string;
  count: number;
  usage: number;
  velo: number | null;
  spin: number | null;
  h_movement: number | null;
  v_movement: number | null;
  vaa: number | null;
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

interface PitchData {
  totalPitches: number;
  pitchTypes: PitchType[];
  strikePct: number | null;
  swingAndMissPct: number | null;
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
  date: string;
  gameLine: GameLine;
  gameInfo: GameInfo;
  pitchData: PitchData | null;
  availableDates: AvailableDate[];
}

// ─── Stat result quality ──────────────────────────────────────────────────────
// Colors the game line stats (greener = better for pitcher)
function gameStatColor(stat: string, value: number): string {
  const thresholds: Record<string, { great: number; good: number; bad: number; worse: number; lowerIsBetter: boolean }> = {
    er:  { great: 0, good: 1, bad: 3, worse: 5, lowerIsBetter: true },
    h:   { great: 2, good: 4, bad: 7, worse: 10, lowerIsBetter: true },
    bb:  { great: 0, good: 1, bad: 3, worse: 5, lowerIsBetter: true },
    hr:  { great: 0, good: 0, bad: 1, worse: 2, lowerIsBetter: true },
    k:   { great: 9, good: 6, bad: 3, worse: 1, lowerIsBetter: false },
  };

  const t = thresholds[stat];
  if (!t) return '#e2e8f0';

  if (t.lowerIsBetter) {
    if (value <= t.great) return '#22c55e'; // green
    if (value <= t.good)  return '#86efac';
    if (value <= t.bad)   return '#fbbf24';
    return '#f87171';                        // red
  } else {
    if (value >= t.great) return '#22c55e';
    if (value >= t.good)  return '#86efac';
    if (value >= t.bad)   return '#fbbf24';
    return '#f87171';
  }
}

function ipQualityLabel(ip: string): { label: string; color: string } {
  const num = parseFloat(ip.replace(/\.\d+/, (m) => {
    // Convert 0.1 → 0.333, 0.2 → 0.667 (MLB outs format)
    const outs = parseInt(m.slice(1));
    return outs === 0 ? '.0' : outs === 1 ? '.333' : '.667';
  }));
  if (num >= 7)   return { label: 'CG / Deep', color: '#22c55e' };
  if (num >= 6)   return { label: 'Quality Start', color: '#86efac' };
  if (num >= 5)   return { label: 'Solid Outing', color: '#fbbf24' };
  if (num >= 3)   return { label: 'Mediocre', color: '#fb923c' };
  return             { label: 'Short Outing', color: '#f87171' };
}

// ─── Pitch movement chart (same style as pitcher detail page) ─────────────────
function DayPitchMovementChart({ pitches, throws }: {
  pitches: PitchType[];
  throws?: string;
}) {
  const size = 340;
  const center = size / 2;
  const maxInches = 24;
  const scale = (center - 28) / maxInches;

  return (
    <svg width={size} height={size} className="bg-[#1a2940] rounded-lg">
      {/* Grid lines */}
      <line x1={center} y1={18} x2={center} y2={size - 18} stroke="#3a4f66" strokeWidth="1" />
      <line x1={18} y1={center} x2={size - 18} y2={center} stroke="#3a4f66" strokeWidth="1" />

      {/* Concentric guides */}
      {[6, 12, 18, 24].map(inches => (
        <g key={inches}>
          <circle cx={center} cy={center} r={inches * scale}
            fill="none" stroke="#3a4f66" strokeWidth="0.5" strokeDasharray="3,3" />
          <text x={center + inches * scale + 2} y={center - 3} fontSize="8" fill="#5a7a94">{inches}&quot;</text>
          <text x={center - inches * scale - 2} y={center - 3} fontSize="8" fill="#5a7a94" textAnchor="end">{inches}&quot;</text>
        </g>
      ))}

      {/* Axis labels */}
      <text x={center} y={13} textAnchor="middle" fontSize="9" fill="#7a8fa5">IVB (in)</text>
      <text x={size - 5} y={center - 5} textAnchor="end" fontSize="9" fill="#7a8fa5">
        {throws === 'L' ? '← Arm' : 'Arm →'}
      </text>
      <text x={5} y={center - 5} textAnchor="start" fontSize="9" fill="#7a8fa5">
        {throws === 'L' ? 'Glove →' : '← Glove'}
      </text>

      {/* Pitch dots — solid filled circles with label */}
      {pitches.map(p => {
        if (p.h_movement === null || p.v_movement === null) return null;
        const cx = center + p.h_movement * scale;
        const cy = center - p.v_movement * scale;
        const col = pitchColors(p.name);
        const short = PITCH_SHORT[p.name] || p.name.slice(0, 2).toUpperCase();
        return (
          <g key={p.name}>
            <circle cx={cx} cy={cy} r={18} fill={col.bg} opacity={0.9} />
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize="9" fontWeight="bold" fill={col.text}>
              {short}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PitcherDailyPage({ params }: DailyPageProps) {
  const { id } = use(params);

  const [selectedDataset, setSelectedDataset] = useState(DEFAULT_DATASET_ID);
  const [imageError, setImageError] = useState(0);
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');

  // Resolve pitcher from static JSON (for name, throws, team info)
  useEffect(() => {
    const saved = localStorage.getItem('selectedPitcherDataset');
    if (saved) setSelectedDataset(saved);
  }, []);

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

  const fetchData = useCallback(async (date?: string) => {
    if (!playerId) return;
    setLoading(true);
    setError(null);
    try {
      const dateQuery = date ? `&date=${date}` : '';
      const res = await fetch(`/api/pitcher-daily?playerId=${playerId}${dateQuery}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to load game data');
        // Still store available dates if returned
        if (json.availableDates) {
          setData(prev => prev ? { ...prev, availableDates: json.availableDates } : null);
        }
      } else {
        setData(json);
        setSelectedDate(json.date);
      }
    } catch (e) {
      setError('Network error — could not load game data');
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  // Initial load — yesterday by default
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    fetchData(date);
  };

  const imageSources = [
    pitcher?.player_id ? getMLBStaticPlayerImage(pitcher.player_id, { width: 426 }) : null,
    pitcher?.player_id ? getESPNPlayerImage(pitcher.player_id) : null,
    '/api/placeholder/400/400',
  ].filter(Boolean) as string[];
  const currentImage = imageSources[imageError] || imageSources[imageSources.length - 1];

  const teamLogo = pitcher?.team ? getMLBTeamLogoUrl(pitcher.team) : null;
  const opponentLogo = data?.gameInfo?.opponent ? getMLBTeamLogoUrl(data.gameInfo.opponent) : null;

  const pitches = data?.pitchData?.pitchTypes ?? [];
  const gameLine = data?.gameLine;
  const gameInfo = data?.gameInfo;
  const availableDates = data?.availableDates ?? [];

  const ipLabel = gameLine ? ipQualityLabel(gameLine.ip) : null;

  // Strike% from game line pitches/strikes
  const strikePct = gameLine && gameLine.pitches > 0
    ? Math.round((gameLine.strikes / gameLine.pitches) * 1000) / 10
    : data?.pitchData?.strikePct ?? null;

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-white">
      {/* Nav */}
      <header className="bg-[#16213e] border-b border-gray-700">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-4">
              <Link href="/pitchers" className="text-blue-400 hover:text-blue-300 font-medium text-sm">
                ← Pitchers
              </Link>
              {pitcher && (
                <Link
                  href={`/pitcher/${id}`}
                  className="text-gray-400 hover:text-gray-300 font-medium text-sm"
                >
                  Season Card
                </Link>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Daily Card</span>
            </div>
            <Link href="/" className="text-green-400 hover:text-green-300 font-medium text-sm">
              View Hitters →
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-5xl">

        {/* ── Date Picker ─────────────────────────────────────────────── */}
        <div className="bg-[#16213e] rounded-xl p-4 mb-5 flex flex-wrap items-center gap-4">
          <div className="flex-1">
            <label className="text-xs text-gray-500 uppercase font-semibold tracking-wider mb-1 block">
              Select Game Date
            </label>
            {availableDates.length > 0 ? (
              <select
                value={selectedDate}
                onChange={e => handleDateChange(e.target.value)}
                className="bg-[#0d1b2a] text-white border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[260px]"
              >
                {availableDates.map(d => (
                  <option key={d.date} value={d.date}>
                    {d.date} — vs {d.opponent} &nbsp; {d.ip} IP, {d.er} ER, {d.k} K
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="date"
                value={selectedDate}
                onChange={e => handleDateChange(e.target.value)}
                className="bg-[#0d1b2a] text-white border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
          </div>
          {availableDates.length > 0 && (
            <div className="text-xs text-gray-500">
              {availableDates.length} appearances in 2025
            </div>
          )}
        </div>

        {/* ── Loading / Error ──────────────────────────────────────────── */}
        {loading && (
          <div className="bg-[#16213e] rounded-xl p-12 text-center">
            <div className="inline-block w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-gray-400 text-sm">Loading game data...</p>
          </div>
        )}

        {!loading && error && (
          <div className="bg-[#16213e] rounded-xl p-8 text-center mb-5">
            <p className="text-red-400 text-sm mb-2">{error}</p>
            {availableDates.length > 0 && (
              <p className="text-gray-500 text-xs">Select a date above to view a different game.</p>
            )}
          </div>
        )}

        {/* ── Main Card ────────────────────────────────────────────────── */}
        {!loading && !error && data && gameLine && gameInfo && (
          <>
            {/* TOP: Player info + game headline */}
            <div className="bg-[#16213e] rounded-xl p-6 mb-5">
              <div className="flex flex-wrap gap-6 items-start">

                {/* Player photo */}
                <div className="flex-shrink-0">
                  <div className="relative w-32 h-32 rounded-xl overflow-hidden bg-gray-700 border-2 border-gray-600">
                    <Image
                      src={currentImage}
                      alt={pitcher?.full_name || 'Pitcher'}
                      fill
                      className="object-cover"
                      onError={() => setImageError(e => Math.min(e + 1, imageSources.length - 1))}
                      unoptimized
                    />
                  </div>
                </div>

                {/* Name + matchup */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h1 className="text-2xl font-bold truncate">{pitcher?.full_name ?? `Player ${id}`}</h1>
                    {teamLogo && (
                      <img src={teamLogo} alt={pitcher?.team || ''} className="w-8 h-8 object-contain flex-shrink-0" />
                    )}
                  </div>

                  {/* Matchup line */}
                  <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
                    <span>{gameInfo.date}</span>
                    <span className="text-gray-600">·</span>
                    <span>{gameInfo.isHome ? 'vs' : '@'}</span>
                    {opponentLogo && (
                      <img src={opponentLogo} alt={gameInfo.opponent || ''} className="w-5 h-5 object-contain" />
                    )}
                    <span className="font-semibold text-white">{gameInfo.opponentFull || gameInfo.opponent}</span>
                    {pitcher?.throws && <span className="ml-2 text-gray-500">{pitcher.throws}HP</span>}
                  </div>

                  {/* IP quality badge */}
                  {ipLabel && (
                    <div className="mb-3">
                      <span
                        className="inline-block px-3 py-1 rounded-full text-xs font-bold text-gray-900"
                        style={{ backgroundColor: ipLabel.color }}
                      >
                        {ipLabel.label}
                      </span>
                    </div>
                  )}

                  {/* Game line stats */}
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                    {[
                      { label: 'IP',  value: gameLine.ip,          color: null },
                      { label: 'H',   value: gameLine.h,            color: gameStatColor('h', gameLine.h) },
                      { label: 'ER',  value: gameLine.er,           color: gameStatColor('er', gameLine.er) },
                      { label: 'BB',  value: gameLine.bb,           color: gameStatColor('bb', gameLine.bb) },
                      { label: 'K',   value: gameLine.k,            color: gameStatColor('k', gameLine.k) },
                      { label: 'HR',  value: gameLine.hr,           color: gameStatColor('hr', gameLine.hr) },
                      { label: 'P',   value: gameLine.pitches || '—', color: null },
                      { label: 'STR%', value: strikePct != null ? `${strikePct}%` : '—', color: null },
                    ].map(s => (
                      <div
                        key={s.label}
                        className="rounded-lg px-2 py-2 text-center"
                        style={{ backgroundColor: s.color || '#0d1b2a' }}
                      >
                        <div className="text-[9px] text-gray-500 uppercase font-semibold">{s.label}</div>
                        <div className="text-lg font-bold" style={{ color: s.color ? '#111' : undefined }}>
                          {String(s.value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* PITCH ARSENAL (if Statcast available) */}
            {pitches.length > 0 ? (
              <>
                {/* Pitch type pills */}
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
                        <span className="opacity-80">({p.count})</span>
                      </span>
                    );
                  })}
                </div>

                {/* Two-column: chart + table */}
                <div className="flex flex-wrap gap-5 mb-6">

                  {/* Movement chart */}
                  <div className="bg-[#16213e] rounded-xl p-4 flex flex-col items-center">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                      Pitch Movement — {gameInfo.date}
                    </h3>
                    <DayPitchMovementChart pitches={pitches} throws={pitcher?.throws} />
                  </div>

                  {/* Stats table */}
                  <div className="flex-1 min-w-0 bg-[#16213e] rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-700 bg-[#0d1b2a]">
                            {['Pitch', '#', 'Usage', 'Velo', 'IVB', 'HB', 'Spin', 'VAA'].map(h => (
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
                                    className="inline-block px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap"
                                    style={{ backgroundColor: col.bg, color: col.text }}
                                  >
                                    {PITCH_SHORT[p.name] || p.name}
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
                              </tr>
                            );
                          })}
                          {/* Totals row */}
                          <tr className="bg-[#0d1b2a] border-t border-gray-600 font-bold">
                            <td className="px-3 py-3 text-center">
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-gray-600 text-white">All</span>
                            </td>
                            <td className="px-3 py-3 text-center">{data.pitchData?.totalPitches ?? '—'}</td>
                            <td className="px-3 py-3 text-center">100%</td>
                            <td className="px-3 py-3 text-center">—</td>
                            <td className="px-3 py-3 text-center">—</td>
                            <td className="px-3 py-3 text-center">—</td>
                            <td className="px-3 py-3 text-center">—</td>
                            <td className="px-3 py-3 text-center">—</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Swing-and-miss note */}
                    {data.pitchData?.swingAndMissPct != null && (
                      <div className="px-4 py-2 border-t border-gray-700 text-xs text-gray-500">
                        SwStr%: <span className="text-white font-semibold">{data.pitchData.swingAndMissPct.toFixed(1)}%</span>
                        {strikePct != null && (
                          <span className="ml-4">Strike%: <span className="text-white font-semibold">{strikePct.toFixed(1)}%</span></span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Season comparison note */}
                <div className="bg-[#16213e] rounded-xl p-4 mb-5">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    Season Averages vs Today
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-700">
                          <th className="px-3 py-2 text-left text-gray-500 uppercase">Pitch</th>
                          <th className="px-3 py-2 text-center text-gray-500 uppercase">Today Velo</th>
                          <th className="px-3 py-2 text-center text-gray-500 uppercase">Season Velo</th>
                          <th className="px-3 py-2 text-center text-gray-500 uppercase">Δ Velo</th>
                          <th className="px-3 py-2 text-center text-gray-500 uppercase">Today Usage</th>
                          <th className="px-3 py-2 text-center text-gray-500 uppercase">Season Usage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pitches.map(p => {
                          const col = pitchColors(p.name);
                          // Find matching season stat from pitcher object
                          const keyMap: Record<string, string> = {
                            '4-Seam Fastball': 'ff', 'Sinker': 'si', 'Cutter': 'fc',
                            'Changeup': 'ch', 'Splitter': 'fs', 'Curveball': 'cu',
                            'Knuckle Curve': 'kc', 'Slider': 'sl', 'Sweeper': 'st', 'Slurve': 'sv',
                          };
                          const legacyMap: Record<string, string> = {
                            '4-Seam Fastball': 'fastball', 'Sinker': 'sinker', 'Cutter': 'cutter',
                            'Changeup': 'changeup', 'Splitter': 'splitter', 'Curveball': 'curveball',
                            'Slider': 'slider', 'Sweeper': 'sweeper',
                          };
                          const key = keyMap[p.name];
                          const legacy = legacyMap[p.name];
                          const pd = pitcher as unknown as Record<string, unknown>;
                          const structured = pd[key] as Record<string, number> | undefined;
                          const seasonVelo: number | null = structured?.velo ?? (pd[`${legacy}_velo`] as number | undefined) ?? null;
                          const seasonUsage: number | null = structured?.usage ?? (pd[`${legacy}_usage`] as number | undefined) ?? null;
                          const veloD = (p.velo !== null && seasonVelo !== null) ? p.velo - seasonVelo : null;

                          return (
                            <tr key={p.name} className="border-b border-gray-700/40 hover:bg-gray-700/10">
                              <td className="px-3 py-2">
                                <span
                                  className="inline-block px-2 py-0.5 rounded text-[10px] font-bold"
                                  style={{ backgroundColor: col.bg, color: col.text }}
                                >
                                  {PITCH_SHORT[p.name] || p.name}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-center font-semibold">{p.velo?.toFixed(1) ?? '—'}</td>
                              <td className="px-3 py-2 text-center text-gray-400">{seasonVelo?.toFixed(1) ?? '—'}</td>
                              <td className="px-3 py-2 text-center font-semibold"
                                style={{ color: veloD === null ? undefined : veloD > 0.3 ? '#4ade80' : veloD < -0.3 ? '#f87171' : '#9ca3af' }}>
                                {veloD === null ? '—' : `${veloD > 0 ? '+' : ''}${veloD.toFixed(1)}`}
                              </td>
                              <td className="px-3 py-2 text-center font-semibold">{p.usage.toFixed(1)}%</td>
                              <td className="px-3 py-2 text-center text-gray-400">{seasonUsage?.toFixed(1) != null ? `${seasonUsage.toFixed(1)}%` : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-[#16213e] rounded-xl p-8 text-center mb-5">
                <p className="text-gray-400 text-sm">
                  Statcast pitch data is not yet available for this game.
                </p>
                <p className="text-gray-600 text-xs mt-1">
                  Statcast data typically posts within a few hours of game completion.
                </p>
              </div>
            )}

            {/* Footer link to full season card */}
            <div className="text-center py-4">
              <Link
                href={`/pitcher/${id}`}
                className="text-blue-400 hover:text-blue-300 text-sm font-medium"
              >
                ← View Full Season Card
              </Link>
              <span className="mx-4 text-gray-700">·</span>
              <span className="text-gray-600 text-xs">Data: MLB Stats API, Baseball Savant</span>
            </div>
          </>
        )}

        {/* Pitcher not found */}
        {!pitcher && !loading && (
          <div className="bg-[#16213e] rounded-xl p-8 text-center">
            <p className="text-gray-400">Pitcher not found in database. Stats will still load if a valid player ID was provided.</p>
            <Link href="/pitchers" className="text-blue-400 hover:text-blue-300 text-sm mt-2 inline-block">
              ← Back to Pitchers
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
