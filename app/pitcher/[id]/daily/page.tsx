'use client';

import { use, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getPitcherById, getPitcherByName, searchAllPitchers, getAllPitchers, getAllPitchersForSimilarity } from '@/lib/pitcher-database';
import { Pitcher } from '@/types/pitcher';
import { DEFAULT_DATASET_ID, DATASETS } from '@/lib/datasets';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import { captureCardDesktop, shareOrCopyImage } from '@/lib/capture-card';
import { getCollegeLogoUrl } from '@/lib/college-logos';
import { getCountryFlagUrl } from '@/lib/country-flags';
import Image from 'next/image';
import Link from 'next/link';
import { RawDot, PITCH_COLORS, PITCH_SHORT, pitchColors, PitchLocationChart, PitchMovementChart } from '@/components/PitchCharts';
import PitcherInstagramCard from '@/components/PitcherInstagramCard';

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
  sportId: number;
}

// RawDot imported from @/components/PitchCharts

interface PitchData {
  totalPitches: number;
  pitchTypes: PitchType[];
  rawDots: RawDot[];
  throws: 'L' | 'R' | null;
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

interface FastballMetrics {
  pitchName: string;
  velo: number | null;
  ivb: number | null;
  hb: number | null;
  arm_angle: number | null;
}

const FB_METRICS: { key: keyof Omit<FastballMetrics, 'pitchName'>; label: string; unit: string; digits: number; higherBetter: boolean | null }[] = [
  { key: 'velo',      label: 'Velocity',  unit: ' mph', digits: 1, higherBetter: true  },
  { key: 'ivb',       label: 'IVB',       unit: '"',    digits: 1, higherBetter: true  },
  { key: 'hb',        label: 'HB',        unit: '"',    digits: 1, higherBetter: null  },
  { key: 'arm_angle', label: 'Arm Angle', unit: '°',    digits: 1, higherBetter: null  },
];

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

// dark navy (#163d6e) → white (t=0.5) → brand red (#ff2d2d) — matches daily hitters card
function getWhiffBgColor(t: number): { bg: string; text: string } {
  const c = Math.max(0, Math.min(1, t));
  let r: number, g: number, b: number;
  if (c <= 0.5) {
    // white → dark navy
    const s = (0.5 - c) / 0.5;
    r = Math.round(255 + s * (22  - 255));
    g = Math.round(255 + s * (61  - 255));
    b = Math.round(255 + s * (110 - 255));
  } else {
    // white → brand red #ff2d2d
    const s = (c - 0.5) / 0.5;
    r = 255;
    g = Math.round(255 + s * (45  - 255));
    b = Math.round(255 + s * (45  - 255));
  }
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return { bg: `rgb(${r}, ${g}, ${b})`, text: luminance > 0.5 ? '#111827' : '#ffffff' };
}

// ─── Fastball comparison helpers ──────────────────────────────────────────────

function getSeasonFastball(p: Pitcher | null | undefined): FastballMetrics | null {
  if (!p) return null;
  const aa = p.arm_angle ?? null;
  if (p.ff) return { pitchName: '4-Seam', velo: p.ff.velo ?? null, ivb: p.ff.movement_v ?? null, hb: p.ff.movement_h ?? null, arm_angle: aa };
  if (p.si) return { pitchName: 'Sinker',  velo: p.si.velo ?? null, ivb: p.si.movement_v ?? null, hb: p.si.movement_h ?? null, arm_angle: aa };
  if (p.fc) return { pitchName: 'Cutter',  velo: p.fc.velo ?? null, ivb: p.fc.movement_v ?? null, hb: p.fc.movement_h ?? null, arm_angle: aa };
  if (p.fastball_velo) return { pitchName: '4-Seam', velo: p.fastball_velo ?? null, ivb: p.fastball_movement_v ?? null, hb: p.fastball_movement_h ?? null, arm_angle: aa };
  return null;
}

function getGameFastball(pitchTypes: PitchType[], armAngle?: number | null): FastballMetrics | null {
  const fb = pitchTypes.find(p => p.name === '4-Seam Fastball')
    ?? pitchTypes.find(p => p.name === 'Sinker')
    ?? pitchTypes.find(p => p.name === 'Cutter');
  if (!fb) return null;
  const shortNames: Record<string, string> = { '4-Seam Fastball': '4-Seam', 'Sinker': 'Sinker', 'Cutter': 'Cutter' };
  return { pitchName: shortNames[fb.name] ?? fb.name, velo: fb.velo, ivb: fb.v_movement, hb: fb.h_movement, arm_angle: armAngle ?? null };
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
  const [instagramView, setInstagramView] = useState(false);
  const [customArmAngle, setCustomArmAngle] = useState<string>('');
  const [handFilter, setHandFilter] = useState<'all' | 'L' | 'R'>('all');
  const [apiPlayerName, setApiPlayerName] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [compareQuery, setCompareQuery] = useState('');
  const [compareResults, setCompareResults] = useState<Pitcher[]>([]);
  const [comparePitcher, setComparePitcher] = useState<Pitcher | null>(null);

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

  // Compute top similar pitchers using today's game fastball as the reference
  const similarPitchers = useMemo((): Pitcher[] => {
    const gamePitchTypes = (data?.pitchData?.pitchTypes ?? []) as PitchType[];
    const gameArmAngle = customArmAngle !== '' ? parseFloat(customArmAngle) : (data?.pitchData?.armAngle ?? null);
    const ref = getGameFastball(gamePitchTypes, gameArmAngle);
    if (!ref || ref.velo === null) return [];

    // Determine handedness for arm-side sign: prefer live data, then static, then R
    const throwsHand = (data?.pitchData?.throws ?? pitcher?.throws ?? 'R') as 'L' | 'R';
    // Arm-side sign for HB (game API already uses arm-side positive convention)
    const sign = throwsHand === 'L' ? -1 : 1;
    const refHB = ref.hb !== null ? ref.hb * sign : null;

    const scored: { p: Pitcher; score: number }[] = [];
    for (const p of getAllPitchersForSimilarity()) {
      if (p.player_id === pitcher?.player_id) continue;
      if (handFilter !== 'all' && p.throws !== handFilter) continue;
      const fb = getSeasonFastball(p);
      if (!fb || fb.velo === null) continue;
      const pSign = (p.throws ?? 'R') === 'L' ? -1 : 1;
      const pHB = fb.hb !== null ? fb.hb * pSign : null;
      let dist = 0; let terms = 0;
      if (ref.velo     !== null && fb.velo     !== null) { dist += ((fb.velo     - ref.velo)     / 2)  ** 2; terms++; }
      if (ref.ivb      !== null && fb.ivb      !== null) { dist += ((fb.ivb      - ref.ivb)      / 3)  ** 2; terms++; }
      if (refHB        !== null && pHB         !== null) { dist += ((pHB         - refHB)        / 3)  ** 2; terms++; }
      if (ref.arm_angle !== null && fb.arm_angle !== null) { dist += ((fb.arm_angle - ref.arm_angle) / 5) ** 2; terms++; }
      if (terms === 0) continue;
      // Require arm angle on both sides
      if (ref.arm_angle === null || fb.arm_angle === null) continue;
      scored.push({ p, score: Math.sqrt(dist / terms) });
    }
    return scored.sort((a, b) => a.score - b.score).slice(0, 6).map(s => s.p);
  }, [pitcher, data, customArmAngle, handFilter]);

  const fetchData = useCallback(async (date?: string, silent = false) => {
    if (!playerId) return;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const dateQuery = date ? `&date=${date}` : '';
      const res = await fetch(`/api/pitcher-daily?playerId=${playerId}${dateQuery}`);
      const json = await res.json();
      // Always extract name + bio regardless of success/error
      if (json.playerName) setApiPlayerName(json.playerName);
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

  // Season pitching stats from MLB Stats API
  useEffect(() => {
    if (!playerId) return;
    const year = new Date().getFullYear();
    fetch(`https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=pitching&season=${year}&sportId=1`)
      .then(r => r.json())
      .then(d => {
        const splits = d?.stats?.[0]?.splits ?? [];
        if (!splits.length) return;
        const stat = splits[0].stat;
        setSeasonStats({
          ip:  stat.inningsPitched ?? '0.0',
          h:   Number(stat.hits         ?? 0),
          er:  Number(stat.earnedRuns   ?? 0),
          bb:  Number(stat.baseOnBalls  ?? 0),
          k:   Number(stat.strikeOuts   ?? 0),
          hr:  Number(stat.homeRuns     ?? 0),
          bf:  Number(stat.battersFaced ?? 0),
          hbp: Number(stat.hitByPitch   ?? 0),
          era: stat.era ?? null,
        });
      })
      .catch(() => {});
  }, [playerId]);

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
  const displayName = pitcher?.full_name ?? data?.playerName ?? apiPlayerName ?? `Player ${id}`;

  const imageSources = [
    resolvedPlayerId ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_426,q_auto:best/v1/people/${resolvedPlayerId}/headshot/silo/current` : null,
    resolvedPlayerId ? getMLBStaticPlayerImage(resolvedPlayerId, { width: 426 }) : null,
    resolvedPlayerId ? getESPNPlayerImage(resolvedPlayerId) : null,
    '/api/placeholder/400/400',
  ].filter(Boolean) as string[];
  const currentImage = imageSources[Math.min(imageError, imageSources.length - 1)];

  // Determine if this is an actual MLB game.
  // resolveTeamAbbr can incorrectly map college names like "Louisville Cardinals"
  // to "STL" via the MLB name fragment matching, so we explicitly check whether the
  // opponent's full name matches a known college team — if it does, it's not MLB.
  const sportId = data?.gameInfo?.sportId ?? 1;
  const opponentMLBLogo = data?.gameInfo?.opponent
    ? getMLBTeamLogoUrl(data.gameInfo.opponent)
    : null;
  const opponentIsCollegeName = !!(
    getCollegeLogoUrl(data?.gameInfo?.opponentFull) ||
    getCollegeLogoUrl(data?.gameInfo?.opponent)
  );
  const isMLBGame = sportId === 1 && opponentMLBLogo !== null && !opponentIsCollegeName;
  // MiLB games (AAA=11, AA=12, High-A=13, Low-A=14, Rookie=15, FCL/ACL=16) should also
  // show the MLB parent org logo — getMLBTeamLogoUrl already handles MiLB abbrs via getParentOrgAbbr.
  const isMiLBGame = [11, 12, 13, 14, 15, 16].includes(sportId);
  const teamLogo = (isMLBGame || isMiLBGame)
    ? ((pitcher?.team ? getMLBTeamLogoUrl(pitcher.team) : null) ??
       (data?.gameInfo?.team ? getMLBTeamLogoUrl(data.gameInfo.team) : null) ??
       getCollegeLogoUrl(data?.gameInfo?.team) ?? null)
    : (getCollegeLogoUrl(data?.gameInfo?.team) ?? null);
  const opponentLogo = (isMLBGame || isMiLBGame)
    ? (opponentMLBLogo ??
       getCollegeLogoUrl(data?.gameInfo?.opponentFull) ??
       getCollegeLogoUrl(data?.gameInfo?.opponent) ?? null)
    : (getCollegeLogoUrl(data?.gameInfo?.opponentFull) ??
       getCollegeLogoUrl(data?.gameInfo?.opponent) ?? null);
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

  const [light, setLight]         = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [copied, setCopied]       = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [seasonStats, setSeasonStats] = useState<{
    ip: string; h: number; er: number; bb: number; k: number; hr: number; bf: number; hbp: number;
    era: string | null;
  } | null>(null);

  const captureCard = async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    return captureCardDesktop(cardRef.current);
  };
  const handleDownload = async () => {
    if (capturing) return; setCapturing(true);
    try {
      const url = await captureCard(); if (!url) return;
      const a = document.createElement('a');
      a.download = `${displayName.replace(/\s+/g,'-')}-${selectedDate}.png`;
      a.href = url; a.click();
    } catch(e) { console.error(e); } finally { setCapturing(false); }
  };
  const handleCopy = async () => {
    if (capturing) return; setCapturing(true);
    try {
      const url = await captureCard(); if (!url) return;
      const blob = await fetch(url).then(r => r.blob());
      const result = await shareOrCopyImage(blob, `${displayName.replace(/\s+/g,'-')}-${selectedDate}.png`);
      if (result !== 'failed') { setCopied(true); setTimeout(() => setCopied(false), 2000); }
    } catch(e) { console.error(e); } finally { setCapturing(false); }
  };

  const BL = '2px solid #000000';
  const th = {
    bg:           light ? '#ffffff' : '',          // card bg override
    banner:       light ? '#e8e8e8' : '#000000',
    label:        light ? '#000000' : '#777777',
    fg:           light ? '#000000' : '#ffffff',
    ink2:         light ? '#000000' : 'var(--color-ink-2)',
    ink3:         light ? '#000000' : 'var(--color-ink-3)',
    ink4:         light ? '#000000' : 'var(--color-ink-4)',
    border:       'border-ink/10',
    tableBg:      light ? '#f7f7f7' : '',
    tableHeadBg:  light ? '#e8e8e8' : '',
    tableRowBg:   light ? '#f0f0f0' : '',
    btnFg:        light ? 'rgba(0,0,0,0.55)'  : 'rgba(255,255,255,0.6)',
    btnBg:        light ? 'rgba(0,0,0,0.05)'  : 'rgba(255,255,255,0.08)',
    btnBorder:    light ? 'rgba(0,0,0,0.18)'  : 'rgba(255,255,255,0.18)',
    statBoxStyle: light ? { background: '#f0f0f0', border: '1px solid #d4d4d4' } as React.CSSProperties
                        : { background: '', border: '' } as React.CSSProperties,
    sectionBorder:light ? { border: BL } as React.CSSProperties : {} as React.CSSProperties,
  };

  return (
    <div className="min-h-screen bg-panel text-deep-fg" data-light={light ? 'true' : undefined}>
      {/* Nav */}
      <header className="bg-panel border-b border-ink/20">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/pitchers" className="text-blue-400 hover:text-blue-300 font-medium text-sm">
                ← Back to Pitchers
              </Link>
              <div className="flex items-center gap-1 text-xs text-ink-3">
                <span>Arm Angle:</span>
                <input
                  type="number"
                  placeholder={data?.pitchData?.armAngle != null ? String(Math.round(Math.abs(data.pitchData.armAngle))) : 'auto'}
                  value={customArmAngle}
                  onChange={e => setCustomArmAngle(e.target.value)}
                  className="w-14 px-1 py-0.5 rounded bg-bone border border-ink/30 text-deep-fg text-xs text-center"
                />
                {customArmAngle !== '' && (
                  <button onClick={() => setCustomArmAngle('')} className="text-ink-4 hover:text-ink text-xs">✕</button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {pitcher && (
                <Link
                  href={`/pitcher/${id}`}
                  className="px-3 py-1.5 bg-bone hover:bg-bone border border-ink/30 hover:border-ink text-ink-2 hover:text-ink text-xs font-semibold transition-colors"
                >
                  📊 Season Card
                </Link>
              )}
              <Link
                href={`/pitcher/${id}/spring-summary`}
                className="px-3 py-1.5 bg-bone hover:bg-bone border border-blue-700 hover:border-ink text-blue-400 hover:text-blue-300 text-xs font-semibold transition-colors"
              >
                📊 Season Summary
              </Link>
              {data?.pitchData && (
                <button
                  onClick={() => setInstagramView(v => !v)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors border ${instagramView ? 'bg-pink-600 border-pink-500 text-white' : 'bg-bone border-pink-800 text-pink-400 hover:text-pink-300 hover:border-pink-500'}`}
                >
                  📸 {instagramView ? 'Normal View' : 'Instagram'}
                </button>
              )}
            </div>
            <Link href="/" className="text-green-400 hover:text-green-300 font-medium text-sm">
              View Hitters →
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6" style={{ maxWidth: 1088 }}>

        {/* Export / light-mode buttons */}
        <div className="export-ignore flex justify-end gap-2 mb-2">
          <button onClick={() => setLight(l => !l)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: th.btnBg, border: `1px solid ${th.btnBorder}`, color: th.btnFg, borderRadius: 3, whiteSpace: 'nowrap' }}>
            {light ? '☀ Light' : '☾ Dark'}
          </button>
          <button onClick={handleCopy} disabled={capturing} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: capturing ? 'wait' : 'pointer', background: copied ? '#166534' : th.btnBg, border: `1px solid ${copied ? '#16a34a' : th.btnBorder}`, color: copied ? '#4ade80' : th.btnFg, borderRadius: 3, whiteSpace: 'nowrap' }}>
            {copied ? '✓ Done' : capturing ? '…' : '⎘ Copy'}
          </button>
          <button onClick={handleDownload} disabled={capturing} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: capturing ? 'wait' : 'pointer', background: th.btnBg, border: `1px solid ${th.btnBorder}`, color: th.btnFg, borderRadius: 3, whiteSpace: 'nowrap' }}>
            {capturing ? '…' : '↓ PNG'}
          </button>
        </div>

        <div ref={cardRef}>

        {/* ── INSTAGRAM CARD VIEW ── */}
        {instagramView && data?.pitchData && gameLine && (
          <div className="flex justify-center mb-6">
            <PitcherInstagramCard
              playerName={displayName}
              playerImage={currentImage}
              teamLogo={teamLogo}
              opponentLogo={opponentLogo}
              teamAbbr={pitcher?.team ?? gameInfo?.team ?? null}
              opponentAbbr={gameInfo?.opponent ?? null}
              isHome={gameInfo?.isHome ?? null}
              date={selectedDate}
              throws={(data.pitchData.throws ?? data.playerPitchHand ?? pitcher?.throws ?? null) as 'L' | 'R' | null}
              bio={(() => {
                const age = calcAge(playerBio?.birthDate ?? null);
                const parts: string[] = [];
                if (playerBio?.height) parts.push(playerBio.height);
                if (playerBio?.weight) parts.push(`${playerBio.weight} lbs`);
                if (age !== null) parts.push(`Age ${age}`);
                if (playerBio?.pitchHand && playerBio?.batSide) parts.push(`${playerBio.batSide}/${playerBio.pitchHand}`);
                return parts.join(' • ');
              })()}
              gameLine={{
                ip: gameLine.ip, h: gameLine.h, er: gameLine.er,
                bb: gameLine.bb, k: gameLine.k, hr: gameLine.hr,
                pitches: totalPitches, strikes: gameLine.strikes,
              }}
              pitchTypes={computedPitchTypes}
              rawDots={effectiveRawDots}
              armAngle={customArmAngle !== '' ? parseFloat(customArmAngle) : data.pitchData.armAngle}
              strikePct={strikePct}
              swingAndMissPct={data.pitchData.swingAndMissPct}
              pitchOverrides={pitchOverrides}
            />
          </div>
        )}

        {/* ── CARD ─── */}
        <div className="bg-panel p-6 mb-6" style={light ? { background: '#ffffff', border: BL } : {}}>

          {/* Top: centered name/bio/game info */}
          <div className="mb-3">
            {/* Centered: photo + name/bio/game info */}
            {/* Player header: photo inline just left of name, whole unit centred */}
            <div className="flex items-center justify-center gap-3 mb-1">
              {/* Photo + optional flag */}
              <div className="flex items-start gap-2 flex-shrink-0">
                {(() => {
                  const flag = getCountryFlagUrl(gameInfo?.team ?? null, 80);
                  return flag ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={flag} alt={gameInfo?.team ?? ''} className="w-8 h-[22px] object-cover flex-shrink-0 mt-1" />
                  ) : null;
                })()}
                <div className="flex-shrink-0 w-20 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentImage || '/api/placeholder/400/400'}
                    alt={displayName}
                    className="w-full h-auto"
                    onError={() => setImageError(e => Math.min(e + 1, imageSources.length - 1))}
                  />
                </div>
              </div>
              {/* Name / bio / game info */}
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-3 mb-0.5">
                  <h1 className="font-display text-3xl uppercase tracking-[0.02em]">{displayName}</h1>
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
                    <p className="text-sm mb-1" style={{ color: th.ink4 }}>{parts.join(' • ')}</p>
                  ) : null;
                })()}
                {/* Game info */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" style={{ color: th.ink3 }}>
                  {pitcher?.throws && <span className="font-bold" style={{ color: th.fg }}>{pitcher.throws}HP</span>}
                  {(pitcher?.team || gameInfo?.team) && <span className="font-bold" style={{ color: th.fg }}>{pitcher?.team || gameInfo?.team}</span>}
                  {gameInfo && (
                    <>
                      <span>·</span>
                      <span>{gameInfo.date}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        {gameInfo.isHome ? 'vs' : '@'}
                        {opponentLogo && <img src={opponentLogo} alt={gameInfo.opponent || ''} className="w-4 h-4 object-contain inline" />}
                        <span className="font-semibold" style={{ color: th.fg }}>{gameInfo.opponentFull || gameInfo.opponent}</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

          </div>

          {/* Stats — season + game log under player info */}
          {gameLine && !loading && (
            <div className="w-full mb-4" style={th.sectionBorder}>
              {/* Season stats row */}
              {seasonStats && (<>
                <div className="font-display italic text-[13px] uppercase tracking-widest text-center py-0.5 border-b border-ink/10"
                     style={{ background: th.banner, color: light ? '#000000' : '#ff2d2d', fontWeight: 900 }}>
                  {new Date().getFullYear()} Season
                </div>
                <div className="grid grid-cols-8 divide-x divide-ink/10 border-b border-ink/10" style={{ background: th.tableBg }}>
                  {[
                    { label: 'IP',  value: seasonStats.ip },
                    { label: 'H',   value: String(seasonStats.h) },
                    { label: 'ER',  value: String(seasonStats.er) },
                    { label: 'BB%', value: seasonStats.bf > 0 ? `${(seasonStats.bb / seasonStats.bf * 100).toFixed(1)}%` : '—' },
                    { label: 'K%',  value: seasonStats.bf > 0 ? `${(seasonStats.k  / seasonStats.bf * 100).toFixed(1)}%` : '—' },
                    { label: 'HR',  value: String(seasonStats.hr) },
                    { label: 'ERA', value: seasonStats.era ?? '—' },
                    { label: 'FIP', value: (() => { const ip = parseIp(seasonStats.ip); return ip > 0 ? ((13 * seasonStats.hr + 3 * (seasonStats.bb + seasonStats.hbp) - 2 * seasonStats.k) / ip + 3.15).toFixed(2) : '—'; })() },
                  ].map(s => (
                    <div key={s.label} className="text-center px-2 py-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                      <div className="font-bold font-display tabular-nums" style={{ fontSize: 15, color: th.fg }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </>)}
              {/* Game log row */}
              <div className="font-display italic text-[13px] uppercase tracking-widest text-center py-0.5 border-b border-ink/10"
                   style={{ background: th.banner, color: light ? '#000000' : '#ff2d2d', fontWeight: 900 }}>
                Game Log
              </div>
              <div className="grid grid-cols-8 divide-x divide-ink/10" style={{ background: th.tableBg }}>
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
                  <div key={s.label} className="text-center px-2 py-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                    <div className="font-bold font-display tabular-nums" style={{ fontSize: 15, color: th.fg }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Loading / Error */}
          {loading && (
            <div className="flex items-center gap-2 mb-3">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent animate-spin" />
              <span className="text-ink-3 text-xs">Loading...</span>
            </div>
          )}
          {!loading && error && (
            <div className="bg-bone p-2 mb-3">
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
                  throws={(data?.pitchData?.throws ?? data?.playerPitchHand ?? playerBio?.pitchHand ?? pitcher?.throws) as 'L' | 'R' | undefined}
                  armAngle={customArmAngle !== '' ? parseFloat(customArmAngle) : (data?.pitchData?.armAngle ?? undefined)}
                  pitchOverrides={pitchOverrides}
                  onDotClick={(origIndex, nearbyIndices, e) => {
                    setReclassifyDot(prev =>
                      prev?.index === origIndex ? null : { index: origIndex, nearbyIndices, x: e.clientX, y: e.clientY }
                    );
                  }}
                />
              ) : (
                <div className="w-[320px] h-[320px] bg-bone flex items-center justify-center">
                  <p className="text-ink-4 text-xs text-center px-6">
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
                  className="fixed bg-page border border-blue-500/60 z-50 p-2"
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
                      <div className="text-[8px] text-ink-3 uppercase tracking-wide mb-1">
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
                                  ? 'border-blue-400 bg-deep/40 text-deep-fg'
                                  : 'border-ink/30 bg-bone/40 text-ink-2 hover:border-ink/30'
                              }`}
                            >
                              <span className="w-2 h-2 flex-shrink-0" style={{ background: col.color }} />
                              #{ni + 1}
                            </button>
                          );
                        })}
                      </div>
                      <div className="border-t border-ink/20/60 mt-2 mb-1" />
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
                            isCurrent ? 'bg-deep/40 text-deep-fg' : 'hover:bg-bone text-ink-2'
                          }`}
                        >
                          <span
                            className="w-2.5 h-2.5 flex-shrink-0 border border-white/20"
                            style={{ background: pitchColors(name).color }}
                          />
                          <span className="text-[11px] flex-1">{name}</span>
                          {isCurrent && <span className="text-[9px] text-blue-300">✓</span>}
                          {isOriginal && <span className="text-[8px] text-ink-4">orig</span>}
                        </button>
                      );
                    })}
                    {pitchOverrides[reclassifyDot.index] !== undefined && (
                      <button
                        onClick={() => {
                          setPitchOverrides(prev => { const n = { ...prev }; delete n[reclassifyDot.index]; return n; });
                          setReclassifyDot(null);
                        }}
                        className="text-[10px] text-red-400 hover:text-red-300 px-2 py-1 mt-0.5 border-t border-ink/20/60 text-left"
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
          <div className="bg-panel overflow-hidden mb-6" style={light ? { background: '#ffffff', border: BL } : {}}>
            {/* Reclassification banner */}
            {Object.keys(pitchOverrides).length > 0 && (
              <div className="flex items-center justify-between px-4 py-2 border-b border-ink/20 bg-walk/20">
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
                  <tr className="border-b border-ink/20" style={{ background: th.banner }}>
                    {['Pitch', 'Pitches', 'Usage', 'Velo', 'Max Velo', 'IVB', 'HB', 'Spin', 'VAA', 'HAA', 'vRel', 'hRel', 'Ext.', 'Zone%', 'Barrel%', 'Whiff%', 'Whiffs'].map(h => (
                      <th key={h} className="px-1 py-2 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: th.label }}>
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
                      <tr key={p.name} className="border-b border-ink/20/50 hover:bg-bone/20">
                        <td className="px-1 py-1.5">
                          <div className="flex items-center gap-1 justify-center">
                            <span
                              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0"
                              style={{ backgroundColor: col.bg, color: col.text }}
                            >
                              {shortName}
                            </span>
                            <span className="text-[9px] truncate" style={{ color: th.ink2 }}>{p.name}</span>
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
                  <tr className="font-bold border-t border-ink/30" style={{ background: th.banner }}>
                    <td className="px-1 py-1.5 text-center">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: light ? '#d0d0d0' : '', color: th.fg }}>All</span>
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
            <div className="px-4 py-2 border-t border-ink/20 text-xs flex gap-6" style={{ color: th.ink4 }}>
              {strikePct != null && (
                <span>Strike%: <span className="font-semibold" style={{ color: th.fg }}>{strikePct.toFixed(1)}%</span></span>
              )}
              {data?.pitchData?.swingAndMissPct != null && (
                <span>SwStr%: <span className="font-semibold" style={{ color: th.fg }}>{data.pitchData.swingAndMissPct.toFixed(1)}%</span></span>
              )}
            </div>
            )}
          </div>
        ); })()}

        {/* ── Fastball Comparison Tool ── */}
        {computedPitchTypes.length > 0 && (() => {
          const gameFB = getGameFastball(computedPitchTypes, customArmAngle !== '' ? parseFloat(customArmAngle) : data?.pitchData?.armAngle);
          const seasonFB = getSeasonFastball(pitcher);
          const compareFB = getSeasonFastball(comparePitcher);
          return (
            <div className="export-ignore bg-panel overflow-hidden mb-6" style={light ? { background: '#ffffff', border: BL } : {}}>
              <button
                onClick={() => setShowCompare(v => !v)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-bone transition-colors"
              >
                <span className="text-sm font-semibold flex items-center gap-2" style={{ color: th.fg }}>
                  ⚡ Fastball Comparison
                  {gameFB && <span className="text-[10px] font-normal text-ink-3">({gameFB.pitchName})</span>}
                </span>
                <span className="text-ink-3 text-xs">{showCompare ? '▲' : '▼'}</span>
              </button>

              {showCompare && (
                <div className="border-t border-ink/20 p-4">
                  {/* Similar pitchers */}
                  {similarPitchers.length > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="text-[10px] text-ink-4 uppercase tracking-wide font-semibold">Similar fastball profiles</div>
                        <div className="flex gap-1">
                          {(['all', 'R', 'L'] as const).map(h => (
                            <button
                              key={h}
                              onClick={() => setHandFilter(h)}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                                handFilter === h
                                  ? 'bg-walk/30 border border-blue-500 text-blue-300'
                                  : 'bg-bone border border-ink/30 text-ink-3 hover:text-ink'
                              }`}
                            >
                              {h === 'all' ? 'All' : h === 'R' ? 'RHP' : 'LHP'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {similarPitchers.map(p => {
                          const isSelected = comparePitcher?.player_id === p.player_id && comparePitcher?.year === p.year;
                          return (
                            <button
                              key={`${p.player_id ?? p.full_name}-${p.year ?? 'cur'}`}
                              onClick={() => {
                                setComparePitcher(isSelected ? null : p);
                                setCompareQuery(isSelected ? '' : p.full_name);
                                setCompareResults([]);
                              }}
                              className={`px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
                                isSelected
                                  ? 'bg-yellow-500/20 border-yellow-500 text-yellow-300'
                                  : 'bg-bone border-ink/30 text-ink-2 hover:border-ink hover:text-ink'
                              }`}
                            >
                              {p.full_name}
                              {p.year && <span className="ml-1 text-[9px] opacity-60">{p.year}</span>}
                              {!p.year && p.team && <span className="ml-1 text-[9px] opacity-60">{p.team}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Search */}
                  <div className="relative mb-4">
                    <input
                      type="text"
                      placeholder="Or search for any pitcher…"
                      value={compareQuery}
                      onChange={e => {
                        const q = e.target.value;
                        setCompareQuery(q);
                        setComparePitcher(null);
                        if (q.length < 2) { setCompareResults([]); return; }
                        setCompareResults(searchAllPitchers(q).slice(0, 8));
                      }}
                      className="w-full px-3 py-2 bg-bone border border-ink/30 text-deep-fg text-sm focus:outline-none focus:border-ink"
                    />
                    {comparePitcher && (
                      <button
                        onClick={() => { setComparePitcher(null); setCompareQuery(''); setCompareResults([]); }}
                        className="absolute right-2.5 top-2.5 text-ink-3 hover:text-ink text-sm leading-none"
                      >✕</button>
                    )}
                    {compareResults.length > 0 && !comparePitcher && (
                      <div className="absolute z-20 w-full mt-1 bg-bone border border-ink/30 overflow-hidden">
                        {compareResults.map(p => (
                          <button
                            key={p.player_id ?? p.full_name}
                            onClick={() => { setComparePitcher(p); setCompareQuery(p.full_name); setCompareResults([]); }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-panel text-deep-fg flex items-center justify-between border-b border-ink/20/50 last:border-0"
                          >
                            <span>{p.full_name}</span>
                            <span className="text-ink-4 text-xs">{p.team ?? ''}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Comparison table */}
                  {!gameFB ? (
                    <p className="text-center text-ink-4 text-xs py-2">No fastball data in today&apos;s game.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-ink/20">
                            <th className="py-2 px-3 text-left text-ink-3 font-semibold uppercase tracking-wide text-[10px] w-24">Metric</th>
                            <th className="py-2 px-3 text-center font-semibold text-[10px] text-blue-300">
                              {displayName}
                              <div className="text-ink-4 font-normal">Today · {gameFB.pitchName}</div>
                            </th>
                            {seasonFB && (
                              <th className="py-2 px-3 text-center font-semibold text-[10px] text-outcome-fg">
                                {displayName}
                                <div className="text-ink-4 font-normal">Season · {seasonFB.pitchName}</div>
                              </th>
                            )}
                            {comparePitcher && (
                              <th className="py-2 px-3 text-center font-semibold text-[10px] text-yellow-300">
                                {comparePitcher.full_name}
                                <div className="text-ink-4 font-normal">Season · {compareFB?.pitchName ?? '—'}</div>
                              </th>
                            )}
                            {!comparePitcher && (
                              <th className="py-2 px-3 text-center text-[10px] text-ink-3 italic">
                                Select a pitcher<br/>to compare
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {FB_METRICS.map(m => {
                            const todayVal = gameFB[m.key] as number | null;
                            const compareVal = compareFB ? (compareFB[m.key] as number | null) : null;
                            const allVals = [todayVal, compareVal].filter((v): v is number => v !== null);
                            const bestVal = m.higherBetter === null || allVals.length < 2
                              ? null
                              : m.higherBetter ? Math.max(...allVals) : Math.min(...allVals);
                            const highlight = (v: number | null) =>
                              v !== null && bestVal !== null && Math.abs(v - bestVal) < 0.001
                                ? 'text-green-400 font-bold' : 'text-accent';
                            const fmt = (v: number | null) => v !== null ? `${v.toFixed(m.digits)}${m.unit}` : '—';
                            return (
                              <tr key={m.key} className="border-b border-ink/20/40 hover:bg-bone/10">
                                <td className="py-2 px-3 text-ink-3 font-semibold">{m.label}</td>
                                <td className={`py-2 px-3 text-center font-semibold ${highlight(todayVal)}`}>{fmt(todayVal)}</td>
                                {seasonFB && (
                                  <td className="py-2 px-3 text-center text-ink-2">{fmt(seasonFB[m.key] as number | null)}</td>
                                )}
                                {comparePitcher ? (
                                  <td className={`py-2 px-3 text-center font-semibold ${highlight(compareVal)}`}>{fmt(compareVal)}</td>
                                ) : (
                                  <td className="py-2 px-3 text-center text-ink-2">—</td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* No Statcast data message */}
        {!loading && !error && gameLine && pitches.length === 0 && (
          <div className="p-8 text-center mb-6" style={light ? { background: '#ffffff', border: BL } : { background: 'var(--color-panel)' }}>
            <p className="text-sm" style={{ color: th.ink3 }}>No Statcast pitch data available for this game.</p>
            <p className="text-xs mt-1" style={{ color: th.ink3 }}>Statcast data typically posts within a few hours of game completion.</p>
          </div>
        )}

        {/* Watermark */}
        <div className="text-right py-1">
          <span className="font-display italic text-[10px] uppercase" style={{ color: light ? '#000000' : '#ff2d2d', fontWeight: 900 }}>By @Piratefan003</span>
          <span className="text-[8px] ml-2" style={{ color: th.ink4 }}>Data: MLB Stats API · Baseball Savant</span>
        </div>

        </div>{/* end cardRef */}

      </div>
    </div>
  );
}
