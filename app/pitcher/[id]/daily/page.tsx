'use client';

import { use, useState, useEffect, useCallback, useMemo } from 'react';
import { getPitcherById, getPitcherByName } from '@/lib/pitcher-database';
import { DEFAULT_DATASET_ID, DATASETS } from '@/lib/datasets';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import { getCountryFlagUrl } from '@/lib/country-flags';
import Image from 'next/image';
import Link from 'next/link';
import { RawDot, PITCH_COLORS, PITCH_SHORT, pitchColors, PitchLocationChart, PitchMovementChart } from '@/components/PitchCharts';

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
  maxVelo: number | null;
  spin: number | null;
  h_movement: number | null;
  v_movement: number | null;
  vaa: number | null;
  haa: number | null;
  whiff: number | null;
  whiffs: number;
  zone_pct: number | null;
  barrel_pct: number | null;
  h_rel: number | null;
  v_rel: number | null;
  extension: number | null;
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

// RawDot imported from @/components/PitchCharts

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
  playerHeight: string | null;
  playerWeight: number | null;
  playerBirthDate: string | null;
  playerPitchHand: string | null;
  playerBatSide: string | null;
  date: string;
  gameLine: GameLine;
  gameInfo: GameInfo;
  pitchData: PitchData | null;
  availableDates: AvailableDate[];
}

// PITCH_COLORS, PITCH_SHORT, pitchColors imported from @/components/PitchCharts

// ─── 2025 MLB velo benchmarks by pitch type (p10 / p90 from pitchers.json) ───
// p10 → dark blue, p90 → dark red, midpoint → white
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

// ─── 2025 MLB extension benchmark (global — doesn't vary by pitch type) ───────
// p10 → dark blue, p90 → dark red, midpoint → white
const EXT_BENCHMARK = { p10: 5.9, p90: 6.9 };

// ─── 2025 MLB barrel% benchmarks by pitch type (p10 / p90 from pitchers.json) ─
// p10 → dark blue, p90 → dark red, midpoint → white
// Note: computed as barrels / pitches thrown for that type
const BARREL_BENCHMARKS: Record<string, { p10: number; p90: number }> = {
  '4-Seam Fastball': { p10: 0, p90:  9.9 },
  'Sinker':          { p10: 0, p90:  8.8 },
  'Cutter':          { p10: 0, p90: 12.5 },
  'Changeup':        { p10: 0, p90: 10.0 },
  'Splitter':        { p10: 0, p90:  9.1 },
  'Curveball':       { p10: 0, p90: 10.7 },
  'Knuckle Curve':   { p10: 0, p90:  8.3 },
  'Slider':          { p10: 0, p90: 10.7 },
  'Sweeper':         { p10: 0, p90: 10.3 },
  'Slurve':          { p10: 0, p90:  7.1 },
};

// ─── 2025 MLB zone% benchmarks by pitch type (p10 / p90 from pitchers.json) ──
// p10 → dark blue, p90 → dark red, midpoint → white
const ZONE_BENCHMARKS: Record<string, { p10: number; p90: number }> = {
  '4-Seam Fastball': { p10: 45.2, p90: 63.2 },
  'Sinker':          { p10: 43.5, p90: 66.1 },
  'Cutter':          { p10: 39.6, p90: 64.0 },
  'Changeup':        { p10: 23.8, p90: 50.2 },
  'Splitter':        { p10: 23.8, p90: 50.0 },
  'Curveball':       { p10: 29.1, p90: 54.5 },
  'Knuckle Curve':   { p10: 32.7, p90: 55.0 },
  'Slider':          { p10: 33.3, p90: 58.3 },
  'Sweeper':         { p10: 31.4, p90: 56.1 },
  'Slurve':          { p10: 25.0, p90: 49.1 },
};

// ─── 2025 MLB whiff% benchmarks by pitch type (p10 / p90 from pitchers.json) ─
// p10 → dark blue, p90 → dark red, midpoint → white
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

function calcAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

