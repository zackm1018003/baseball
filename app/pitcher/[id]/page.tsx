'use client';

import { use, useState, useEffect, useMemo } from 'react';
import { getPitcherById, getPitcherByName } from '@/lib/pitcher-database';
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
      const structured = p[def.key] as Record<string, number> | undefined;
      const colors = PITCH_COLORS[def.name] || { color: '#888', bg: '#888', text: '#fff' };

      // Pull from structured data first, fall back to legacy flat fields
      const velo = structured?.velo ?? (p[`${def.legacy}_velo`] as number | undefined);
      const spin = structured?.spin ?? (p[`${def.legacy}_spin`] as number | undefined);
      const usage = structured?.usage ?? (p[`${def.legacy}_usage`] as number | undefined);
      const h_movement = structured?.movement_h ?? (p[`${def.legacy}_movement_h`] as number | undefined);
      const v_movement = structured?.movement_v ?? (p[`${def.legacy}_movement_v`] as number | undefined);
      const vaa = structured?.vaa ?? (p[`${def.legacy}_vaa`] as number | undefined);

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
        vrel: structured?.vrel,
        hrel: structured?.hrel,
        ext: structured?.ext,
        whiff: structured?.whiff,
        zone_pct: structured?.zone_pct,
        xwoba: structured?.xwoba,
      };
    }).filter(pitch => {
      // Only show pitches that have a usage percentage
      return pitch.usage !== undefined && pitch.usage > 0;
    }).sort((a, b) => (b.usage ?? 0) - (a.usage ?? 0)) as PitchInfo[];
  }, [pitcher]);

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

            {/* LEFT: Player Image */}
            <div className="flex-shrink-0 flex justify-center">
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
                  { label: 'IP', value: pitcher.ip?.toFixed(1) },
                  { label: 'ERA', value: pitcher.era?.toFixed(2) },
                  { label: 'WHIP', value: pitcher.whip?.toFixed(2) },
                  { label: 'K%', value: kPct ? `${kPct}%` : undefined },
                  { label: 'BB%', value: bbPct ? `${bbPct}%` : undefined },
                  { label: 'K-BB%', value: kMinusBBPct ? `${kMinusBBPct}%` : undefined },
                  { label: 'W-L', value: pitcher.wins !== undefined && pitcher.losses !== undefined ? `${pitcher.wins}-${pitcher.losses}` : undefined },
                ].filter(s => s.value).map(s => (
                  <div key={s.label} className="bg-[#0d1b2a] rounded-lg px-3 py-2 text-center">
                    <div className="text-[10px] text-gray-500 uppercase font-semibold">{s.label}</div>
                    <div className="text-lg font-bold">{s.value}</div>
                  </div>
                ))}
              </div>

              {(pitcher.release_height || pitcher.extension) && (
                <div className="flex gap-4 mt-3 text-xs text-gray-500">
                  {pitcher.release_height && (
                    <span>Rel. Height: <span className="text-gray-300 font-semibold">{pitcher.release_height.toFixed(1)} ft</span></span>
                  )}
                  {pitcher.extension && (
                    <span>Extension: <span className="text-gray-300 font-semibold">{pitcher.extension.toFixed(1)} ft</span></span>
                  )}
                </div>
              )}
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
                  {['Pitch Name', 'Count', 'Pitch%', 'Velocity', 'IVB', 'HB', 'Spin', 'VAA', 'vRel', 'Ext.', 'Zone%', 'Whiff%', 'xwOBA'].map(h => (
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
                    <td className="px-3 py-3 text-center font-semibold">—</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.usage?.toFixed(1) ?? '—'}{pitch.usage ? '%' : ''}</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.velo?.toFixed(1) ?? '—'}</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.v_movement?.toFixed(1) ?? '—'}</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.h_movement?.toFixed(1) ?? '—'}</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.spin ?? '—'}</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.vaa?.toFixed(1) ?? '—'}{pitch.vaa ? '°' : ''}</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.vrel?.toFixed(1) ?? pitcher.release_height?.toFixed(1) ?? '—'}</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.ext?.toFixed(1) ?? pitcher.extension?.toFixed(1) ?? '—'}</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.zone_pct?.toFixed(1) ?? '—'}{pitch.zone_pct ? '%' : ''}</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.whiff?.toFixed(1) ?? '—'}{pitch.whiff ? '%' : ''}</td>
                    <td className="px-3 py-3 text-center font-semibold">{pitch.xwoba?.toFixed(3) ?? '—'}</td>
                  </tr>
                ))}
                {/* All row */}
                <tr className="bg-[#0d1b2a] font-bold border-t border-gray-600">
                  <td className="px-3 py-3 text-center">
                    <span className="inline-block px-3 py-1 rounded-md text-xs font-bold bg-gray-600 text-white">
                      All
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">—</td>
                  <td className="px-3 py-3 text-center">100.0%</td>
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

    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 12;
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

