'use client';

import { use, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getPitcherById, getPitcherByName, searchAllPitchers } from '@/lib/pitcher-database';
import { useRouter } from 'next/navigation';
import { DEFAULT_DATASET_ID, DATASETS } from '@/lib/datasets';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getCollegeLogoUrl } from '@/lib/college-logos';
import Image from 'next/image';
import Link from 'next/link';
import {
  RawDot, PITCH_COLORS, PITCH_SHORT, pitchColors,
  PitchLocationChart, PitchMovementChart,
} from '@/components/PitchCharts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CollegeSeasonPageProps {
  params: Promise<{ id: string }>;
}

interface PitchType {
  name: string;
  count: number;
  usage: number;
  velo: number | null;
  maxVelo: number | null;
  spin: number | null;
  h_movement: number | null;
  v_movement: number | null;
  whiff: number | null;
  whiffs: number;
  swings: number;
  zone_pct: number | null;
}

interface Outing {
  date: string;
  dateShort: string;
  opponent: string | null;
  opponentFull: string | null;
  isHome: boolean | null;
  ip: string;
  h: number;
  er: number;
  bb: number;
  k: number;
  hr: number;
  pitches: number;
  bf: number;
  gamePk: number | null;
}

interface Totals {
  games: number;
  ip: string;
  totalOuts: number;
  h: number;
  er: number;
  bb: number;
  k: number;
  hr: number;
  bf: number;
  era: number | null;
  whip: number | null;
  kPct: number | null;
  bbPct: number | null;
  k9: number | null;
  bb9: number | null;
  h9: number | null;
  strikePct: number | null;
  swingAndMissPct: number | null;
}

