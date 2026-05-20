'use client';

import { use, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getPitcherById, getPitcherByName, searchAllPitchers } from '@/lib/pitcher-database';
import { useRouter } from 'next/navigation';
import { DEFAULT_DATASET_ID, DATASETS } from '@/lib/datasets';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import Image from 'next/image';
import Link from 'next/link';
import { RawDot, PITCH_COLORS, PITCH_SHORT, pitchColors, PitchLocationChart, PitchMovementChart } from '@/components/PitchCharts';
import PitcherInstagramCard from '@/components/PitcherInstagramCard';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpringSummaryPageProps {
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

type OutingLevel = 'MLB' | 'AAA' | 'AA' | 'High-A' | 'Low-A';

interface SpringOuting {
  date: string;
  opponent: string;
  ip: string;
  h: number;
  er: number;
  bb: number;
  k: number;
  hr: number;
  pitches: number;
  bf: number;
  gamePk?: number;
  isHome?: boolean | null;
  team?: string | null;
  level: OutingLevel;
}

interface AggregatedGameLine {
  ip: string;
  h: number;
  er: number;
  bb: number;
  k: number;
  hr: number;
  pitches: number;
  bf: number;
  era: string | null;
  games: number;
}

interface SpringSummaryData {
  playerId: number;
  playerName: string | null;
  playerHeight: string | null;
  playerWeight: number | null;
  playerBirthDate: string | null;
  playerPitchHand: string | null;
  playerBatSide: string | null;
  season: number;
  aggregatedGameLine: AggregatedGameLine;
  pitchData: PitchData | null;
  outings: SpringOuting[];
}

// PITCH_COLORS, PITCH_SHORT, pitchColors imported from @/components/PitchCharts

// ─── Benchmarks ───────────────────────────────────────────────────────────────

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

const EXT_BENCHMARK = { p10: 5.9, p90: 6.9 };

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


// ─── Main page ────────────────────────────────────────────────────────────────

export default function PitcherSpringSummaryPage({ params }: SpringSummaryPageProps) {
  const { id } = use(params);

  const [selectedDataset, setSelectedDataset] = useState(DEFAULT_DATASET_ID);
  const [imageError, setImageError] = useState(0);
  const [data, setData] = useState<SpringSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(new Date().getFullYear());
  const [selectedLevel, setSelectedLevel] = useState<OutingLevel | 'ALL'>('ALL');
  const [light, setLight] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [playerBio, setPlayerBio] = useState<{
    height: string | null; weight: number | null;
    birthDate: string | null; pitchHand: string | null; batSide: string | null;
  } | null>(null);
  const [pitchOverrides, setPitchOverrides] = useState<Record<number, string>>({});
  const [reclassifyDot, setReclassifyDot] = useState<{ index: number; nearbyIndices: number[]; x: number; y: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [customArmAngle, setCustomArmAngle] = useState<string>('');
  const router = useRouter();

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
    setSelectedLevel('ALL');
    try {
      const res = await fetch(`/api/pitcher-season-summary?playerId=${playerId}&season=${selectedSeason}`);
      const json = await res.json();
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
        setError(json.error || 'Failed to load season data');
      } else {
        setData(json);
      }
    } catch {
      setError('Network error — could not load season data');
    } finally {
      setLoading(false);
    }
  }, [playerId, selectedSeason]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const effectiveRawDots = useMemo(() => {
    if (!data?.pitchData?.rawDots) return [];
    return data.pitchData.rawDots.map((dot, i) => ({
      ...dot,
      pitchType: pitchOverrides[i] ?? dot.pitchType,
    }));
  }, [data?.pitchData?.rawDots, pitchOverrides]);

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

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchAllPitchers(searchQuery).slice(0, 8);
  }, [searchQuery]);

  const resolvedPlayerId = playerId;
  const displayName = pitcher?.full_name ?? data?.playerName ?? `Player ${id}`;
  const season = data?.season ?? selectedSeason;
  const currentYear = new Date().getFullYear();
  const seasonOptions = Array.from({ length: currentYear - 2015 + 1 }, (_, i) => currentYear - i);

  const imageSources = [
    resolvedPlayerId ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_426,q_auto:best/v1/people/${resolvedPlayerId}/headshot/silo/current` : null,
    resolvedPlayerId ? getMLBStaticPlayerImage(resolvedPlayerId, { width: 426 }) : null,
    resolvedPlayerId ? getESPNPlayerImage(resolvedPlayerId) : null,
    '/api/placeholder/400/400',
  ].filter(Boolean) as string[];
  const currentImage = imageSources[Math.min(imageError, imageSources.length - 1)];

  const teamAbbr = pitcher?.team ?? data?.outings?.[0]?.team ?? null;
  const teamLogo = teamAbbr ? getMLBTeamLogoUrl(teamAbbr) : null;
  const pitches = computedPitchTypes;

  const parseIpToOuts = (ip: string) => {
    const parts = ip.split('.');
    return (parseInt(parts[0]) || 0) * 3 + (parseInt(parts[1]) || 0);
  };

  const allOutings = data?.outings ?? [];
  // Available levels (in display order), only those with data
  const LEVEL_ORDER: OutingLevel[] = ['MLB', 'AAA', 'AA', 'High-A', 'Low-A'];
  const availableLevels = LEVEL_ORDER.filter(l => allOutings.some(o => o.level === l));
  const springOutings = selectedLevel === 'ALL'
    ? allOutings
    : allOutings.filter(o => o.level === selectedLevel);

  // Compute aggregated game line for the currently-visible outings
  const computeGameLine = (os: SpringOuting[]) => {
    if (os.length === 0) return null;
    const totalOuts = os.reduce((s, o) => s + parseIpToOuts(o.ip), 0);
    const totalER   = os.reduce((s, o) => s + o.er, 0);
    const ip = totalOuts / 3;
    return {
      games:   os.length,
      ip:      `${Math.floor(totalOuts / 3)}.${totalOuts % 3}`,
      h:       os.reduce((s, o) => s + o.h, 0),
      er:      totalER,
      bb:      os.reduce((s, o) => s + o.bb, 0),
      k:       os.reduce((s, o) => s + o.k, 0),
      hr:      os.reduce((s, o) => s + o.hr, 0),
      pitches: os.reduce((s, o) => s + o.pitches, 0),
      bf:      os.reduce((s, o) => s + o.bf, 0),
      era:     ip > 0 ? (totalER / ip * 9).toFixed(2) : null,
    };
  };

  const gameLine = computeGameLine(springOutings) ?? data?.aggregatedGameLine;
  const totalPitches = (gameLine?.pitches) || data?.pitchData?.totalPitches || 0;
  const strikePct = data?.pitchData?.strikePct ?? null;

  const bio = (() => {
    const age = calcAge(playerBio?.birthDate ?? null);
    const parts: string[] = [];
    if (playerBio?.height) parts.push(playerBio.height);
    if (playerBio?.weight) parts.push(`${playerBio.weight} lbs`);
    if (age !== null) parts.push(`Age ${age}`);
    if (playerBio?.pitchHand && playerBio?.batSide) parts.push(`${playerBio.pitchHand}/${playerBio.batSide}`);
    return parts.join(' • ');
  })();

  const captureCard = async () => {
    if (!cardRef.current) return null;
    const { toPng } = await import('html-to-image');
    return toPng(cardRef.current, {
      cacheBust: true,
      filter: el => !(el as HTMLElement).classList?.contains('export-ignore'),
    });
  };
  const handleDownload = async () => {
    setCapturing(true);
    try {
      const url = await captureCard();
      if (!url) return;
      const a = document.createElement('a'); a.href = url;
      a.download = `${displayName.replace(/\s+/g, '_')}_${season}_season.png`;
      a.click();
    } finally { setCapturing(false); }
  };
  const handleCopy = async () => {
    setCapturing(true);
    try {
      const url = await captureCard();
      if (!url) return;
      const res = await fetch(url);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } finally { setCapturing(false); }
  };

  const BL = '2px solid #000000';
  const th = {
    bg:           light ? '#ffffff' : '',
    banner:       light ? '#e8e8e8' : '#000000',
    label:        light ? '#000000' : '#777777',
    fg:           light ? '#000000' : '#ffffff',
    ink2:         light ? '#000000' : 'var(--color-ink-2)',
    ink3:         light ? '#000000' : 'var(--color-ink-3)',
    ink4:         light ? '#555555' : 'var(--color-ink-4)',
    tableBg:      light ? '#f7f7f7' : '',
    tableHeadBg:  light ? '#e8e8e8' : '',
    btnFg:        light ? 'rgba(0,0,0,0.55)'  : 'rgba(255,255,255,0.6)',
    btnBg:        light ? 'rgba(0,0,0,0.05)'  : 'rgba(255,255,255,0.08)',
    btnBorder:    light ? 'rgba(0,0,0,0.18)'  : 'rgba(255,255,255,0.18)',
    statBoxStyle: light ? { background: '#f0f0f0', border: '1px solid #d4d4d4' } as React.CSSProperties : {} as React.CSSProperties,
    sectionStyle: light ? { border: BL } as React.CSSProperties : {} as React.CSSProperties,
  };

  return (
    <div className="min-h-screen bg-panel text-deep-fg" data-light={light ? 'true' : undefined}>
      {/* Nav */}
      <header className="bg-panel border-b border-ink/20">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/pitchers" className="text-blue-400 hover:text-blue-300 font-medium text-sm">
              ← Back to Pitchers
            </Link>
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
                href={`/pitcher/${id}/daily`}
                className="px-3 py-1.5 bg-bone hover:bg-bone border border-ink/30 hover:border-ink text-ink-2 hover:text-ink text-xs font-semibold transition-colors"
              >
                📅 Daily
              </Link>
            </div>
            <Link href="/" className="text-green-400 hover:text-green-300 font-medium text-sm">
              View Hitters →
            </Link>
          </div>
        </div>

        {/* Search bar row */}
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
                      router.push(`/pitcher/${p.player_id}/spring-summary`);
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
                        className="w-7 h-7 object-cover flex-shrink-0 bg-bone"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-deep-fg truncate">{p.full_name}</div>
                      <div className="text-[10px] text-ink-3">{p.team} · {p.throws}HP</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6" style={{ maxWidth: 1088 }}>

        {/* Export buttons — outside cardRef so they don't appear in capture */}
        <div className="flex justify-end gap-2 mb-2 export-ignore">
          <button onClick={() => setLight(l => !l)}
            style={{ color: th.btnFg, background: th.btnBg, border: `1px solid ${th.btnBorder}` }}
            className="px-2 py-1 text-xs font-semibold transition-colors">
            {light ? '☾ Dark' : '☀ Light'}
          </button>
          <button onClick={handleCopy} disabled={capturing}
            style={{ color: th.btnFg, background: th.btnBg, border: `1px solid ${th.btnBorder}` }}
            className="px-2 py-1 text-xs font-semibold transition-colors">
            {copied ? '✓ Copied' : capturing ? '…' : '⎘ Copy'}
          </button>
          <button onClick={handleDownload} disabled={capturing}
            style={{ color: th.btnFg, background: th.btnBg, border: `1px solid ${th.btnBorder}` }}
            className="px-2 py-1 text-xs font-semibold transition-colors">
            {capturing ? '…' : '↓ PNG'}
          </button>
        </div>

        <div ref={cardRef} style={light ? { background: '#f4f4f4', padding: 16 } : {}}>

        {/* ── CARD ─── */}
        <div className="bg-panel p-6 mb-6" style={light ? { background: '#ffffff', ...th.sectionStyle } : {}}>

          {/* Season Summary badge + year selector */}
          <div className="flex justify-center items-center gap-3 mb-3">
            <button
              onClick={() => setSelectedSeason(s => Math.max(2015, s - 1))}
              disabled={selectedSeason <= 2015}
              className="px-2 py-0.5 bg-blue-900/30 border border-blue-700/40 text-blue-300 text-sm font-bold disabled:opacity-30 hover:bg-blue-800/40 transition-colors"
            >
              ‹
            </button>
            <span className="px-3 py-1 bg-blue-900/40 border border-blue-700/60 text-blue-300 text-xs font-bold uppercase tracking-wider">
              {season} Season Summary
            </span>
            <button
              onClick={() => setSelectedSeason(s => Math.min(currentYear, s + 1))}
              disabled={selectedSeason >= currentYear}
              className="px-2 py-0.5 bg-blue-900/30 border border-blue-700/40 text-blue-300 text-sm font-bold disabled:opacity-30 hover:bg-blue-800/40 transition-colors"
            >
              ›
            </button>
            <select
              value={selectedSeason}
              onChange={e => setSelectedSeason(parseInt(e.target.value))}
              className="ml-1 bg-bone border border-ink/30 text-deep-fg text-xs px-2 py-1 outline-none"
            >
              {seasonOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Top: centered name/bio + stats absolutely right */}
          <div className="relative mb-5">
            <div className="flex flex-col items-center" style={{ paddingRight: 280 }}>
              <div className="flex items-center justify-center gap-4 mb-1">
                <div className="flex-shrink-0 w-20 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentImage || '/api/placeholder/400/400'}
                    alt={displayName}
                    className="w-full h-auto"
                    onError={() => setImageError(e => Math.min(e + 1, imageSources.length - 1))}
                  />
                </div>
                <div className="flex flex-col items-center">
                  <div className="flex items-center gap-3 mb-0.5">
                    <h1 className="font-display text-3xl uppercase tracking-[0.02em]">{displayName}</h1>
                    {teamLogo && <img src={teamLogo} alt={teamAbbr || ''} className="w-10 h-10 object-contain flex-shrink-0" />}
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
                      <p className="text-sm mb-1" style={{ color: th.ink3 }}>{parts.join(' • ')}</p>
                    ) : null;
                  })()}
                  <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-xs" style={{ color: th.ink3 }}>
                    {pitcher?.throws && <span className="font-bold" style={{ color: th.fg }}>{pitcher.throws}HP</span>}
                    {teamAbbr && <span className="font-bold" style={{ color: th.fg }}>{teamAbbr}</span>}
                    <span style={{ color: th.ink4 }}>·</span>
                    <span className="text-green-400 font-semibold">{gameLine?.games ?? 0} outings</span>
                    {springOutings.length > 0 && (
                      <>
                        <span style={{ color: th.ink4 }}>·</span>
                        <span style={{ color: th.ink3 }}>{springOutings[0].date} – {springOutings[springOutings.length - 1].date}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Stats box — absolutely positioned top-right */}
            {gameLine && !loading && (
              <div className="absolute top-0 right-0 grid grid-cols-5 gap-2">
                {[
                  { label: 'G',    value: String(gameLine.games) },
                  { label: 'IP',   value: gameLine.ip },
                  { label: 'ERA',  value: gameLine.era ?? '—' },
                  { label: 'H',    value: String(gameLine.h) },
                  { label: 'ER',   value: String(gameLine.er) },
                  { label: 'BB',   value: String(gameLine.bb) },
                  { label: 'K',    value: String(gameLine.k) },
                  { label: 'HR',   value: String(gameLine.hr) },
                  { label: 'P',    value: totalPitches ? String(totalPitches) : '—' },
                  { label: 'STR%', value: strikePct != null ? `${strikePct}%` : '—' },
                ].map(s => (
                  <div key={s.label} className="px-1 py-1 text-center" style={{ background: 'transparent', border: '1px solid #000000' }}>
                    <div className="text-[7px] uppercase font-semibold" style={{ color: th.ink4 }}>{s.label}</div>
                    <div className="text-sm font-bold" style={{ color: th.fg }}>{s.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Loading / Error */}
          {loading && (
            <div className="flex items-center gap-2 mb-3">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent animate-spin" />
              <span className="text-ink-3 text-xs">Loading season data...</span>
            </div>
          )}
          {!loading && error && (
            <div className="bg-bone p-2 mb-3">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          {/* Charts row */}
          <div className="relative flex justify-center gap-4">
            {(data?.pitchData?.rawDots?.length ?? 0) > 0 && (
              <PitchLocationChart
                rawDots={data!.pitchData!.rawDots}
                batterSide="L" label="vs LHH"
                pitchOverrides={pitchOverrides}
              />
            )}
            {(data?.pitchData?.rawDots?.length ?? 0) > 0 && (
              <PitchLocationChart
                rawDots={data!.pitchData!.rawDots}
                batterSide="R" label="vs RHH"
                pitchOverrides={pitchOverrides}
              />
            )}
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
                <div className="w-[320px] h-[320px] bg-bone flex items-center justify-center">
                  <p className="text-ink-4 text-xs text-center px-6">
                    {loading ? 'Loading...' : 'No Statcast data available'}
                  </p>
                </div>
              )}
            </div>

            {/* Reclassify popup */}
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
                      const rd = data?.pitchData?.rawDots ?? [];
                      const isCurrent = (pitchOverrides[reclassifyDot.index] ?? rd[reclassifyDot.index]?.pitchType) === name;
                      const isOriginal = rd[reclassifyDot.index]?.pitchType === name && !pitchOverrides[reclassifyDot.index];
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
        {pitches.length > 0 && (() => {
          return (
            <div className="bg-panel overflow-hidden mb-6" style={light ? { background: '#ffffff', ...th.sectionStyle } : {}}>
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
                    <tr className="border-b border-ink/20" style={{ background: th.tableHeadBg || undefined }}>
                      {['Pitch', 'Pitches', 'Usage', 'Velo', 'Max Velo', 'IVB', 'HB', 'Spin', 'VAA', 'HAA', 'vRel', 'hRel', 'Ext.', 'Zone%', 'Barrel%', 'Whiff%', 'Whiffs'].map(h => (
                        <th key={h} className="px-1 py-2 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: th.ink4 }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pitches.map(p => {
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
                              <span className="text-[9px] text-ink-2 truncate">{p.name}</span>
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
                            const bm = ZONE_BENCHMARKS[p.name] ?? { p10: 30, p90: 65 };
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
                    <tr className="font-bold border-t border-ink/30" style={{ background: th.tableHeadBg || undefined }}>
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
          );
        })()}

        {/* ── Level tabs ─── */}
        {availableLevels.length > 1 && (
          <div className="flex items-center gap-1 mb-3 flex-wrap">
            <button
              onClick={() => setSelectedLevel('ALL')}
              className={`px-3 py-1 text-xs font-bold uppercase tracking-wide border transition-colors ${
                selectedLevel === 'ALL'
                  ? 'bg-blue-700 border-blue-500 text-white'
                  : 'bg-bone border-ink/30 text-ink-2 hover:border-ink/60'
              }`}
            >
              All Levels
            </button>
            {availableLevels.map(l => (
              <button
                key={l}
                onClick={() => setSelectedLevel(l)}
                className={`px-3 py-1 text-xs font-bold uppercase tracking-wide border transition-colors ${
                  selectedLevel === l
                    ? 'bg-blue-700 border-blue-500 text-white'
                    : 'bg-bone border-ink/30 text-ink-2 hover:border-ink/60'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        )}

        {/* ── Outings Log ─── */}
        {springOutings.length > 0 && (
          <div className="bg-panel overflow-hidden mb-6" style={light ? { background: '#ffffff', ...th.sectionStyle } : {}}>
            <div className="px-4 py-3 border-b border-ink/20 flex items-center justify-between" style={{ background: th.banner }}>
              <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: th.label }}>
                {season} {selectedLevel === 'ALL' ? 'All Levels' : selectedLevel} Outings
              </h2>
              {selectedLevel === 'ALL' && availableLevels.length > 1 && (
                <span className="text-[10px]" style={{ color: th.ink4 }}>{availableLevels.join(' · ')}</span>
              )}
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-ink/20">
                  {[...(selectedLevel === 'ALL' && availableLevels.length > 1 ? ['Lvl'] : []), 'Date', 'Opp', 'IP', 'H', 'ER', 'BB', 'K', 'HR', 'P', 'BF'].map(h => (
                    <th key={h} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: th.ink4 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {springOutings.map((outing, i) => (
                  <tr key={i} className="border-b border-ink/20/40 hover:bg-bone/20">
                    {selectedLevel === 'ALL' && availableLevels.length > 1 && (
                      <td className="px-2 py-1.5 text-center">
                        <span className="inline-block px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-900/50 text-blue-300 leading-none">
                          {outing.level}
                        </span>
                      </td>
                    )}
                    <td className="px-3 py-1.5 text-center font-mono" style={{ color: th.ink2 }}>{outing.date}</td>
                    <td className="px-3 py-1.5 text-center font-semibold" style={{ color: th.fg }}>
                      <span style={{ color: th.ink3 }}>{outing.isHome === false ? '@' : 'vs'}</span>{' '}
                      {outing.opponent}
                    </td>
                    <td className="px-3 py-1.5 text-center font-semibold" style={{ color: th.fg }}>{outing.ip}</td>
                    <td className="px-3 py-1.5 text-center" style={{ color: th.fg }}>{outing.h}</td>
                    <td className="px-3 py-1.5 text-center" style={{ color: outing.er > 0 ? '#f87171' : th.fg }}>{outing.er}</td>
                    <td className="px-3 py-1.5 text-center" style={{ color: th.fg }}>{outing.bb}</td>
                    <td className="px-3 py-1.5 text-center font-semibold text-green-400">{outing.k}</td>
                    <td className="px-3 py-1.5 text-center" style={{ color: th.fg }}>{outing.hr}</td>
                    <td className="px-3 py-1.5 text-center" style={{ color: th.ink3 }}>{outing.pitches || '—'}</td>
                    <td className="px-3 py-1.5 text-center" style={{ color: th.ink3 }}>{outing.bf || '—'}</td>
                  </tr>
                ))}
                {/* Totals row */}
                {gameLine && (
                  <tr className="border-t border-ink/30 font-bold" style={{ background: th.tableHeadBg || undefined }}>
                    {selectedLevel === 'ALL' && availableLevels.length > 1 && <td className="px-2 py-1.5" />}
                    <td className="px-3 py-1.5 text-center text-[10px] uppercase" style={{ color: th.ink3 }}>Totals</td>
                    <td className="px-3 py-1.5 text-center" style={{ color: th.ink3 }}>{gameLine.games}G</td>
                    <td className="px-3 py-1.5 text-center" style={{ color: th.fg }}>{gameLine.ip}</td>
                    <td className="px-3 py-1.5 text-center" style={{ color: th.fg }}>{gameLine.h}</td>
                    <td className="px-3 py-1.5 text-center" style={{ color: th.fg }}>{gameLine.er}</td>
                    <td className="px-3 py-1.5 text-center" style={{ color: th.fg }}>{gameLine.bb}</td>
                    <td className="px-3 py-1.5 text-center text-green-400">{gameLine.k}</td>
                    <td className="px-3 py-1.5 text-center" style={{ color: th.fg }}>{gameLine.hr}</td>
                    <td className="px-3 py-1.5 text-center" style={{ color: th.fg }}>{totalPitches || '—'}</td>
                    <td className="px-3 py-1.5 text-center" style={{ color: th.fg }}>{gameLine.bf || '—'}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {gameLine?.era && (
              <div className="px-4 py-2 border-t border-ink/20 text-xs" style={{ color: th.ink4 }}>
                ERA: <span className="font-semibold" style={{ color: th.fg }}>{gameLine.era}</span>
              </div>
            )}
          </div>
        )}

        {!loading && !error && pitches.length === 0 && springOutings.length > 0 && (
          <div className="bg-panel p-8 text-center mb-6">
            <p className="text-ink-3 text-sm">
              No Statcast pitch data available for the regular season.
            </p>
            <p className="text-ink-3 text-xs mt-1">
              Game line statistics are shown above based on official box scores.
            </p>
          </div>
        )}

        {/* ── Instagram Card ── */}
        {!loading && !error && gameLine && (
          <div className="mb-6">
            <div className="flex items-center justify-center gap-3 mb-3">
              <h2 className="text-sm font-semibold text-ink-3 uppercase tracking-wider">Instagram Card</h2>
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
            <div className="flex justify-center">
              <PitcherInstagramCard
                playerName={displayName}
                playerImage={currentImage}
                teamAbbr={teamAbbr}
                teamLogo={teamLogo}
                opponentAbbr="Season"
                opponentLogo={null}
                isHome={true}
                date={String(season)}
                throws={(pitcher?.throws ?? null) as 'L' | 'R' | null}
                bio={bio}
                gameLine={{
                  ip: gameLine.ip,
                  h: gameLine.h,
                  er: gameLine.er,
                  bb: gameLine.bb,
                  k: gameLine.k,
                  hr: gameLine.hr,
                  pitches: totalPitches,
                  strikes: strikePct != null ? Math.round((strikePct / 100) * totalPitches) : 0,
                }}
                pitchTypes={pitches}
                rawDots={effectiveRawDots}
                armAngle={customArmAngle !== '' ? parseFloat(customArmAngle) : data?.pitchData?.armAngle ?? null}
                strikePct={strikePct}
                swingAndMissPct={data?.pitchData?.swingAndMissPct ?? null}
                pitchOverrides={pitchOverrides}
              />
            </div>
          </div>
        )}

        <div className="text-center text-xs py-4" style={{ color: th.ink4 }}>
          Data: MLB Stats API · Baseball Savant · {season} Regular Season
        </div>

        </div>{/* end cardRef */}
      </div>
    </div>
  );
}
