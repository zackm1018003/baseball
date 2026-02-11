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
  h_movement?: number;
  v_movement?: number;
  vaa?: number;
}

// Pitch colors matching TJStats style
const PITCH_COLORS: Record<string, { color: string; bg: string; text: string }> = {
  'Cutter': { color: '#C77DBA', bg: '#C77DBA', text: '#fff' },
  '4-Seam Fastball': { color: '#E74C6D', bg: '#E74C6D', text: '#fff' },
  'Changeup': { color: '#F5A623', bg: '#F5A623', text: '#fff' },
  'Slider': { color: '#F4D03F', bg: '#F4D03F', text: '#333' },
  'Curveball': { color: '#1CB5C7', bg: '#1CB5C7', text: '#fff' },
  'Sinker': { color: '#8B5A3C', bg: '#8B5A3C', text: '#fff' },
  'Sweeper': { color: '#7B68EE', bg: '#7B68EE', text: '#fff' },
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

  // Build pitch array from pitcher data
  const pitches: PitchInfo[] = useMemo(() => {
    if (!pitcher) return [];
    return [
      {
        name: 'Cutter',
        shortName: 'CT',
        ...PITCH_COLORS['Cutter'],
        usage: pitcher.cutter_usage,
        velo: pitcher.cutter_velo,
        spin: pitcher.cutter_spin,
        h_movement: undefined,
        v_movement: undefined,
        vaa: pitcher.cutter_vaa,
      },
      {
        name: '4-Seam Fastball',
        shortName: 'FF',
        ...PITCH_COLORS['4-Seam Fastball'],
        usage: pitcher.fastball_usage,
        velo: pitcher.fastball_velo,
        spin: pitcher.fastball_spin,
        h_movement: pitcher.fastball_movement_h,
        v_movement: pitcher.fastball_movement_v,
        vaa: pitcher.fastball_vaa,
      },
      {
        name: 'Changeup',
        shortName: 'CH',
        ...PITCH_COLORS['Changeup'],
        usage: pitcher.changeup_usage,
        velo: pitcher.changeup_velo,
        spin: pitcher.changeup_spin,
        h_movement: pitcher.changeup_movement_h,
        v_movement: pitcher.changeup_movement_v,
        vaa: pitcher.changeup_vaa,
      },
      {
        name: 'Slider',
        shortName: 'SL',
        ...PITCH_COLORS['Slider'],
        usage: pitcher.slider_usage,
        velo: pitcher.slider_velo,
        spin: pitcher.slider_spin,
        h_movement: pitcher.slider_movement_h,
        v_movement: pitcher.slider_movement_v,
        vaa: pitcher.slider_vaa,
      },
      {
        name: 'Curveball',
        shortName: 'CB',
        ...PITCH_COLORS['Curveball'],
        usage: pitcher.curveball_usage,
        velo: pitcher.curveball_velo,
        spin: pitcher.curveball_spin,
        h_movement: pitcher.curveball_movement_h,
        v_movement: pitcher.curveball_movement_v,
        vaa: pitcher.curveball_vaa,
      },
    ].filter(p => p.usage !== undefined && p.usage > 0) as PitchInfo[];
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

      <div className="container mx-auto px-4 py-6 max-w-6xl">

        {/* ===== PLAYER HEADER ===== */}
        <div className="bg-[#16213e] rounded-xl p-6 mb-6">
          <div className="flex items-center gap-6">
            {/* Player Image */}
            <div className="flex-shrink-0">
              <div className="relative w-36 h-36 rounded-full overflow-hidden bg-gray-700 border-4 border-gray-600">
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

            {/* Name + Info */}
            <div className="flex-1">
              <h1 className="text-4xl font-bold mb-1">{pitcher.full_name}</h1>
              <p className="text-gray-400 text-lg mb-3">
                {throws && `${throws}HP`}
                {age && `, Age: ${age}`}
                {height && `, ${height}`}
                {weight && `/${weight}`}
              </p>
              <h2 className="text-xl text-gray-300 font-semibold">Season Pitching Summary</h2>
              <p className="text-gray-500 text-sm">2025 MLB Season</p>
              {(pitcher.release_height || pitcher.extension) && (
                <div className="flex gap-4 mt-2 text-sm">
                  {pitcher.release_height && (
                    <span className="text-gray-400">Rel. Height: <span className="text-white font-semibold">{pitcher.release_height.toFixed(1)} ft</span></span>
                  )}
                  {pitcher.extension && (
                    <span className="text-gray-400">Extension: <span className="text-white font-semibold">{pitcher.extension.toFixed(1)} ft</span></span>
                  )}
                </div>
              )}
            </div>

            {/* Team Logo */}
            {teamLogo && (
              <div className="flex-shrink-0">
                <img src={teamLogo} alt={pitcher.team || ''} className="w-24 h-24 object-contain" />
              </div>
            )}
          </div>
        </div>

        {/* ===== SUMMARY STATS BAR ===== */}
        <div className="bg-[#16213e] rounded-xl mb-6 overflow-hidden">
          <table className="w-full text-center">
            <thead>
              <tr className="border-b border-gray-700">
                {['IP', 'WHIP', 'ERA', 'FIP', 'K%', 'BB%', 'K-BB%'].map(h => (
                  <th key={h} className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-4 py-3 text-lg font-bold">{pitcher.ip?.toFixed(1) ?? '—'}</td>
                <td className="px-4 py-3 text-lg font-bold">{pitcher.whip?.toFixed(2) ?? '—'}</td>
                <td className="px-4 py-3 text-lg font-bold">{pitcher.era?.toFixed(2) ?? '—'}</td>
                <td className="px-4 py-3 text-lg font-bold">—</td>
                <td className="px-4 py-3 text-lg font-bold">{kPct ? `${kPct}%` : '—'}</td>
                <td className="px-4 py-3 text-lg font-bold">{bbPct ? `${bbPct}%` : '—'}</td>
                <td className="px-4 py-3 text-lg font-bold">{kMinusBBPct ? `${kMinusBBPct}%` : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ===== THREE PANEL: Velocity Dist | Pitch Breaks | Pitch Usage ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">

          {/* LEFT: Pitch Velocity Distribution */}
          <div className="bg-[#16213e] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Pitch Velocity Distribution
            </h3>
            <div className="space-y-4">
              {pitches.map((pitch) => (
                <VeloDistribution key={pitch.name} pitch={pitch} />
              ))}
            </div>
          </div>

          {/* CENTER: Pitch Breaks Scatter */}
          <div className="bg-[#16213e] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Pitch Breaks - Arm Angle
            </h3>
            <PitchBreaksChart pitches={pitches} throws={throws} />
          </div>

          {/* RIGHT: Pitch Usage */}
          <div className="bg-[#16213e] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Pitch Usage
            </h3>
            <PitchUsageChart pitches={pitches} />
          </div>
        </div>

        {/* ===== PITCH LEGEND ===== */}
        <div className="flex justify-center gap-6 mb-6">
          {pitches.map(p => (
            <div key={p.name} className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="text-sm text-gray-300">{p.name}</span>
            </div>
          ))}
        </div>

        {/* ===== PITCH STATS TABLE ===== */}
        <div className="bg-[#16213e] rounded-xl overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                {['Pitch Name', 'Usage', 'Velocity', 'Spin', 'VAA', 'H Break', 'V Break'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pitches.map((pitch) => (
                <tr key={pitch.name} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                  <td className="px-4 py-3">
                    <span
                      className="inline-block px-3 py-1 rounded-md text-sm font-bold"
                      style={{ backgroundColor: pitch.bg, color: pitch.text }}
                    >
                      {pitch.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold">{pitch.usage?.toFixed(1)}%</td>
                  <td className="px-4 py-3 font-semibold">{pitch.velo?.toFixed(1) ?? '—'}</td>
                  <td className="px-4 py-3 font-semibold">{pitch.spin ?? '—'}</td>
                  <td className="px-4 py-3 font-semibold">{pitch.vaa?.toFixed(1) ?? '—'}°</td>
                  <td className="px-4 py-3 font-semibold">{pitch.h_movement?.toFixed(1) ?? '—'}</td>
                  <td className="px-4 py-3 font-semibold">{pitch.v_movement?.toFixed(1) ?? '—'}</td>
                </tr>
              ))}
              {/* All row */}
              <tr className="bg-gray-700/30 font-bold">
                <td className="px-4 py-3">
                  <span className="inline-block px-3 py-1 rounded-md text-sm font-bold bg-gray-600 text-white">
                    All
                  </span>
                </td>
                <td className="px-4 py-3">100.0%</td>
                <td className="px-4 py-3">—</td>
                <td className="px-4 py-3">—</td>
                <td className="px-4 py-3">—</td>
                <td className="px-4 py-3">—</td>
                <td className="px-4 py-3">—</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ===== ADDITIONAL STATS (W/L/SV) ===== */}
        {(pitcher.wins !== undefined || pitcher.losses !== undefined || pitcher.saves !== undefined) && (
          <div className="bg-[#16213e] rounded-xl p-5 mb-6">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Record</h3>
            <div className="flex gap-8">
              {pitcher.wins !== undefined && (
                <div>
                  <div className="text-gray-500 text-xs">W</div>
                  <div className="text-2xl font-bold">{pitcher.wins}</div>
                </div>
              )}
              {pitcher.losses !== undefined && (
                <div>
                  <div className="text-gray-500 text-xs">L</div>
                  <div className="text-2xl font-bold">{pitcher.losses}</div>
                </div>
              )}
              {pitcher.saves !== undefined && (
                <div>
                  <div className="text-gray-500 text-xs">SV</div>
                  <div className="text-2xl font-bold">{pitcher.saves}</div>
                </div>
              )}
            </div>
          </div>
        )}

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

/** Velocity distribution - horizontal bar with range indicator */
function VeloDistribution({ pitch }: { pitch: PitchInfo }) {
  if (!pitch.velo) return null;

  // Simulate a range around the average velo
  const minVelo = pitch.velo - 2.5;
  const maxVelo = pitch.velo + 2.5;
  const absMin = 70;
  const absMax = 105;
  const range = absMax - absMin;

  const leftPct = ((minVelo - absMin) / range) * 100;
  const widthPct = ((maxVelo - minVelo) / range) * 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-gray-400 uppercase">{pitch.shortName}</span>
        <span className="text-xs text-gray-400">{pitch.velo.toFixed(1)} mph</span>
      </div>
      <div className="relative h-4 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="absolute top-0 h-full rounded-full opacity-80"
          style={{
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            backgroundColor: pitch.color,
          }}
        />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] text-gray-600">{absMin}</span>
        <span className="text-[10px] text-gray-600">{absMax}</span>
      </div>
    </div>
  );
}

/** Pitch Breaks scatter chart (SVG) */
function PitchBreaksChart({ pitches, throws }: { pitches: PitchInfo[]; throws?: 'R' | 'L' }) {
  const size = 300;
  const center = size / 2;
  const maxInches = 24;
  const scale = (center - 30) / maxInches;

  // Generate scattered dots around each pitch's movement
  const allDots: { x: number; y: number; color: string }[] = [];

  pitches.forEach((pitch) => {
    if (pitch.h_movement === undefined || pitch.v_movement === undefined) return;

    const baseX = center - pitch.h_movement * scale;
    const baseY = center - pitch.v_movement * scale;

    // Scatter dots around center
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

  return (
    <div className="flex justify-center">
      <svg width={size} height={size} className="bg-[#0d1b2a] rounded-lg">
        {/* Grid */}
        <line x1={center} y1={20} x2={center} y2={size - 20} stroke="#2a3a4a" strokeWidth="1" />
        <line x1={20} y1={center} x2={size - 20} y2={center} stroke="#2a3a4a" strokeWidth="1" />

        {/* Concentric guides */}
        {[10, 20].map(inches => (
          <circle key={inches} cx={center} cy={center} r={inches * scale}
            fill="none" stroke="#2a3a4a" strokeWidth="0.5" strokeDasharray="3,3" />
        ))}

        {/* Axis labels */}
        <text x={center} y={15} textAnchor="middle" fontSize="9" fill="#5a6a7a">Induced Vertical Break (in)</text>
        <text x={size - 5} y={center - 5} textAnchor="end" fontSize="9" fill="#5a6a7a">
          {throws === 'L' ? 'Arm Side →' : 'Glove Side →'}
        </text>
        <text x={5} y={center - 5} textAnchor="start" fontSize="9" fill="#5a6a7a">
          {throws === 'L' ? '← Glove Side' : '← Arm Side'}
        </text>

        {/* Dots */}
        {allDots.map((dot, i) => (
          <circle key={i} cx={dot.x} cy={dot.y} r="4" fill={dot.color} opacity="0.75" />
        ))}
      </svg>
    </div>
  );
}

/** Pitch Usage horizontal bar chart */
function PitchUsageChart({ pitches }: { pitches: PitchInfo[] }) {
  const maxUsage = Math.max(...pitches.map(p => p.usage || 0));

  return (
    <div className="space-y-3">
      {pitches
        .sort((a, b) => (b.usage || 0) - (a.usage || 0))
        .map((pitch) => (
          <div key={pitch.name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-gray-300">{pitch.name}</span>
              <span className="text-xs font-bold text-white">{pitch.usage?.toFixed(1)}%</span>
            </div>
            <div className="relative h-6 bg-gray-800 rounded overflow-hidden">
              <div
                className="h-full rounded transition-all"
                style={{
                  width: `${((pitch.usage || 0) / 100) * 100}%`,
                  backgroundColor: pitch.color,
                  opacity: 0.85,
                }}
              />
            </div>
          </div>
        ))}
    </div>
  );
}