// Interpolates dark blue (t=0) → white (t=0.5) → dark red (t=1) for whiff conditional formatting
function getWhiffBgColor(t: number): { bg: string; text: string } {
  const c = Math.max(0, Math.min(1, t));
  let r: number, g: number, b: number;
  if (c <= 0.5) {
    const s = c / 0.5;
    r = Math.round(30 + s * (255 - 30));
    g = Math.round(58 + s * (255 - 58));
    b = Math.round(138 + s * (255 - 138));
  } else {
    const s = (c - 0.5) / 0.5;
    r = Math.round(255 + s * (127 - 255));
    g = Math.round(255 + s * (29 - 255));
    b = Math.round(255 + s * (29 - 255));
  }
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return { bg: `rgb(${r}, ${g}, ${b})`, text: luminance > 0.5 ? '#111827' : '#ffffff' };
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
  const [playerBio, setPlayerBio] = useState<{
    height: string | null; weight: number | null;
    birthDate: string | null; pitchHand: string | null; batSide: string | null;
  } | null>(null);
  const [pitchOverrides, setPitchOverrides] = useState<Record<number, string>>({});
  const [reclassifyDot, setReclassifyDot] = useState<{ index: number; nearbyIndices: number[]; x: number; y: number } | null>(null);

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
      // Always extract bio regardless of success/error
      if (json.playerHeight || json.playerWeight || json.playerBirthDate) {
        setPlayerBio({
          height: json.playerHeight ?? null,
          weight: json.playerWeight ?? null,
          birthDate: json.playerBirthDate ?? null,
          pitchHand: json.playerPitchHand ?? null,
          batSide: json.playerBatSide ?? null,
        });
      }
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
    setPitchOverrides({});
    setReclassifyDot(null);
    fetchData(date);
  };

  // Effective rawDots with overrides applied (used for movement chart colors)
  const effectiveRawDots = useMemo(() => {
    if (!data?.pitchData?.rawDots) return [];
    return data.pitchData.rawDots.map((dot, i) => ({
      ...dot,
      pitchType: pitchOverrides[i] ?? dot.pitchType,
    }));
  }, [data?.pitchData?.rawDots, pitchOverrides]);

  // Pitch type table recomputed from effective dots
  const computedPitchTypes = useMemo((): PitchType[] => {
    const originalTypes = data?.pitchData?.pitchTypes ?? [];
    if (Object.keys(pitchOverrides).length === 0) return originalTypes;

    const total = effectiveRawDots.length;
    const countByType: Record<string, number> = {};
    const whiffsByType: Record<string, number> = {};
    const inZoneByType: Record<string, number> = {};
    const barrelsByType: Record<string, number> = {};
    const hbSumByType: Record<string, number> = {};
    const ivbSumByType: Record<string, number> = {};
    const veloSumByType: Record<string, number> = {};
    const veloCntByType: Record<string, number> = {};
    const maxVeloByType: Record<string, number> = {};
    const spinSumByType: Record<string, number> = {};
    const spinCntByType: Record<string, number> = {};
    const vaaSumByType: Record<string, number> = {};
    const vaaCntByType: Record<string, number> = {};
    const haaSumByType: Record<string, number> = {};
    const haaCntByType: Record<string, number> = {};
    const hRelSumByType: Record<string, number> = {};
    const hRelCntByType: Record<string, number> = {};
    const vRelSumByType: Record<string, number> = {};
    const vRelCntByType: Record<string, number> = {};
    const extSumByType: Record<string, number> = {};
    const extCntByType: Record<string, number> = {};

    for (const dot of effectiveRawDots) {
      countByType[dot.pitchType] = (countByType[dot.pitchType] ?? 0) + 1;
      if (dot.isWhiff) whiffsByType[dot.pitchType] = (whiffsByType[dot.pitchType] ?? 0) + 1;
      if (dot.isBarrel) barrelsByType[dot.pitchType] = (barrelsByType[dot.pitchType] ?? 0) + 1;
      if (dot.px !== null && dot.pz !== null &&
          dot.px >= -0.708 && dot.px <= 0.708 && dot.pz >= 1.5 && dot.pz <= 3.5) {
        inZoneByType[dot.pitchType] = (inZoneByType[dot.pitchType] ?? 0) + 1;
      }
      hbSumByType[dot.pitchType] = (hbSumByType[dot.pitchType] ?? 0) + dot.hb;
      ivbSumByType[dot.pitchType] = (ivbSumByType[dot.pitchType] ?? 0) + dot.ivb;
      if (dot.velo !== null) {
        veloSumByType[dot.pitchType] = (veloSumByType[dot.pitchType] ?? 0) + dot.velo;
        veloCntByType[dot.pitchType] = (veloCntByType[dot.pitchType] ?? 0) + 1;
        maxVeloByType[dot.pitchType] = Math.max(maxVeloByType[dot.pitchType] ?? 0, dot.velo);
      }
      if (dot.spin !== null) {
        spinSumByType[dot.pitchType] = (spinSumByType[dot.pitchType] ?? 0) + dot.spin;
        spinCntByType[dot.pitchType] = (spinCntByType[dot.pitchType] ?? 0) + 1;
      }
      if (dot.vaa !== null) {
        vaaSumByType[dot.pitchType] = (vaaSumByType[dot.pitchType] ?? 0) + dot.vaa;
        vaaCntByType[dot.pitchType] = (vaaCntByType[dot.pitchType] ?? 0) + 1;
      }
      if (dot.haa !== null) {
        haaSumByType[dot.pitchType] = (haaSumByType[dot.pitchType] ?? 0) + dot.haa;
        haaCntByType[dot.pitchType] = (haaCntByType[dot.pitchType] ?? 0) + 1;
      }
      if (dot.hRel !== null) {
        hRelSumByType[dot.pitchType] = (hRelSumByType[dot.pitchType] ?? 0) + dot.hRel;
        hRelCntByType[dot.pitchType] = (hRelCntByType[dot.pitchType] ?? 0) + 1;
      }
      if (dot.vRel !== null) {
        vRelSumByType[dot.pitchType] = (vRelSumByType[dot.pitchType] ?? 0) + dot.vRel;
        vRelCntByType[dot.pitchType] = (vRelCntByType[dot.pitchType] ?? 0) + 1;
      }
      if (dot.extension !== null) {
        extSumByType[dot.pitchType] = (extSumByType[dot.pitchType] ?? 0) + dot.extension;
        extCntByType[dot.pitchType] = (extCntByType[dot.pitchType] ?? 0) + 1;
      }
    }

    const allTypeNames = new Set([
      ...Object.keys(countByType),
      ...originalTypes.map(p => p.name),
    ]);

    return Array.from(allTypeNames)
      .filter(name => (countByType[name] ?? 0) > 0)
      .map(name => {
        const orig = originalTypes.find(p => p.name === name);
        const count = countByType[name] ?? 0;
        const whiffs = whiffsByType[name] ?? 0;
        const inZone = inZoneByType[name] ?? 0;
        const barrels = barrelsByType[name] ?? 0;
        return {
          name,
          count,
          usage: total > 0 ? (count / total) * 100 : 0,
          velo: (veloCntByType[name] ?? 0) > 0 ? parseFloat((veloSumByType[name] / veloCntByType[name]).toFixed(1)) : (orig?.velo ?? null),
          maxVelo: (veloCntByType[name] ?? 0) > 0 ? parseFloat(maxVeloByType[name].toFixed(1)) : (orig?.maxVelo ?? null),
          spin: (spinCntByType[name] ?? 0) > 0 ? Math.round(spinSumByType[name] / spinCntByType[name]) : (orig?.spin ?? null),
          h_movement: count > 0 ? parseFloat((hbSumByType[name] / count).toFixed(1)) : (orig?.h_movement ?? null),
          v_movement: count > 0 ? parseFloat((ivbSumByType[name] / count).toFixed(1)) : (orig?.v_movement ?? null),
          vaa: (vaaCntByType[name] ?? 0) > 0 ? parseFloat((vaaSumByType[name] / vaaCntByType[name]).toFixed(2)) : (orig?.vaa ?? null),
          haa: (haaCntByType[name] ?? 0) > 0 ? parseFloat((haaSumByType[name] / haaCntByType[name]).toFixed(2)) : (orig?.haa ?? null),
          whiff: count > 0 ? (whiffs / count) * 100 : null,
          whiffs,
          zone_pct: count > 0 ? (inZone / count) * 100 : null,
          barrel_pct: count > 0 ? (barrels / count) * 100 : null,
          h_rel: (hRelCntByType[name] ?? 0) > 0 ? parseFloat((hRelSumByType[name] / hRelCntByType[name]).toFixed(2)) : (orig?.h_rel ?? null),
          v_rel: (vRelCntByType[name] ?? 0) > 0 ? parseFloat((vRelSumByType[name] / vRelCntByType[name]).toFixed(2)) : (orig?.v_rel ?? null),
          extension: (extCntByType[name] ?? 0) > 0 ? parseFloat((extSumByType[name] / extCntByType[name]).toFixed(2)) : (orig?.extension ?? null),
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [effectiveRawDots, data?.pitchData?.pitchTypes, pitchOverrides]);

  // Use playerId from static DB or from URL — works for any MLB player
  const resolvedPlayerId = playerId;
  const displayName = pitcher?.full_name ?? data?.playerName ?? `Player ${id}`;

  const imageSources = [
    resolvedPlayerId ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_426,q_auto:best/v1/people/${resolvedPlayerId}/headshot/silo/current` : null,
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
            <div className="flex items-center gap-2">
              {pitcher && (
                <Link
                  href={`/pitcher/${id}`}
                  className="px-3 py-1.5 bg-[#0d1b2a] hover:bg-[#1a2940] border border-gray-600 hover:border-blue-500 text-gray-300 hover:text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  📊 Season Card
                </Link>
              )}
              <Link
                href={`/pitcher/${id}/spring-summary`}
                className="px-3 py-1.5 bg-[#0d1b2a] hover:bg-[#1a2940] border border-green-700 hover:border-green-500 text-green-400 hover:text-green-300 rounded-lg text-xs font-semibold transition-colors"
              >
                🌱 Spring Summary
              </Link>
            </div>
            <Link href="/" className="text-green-400 hover:text-green-300 font-medium text-sm">
              View Hitters →
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6" style={{ maxWidth: 1088 }}>

        {/* ── CARD ─── */}
        <div className="bg-[#16213e] rounded-xl p-6 mb-6">

          {/* Top: centered name/bio/game info + stats absolutely right */}
          <div className="relative mb-5">
            {/* Centered: photo + name/bio/game info */}
            <div className="flex flex-col items-center">
              <div className="flex items-center justify-center gap-4 mb-1">
                <div className="flex items-start gap-2">
                  {(() => {
                    const flag = getCountryFlagUrl(gameInfo?.team ?? null, 80);
                    return flag ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={flag} alt={gameInfo?.team ?? ''} className="w-8 h-[22px] object-cover rounded-sm flex-shrink-0 mt-1" />
                    ) : null;
                  })()}
                  <div className="flex-shrink-0 w-20 rounded-lg overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={currentImage || '/api/placeholder/400/400'}
                      alt={displayName}
                      className="w-full h-auto"
                      onError={() => setImageError(e => Math.min(e + 1, imageSources.length - 1))}
                    />
                  </div>
                </div>
                <div className="flex flex-col items-center">
                  <div className="flex items-center gap-3 mb-0.5">
                    <h1 className="text-3xl font-bold">{displayName}</h1>
                    {teamLogo && <img src={teamLogo} alt={pitcher?.team || gameInfo?.team || ''} className="w-10 h-10 object-contain flex-shrink-0" />}
                  </div>
                  {/* Bio line */}
                  {(() => {
                    const age = calcAge(playerBio?.birthDate ?? null);
                    const parts: string[] = [];
                    if (playerBio?.height) parts.push(playerBio.height);
                    if (playerBio?.weight) parts.push(`${playerBio.weight} lbs`);
                    if (age !== null) parts.push(`Age ${age}`);
                    if (playerBio?.pitchHand && playerBio?.batSide) parts.push(`${playerBio.batSide}/${playerBio.pitchHand}`);
                    return parts.length > 0 ? (
                      <p className="text-sm text-white-400 mb-1">{parts.join(' • ')}</p>
                    ) : null;
                  })()}
                  {/* Game info */}
                  <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-xs text-gray-400">
                    {pitcher?.throws && <span className="font-bold text-white">{pitcher.throws}HP</span>}
                    {(pitcher?.team || gameInfo?.team) && <span className="font-bold text-white">{pitcher?.team || gameInfo?.team}</span>}
                    {gameInfo && (
                      <>
                        <span className="text-white-600">·</span>
                        <span>{gameInfo.date}</span>
                        <span className="text-white-600">·</span>
                        <span className="flex items-center gap-1">
                          {gameInfo.isHome ? 'vs' : '@'}
                          {opponentLogo && <img src={opponentLogo} alt={gameInfo.opponent || ''} className="w-4 h-4 object-contain inline" />}
                          <span className="font-semibold text-white">{gameInfo.opponentFull || gameInfo.opponent}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Stats — absolutely positioned top-right */}
            {gameLine && !loading && (
              <div className="absolute top-0 right-16 grid grid-cols-4 gap-3">
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
                  <div key={s.label} className="px-1 py-1 text-center bg-[#0d1b2a] border border-gray-600">
                    <div className="text-[7px] text-white-400 uppercase font-semibold">{s.label}</div>
                    <div className="text-sm font-bold">{s.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Loading / Error */}
          {loading && (
            <div className="flex items-center gap-2 mb-3">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-gray-400 text-xs">Loading...</span>
            </div>
          )}
          {!loading && error && (
            <div className="bg-[#0d1b2a] rounded-lg p-2 mb-3">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          {/* Charts row — centered */}
          <div className="relative flex justify-center gap-4">
            {/* vs LHH location chart — colors update when pitches are reclassified */}
            {(data?.pitchData?.rawDots?.length ?? 0) > 0 && (
              <PitchLocationChart
                rawDots={data!.pitchData!.rawDots}
                batterSide="L" label="vs LHH"
                pitchOverrides={pitchOverrides}
              />
            )}
            {/* vs RHH location chart */}
            {(data?.pitchData?.rawDots?.length ?? 0) > 0 && (
              <PitchLocationChart
                rawDots={data!.pitchData!.rawDots}
                batterSide="R" label="vs RHH"
                pitchOverrides={pitchOverrides}
              />
            )}
            {/* Movement chart — click dots here to reclassify */}
            <div className="flex flex-col items-center">
              {(data?.pitchData?.rawDots?.length ?? 0) > 0 ? (
                <PitchMovementChart
                  rawDots={effectiveRawDots}
                  throws={(data?.playerPitchHand ?? playerBio?.pitchHand ?? pitcher?.throws) as 'L' | 'R' | undefined}
                  armAngle={data?.pitchData?.armAngle ?? undefined}
                  pitchOverrides={pitchOverrides}
                  onDotClick={(origIndex, nearbyIndices, e) => {
                    setReclassifyDot(prev =>
                      prev?.index === origIndex ? null : { index: origIndex, nearbyIndices, x: e.clientX, y: e.clientY }
                    );
                  }}
                />
              ) : (
                <div className="w-[320px] h-[320px] bg-[#d1d5db] rounded-lg flex items-center justify-center">
                  <p className="text-gray-500 text-xs text-center px-6">
                    {loading ? 'Loading...' : 'No Statcast data available for this game'}
                  </p>
                </div>
              )}
            </div>

            {/* Reclassify popup — fixed position relative to viewport */}
            {reclassifyDot && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setReclassifyDot(null)} />
                <div
                  className="fixed bg-[#0d1421] border border-blue-500/60 rounded-lg shadow-2xl z-50 p-2"
                  style={{
                    left: reclassifyDot.x > (typeof window !== 'undefined' ? window.innerWidth : 1200) - 170
                      ? reclassifyDot.x - 162 : reclassifyDot.x + 10,
                    top: reclassifyDot.y > (typeof window !== 'undefined' ? window.innerHeight : 800) - 290
                      ? reclassifyDot.y - 280 : reclassifyDot.y - 10,
                    minWidth: 152,
                  }}
                  onClick={e => e.stopPropagation()}
                >
                  {/* Overlapping dots selector */}
                  {reclassifyDot.nearbyIndices.length > 1 && (
                    <div className="mb-2">
                      <div className="text-[8px] text-gray-400 uppercase tracking-wide mb-1">
                        {reclassifyDot.nearbyIndices.length} overlapping — select:
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {reclassifyDot.nearbyIndices.map(ni => {
                          const rd = data?.pitchData?.rawDots ?? [];
                          const effectiveType = pitchOverrides[ni] ?? rd[ni]?.pitchType ?? '?';
                          const col = pitchColors(effectiveType);
                          const isSelected = reclassifyDot.index === ni;
                          return (
                            <button
                              key={ni}
                              onClick={() => setReclassifyDot(prev => prev ? { ...prev, index: ni } : null)}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border transition-colors ${
                                isSelected
                                  ? 'border-blue-400 bg-blue-600/40 text-white'
                                  : 'border-gray-600 bg-gray-700/40 text-gray-300 hover:border-gray-400'
                              }`}
                            >
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: col.color }} />
                              #{ni + 1}
                            </button>
                          );
                        })}
                      </div>
                      <div className="border-t border-gray-700/60 mt-2 mb-1" />
                    </div>
                  )}
                  <div className="text-[9px] text-blue-300 font-bold uppercase tracking-wide mb-1.5">
                    Pitch #{reclassifyDot.index + 1} · reclassify
                  </div>
                  <div className="flex flex-col gap-px">
                    {Object.keys(PITCH_COLORS).map(name => {
                      const rawDots = data?.pitchData?.rawDots ?? [];
                      const isCurrent = (pitchOverrides[reclassifyDot.index] ?? rawDots[reclassifyDot.index]?.pitchType) === name;
                      const isOriginal = rawDots[reclassifyDot.index]?.pitchType === name && !pitchOverrides[reclassifyDot.index];
                      return (
                        <button
                          key={name}
                          onClick={() => {
                            setPitchOverrides(prev => ({ ...prev, [reclassifyDot.index]: name }));
                            setReclassifyDot(null);
                          }}
                          className={`flex items-center gap-2 px-2 py-[3px] rounded text-left w-full transition-colors ${
                            isCurrent ? 'bg-blue-600/40 text-white' : 'hover:bg-[#1a2940] text-gray-200'
                          }`}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-white/20"
                            style={{ background: pitchColors(name).color }}
                          />
                          <span className="text-[11px] flex-1">{name}</span>
                          {isCurrent && <span className="text-[9px] text-blue-300">✓</span>}
                          {isOriginal && <span className="text-[8px] text-gray-500">orig</span>}
                        </button>
                      );
                    })}
                    {pitchOverrides[reclassifyDot.index] !== undefined && (
                      <button
                        onClick={() => {
                          setPitchOverrides(prev => { const n = { ...prev }; delete n[reclassifyDot.index]; return n; });
                          setReclassifyDot(null);
                        }}
                        className="text-[10px] text-red-400 hover:text-red-300 px-2 py-1 mt-0.5 border-t border-gray-700/60 text-left"
                      >
                        ↩ Reset to original
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

        </div>

        {/* ── Pitch stats table ─── */}
        {computedPitchTypes.length > 0 && (() => {
        return (
          <div className="bg-[#16213e] rounded-xl overflow-hidden mb-6">
            {/* Reclassification banner */}
            {Object.keys(pitchOverrides).length > 0 && (
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-blue-900/20">
                <span className="text-[10px] text-blue-300 font-semibold uppercase tracking-wide">
                  {Object.keys(pitchOverrides).length} pitch{Object.keys(pitchOverrides).length !== 1 ? 'es' : ''} reclassified
                </span>
                <button
                  onClick={() => setPitchOverrides({})}
                  className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
                >
                  Reset all
                </button>
              </div>
            )}
            <div>
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '6%' }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-700 bg-[#0d1b2a]">
                    {['Pitch', 'Pitches', 'Usage', 'Velo', 'Max Velo', 'IVB', 'HB', 'Spin', 'VAA', 'HAA', 'vRel', 'hRel', 'Ext.', 'Zone%', 'Barrel%', 'Whiff%', 'Whiffs'].map(h => (
                      <th key={h} className="px-1 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-center">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {computedPitchTypes.map(p => {
                    const col = pitchColors(p.name);
                    const shortName = PITCH_SHORT[p.name] ?? p.name;
                    return (
                      <tr key={p.name} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                        <td className="px-1 py-1.5">
                          <div className="flex items-center gap-1 justify-center">
                            <span
                              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0"
                              style={{ backgroundColor: col.bg, color: col.text }}
                            >
                              {shortName}
                            </span>
                            <span className="text-[9px] text-gray-300 truncate">{p.name}</span>
                          </div>
                        </td>
                        <td className="px-1 py-1.5 text-center font-semibold">{p.count}</td>
                        <td className="px-1 py-1.5 text-center font-semibold">{p.usage.toFixed(1)}%</td>
                        {(() => {
                          const bm = VELO_BENCHMARKS[p.name] ?? { p10: 80, p90: 97 };
                          const t = p.velo !== null ? Math.max(0, Math.min(1, (p.velo - bm.p10) / (bm.p90 - bm.p10))) : 0.5;
                          const wc = p.velo !== null ? getWhiffBgColor(t) : null;
                          return (
                            <td className="px-1 py-1.5 text-center font-semibold" style={{ backgroundColor: wc?.bg, color: wc?.text }}>
                              {p.velo?.toFixed(1) ?? '—'}
                            </td>
                          );
                        })()}
                        {(() => {
                          const bm = VELO_BENCHMARKS[p.name] ?? { p10: 80, p90: 97 };
                          const t = p.maxVelo !== null ? Math.max(0, Math.min(1, (p.maxVelo - bm.p10) / (bm.p90 - bm.p10))) : 0.5;
                          const wc = p.maxVelo !== null ? getWhiffBgColor(t) : null;
                          return (
                            <td className="px-1 py-1.5 text-center font-semibold" style={{ backgroundColor: wc?.bg, color: wc?.text }}>
                              {p.maxVelo?.toFixed(1) ?? '—'}
                            </td>
                          );
                        })()}
                        <td className="px-1 py-1.5 text-center font-semibold">{p.v_movement?.toFixed(1) ?? '—'}</td>
                        <td className="px-1 py-1.5 text-center font-semibold">{p.h_movement?.toFixed(1) ?? '—'}</td>
                        <td className="px-1 py-1.5 text-center font-semibold">{p.spin ?? '—'}</td>
                        <td className="px-1 py-1.5 text-center font-semibold">
                          {p.vaa !== null ? `${p.vaa.toFixed(1)}°` : '—'}
                        </td>
                        <td className="px-1 py-1.5 text-center font-semibold">
                          {p.haa !== null ? `${p.haa.toFixed(1)}°` : '—'}
                        </td>
                        <td className="px-1 py-1.5 text-center font-semibold">{p.v_rel?.toFixed(2) ?? '—'}</td>
                        <td className="px-1 py-1.5 text-center font-semibold">{p.h_rel?.toFixed(2) ?? '—'}</td>
                        {(() => {
                          const t = p.extension !== null && p.extension !== undefined ? Math.max(0, Math.min(1, (p.extension - EXT_BENCHMARK.p10) / (EXT_BENCHMARK.p90 - EXT_BENCHMARK.p10))) : 0.5;
                          const wc = p.extension !== null && p.extension !== undefined ? getWhiffBgColor(t) : null;
                          return (
                            <td className="px-1 py-1.5 text-center font-semibold" style={{ backgroundColor: wc?.bg, color: wc?.text }}>
                              {p.extension?.toFixed(2) ?? '—'}
                            </td>
                          );
                        })()}
                        {(() => {
                          const bm = ZONE_BENCHMARKS[p.name] ?? { p10: 0, p90: 100 };
                          const t = p.zone_pct !== null && p.zone_pct !== undefined ? Math.max(0, Math.min(1, (p.zone_pct - bm.p10) / (bm.p90 - bm.p10))) : 0.5;
                          const wc = p.zone_pct !== null && p.zone_pct !== undefined ? getWhiffBgColor(t) : null;
                          return (
                            <td className="px-1 py-1.5 text-center font-semibold" style={{ backgroundColor: wc?.bg, color: wc?.text }}>
                              {p.zone_pct !== null && p.zone_pct !== undefined ? `${p.zone_pct.toFixed(1)}%` : '—'}
                            </td>
                          );
                        })()}
                        {(() => {
                          const bm = BARREL_BENCHMARKS[p.name] ?? { p10: 0, p90: 10 };
                          const t = p.barrel_pct !== null && p.barrel_pct !== undefined ? Math.max(0, Math.min(1, 1 - (p.barrel_pct - bm.p10) / (bm.p90 - bm.p10))) : 0.5;
                          const wc = p.barrel_pct !== null && p.barrel_pct !== undefined ? getWhiffBgColor(t) : null;
                          return (
                            <td className="px-1 py-1.5 text-center font-semibold" style={{ backgroundColor: wc?.bg, color: wc?.text }}>
                              {p.barrel_pct !== null && p.barrel_pct !== undefined ? `${p.barrel_pct.toFixed(1)}%` : '—'}
                            </td>
                          );
                        })()}
                        {(() => {
                          const bm = WHIFF_BENCHMARKS[p.name] ?? { p10: 0, p90: 100 };
                          const t = p.whiff !== null ? Math.max(0, Math.min(1, (p.whiff - bm.p10) / (bm.p90 - bm.p10))) : 0.5;
                          const wc = p.whiff !== null ? getWhiffBgColor(t) : null;
                          return (
                            <td className="px-1 py-1.5 text-center font-semibold" style={{ backgroundColor: wc?.bg, color: wc?.text }}>
                              {p.whiff !== null ? `${p.whiff.toFixed(1)}%` : '—'}
                            </td>
                          );
                        })()}
                        {(() => {
                          const bm = WHIFF_BENCHMARKS[p.name] ?? { p10: 0, p90: 100 };
                          const t = p.whiff !== null ? Math.max(0, Math.min(1, (p.whiff - bm.p10) / (bm.p90 - bm.p10))) : 0.5;
                          const wc = p.whiff !== null ? getWhiffBgColor(t) : null;
                          return (
                            <td className="px-1 py-1.5 text-center font-semibold" style={{ backgroundColor: wc?.bg, color: wc?.text }}>
                              {p.whiffs > 0 ? p.whiffs : '—'}
                            </td>
                          );
                        })()}
                      </tr>
                    );
                  })}
                  <tr className="bg-[#0d1b2a] font-bold border-t border-gray-600">
                    <td className="px-1 py-1.5 text-center">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-600 text-white">All</span>
                    </td>
                    <td className="px-1 py-1.5 text-center">{data?.pitchData?.totalPitches ?? '—'}</td>
                    <td className="px-1 py-1.5 text-center">100%</td>
                    <td className="px-1 py-1.5 text-center">—</td>
                    <td className="px-1 py-1.5 text-center">—</td>
                    <td className="px-1 py-1.5 text-center">—</td>
                    <td className="px-1 py-1.5 text-center">—</td>
                    <td className="px-1 py-1.5 text-center">—</td>
                    <td className="px-1 py-1.5 text-center">—</td>
                    <td className="px-1 py-1.5 text-center">—</td>
                    <td className="px-1 py-1.5 text-center">—</td>
                    <td className="px-1 py-1.5 text-center">—</td>
                    <td className="px-1 py-1.5 text-center">—</td>
                    <td className="px-1 py-1.5 text-center">—</td>
                    <td className="px-1 py-1.5 text-center">—</td>
                    <td className="px-1 py-1.5 text-center">
                      {data?.pitchData?.swingAndMissPct != null ? `${data.pitchData.swingAndMissPct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-1 py-1.5 text-center">
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
        ); })()}

        {/* No Statcast data message */}
        {!loading && !error && gameLine && pitches.length === 0 && (
          <>
            <div className="bg-[#16213e] rounded-xl p-8 text-center mb-6">
              <p className="text-gray-400 text-sm">
                No Statcast pitch data available for this game.
              </p>
              <p className="text-gray-600 text-xs mt-1">
                Statcast data typically posts within a few hours of game completion.
              </p>
            </div>
            <div className="text-center text-gray-600 text-xs py-4">
              Data: MLB Stats API · Baseball Savant
            </div>
          </>
        )}

      </div>
    </div>
  );
}
