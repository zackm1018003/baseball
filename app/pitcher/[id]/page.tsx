'use client';

import { use, useState, useEffect, useMemo } from 'react';
import { getPitcherById, getPitcherByName, getAllPitchers } from '@/lib/pitcher-database';
import { DEFAULT_DATASET_ID, DATASETS } from '@/lib/datasets';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { fetchMLBPlayer } from '@/lib/mlb-api';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import Image from 'next/image';
import Link from 'next/link';

interface PitcherPageProps {
  params: Promise<{ id: string }>;
}

interface MLBPlayerData {
  height?: string;
  weight?: number;
  pitchHand?: { code: string; description: string };
  batSide?: { code: string; description: string };
  birthCountry?: string;
  birthDate?: string;
  currentAge?: number;
}

interface PitchInfo {
  name: string;
  shortName: string;
  color: string;
  bg: string;
  text: string;
  usage?: number;
  velo?: number;
  spin?: number;
  spin_pct?: number;
  h_movement?: number;
  v_movement?: number;
  vaa?: number;
  vrel?: number;
  hrel?: number;
  ext?: number;
  whiff?: number;
  zone_pct?: number;
  xwoba?: number;
  barrel_pct?: number;
  usage_vs_lhh?: number;
  usage_vs_rhh?: number;
}

// Pitch colors matching TJStats style
const PITCH_COLORS: Record<string, { color: string; bg: string; text: string }> = {
  '4-Seam Fastball': { color: '#D22D49', bg: '#D22D49', text: '#fff' },
  'Sinker': { color: '#C75B12', bg: '#C75B12', text: '#fff' },
  'Cutter': { color: '#933F2C', bg: '#933F2C', text: '#fff' },
  'Changeup': { color: '#3BBB38', bg: '#3BBB38', text: '#fff' },
  'Splitter': { color: '#1A8B6E', bg: '#1A8B6E', text: '#fff' },
  'Curveball': { color: '#00D1ED', bg: '#00D1ED', text: '#333' },
  'Knuckle Curve': { color: '#6236CD', bg: '#6236CD', text: '#fff' },
  'Slider': { color: '#EFE514', bg: '#EFE514', text: '#333' },
  'Sweeper': { color: '#E66B22', bg: '#E66B22', text: '#fff' },
  'Slurve': { color: '#3B44CE', bg: '#3B44CE', text: '#fff' },
};