interface CollegeSeasonData {
  playerId: number;
  playerName: string | null;
  playerHeight: string | null;
  playerWeight: number | null;
  playerBirthDate: string | null;
  playerPitchHand: string | null;
  playerBatSide: string | null;
  season: string;
  team: string | null;
  games: Outing[];
  pitchTypes: PitchType[];
  rawDots: RawDot[];
  totals: Totals | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const now   = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

// blue→white→red gradient for whiff coloring
function getWhiffBgColor(t: number): { bg: string; text: string } {
  const c = Math.max(0, Math.min(1, t));
  let r: number, g: number, b: number;
  if (c <= 0.5) {
    const s = (0.5 - c) / 0.5;
    r = Math.round(255 + s * (22  - 255));
    g = Math.round(255 + s * (61  - 255));
    b = Math.round(255 + s * (110 - 255));
  } else {
    const s = (c - 0.5) / 0.5;
    r = 255;
    g = Math.round(255 + s * (45  - 255));
    b = Math.round(255 + s * (45  - 255));
  }
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return { bg: `rgb(${r},${g},${b})`, text: lum > 0.5 ? '#111827' : '#ffffff' };
}

const VELO_BENCHMARKS: Record<string, { p10: number; p90: number }> = {
  '4-Seam Fastball': { p10: 91.0, p90: 97.2 },
  'Sinker':          { p10: 90.4, p90: 96.6 },
  'Cutter':          { p10: 86.3, p90: 92.7 },
  'Changeup':        { p10: 81.7, p90: 90.4 },
  'Splitter':        { p10: 83.1, p90: 90.3 },
  'Curveball':       { p10: 74.8, p90: 84.2 },
  'Knuckle Curve':   { p10: 74.8, p90: 84.2 },
  'Slider':          { p10: 82.0, p90: 89.0 },
  'Sweeper':         { p10: 78.6, p90: 85.1 },
  'Slurve':          { p10: 78.5, p90: 84.6 },
};

const WHIFF_BENCHMARKS: Record<string, { p10: number; p90: number }> = {
  '4-Seam Fastball': { p10: 11.0, p90: 30.4 },
  'Sinker':          { p10:  4.5, p90: 21.5 },
  'Cutter':          { p10: 11.1, p90: 32.2 },
  'Changeup':        { p10: 12.5, p90: 46.2 },
  'Splitter':        { p10: 17.8, p90: 49.5 },
  'Curveball':       { p10: 14.1, p90: 44.6 },
  'Knuckle Curve':   { p10:  6.7, p90: 43.1 },
  'Slider':          { p10: 16.4, p90: 45.5 },
  'Sweeper':         { p10: 17.2, p90: 45.2 },
  'Slurve':          { p10: 16.7, p90: 44.8 },
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PitcherCollegeSeasonPage({ params }: CollegeSeasonPageProps) {
  const { id } = use(params);

  const CURRENT_YEAR = new Date().getFullYear();
  const yearOptions  = Array.from({ length: 6 }, (_, i) => String(CURRENT_YEAR - i));

  const [selectedDataset, setSelectedDataset] = useState(DEFAULT_DATASET_ID);
  const [imageError,      setImageError]      = useState(0);
  const [data,            setData]            = useState<CollegeSeasonData | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);
  const [selectedYear,    setSelectedYear]    = useState(String(CURRENT_YEAR));
  const [light,           setLight]           = useState(true);
  const [capturing,       setCapturing]       = useState(false);
  const [copied,          setCopied]          = useState(false);
  const [searchQuery,     setSearchQuery]     = useState('');
  const [searchOpen,      setSearchOpen]      = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const router  = useRouter();

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

  const fetchData = useCallback(async () => {
    if (!playerId) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res  = await fetch(`/api/pitcher-college-season?playerId=${playerId}&year=${selectedYear}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to load season data');
      } else {
        setData(json);
      }
    } catch {
      setError('Network error — could not load season data');
    } finally {
      setLoading(false);
    }
  }, [playerId, selectedYear]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchAllPitchers(searchQuery).slice(0, 8);
  }, [searchQuery]);

  const displayName = pitcher?.full_name ?? data?.playerName ?? `Player ${id}`;

  const imageSources = [
    playerId ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_426,q_auto:best/v1/people/${playerId}/headshot/silo/current` : null,
    playerId ? getMLBStaticPlayerImage(playerId, { width: 426 }) : null,
    playerId ? getESPNPlayerImage(playerId) : null,
    '/api/placeholder/400/400',
  ].filter(Boolean) as string[];
  const currentImage = imageSources[Math.min(imageError, imageSources.length - 1)];

  // Resolve team logo — prefer college logo
  const teamName = data?.team ?? pitcher?.team ?? null;
  const teamLogo = teamName ? (getCollegeLogoUrl(teamName) ?? null) : null;

  // Bio line
  const bio = (() => {
    const age = calcAge(data?.playerBirthDate ?? null);
    const parts: string[] = [];
    if (data?.playerHeight) parts.push(data.playerHeight);
    if (data?.playerWeight) parts.push(`${data.playerWeight} lbs`);
    if (age !== null) parts.push(`Age ${age}`);
    if (data?.playerPitchHand && data?.playerBatSide) parts.push(`${data.playerPitchHand}/${data.playerBatSide}`);
    return parts.join(' • ');
  })();

  // Theme
  const BL = '2px solid #000000';
  const th = {
    fg:          light ? '#000000' : '#ffffff',
    ink2:        light ? '#000000' : 'var(--color-ink-2)',
    ink3:        light ? '#000000' : 'var(--color-ink-3)',
    ink4:        light ? '#6b7280' : 'var(--color-ink-4)',
    tableHeadBg: light ? '#374151' : '',
    statBox:     light ? { background: '#f0f0f0', border: '1px solid #d4d4d4' } as React.CSSProperties : {} as React.CSSProperties,
    sectionStyle:light ? { border: BL } as React.CSSProperties : {} as React.CSSProperties,
  };

  // Per-hand usage strips for location charts
  const usageByHand = useMemo(() => {
    const acc: Record<'L'|'R', Record<string, { veloSum: number; count: number; dotCount: number }>> = { L: {}, R: {} };
    for (const dot of (data?.rawDots ?? [])) {
      const side = (dot.batterSide === 'L' || dot.batterSide === 'R') ? dot.batterSide : null;
      if (!side) continue;
      if (!acc[side][dot.pitchType]) acc[side][dot.pitchType] = { veloSum: 0, count: 0, dotCount: 0 };
      acc[side][dot.pitchType].dotCount++;
      if (dot.velo !== null) { acc[side][dot.pitchType].veloSum += dot.velo; acc[side][dot.pitchType].count++; }
    }
    const toStrip = (m: Record<string, { veloSum: number; count: number; dotCount: number }>) => {
      const total = Object.values(m).reduce((s, v) => s + v.dotCount, 0);
      return Object.entries(m)
        .map(([name, v]) => ({ name, pct: total > 0 ? (v.dotCount / total) * 100 : 0, velo: v.count > 0 ? v.veloSum / v.count : null }))
        .sort((a, b) => b.pct - a.pct);
    };
    return { L: toStrip(acc.L), R: toStrip(acc.R) };
  }, [data?.rawDots]);

  // PNG capture
  const captureCard = async () => {
    if (!cardRef.current) return null;
    const { toPng } = await import('html-to-image');
    return toPng(cardRef.current, { cacheBust: true, filter: el => !(el as HTMLElement).classList?.contains('export-ignore') });
  };
  const handleDownload = async () => {
    setCapturing(true);
    try {
      const url = await captureCard();
      if (!url) return;
      const a = document.createElement('a'); a.href = url;
      a.download = `${displayName.replace(/\s+/g, '_')}_${selectedYear}_college.png`;
      a.click();
    } finally { setCapturing(false); }
  };
  const handleCopy = async () => {
    setCapturing(true);
    try {
      const url = await captureCard();
      if (!url) return;
      const res  = await fetch(url);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } finally { setCapturing(false); }
  };

  const totals   = data?.totals ?? null;
  const rawDots  = data?.rawDots ?? [];
  const pitches  = data?.pitchTypes ?? [];
  const outings  = data?.games ?? [];        // newest first
  const hasStatcast = rawDots.length > 0;

  return (
    <div className="min-h-screen bg-panel text-deep-fg" data-light={light ? 'true' : undefined}>

      {/* ── Nav ── */}
      <header className="bg-panel border-b border-ink/20">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/pitchers" className="text-blue-400 hover:text-blue-300 font-medium text-sm">
              ← Back to Pitchers
            </Link>
            <div className="flex items-center gap-2">
              {/* Year selector */}
              <button
                onClick={() => setSelectedYear(y => String(Math.max(CURRENT_YEAR - 5, parseInt(y) - 1)))}
                disabled={parseInt(selectedYear) <= CURRENT_YEAR - 5}
                className="px-2 py-0.5 bg-blue-900/30 border border-blue-700/40 text-blue-300 text-sm font-bold disabled:opacity-30 hover:bg-blue-800/40 transition-colors"
              >‹</button>
              <select
                value={selectedYear}
                onChange={e => setSelectedYear(e.target.value)}
                className="bg-bone border border-ink/30 text-deep-fg text-xs px-2 py-1 outline-none"
              >
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <button
                onClick={() => setSelectedYear(y => String(Math.min(CURRENT_YEAR, parseInt(y) + 1)))}
                disabled={parseInt(selectedYear) >= CURRENT_YEAR}
                className="px-2 py-0.5 bg-blue-900/30 border border-blue-700/40 text-blue-300 text-sm font-bold disabled:opacity-30 hover:bg-blue-800/40 transition-colors"
              >›</button>
              <Link
                href={`/pitcher/${id}/daily`}
                className="px-3 py-1.5 bg-bone hover:bg-bone border border-ink/30 hover:border-ink text-ink-2 hover:text-ink text-xs font-semibold transition-colors"
              >
                📅 Daily Card
              </Link>
              <Link
                href={`/pitcher/${id}/spring-summary`}
                className="px-3 py-1.5 bg-bone hover:bg-bone border border-ink/30 hover:border-ink text-ink-2 hover:text-ink text-xs font-semibold transition-colors"
              >
                📊 Pro Season Summary
              </Link>
            </div>
            <Link href="/" className="text-green-400 hover:text-green-300 font-medium text-sm">
              View Hitters →
            </Link>
          </div>
        </div>

        {/* Search */}
        <div className="border-t border-ink/20/50 px-4 py-2 flex justify-center">
          <div className="relative w-72">
            <input
              type="text"
              placeholder="🔍  Search pitchers..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              className="w-full bg-bone border border-ink/30 focus:border-green-500 text-deep-fg text-sm px-3 py-1.5 outline-none placeholder-ink-4 transition-colors"
            />
            {searchOpen && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-page border border-ink/30 z-50 overflow-hidden">
                {searchResults.map(p => (
                  <button
                    key={p.player_id}
                    onMouseDown={() => {
                      router.push(`/pitcher/${p.player_id}/college-season`);
                      setSearchQuery('');
                      setSearchOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bone transition-colors text-left"
                  >
                    {p.player_id && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_60,q_auto:best/v1/people/${p.player_id}/headshot/silo/current`}
                        alt={p.full_name}
                        className="w-7 h-7 object-cover flex-shrink-0"
                      />
                    )}
                    <div>
                      <div className="text-xs font-semibold text-deep-fg">{p.full_name}</div>
                      <div className="text-[10px] text-ink-3">{p.team}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Toolbar ── */}
      <div className="container mx-auto px-4 py-2 flex justify-end gap-2 export-ignore">
        <button
          onClick={() => setLight(l => !l)}
          className="px-3 py-1.5 text-xs font-semibold border border-ink/30 bg-bone hover:bg-bone/60 text-ink-2 transition-colors"
        >
          {light ? '☾ Dark' : '☀ Light'}
        </button>
        <button
          onClick={handleCopy}
          disabled={capturing}
          className="px-3 py-1.5 text-xs font-semibold border border-ink/30 bg-bone hover:bg-bone/60 text-ink-2 transition-colors disabled:opacity-50"
        >
          {copied ? '✓ Copied' : '⎘ Copy'}
        </button>
        <button
          onClick={handleDownload}
          disabled={capturing}
          className="px-3 py-1.5 text-xs font-semibold border border-ink/30 bg-bone hover:bg-bone/60 text-ink-2 transition-colors disabled:opacity-50"
        >
          ↓ PNG
        </button>
      </div>

      {/* ── Card ── */}
      <div className="container mx-auto px-4 pb-10">
        <div ref={cardRef} className="max-w-3xl mx-auto" style={light ? { background: '#ffffff', border: BL } : {}}>

          {/* Player header */}
          <div className="relative p-4">
            {/* Watermark */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden">
              <span className="text-[80px] font-black uppercase tracking-tighter opacity-[0.04]" style={{ color: th.fg }}>
                {displayName.split(' ').pop()}
              </span>
            </div>

            <div className="relative flex items-center gap-4">
              {/* Headshot */}
              <div className="flex-shrink-0">
                <Image
                  src={currentImage}
                  alt={displayName}
                  width={80}
                  height={80}
                  className="object-cover"
                  onError={() => setImageError(e => e + 1)}
                  unoptimized
                />
              </div>

              {/* Name + bio */}
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-black uppercase tracking-tight" style={{ color: th.fg }}>
                  {displayName}
                </h1>
                {bio && (
                  <p className="text-xs mt-0.5" style={{ color: th.ink3 }}>{bio}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs mt-1" style={{ color: th.ink3 }}>
                  {data?.playerPitchHand && (
                    <span className="font-bold" style={{ color: th.fg }}>{data.playerPitchHand}HP</span>
                  )}
                  {teamName && (
                    <span className="font-bold" style={{ color: th.fg }}>{teamName}</span>
                  )}
                  <span style={{ color: th.ink4 }}>·</span>
                  <span className="text-green-400 font-semibold">{selectedYear} College Season</span>
                  {!loading && totals && (
                    <>
                      <span style={{ color: th.ink4 }}>·</span>
                      <span style={{ color: th.ink3 }}>{totals.games} outings · {totals.ip} IP</span>
                    </>
                  )}
                </div>
              </div>

              {/* Team logo */}
              {teamLogo && (
                <div className="flex-shrink-0 export-include">
                  <Image src={teamLogo} alt={teamName ?? ''} width={52} height={52} className="object-contain" unoptimized />
                </div>
              )}
            </div>
          </div>

          {/* Loading note */}
          {loading && (
            <div className="px-4 pb-2">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent animate-spin" />
                <span className="text-ink-3 text-xs">
                  Loading season data… may take 20–40 seconds for a full season.
                </span>
              </div>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="px-4 pb-3">
              <p className="text-red-400 text-xs bg-bone p-2">{error}</p>
            </div>
          )}

          {/* ── Season stat box ── */}
          {totals && !loading && (
            <div className="px-4 pb-4">
              <div className="grid grid-cols-11 gap-1.5">
                {(() => {
                  const kMinusBB = totals.kPct != null && totals.bbPct != null
                    ? (totals.kPct - totals.bbPct).toFixed(1) + '%' : '—';
                  return [
                    { label: 'G',     value: String(totals.games) },
                    { label: 'IP',    value: totals.ip },
                    { label: 'ERA',   value: totals.era?.toFixed(2) ?? '—' },
                    { label: 'WHIP',  value: totals.whip?.toFixed(2) ?? '—' },
                    { label: 'H',     value: String(totals.h) },
                    { label: 'ER',    value: String(totals.er) },
                    { label: 'BB%',   value: totals.bbPct != null ? `${totals.bbPct.toFixed(1)}%` : '—' },
                    { label: 'K%',    value: totals.kPct  != null ? `${totals.kPct.toFixed(1)}%`  : '—' },
                    { label: 'K-BB%', value: kMinusBB },
                    { label: 'HR',    value: String(totals.hr) },
                    { label: 'STR%',  value: totals.strikePct != null ? `${totals.strikePct}%` : '—' },
                  ];
                })().map(s => (
                  <div key={s.label} className="py-2 text-center" style={{ background: 'transparent', border: '1px solid #000000' }}>
                    <div className="text-[9px] uppercase font-semibold" style={{ color: th.ink4 }}>{s.label}</div>
                    <div className="font-bold tabular-nums" style={{ fontSize: 18, color: th.fg }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* K/9 BB/9 H/9 row */}
              <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                {[
                  { label: 'K/9',  value: totals.k9?.toFixed(1)  ?? '—' },
                  { label: 'BB/9', value: totals.bb9?.toFixed(1) ?? '—' },
                  { label: 'H/9',  value: totals.h9?.toFixed(1)  ?? '—' },
                ].map(s => (
                  <div key={s.label} className="py-2 text-center" style={{ background: 'transparent', border: '1px solid #000000' }}>
                    <div className="text-[9px] uppercase font-semibold" style={{ color: th.ink4 }}>{s.label}</div>
                    <div className="font-bold tabular-nums" style={{ fontSize: 18, color: th.fg }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Charts row ── */}
          <div className="px-4 pb-4">
            <div className="flex flex-wrap justify-center gap-4">

              {/* Location: vs LHH */}
              {hasStatcast && (
                <div className="flex flex-col items-center">
                  <PitchLocationChart rawDots={rawDots} batterSide="L" label="vs LHH" />
                  {usageByHand.L.length > 0 && (
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 justify-center mt-1 px-1" style={{ width: 260 }}>
                      {usageByHand.L.map(({ name, pct, velo }) => {
                        const col   = pitchColors(name);
                        const short = PITCH_SHORT[name] ?? name;
                        return (
                          <div key={name} className="flex items-center gap-1">
                            <span className="px-1 py-px rounded text-[9px] font-bold leading-none" style={{ background: col.bg, color: col.text }}>{short}</span>
                            <span className="text-[10px] font-medium" style={{ color: th.fg }}>{pct.toFixed(0)}%</span>
                            {velo !== null && <span className="text-[10px]" style={{ color: th.ink3 }}>{velo.toFixed(1)}</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Location: vs RHH */}
              {hasStatcast && (
                <div className="flex flex-col items-center">
                  <PitchLocationChart rawDots={rawDots} batterSide="R" label="vs RHH" />
                  {usageByHand.R.length > 0 && (
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 justify-center mt-1 px-1" style={{ width: 260 }}>
                      {usageByHand.R.map(({ name, pct, velo }) => {
                        const col   = pitchColors(name);
                        const short = PITCH_SHORT[name] ?? name;
                        return (
                          <div key={name} className="flex items-center gap-1">
                            <span className="px-1 py-px rounded text-[9px] font-bold leading-none" style={{ background: col.bg, color: col.text }}>{short}</span>
                            <span className="text-[10px] font-medium" style={{ color: th.fg }}>{pct.toFixed(0)}%</span>
                            {velo !== null && <span className="text-[10px]" style={{ color: th.ink3 }}>{velo.toFixed(1)}</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Movement chart */}
              <div className="flex flex-col items-center">
                {hasStatcast ? (
                  <PitchMovementChart
                    rawDots={rawDots}
                    throws={(data?.playerPitchHand) as 'L' | 'R' | undefined}
                  />
                ) : (
                  <div className="w-[260px] h-[260px] bg-bone flex items-center justify-center" style={th.statBox}>
                    <p className="text-ink-4 text-xs text-center px-6">
                      {loading ? 'Loading...' : 'No Statcast data available'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Pitch type table ── */}
          {pitches.length > 0 && (
            <div className="px-4 pb-4">
              <div className="overflow-x-auto" style={th.sectionStyle}>
                <table className="w-full table-fixed text-xs min-w-[560px]">
                  <colgroup>
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '6%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '7%' }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-ink/20" style={{ background: th.tableHeadBg || undefined }}>
                      {['Pitch', '#', 'Usage', 'Velo', 'Max', 'IVB', 'HB', 'Spin', 'Zone%', 'Whiff%', 'Whiffs'].map(h => (
                        <th key={h} className="px-1 py-2 text-[11px] font-semibold uppercase tracking-wider text-center" style={{ color: th.ink4 }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pitches.map(p => {
                      const col = pitchColors(p.name);
                      const short = PITCH_SHORT[p.name] ?? p.name;

                      const veloBm  = VELO_BENCHMARKS[p.name]  ?? { p10: 80,   p90: 97   };
                      const whiffBm = WHIFF_BENCHMARKS[p.name] ?? { p10: 10,   p90: 40   };
                      const veloT   = p.velo  != null ? Math.max(0, Math.min(1, (p.velo  - veloBm.p10)  / (veloBm.p90  - veloBm.p10)))  : null;
                      const whiffT  = p.whiff != null ? Math.max(0, Math.min(1, (p.whiff - whiffBm.p10) / (whiffBm.p90 - whiffBm.p10))) : null;
                      const veloWc  = veloT  != null ? getWhiffBgColor(veloT)  : null;
                      const whiffWc = whiffT != null ? getWhiffBgColor(whiffT) : null;

                      return (
                        <tr key={p.name} className="border-b border-ink/20/50 hover:bg-bone/20">
                          <td className="px-1 py-1.5">
                            <div className="flex items-center gap-1 justify-center">
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0"
                                style={{ backgroundColor: col.bg, color: col.text }}>
                                {short}
                              </span>
                              <span className="text-[9px] truncate" style={{ color: th.ink3 }}>{p.name}</span>
                            </div>
                          </td>
                          <td className="px-1 py-1.5 text-center font-semibold" style={{ color: th.fg }}>{p.count}</td>
                          <td className="px-1 py-1.5 text-center font-semibold" style={{ color: th.fg }}>{p.usage.toFixed(1)}%</td>
                          <td className="px-1 py-1.5 text-center font-semibold"
                            style={veloWc ? { backgroundColor: veloWc.bg, color: veloWc.text } : { color: th.fg }}>
                            {p.velo?.toFixed(1) ?? '—'}
                          </td>
                          <td className="px-1 py-1.5 text-center" style={{ color: th.fg }}>{p.maxVelo?.toFixed(1) ?? '—'}</td>
                          <td className="px-1 py-1.5 text-center" style={{ color: th.fg }}>{p.v_movement?.toFixed(1) ?? '—'}</td>
                          <td className="px-1 py-1.5 text-center" style={{ color: th.fg }}>{p.h_movement?.toFixed(1) ?? '—'}</td>
                          <td className="px-1 py-1.5 text-center" style={{ color: th.fg }}>{p.spin != null ? p.spin.toLocaleString() : '—'}</td>
                          <td className="px-1 py-1.5 text-center" style={{ color: th.fg }}>{p.zone_pct?.toFixed(1) ?? '—'}%</td>
                          <td className="px-1 py-1.5 text-center font-semibold"
                            style={whiffWc ? { backgroundColor: whiffWc.bg, color: whiffWc.text } : { color: th.fg }}>
                            {p.whiff?.toFixed(1) ?? '—'}%
                          </td>
                          <td className="px-1 py-1.5 text-center" style={{ color: th.fg }}>{p.whiffs}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Game log ── */}
          {outings.length > 0 && (
            <div className="px-4 pb-4">
              <div className="overflow-x-auto" style={th.sectionStyle}>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-ink/20" style={{ background: th.tableHeadBg || undefined }}>
                      {['Date', 'Opp', 'IP', 'H', 'ER', 'BB', 'K', 'HR', 'P'].map(h => (
                        <th key={h} className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: th.ink4 }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {outings.map((o, i) => (
                      <tr
                        key={i}
                        className="border-b border-ink/20/50 hover:bg-bone/30 cursor-pointer transition-colors"
                        onClick={() => router.push(`/pitcher/${id}/daily?date=${o.date}`)}
                      >
                        <td className="px-2 py-1.5 text-center font-medium" style={{ color: th.fg }}>{o.dateShort}</td>
                        <td className="px-2 py-1.5 text-center" style={{ color: th.ink2 }}>
                          {o.isHome === false && <span className="text-ink-4 mr-0.5">@</span>}
                          {o.opponent ?? '—'}
                        </td>
                        <td className="px-2 py-1.5 text-center font-semibold" style={{ color: th.fg }}>{o.ip}</td>
                        <td className="px-2 py-1.5 text-center" style={{ color: th.fg }}>{o.h}</td>
                        <td className="px-2 py-1.5 text-center" style={{ color: o.er > 0 ? '#ef4444' : th.fg }}>{o.er}</td>
                        <td className="px-2 py-1.5 text-center" style={{ color: th.fg }}>{o.bb}</td>
                        <td className="px-2 py-1.5 text-center font-semibold" style={{ color: o.k >= 8 ? '#16a34a' : th.fg }}>{o.k}</td>
                        <td className="px-2 py-1.5 text-center" style={{ color: o.hr > 0 ? '#ef4444' : th.fg }}>{o.hr}</td>
                        <td className="px-2 py-1.5 text-center" style={{ color: th.ink3 }}>{o.pitches || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="px-4 py-3 border-t border-ink/20 text-center">
            <p className="text-[10px]" style={{ color: th.ink4 }}>
              Data:{' '}
              <a href="https://statsapi.mlb.com" className="text-blue-400 hover:underline" target="_blank" rel="noreferrer">MLB Stats API</a>
              {' · '}
              <a href="https://baseballsavant.mlb.com" className="text-blue-400 hover:underline" target="_blank" rel="noreferrer">Baseball Savant</a>
              {' · '}{selectedYear} College Season
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