// Percentile to color: 0% = deep blue, 50% = neutral, 100% = deep red
function percentileColor(pct: number | null): string | undefined {
  if (pct === null) return undefined;
  // Blue (0%) -> neutral gray (50%) -> Red (100%)
  if (pct <= 50) {
    // Blue range: deep blue at 0, fading toward neutral
    const t = pct / 50; // 0 to 1
    const r = Math.round(30 + t * 50);
    const g = Math.round(50 + t * 50);
    const b = Math.round(160 - t * 60);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // Red range: neutral at 50, deepening to red
    const t = (pct - 50) / 50; // 0 to 1
    const r = Math.round(80 + t * 120);
    const g = Math.round(100 - t * 70);
    const b = Math.round(100 - t * 70);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

export default function PitcherPage({ params }: PitcherPageProps) {
  const { id } = use(params);
  const [selectedDataset, setSelectedDataset] = useState<string>(DEFAULT_DATASET_ID);
  const [isClient, setIsClient] = useState(false);
  const [imageError, setImageError] = useState(0);
  const [mlbData, setMlbData] = useState<MLBPlayerData | null>(null);

  useEffect(() => {
    setIsClient(true);
    const savedDataset = localStorage.getItem('selectedPitcherDataset');
    if (savedDataset) {
      setSelectedDataset(savedDataset);
    }
  }, []);

  const isNumericId = /^\d+$/.test(id);
  const decodedName = isNumericId ? null : decodeURIComponent(id);

  let pitcher = isNumericId
    ? getPitcherById(parseInt(id), selectedDataset)
    : getPitcherByName(decodedName!, selectedDataset);
  let actualDataset = selectedDataset;

  if (!pitcher) {
    for (const dataset of DATASETS) {
      pitcher = isNumericId
        ? getPitcherById(parseInt(id), dataset.id)
        : getPitcherByName(decodedName!, dataset.id);
      if (pitcher) {
        actualDataset = dataset.id;
        setSelectedDataset(dataset.id);
        if (isClient) {
          localStorage.setItem('selectedPitcherDataset', dataset.id);
        }
        break;
      }
    }
  }

  useEffect(() => {
    if (pitcher?.player_id) {
      fetchMLBPlayer(pitcher.player_id).then((data) => {
        if (data) setMlbData(data);
      });
    }
  }, [pitcher?.player_id]);

  // Build pitch array from pitcher data (supports both new structured + legacy flat fields)
  const pitches: PitchInfo[] = useMemo(() => {
    if (!pitcher) return [];

    // Define all pitch types with their display info and data keys
    const pitchDefs = [
      { name: '4-Seam Fastball', shortName: 'FF', key: 'ff', legacy: 'fastball' },
      { name: 'Sinker',          shortName: 'SI', key: 'si', legacy: 'sinker' },
      { name: 'Cutter',          shortName: 'FC', key: 'fc', legacy: 'cutter' },
      { name: 'Changeup',        shortName: 'CH', key: 'ch', legacy: 'changeup' },
      { name: 'Splitter',        shortName: 'FS', key: 'fs', legacy: 'splitter' },
      { name: 'Curveball',       shortName: 'CU', key: 'cu', legacy: 'curveball' },
      { name: 'Knuckle Curve',   shortName: 'KC', key: 'kc', legacy: 'knuckle_curve' },
      { name: 'Slider',          shortName: 'SL', key: 'sl', legacy: 'slider' },
      { name: 'Sweeper',         shortName: 'ST', key: 'st', legacy: 'sweeper' },
      { name: 'Slurve',          shortName: 'SV', key: 'sv', legacy: 'slurve' },
    ];

    const p = pitcher as unknown as Record<string, unknown>;

    return pitchDefs.map(def => {
      let structured = p[def.key] as Record<string, number> | undefined;
      const colors = PITCH_COLORS[def.name] || { color: '#888', bg: '#888', text: '#fff' };

      // CU/KC fallback: Many pitchers have curveball in Excel but Savant classifies as knuckle curve.
      // If CU is missing enriched stats (whiff, zone_pct, etc.), pull them from KC, and vice versa.
      let fallback: Record<string, number> | undefined;
      if (def.key === 'cu') {
        fallback = p['kc'] as Record<string, number> | undefined;
      } else if (def.key === 'kc') {
        fallback = p['cu'] as Record<string, number> | undefined;
      }

      // Pull from structured data first, fall back to legacy flat fields
      const velo = structured?.velo ?? (p[`${def.legacy}_velo`] as number | undefined);
      const spin = structured?.spin ?? (p[`${def.legacy}_spin`] as number | undefined);
      const usage = structured?.usage ?? (p[`${def.legacy}_usage`] as number | undefined);
      const h_movement = structured?.movement_h ?? (p[`${def.legacy}_movement_h`] as number | undefined);
      const v_movement = structured?.movement_v ?? (p[`${def.legacy}_movement_v`] as number | undefined);
      const vaa = structured?.vaa ?? fallback?.vaa ?? (p[`${def.legacy}_vaa`] as number | undefined);

      return {
        name: def.name,
        shortName: def.shortName,
        ...colors,
        usage,
        velo,
        spin,
        spin_pct: structured?.spin_pct,
        h_movement,
        v_movement,
        vaa,
        vrel: structured?.vrel ?? fallback?.vrel,
        hrel: structured?.hrel ?? fallback?.hrel,
        ext: structured?.ext ?? fallback?.ext,
        whiff: structured?.whiff ?? fallback?.whiff,
        zone_pct: structured?.zone_pct ?? fallback?.zone_pct,
        xwoba: structured?.xwoba ?? fallback?.xwoba,
        barrel_pct: structured?.barrel_pct ?? fallback?.barrel_pct,
        usage_vs_lhh: structured?.usage_vs_lhh ?? fallback?.usage_vs_lhh,
        usage_vs_rhh: structured?.usage_vs_rhh ?? fallback?.usage_vs_rhh,
      };
    }).filter(pitch => {
      // Only show pitches that have a usage percentage
      return pitch.usage !== undefined && pitch.usage > 0;
    }).sort((a, b) => (b.usage ?? 0) - (a.usage ?? 0)) as PitchInfo[];
  }, [pitcher]);

  // Compute percentile ranks per pitch type per stat across all pitchers
  const percentiles = useMemo(() => {
    const allPitchers = getAllPitchers(actualDataset);
    const pitchKeys = ['ff','si','fc','sl','ch','cu','fs','st','sv','kc'];
    const keyToName: Record<string, string> = {
      ff: '4-Seam Fastball', si: 'Sinker', fc: 'Cutter', ch: 'Changeup',
      fs: 'Splitter', cu: 'Curveball', kc: 'Knuckle Curve', sl: 'Slider',
      st: 'Sweeper', sv: 'Slurve',
    };

    // Collect all values per pitch type per stat
    const distributions: Record<string, number[]> = {};
    allPitchers.forEach(p => {
      const pd = p as unknown as Record<string, Record<string, number>>;
      pitchKeys.forEach(pk => {
        const data = pd[pk];
        if (!data || !data.usage || data.usage <= 0) return;
        const name = keyToName[pk];
        const stats = { velo: data.velo, spin: data.spin, spin_pct: data.spin_pct, whiff: data.whiff, zone_pct: data.zone_pct, xwoba: data.xwoba, vaa: data.vaa, ext: data.ext, barrel_pct: data.barrel_pct };
        Object.entries(stats).forEach(([stat, val]) => {
          if (val === undefined || val === null || isNaN(val)) return;
          const key = `${name}_${stat}`;
          if (!distributions[key]) distributions[key] = [];
          distributions[key].push(val);
        });
      });
    });

    // Sort all distributions
    Object.values(distributions).forEach(arr => arr.sort((a, b) => a - b));

    // Return a function that computes percentile for a given pitch+stat+value
    return (pitchName: string, stat: string, value: number | undefined): number | null => {
      if (value === undefined || value === null || isNaN(value)) return null;
      const key = `${pitchName}_${stat}`;
      const dist = distributions[key];
      if (!dist || dist.length < 5) return null;
      // Count how many values are below this one
      let below = 0;
      for (let i = 0; i < dist.length; i++) {
        if (dist[i] < value) below++;
        else break;
      }
      return Math.round((below / dist.length) * 100);
    };
  }, [actualDataset]);

  // Compute overall pitcher stat percentiles (ERA, WHIP, K%, BB%, etc.)
  const overallPct = useMemo(() => {
    const allPitchers = getAllPitchers(actualDataset);
    const distributions: Record<string, number[]> = {};
    allPitchers.forEach(p => {
      const kp = p.k_per_9 ? (p.k_per_9 / 9 * 100 / 4.3) : null;
      const bbp = p.bb_per_9 ? (p.bb_per_9 / 9 * 100 / 4.3) : null;
      const kbb = kp && bbp ? kp - bbp : null;
      const entries: [string, number | null | undefined][] = [
        ['era', p.era], ['whip', p.whip], ['k_pct', kp], ['bb_pct', bbp],
        ['k_bb_pct', kbb], ['strike_pct', p.strike_pct],
      ];
      entries.forEach(([key, val]) => {
        if (val === undefined || val === null || isNaN(val)) return;
        if (!distributions[key]) distributions[key] = [];
        distributions[key].push(val);
      });
    });
    Object.values(distributions).forEach(arr => arr.sort((a, b) => a - b));

    return (stat: string, value: number | null | undefined): number | null => {
      if (value === undefined || value === null || isNaN(value)) return null;
      const dist = distributions[stat];
      if (!dist || dist.length < 5) return null;
      let below = 0;
      for (let i = 0; i < dist.length; i++) {
        if (dist[i] < value) below++;
        else break;
      }
      return Math.round((below / dist.length) * 100);
    };
  }, [actualDataset]);

  if (!pitcher) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
        <div className="container mx-auto px-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Pitcher Not Found</h1>
            <Link href="/pitchers" className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">
              Return to Pitchers
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const imageSources = [
    getMLBStaticPlayerImage(pitcher.player_id, { width: 426 }),
    getESPNPlayerImage(pitcher.player_id),
    '/api/placeholder/400/400',
  ];
  const currentImage = imageSources[imageError] || imageSources[imageSources.length - 1];

  const handleImageError = () => {
    if (imageError < imageSources.length - 1) {
      setImageError(imageError + 1);
    }
  };

  const age = pitcher.age || mlbData?.currentAge;
  const height = mlbData?.height;
  const weight = mlbData?.weight;
  const throws = pitcher.throws;
  const teamLogo = getMLBTeamLogoUrl(pitcher.team);

  // Calculate K% and BB% from K/9 and BB/9 (approximate)
  const kPct = pitcher.k_per_9 ? (pitcher.k_per_9 / 9 * 100 / 4.3).toFixed(1) : null;
  const bbPct = pitcher.bb_per_9 ? (pitcher.bb_per_9 / 9 * 100 / 4.3).toFixed(1) : null;
  const kMinusBBPct = kPct && bbPct ? (parseFloat(kPct) - parseFloat(bbPct)).toFixed(1) : null;

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-white">
      {/* Nav */}
      <header className="bg-[#16213e] border-b border-gray-700">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/pitchers" className="text-blue-400 hover:text-blue-300 font-medium text-sm">
              ← Back to Pitchers
            </Link>
            <Link href="/" className="text-green-400 hover:text-green-300 font-medium text-sm">
              View Hitters →
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-7xl">

        {/* ===== TOP ROW: Face | Name+Info | Pitch Plot ===== */}
        <div className="bg-[#16213e] rounded-xl p-6 mb-6">
          <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_auto] gap-6 items-start">

            {/* LEFT: Player Image + Usage Splits */}
            <div className="flex-shrink-0 flex flex-col items-center gap-3">
              <div className="relative w-44 h-44 rounded-xl overflow-hidden bg-gray-700 border-2 border-gray-600">
                <Image
                  src={currentImage}
                  alt={pitcher.full_name || 'Pitcher'}
                  fill
                  className="object-cover"
                  onError={handleImageError}
                  unoptimized
                />
              </div>
              {pitches.some(p => p.usage_vs_lhh || p.usage_vs_rhh) && (
                <PitchUsageSplitsChart pitches={pitches} />
              )}
            </div>

            {/* CENTER: Name + Info */}
            <div className="flex flex-col justify-center min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold truncate">{pitcher.full_name}</h1>
                {teamLogo && (
                  <img src={teamLogo} alt={pitcher.team || ''} className="w-10 h-10 object-contain flex-shrink-0" />
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-400 mb-3">
                {throws && <span>{throws}HP</span>}
                {age && <span>Age: {age}</span>}
                {height && <span>{height}</span>}
                {weight && <span>{weight} lbs</span>}
                {pitcher.team && <span>{pitcher.team}</span>}
              </div>

              {/* Summary stats inline */}
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-3">
                {[
                  { label: 'IP', value: pitcher.ip?.toFixed(1), pct: null as number | null },
                  { label: 'ERA', value: pitcher.era?.toFixed(2), pct: (() => { const p = overallPct('era', pitcher.era); return p !== null ? 100 - p : null; })() },
                  { label: 'WHIP', value: pitcher.whip?.toFixed(2), pct: (() => { const p = overallPct('whip', pitcher.whip); return p !== null ? 100 - p : null; })() },
                  { label: 'K%', value: kPct ? `${kPct}%` : undefined, pct: overallPct('k_pct', kPct ? parseFloat(kPct) : null) },
                  { label: 'BB%', value: bbPct ? `${bbPct}%` : undefined, pct: (() => { const p = overallPct('bb_pct', bbPct ? parseFloat(bbPct) : null); return p !== null ? 100 - p : null; })() },
                  { label: 'K-BB%', value: kMinusBBPct ? `${kMinusBBPct}%` : undefined, pct: overallPct('k_bb_pct', kMinusBBPct ? parseFloat(kMinusBBPct) : null) },
                  { label: 'Strike%', value: pitcher.strike_pct ? `${pitcher.strike_pct.toFixed(1)}%` : undefined, pct: overallPct('strike_pct', pitcher.strike_pct) },
                ].filter(s => s.value).map(s => (
                  <div key={s.label} className="rounded-lg px-3 py-2 text-center" style={{ backgroundColor: percentileColor(s.pct) || '#0d1b2a' }}>
                    <div className="text-[10px] text-gray-500 uppercase font-semibold">{s.label}</div>
                    <div className="text-lg font-bold">{s.value}</div>
                  </div>
                ))}
              </div>

            </div>

            {/* RIGHT: Pitch Breaks Chart */}
            <div className="flex-shrink-0 flex flex-col items-center">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Pitch Movement
              </h3>
              <PitchBreaksChart pitches={pitches} throws={throws} armAngle={pitcher.arm_angle} />
            </div>
          </div>

        </div>

        {/* ===== PITCH TYPE FILTER BUTTONS ===== */}
        <div className="flex flex-wrap gap-2 mb-4">
          {pitches.map(p => (
            <span
              key={p.name}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
              style={{ backgroundColor: p.bg, color: p.text }}
            >
              {p.name}
            </span>
          ))}
        </div>

        {/* ===== PITCH STATS TABLE (full width, prominent) ===== */}
        <div className="bg-[#16213e] rounded-xl overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 bg-[#0d1b2a]">
                  {['Pitch Name', 'Pitch%', 'Velocity', 'IVB', 'HB', 'Spin', 'Spin%', 'VAA', 'vRel', 'Ext.', 'Zone%', 'Whiff%', 'Barrel%', 'xwOBA'].map(h => (
                    <th key={h} className="px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pitches.map((pitch) => (
                  <tr key={pitch.name} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                    <td className="px-3 py-3 text-center">
                      <span
                        className="inline-block px-3 py-1 rounded-md text-xs font-bold whitespace-nowrap"
                        style={{ backgroundColor: pitch.bg, color: pitch.text }}
                      >
                        {pitch.name}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.usage?.toFixed(1) ?? '—'}{pitch.usage ? '%' : ''}</td>
                    <td className="px-3 py-3 text-center font-semibold" style={{ backgroundColor: percentileColor(percentiles(pitch.name, 'velo', pitch.velo)) }}>{pitch.velo?.toFixed(1) ?? '—'}</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.v_movement?.toFixed(1) ?? '—'}</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.h_movement?.toFixed(1) ?? '—'}</td>
                    <td className="px-3 py-3 text-center font-semibold" style={{ backgroundColor: percentileColor(percentiles(pitch.name, 'spin', pitch.spin)) }}>{pitch.spin ?? '—'}</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.spin_pct?.toFixed(1) ?? '—'}{pitch.spin_pct ? '%' : ''}</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.vaa?.toFixed(1) ?? '—'}{pitch.vaa ? '°' : ''}</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.vrel?.toFixed(1) ?? pitcher.release_height?.toFixed(1) ?? '—'}</td>
                    <td className="px-3 py-3 text-center font-semibold" style={{ backgroundColor: percentileColor(percentiles(pitch.name, 'ext', pitch.ext)) }}>{pitch.ext?.toFixed(1) ?? pitcher.extension?.toFixed(1) ?? '—'}</td>
                    <td className="px-3 py-3 text-center font-semibold" style={{ backgroundColor: percentileColor(percentiles(pitch.name, 'zone_pct', pitch.zone_pct)) }}>{pitch.zone_pct?.toFixed(1) ?? '—'}{pitch.zone_pct ? '%' : ''}</td>
                    <td className="px-3 py-3 text-center font-semibold" style={{ backgroundColor: percentileColor(percentiles(pitch.name, 'whiff', pitch.whiff)) }}>{pitch.whiff?.toFixed(1) ?? '—'}{pitch.whiff ? '%' : ''}</td>
                    <td className="px-3 py-3 text-center font-semibold" style={{ backgroundColor: percentileColor((() => { const p = percentiles(pitch.name, 'barrel_pct', pitch.barrel_pct); return p !== null ? 100 - p : null; })()) }}>{pitch.barrel_pct?.toFixed(1) ?? '—'}{pitch.barrel_pct !== undefined ? '%' : ''}</td>
                    <td className="px-3 py-3 text-center font-semibold" style={{ backgroundColor: percentileColor((() => { const p = percentiles(pitch.name, 'xwoba', pitch.xwoba); return p !== null ? 100 - p : null; })()) }}>{pitch.xwoba?.toFixed(3) ?? '—'}</td>
                  </tr>
                ))}
                {/* All row */}
                <tr className="bg-[#0d1b2a] font-bold border-t border-gray-600">
                  <td className="px-3 py-3 text-center">
                    <span className="inline-block px-3 py-1 rounded-md text-xs font-bold bg-gray-600 text-white">
                      All
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">100.0%</td>
                  <td className="px-3 py-3 text-center">—</td>
                  <td className="px-3 py-3 text-center">—</td>
                  <td className="px-3 py-3 text-center">—</td>
                  <td className="px-3 py-3 text-center">—</td>
                  <td className="px-3 py-3 text-center">—</td>
                  <td className="px-3 py-3 text-center">—</td>
                  <td className="px-3 py-3 text-center">{pitcher.release_height?.toFixed(1) ?? '—'}</td>
                  <td className="px-3 py-3 text-center">{pitcher.extension?.toFixed(1) ?? '—'}</td>
                  <td className="px-3 py-3 text-center">—</td>
                  <td className="px-3 py-3 text-center">—</td>
                  <td className="px-3 py-3 text-center">—</td>
                  <td className="px-3 py-3 text-center">—</td>

                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="text-center text-gray-600 text-xs py-4">
          Data: MLB, Fangraphs
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   SUB-COMPONENTS
   ============================================================ */

/** Pitch Breaks scatter chart (SVG) */
function PitchBreaksChart({ pitches, throws, armAngle }: { pitches: PitchInfo[]; throws?: 'R' | 'L'; armAngle?: number }) {
  const size = 400;
  const center = size / 2;
  const maxInches = 24;
  const scale = (center - 30) / maxInches;

  // Generate scattered dots around each pitch's movement
  const allDots: { x: number; y: number; color: string }[] = [];

  pitches.forEach((pitch) => {
    if (pitch.h_movement === undefined || pitch.v_movement === undefined) return;

    const baseX = center + pitch.h_movement * scale;
    const baseY = center - pitch.v_movement * scale;

    // Scale dot count by usage: ~1 dot per 1% usage, min 2, max 50
    const usage = pitch.usage ?? 10;
    const numDots = Math.max(2, Math.min(50, Math.round(usage)));
    const spread = Math.min(16, 6 + numDots * 0.2);

    for (let i = 0; i < numDots; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * spread;
      allDots.push({
        x: baseX + Math.cos(angle) * dist,
        y: baseY + Math.sin(angle) * dist,
        color: pitch.color,
      });
    }
  });

  // Arm angle line through the plot center
  // 0° = sidearm (horizontal right for RHP), 90° = straight over the top (vertical)
  // RHP: line extends to upper-right, LHP: line extends to upper-left
  const armLine = armAngle !== undefined ? (() => {
    const angleRad = (armAngle * Math.PI) / 180;
    const dir = throws === 'L' ? -1 : 1;
    const len = size * 0.45;
    // At 0° (sidearm): line is horizontal (dx=len, dy=0)
    // At 90° (over the top): line is vertical (dx=0, dy=len)
    const dx = dir * Math.cos(angleRad) * len;
    const dy = Math.sin(angleRad) * len;
    return {
      x1: center, y1: center,
      x2: center + dx, y2: center - dy,
    };
  })() : null;

  return (
    <div className="flex justify-center">
      <svg width={size} height={size} className="bg-[#1a2940] rounded-lg">
        {/* Grid */}
        <line x1={center} y1={20} x2={center} y2={size - 20} stroke="#3a4f66" strokeWidth="1" />
        <line x1={20} y1={center} x2={size - 20} y2={center} stroke="#3a4f66" strokeWidth="1" />

        {/* Concentric guides with inch labels */}
        {[6, 12, 18, 24].map(inches => (
          <g key={inches}>
            <circle cx={center} cy={center} r={inches * scale}
              fill="none" stroke="#3a4f66" strokeWidth="0.5" strokeDasharray="3,3" />
            {/* Labels along axes */}
            <text x={center + inches * scale + 2} y={center - 3} fontSize="8" fill="#5a7a94">{inches}&quot;</text>
            <text x={center - inches * scale - 2} y={center - 3} fontSize="8" fill="#5a7a94" textAnchor="end">{inches}&quot;</text>
            <text x={center + 3} y={center - inches * scale + 3} fontSize="8" fill="#5a7a94">{inches}&quot;</text>
            <text x={center + 3} y={center + inches * scale + 3} fontSize="8" fill="#5a7a94">{inches}&quot;</text>
          </g>
        ))}

        {/* Arm angle dotted line */}
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

        {/* Dots */}
        {allDots.map((dot, i) => (
          <circle key={i} cx={dot.x} cy={dot.y} r="4" fill={dot.color} opacity="0.75" />
        ))}
      </svg>
    </div>
  );
}

/** Pitch Usage butterfly chart: vs LHH (left) | pitch name | vs RHH (right) */
function PitchUsageSplitsChart({ pitches }: { pitches: PitchInfo[] }) {
  const maxUsage = Math.max(
    ...pitches.map(p => Math.max(p.usage_vs_lhh ?? 0, p.usage_vs_rhh ?? 0)),
    1
  );
  // Scale bars: max bar = full width of one side
  const barMaxWidth = 90; // px per side

  return (
    <div className="w-full" style={{ maxWidth: '280px' }}>
      <div className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider text-center mb-1">
        Pitch Usage
      </div>
      {/* Header labels */}
      <div className="flex justify-between text-[9px] text-gray-500 mb-1 px-1">
        <span>vs LHH</span>
        <span>vs RHH</span>
      </div>
      {/* Rows */}
      <div className="flex flex-col gap-[3px]">
        {pitches.map(p => {
          const lhh = p.usage_vs_lhh ?? 0;
          const rhh = p.usage_vs_rhh ?? 0;
          const lhhWidth = (lhh / maxUsage) * barMaxWidth;
          const rhhWidth = (rhh / maxUsage) * barMaxWidth;

          return (
            <div key={p.shortName} className="flex items-center gap-0" style={{ height: '16px' }}>
              {/* LHH bar (grows right-to-left) */}
              <div className="flex items-center justify-end" style={{ width: barMaxWidth + 28, minWidth: barMaxWidth + 28 }}>
                <span className="text-[8px] text-gray-400 mr-1 min-w-[24px] text-right">
                  {lhh > 0 ? `${lhh.toFixed(1)}%` : ''}
                </span>
                <div
                  className="rounded-l-sm"
                  style={{
                    width: lhhWidth,
                    height: '14px',
                    backgroundColor: p.color,
                    opacity: 0.85,
                  }}
                />
              </div>
              {/* Center label */}
              <div
                className="text-[8px] font-bold text-center px-0.5 flex-shrink-0"
                style={{ width: '28px', color: p.color }}
              >
                {p.shortName}
              </div>
              {/* RHH bar (grows left-to-right) */}
              <div className="flex items-center" style={{ width: barMaxWidth + 28, minWidth: barMaxWidth + 28 }}>
                <div
                  className="rounded-r-sm"
                  style={{
                    width: rhhWidth,
                    height: '14px',
                    backgroundColor: p.color,
                    opacity: 0.85,
                  }}
                />
                <span className="text-[8px] text-gray-400 ml-1 min-w-[24px]">
                  {rhh > 0 ? `${rhh.toFixed(1)}%` : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


