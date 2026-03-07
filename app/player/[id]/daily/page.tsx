'use client';

import { use, useState, useEffect, useCallback, useMemo } from 'react';
import { getPlayerById, getPlayerByName } from '@/lib/database';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import { getCountryFlagUrl } from '@/lib/country-flags';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DailyPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string }>;
}

interface HitterRawDot {
  pitchType: string;
  px: number;
  pz: number;
  isWhiff: boolean;
  isBarrel: boolean;
  isSwing: boolean;
  isTake: boolean;
  exitVelo: number | null;
}

interface HitterHitDot {
  hcX: number;
  hcY: number;
  result: string;
}

interface HitterPitchTypeStat {
  name: string;
  count: number;
  swings: number;
  whiffs: number;
  contacts: number;
  inZone: number;
}

interface AtBatPitch {
  pitchNum: number;
  pitchType: string;
  velo: number | null;
  hBreak: number | null;
  ivBreak: number | null;
  description: string;
  exitVelo: number | null;
  launchAngle: number | null;
  hitDistance: number | null;
}

interface AtBat {
  atBatNum: number;
  pitcherName: string;
  result: string;
  pitches: AtBatPitch[];
}

interface HitterPitchData {
  totalPitches: number;
  rawDots: HitterRawDot[];
  pitchTypes: HitterPitchTypeStat[];
  atBats?: AtBat[];
  hitDots?: HitterHitDot[];
}

interface GameLine {
  date: string;
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  doubles: number;
  triples: number;
  pa: number;
  sb: number;
}

interface GameInfo {
  gamePk: number | null;
  opponent: string | null;
  opponentFull: string | null;
  team: string | null;
  isHome: boolean | null;
  date: string;
}

interface AvailableDate {
  date: string;
  opponent: string;
  ab: number;
  h: number;
  hr: number;
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
  pitchData: HitterPitchData | null;
  availableDates: AvailableDate[];
}

// ─── Pitch colors ─────────────────────────────────────────────────────────────

const PITCH_COLORS: Record<string, { color: string; bg: string; text: string }> = {
  '4-Seam Fastball': { color: '#D22D49', bg: '#D22D49', text: '#fff' },
  'Sinker':          { color: '#C75B12', bg: '#C75B12', text: '#fff' },
  'Cutter':          { color: '#933F2C', bg: '#933F2C', text: '#fff' },
  'Changeup':        { color: '#3BBB38', bg: '#3BBB38', text: '#fff' },
  'Splitter':        { color: '#1A8B6E', bg: '#1A8B6E', text: '#fff' },
  'Curveball':       { color: '#00D1ED', bg: '#00D1ED', text: '#333' },
  'Knuckle Curve':   { color: '#6236CD', bg: '#6236CD', text: '#fff' },
  'Slider':          { color: '#EFE514', bg: '#EFE514', text: '#333' },
  'Sweeper':         { color: '#FF6D00', bg: '#FF6D00', text: '#fff' },
  'Slurve':          { color: '#3B44CE', bg: '#3B44CE', text: '#fff' },
};

function pitchColors(name: string) {
  return PITCH_COLORS[name] || { color: '#888', bg: '#888', text: '#fff' };
}

const PITCH_ABBREV: Record<string, string> = {
  '4-Seam Fastball': 'FF',
  'Sinker':          'SI',
  'Cutter':          'CT',
  'Changeup':        'CH',
  'Curveball':       'CU',
  'Slider':          'SL',
  'Sweeper':         'SW',
  'Knuckle Curve':   'KC',
  'Splitter':        'SP',
  'Slurve':          'SV',
};

function cleanDesc(desc: string): string {
  const d = desc.toLowerCase();
  if (d.includes('swinging_strike') || d.includes('swinging strike')) return 'Whiff';
  if (d === 'called_strike' || d === 'called strike') return 'CS';
  if (d === 'ball' || d === 'blocked_ball') return 'Ball';
  if (d.includes('foul_tip') || d === 'foul tip') return 'Foul Tip';
  if (d.includes('foul')) return 'Foul';
  if (d.includes('hit_into_play') || d.includes('in play')) return 'In Play';
  return desc.replace(/_/g, ' ');
}

function cleanResult(events: string): string {
  const map: Record<string, string> = {
    single: '1B', double: '2B', triple: '3B', home_run: 'HR',
    strikeout: 'K', strikeout_double_play: 'KDP',
    walk: 'BB', intent_walk: 'IBB', hit_by_pitch: 'HBP',
    field_out: 'Out', force_out: 'FC Out',
    fielders_choice: 'FC', fielders_choice_out: 'FC Out',
    grounded_into_double_play: 'GIDP', double_play: 'DP', triple_play: 'TP',
    sac_fly: 'SF', sac_fly_double_play: 'SF-DP',
    sac_bunt: 'SH', sac_bunt_double_play: 'SH-DP',
    catcher_interf: 'CI', other_out: 'Out',
  };
  return map[events] || events.replace(/_/g, ' ');
}

function resultColor(events: string): string {
  if (['single','double','triple','home_run'].includes(events)) return 'bg-green-700 text-green-200';
  if (['strikeout','strikeout_double_play','field_out','force_out',
       'grounded_into_double_play','double_play','triple_play',
       'sac_fly','sac_fly_double_play','sac_bunt','sac_bunt_double_play',
       'other_out','fielders_choice','fielders_choice_out'].includes(events))
    return 'bg-red-900 text-red-300';
  if (['walk','intent_walk','hit_by_pitch'].includes(events)) return 'bg-blue-800 text-blue-200';
  return 'bg-gray-700 text-gray-300';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Zone Chart - pitches seen by hitter ─────────────────────────────────────

function HitterZoneChart({
  rawDots,
  pitchOverrides = {},
  onDotClick,
}: {
  rawDots: HitterRawDot[];
  pitchOverrides?: Record<number, string>;
  onDotClick?: (index: number, svgX: number, svgY: number) => void;
}) {
  const size = 300;
  const xMin = -2.5, xMax = 2.5;
  const zMin = 0,    zMax = 5;
  const pad = 28;
  const w = size - pad * 2;
  const h = size - pad * 2;

  const toSvgX = (px: number) => pad + ((px - xMin) / (xMax - xMin)) * w;
  const toSvgY = (pz: number) => pad + ((zMax - pz) / (zMax - zMin)) * h;

  const szLeft  = toSvgX(-0.708);
  const szRight = toSvgX(0.708);
  const szTop   = toSvgY(3.5);
  const szBot   = toSvgY(1.5);

  const thirdW = (szRight - szLeft) / 3;
  const thirdH = (szBot - szTop) / 3;

  if (rawDots.length === 0) {
    return (
      <div style={{ width: size, height: size }}
        className="bg-[#d1d5db] rounded-lg flex items-center justify-center">
        <p className="text-gray-500 text-xs text-center px-6">No Statcast data</p>
      </div>
    );
  }

  return (
    <svg width={size} height={size} className="bg-white rounded-lg">
      {/* Title */}
      <text x={size / 2} y={18} textAnchor="middle" fontSize="10" fontWeight="600" fill="#111827">
        Pitches Seen
      </text>
      {onDotClick && (
        <text x={size / 2} y={27} textAnchor="middle" fontSize="7" fill="#6b7280">
          click a pitch to reclassify
        </text>
      )}

      {/* Strike zone */}
      <rect x={szLeft} y={szTop} width={szRight - szLeft} height={szBot - szTop}
        fill="rgba(0,0,0,0.06)" stroke="#000" strokeWidth="2" />

      {/* Inner thirds grid */}
      {[1, 2].map(i => (
        <line key={`v${i}`}
          x1={szLeft + thirdW * i} y1={szTop}
          x2={szLeft + thirdW * i} y2={szBot}
          stroke="#00000033" strokeWidth="0.75" />
      ))}
      {[1, 2].map(i => (
        <line key={`h${i}`}
          x1={szLeft} y1={szTop + thirdH * i}
          x2={szRight} y2={szTop + thirdH * i}
          stroke="#00000033" strokeWidth="0.75" />
      ))}

      {/* Pitch dots */}
      {rawDots.map((dot, i) => {
        const cx = toSvgX(dot.px);
        const cy = toSvgY(dot.pz);
        const effectiveType = pitchOverrides[i] ?? dot.pitchType;
        const col = pitchColors(effectiveType).color;
        const isOverridden = pitchOverrides[i] !== undefined;

        const handleClick = (e: React.MouseEvent) => {
          e.stopPropagation();
          onDotClick?.(i, cx, cy);
        };

        if (dot.isWhiff) {
          const s = 4;
          return (
            <g key={i} onClick={handleClick} style={{ cursor: onDotClick ? 'pointer' : 'default' }}>
              <circle cx={cx} cy={cy} r="9" fill="transparent" />
              <line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke="#000" strokeWidth="4" opacity="0.9" />
              <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke="#000" strokeWidth="4" opacity="0.9" />
              <line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke={col} strokeWidth="2.5" opacity="0.95" />
              <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke={col} strokeWidth="2.5" opacity="0.95" />
              {isOverridden && <circle cx={cx} cy={cy} r="7" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="3,2" />}
            </g>
          );
        }
        if (dot.isBarrel) {
          return (
            <g key={i} onClick={handleClick} style={{ cursor: onDotClick ? 'pointer' : 'default' }}>
              <circle cx={cx} cy={cy} r="9" fill="transparent" />
              <text x={cx} y={cy+5} textAnchor="middle" fontSize="12" fontWeight="bold"
                fill="#000" stroke="#000" strokeWidth="4" strokeLinejoin="round" opacity="0.9">B</text>
              <text x={cx} y={cy+5} textAnchor="middle" fontSize="12" fontWeight="bold"
                fill={col} opacity="0.95">B</text>
              {isOverridden && <circle cx={cx} cy={cy} r="9" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="3,2" />}
            </g>
          );
        }
        if (dot.isTake) {
          return (
            <g key={i} onClick={handleClick} style={{ cursor: onDotClick ? 'pointer' : 'default' }}>
              <circle cx={cx} cy={cy} r="8" fill="transparent" />
              <circle cx={cx} cy={cy} r="3.5" fill="none" stroke={col} strokeWidth="1.5" opacity="0.75" />
              {isOverridden && <circle cx={cx} cy={cy} r="6" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="3,2" opacity="0.9" />}
            </g>
          );
        }
        return (
          <g key={i} onClick={handleClick} style={{ cursor: onDotClick ? 'pointer' : 'default' }}>
            <circle cx={cx} cy={cy} r="8" fill="transparent" />
            <circle cx={cx} cy={cy} r="3.5" fill={col} stroke="#000" strokeWidth="0.6" opacity="0.8" />
            {isOverridden && <circle cx={cx} cy={cy} r="6" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="3,2" opacity="0.9" />}
          </g>
        );
      })}

      {/* Legend */}
      <circle cx={pad + 4} cy={size - 10} r="3" fill="#555" opacity="0.8" />
      <text x={pad + 10} y={size - 7} fontSize="7.5" fill="#000">swing</text>
      <circle cx={pad + 42} cy={size - 10} r="3" fill="none" stroke="#555" strokeWidth="1.5" />
      <text x={pad + 48} y={size - 7} fontSize="7.5" fill="#000">take</text>
      <line x1={pad + 75} y1={size - 14} x2={pad + 81} y2={size - 7} stroke="#555" strokeWidth="1.5" />
      <line x1={pad + 81} y1={size - 14} x2={pad + 75} y2={size - 7} stroke="#555" strokeWidth="1.5" />
      <text x={pad + 85} y={size - 7} fontSize="7.5" fill="#000">whiff</text>
      <text x={pad + 114} y={size - 7} fontSize="7.5" fontWeight="bold" fill="#000">B</text>
      <text x={pad + 122} y={size - 7} fontSize="7.5" fill="#000">barrel</text>
    </svg>
  );
}

// ─── At-bat breakdown panel ───────────────────────────────────────────────────

function AtBatPanel({ atBats, loading, maxHeight = 300 }: { atBats: AtBat[]; loading: boolean; maxHeight?: number }) {
  if (loading) {
    return (
      <div className="bg-[#0d1b2a] rounded-lg flex items-center justify-center" style={{ height: maxHeight }}>
        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!atBats || atBats.length === 0) {
    return (
      <div className="bg-[#0d1b2a] rounded-lg flex items-center justify-center" style={{ height: maxHeight }}>
        <p className="text-gray-500 text-xs text-center px-4">No at-bat data</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 overflow-y-auto pr-1" style={{ maxHeight }}>
      {atBats.map(ab => (
        <div key={ab.atBatNum} className="bg-[#0d1b2a] rounded p-1 flex-shrink-0">
          {/* Header */}
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[9px] font-bold text-gray-500">AB {ab.atBatNum}</span>
            {ab.result && (
              <span className={`text-[9px] font-bold px-1 py-0 rounded leading-3 ${resultColor(ab.result)}`}>
                {cleanResult(ab.result)}
              </span>
            )}
            <span className="text-[9px] text-gray-400 truncate">{ab.pitcherName}</span>
          </div>

          {/* Pitch rows */}
          <div className="flex flex-col gap-px">
            {ab.pitches.map((p, i) => {
              const col = PITCH_COLORS[p.pitchType];
              const abbrev = PITCH_ABBREV[p.pitchType] || p.pitchType.slice(0, 2).toUpperCase();
              return (
                <div key={i} className="flex items-center gap-1 leading-3">
                  {/* Type badge */}
                  <span
                    className="rounded px-1 font-bold text-[8px] leading-3 flex-shrink-0"
                    style={{ backgroundColor: col?.bg || '#555', color: col?.text || '#fff' }}
                  >
                    {abbrev}
                  </span>

                  {/* Velo */}
                  {p.velo !== null && (
                    <span className="text-[9px] text-gray-200 font-semibold w-5 text-right flex-shrink-0">
                      {p.velo.toFixed(0)}
                    </span>
                  )}

                  {/* Description + exit velo + distance inline */}
                  <span className="text-[9px] text-gray-300 truncate">{cleanDesc(p.description)}</span>
                  {(p.exitVelo !== null || p.launchAngle !== null || p.hitDistance !== null) && (
                    <span className="text-[9px] text-yellow-400 font-semibold ml-1 flex-shrink-0">
                      {p.exitVelo !== null ? `${p.exitVelo.toFixed(0)} EV` : ''}
                      {p.exitVelo !== null && p.launchAngle !== null ? ' · ' : ''}
                      {p.launchAngle !== null ? `${p.launchAngle.toFixed(0)}°` : ''}
                      {p.hitDistance !== null ? ` · ${p.hitDistance}ft` : ''}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}


function SprayChart({ hitDots }: { hitDots: HitterHitDot[] }) {
  const W = 300;
  const H = 300;

  // Map Statcast hc_x/hc_y to SVG display coordinates
  const toX = (hcX: number) => 10 + (hcX / 250) * 280;
  const toY = (hcY: number) => 22 + ((hcY - 15) / 200) * 253;

  // Key field anchor points
  const hpX = toX(125), hpY = toY(199);   // home plate
  const lfX = toX(8),   lfY = toY(162);   // left foul pole
  const rfX = toX(242), rfY = toY(162);   // right foul pole
  const arcR = (rfX - lfX) / 2;           // outfield arc radius
  const b1X = toX(162), b1Y = toY(162);
  const b2X = toX(125), b2Y = toY(129);
  const b3X = toX(88),  b3Y = toY(162);
  const mnX = toX(125), mnY = toY(163);

  function dotColor(result: string): string {
    if (result === 'single')   return '#f97316';
    if (result === 'double')   return '#8b5cf6';
    if (result === 'triple')   return '#eab308';
    if (result === 'home_run') return '#ec4899';
    return '';
  }

  const HIT_TYPES = ['single', 'double', 'triple', 'home_run'];
  const visibleDots = hitDots.filter(d => HIT_TYPES.includes(d.result));

  return (
    <svg width={W} height={H} style={{ background: '#ffffff' }} className="rounded-lg">
      {/* Title */}
      <text x={W / 2} y={15} textAnchor="middle" fontSize="11" fontWeight="700" fill="#111827">
        Batted Ball Spray Chart
      </text>

      {/* Fair territory grass */}
      <path
        d={`M ${hpX} ${hpY} L ${lfX} ${lfY} A ${arcR} ${arcR} 0 0 0 ${rfX} ${rfY} Z`}
        fill="#b2dfdb"
      />

      {/* Infield grass (lighter) */}
      <polygon
        points={`${hpX},${hpY} ${b1X},${b1Y} ${b2X},${b2Y} ${b3X},${b3Y}`}
        fill="#e0f2f1"
      />

      {/* Infield dirt */}
      <ellipse cx={mnX} cy={mnY} rx={arcR * 0.41} ry={arcR * 0.34} fill="#ddc9a3" />

      {/* Outfield wall */}
      <path
        d={`M ${lfX} ${lfY} A ${arcR} ${arcR} 0 0 0 ${rfX} ${rfY}`}
        fill="none" stroke="#4db6ac" strokeWidth="2.5"
      />

      {/* Foul lines */}
      <line x1={hpX} y1={hpY} x2={lfX} y2={lfY} stroke="#4db6ac" strokeWidth="1.5" />
      <line x1={hpX} y1={hpY} x2={rfX} y2={rfY} stroke="#4db6ac" strokeWidth="1.5" />

      {/* Base paths */}
      <polygon
        points={`${hpX},${hpY} ${b1X},${b1Y} ${b2X},${b2Y} ${b3X},${b3Y}`}
        fill="none" stroke="#4db6ac" strokeWidth="1"
      />

      {/* Pitcher's mound */}
      <circle cx={mnX} cy={mnY} r="5" fill="#c8a97a" />

      {/* Home plate */}
      <polygon
        points={`${hpX},${hpY - 5} ${hpX + 5},${hpY} ${hpX},${hpY + 5} ${hpX - 5},${hpY}`}
        fill="white" stroke="#4db6ac" strokeWidth="1"
      />

      {/* Bases */}
      {[{ x: b1X, y: b1Y }, { x: b2X, y: b2Y }, { x: b3X, y: b3Y }].map((b, i) => (
        <rect key={i} x={b.x - 3.5} y={b.y - 3.5} width="7" height="7"
          fill="white" stroke="#4db6ac" strokeWidth="1" />
      ))}

      {/* Distance labels */}
      <text x={26}       y={200} fontSize="9" fill="#4db6ac" fontWeight="600">330</text>
      <text x={68}       y={112} fontSize="9" fill="#4db6ac" fontWeight="600">375</text>
      <text x={W / 2 - 10} y={62} fontSize="9" fill="#4db6ac" fontWeight="600">400</text>
      <text x={224}      y={112} fontSize="9" fill="#4db6ac" fontWeight="600">375</text>
      <text x={261}      y={200} fontSize="9" fill="#4db6ac" fontWeight="600">330</text>

      {/* Hit dots */}
      {visibleDots.map((dot, i) => (
        <circle
          key={i}
          cx={toX(dot.hcX)}
          cy={toY(dot.hcY)}
          r="5.5"
          fill={dotColor(dot.result)}
          stroke="white"
          strokeWidth="0.8"
          opacity="0.9"
        />
      ))}

      {/* No data */}
      {hitDots.length === 0 && (
        <text x={W / 2} y={H / 2 + 10} textAnchor="middle" fontSize="10" fill="#9ca3af">
          No Statcast data
        </text>
      )}
      {visibleDots.length === 0 && hitDots.length > 0 && (
        <text x={W / 2} y={H / 2 + 10} textAnchor="middle" fontSize="10" fill="#9ca3af">
          No hits recorded
        </text>
      )}

      {/* Legend */}
      <circle cx="18"  cy={H - 9} r="4.5" fill="#f97316" />
      <text x="26"  y={H - 5} fontSize="8.5" fill="#374151" fontWeight="500">Single</text>
      <circle cx="80"  cy={H - 9} r="4.5" fill="#8b5cf6" />
      <text x="88"  y={H - 5} fontSize="8.5" fill="#374151" fontWeight="500">Double</text>
      <circle cx="144" cy={H - 9} r="4.5" fill="#eab308" />
      <text x="152" y={H - 5} fontSize="8.5" fill="#374151" fontWeight="500">Triple</text>
      <circle cx="199" cy={H - 9} r="4.5" fill="#ec4899" />
      <text x="207" y={H - 5} fontSize="8.5" fill="#374151" fontWeight="500">Home Run</text>
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HitterDailyPage({ params, searchParams }: DailyPageProps) {
  const { id } = use(params);
  const { date: initialDate } = use(searchParams);

  // Try to resolve player from static DB
  const isNumeric = /^\d+$/.test(id);
  const player = isNumeric
    ? getPlayerById(parseInt(id))
    : getPlayerByName(decodeURIComponent(id));
  const playerId = player?.player_id ?? (isNumeric ? parseInt(id) : null);

  const [data, setData]               = useState<DailyData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(initialDate ?? today());
  const [imageError, setImageError]   = useState(0);
  const [filterHR, setFilterHR]       = useState(false);
  const [pitchOverrides, setPitchOverrides] = useState<Record<number, string>>({});
  const [reclassifyDot, setReclassifyDot]   = useState<{ index: number; svgX: number; svgY: number } | null>(null);
  const [playerBio, setPlayerBio]     = useState<{
    height?: string; weight?: number; birthDate?: string;
    pitchHand?: string; batSide?: string;
  } | null>(null);

  // Effective dots = rawDots with any user overrides applied
  const effectiveRawDots = useMemo(() => {
    if (!data?.pitchData?.rawDots) return [];
    return data.pitchData.rawDots.map((dot, i) => ({
      ...dot,
      pitchType: pitchOverrides[i] ?? dot.pitchType,
    }));
  }, [data?.pitchData?.rawDots, pitchOverrides]);

  // Pitch type breakdown recomputed from effective dots (reflects overrides)
  const computedPitchTypes = useMemo((): HitterPitchTypeStat[] => {
    const map: Record<string, HitterPitchTypeStat> = {};
    for (const dot of effectiveRawDots) {
      if (!map[dot.pitchType]) {
        map[dot.pitchType] = { name: dot.pitchType, count: 0, swings: 0, whiffs: 0, contacts: 0, inZone: 0 };
      }
      const s = map[dot.pitchType];
      s.count++;
      if (dot.isSwing || dot.isWhiff || dot.isBarrel) s.swings++;
      if (dot.isWhiff) s.whiffs++;
      if ((dot.isSwing || dot.isBarrel) && !dot.isWhiff) s.contacts++;
      if (dot.px >= -0.708 && dot.px <= 0.708 && dot.pz >= 1.5 && dot.pz <= 3.5) s.inZone++;
    }
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [effectiveRawDots]);

  const fetchData = useCallback(async (date?: string, silent = false) => {
    if (!playerId) return;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const res = await fetch(`/api/hitter-daily?playerId=${playerId}&date=${date ?? today()}`, { cache: 'no-store' });
      const json = await res.json();
      if (!playerBio && json.playerHeight) {
        setPlayerBio({
          height: json.playerHeight,
          weight: json.playerWeight,
          birthDate: json.playerBirthDate,
          pitchHand: json.playerPitchHand,
          batSide: json.playerBatSide,
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
      if (!silent) setError('Network error - could not load game data');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [playerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(initialDate ?? undefined); }, [fetchData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 90s when viewing today
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

  const displayName = player?.full_name ?? data?.playerName ?? `Player ${id}`;
  const availableDates = data?.availableDates ?? [];
  const gameLine = data?.gameLine;
  const gameInfo = data?.gameInfo;

  const imageSources = [
    playerId ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_426,q_auto:best/v1/people/${playerId}/headshot/silo/current` : null,
    playerId ? getMLBStaticPlayerImage(playerId, { width: 426 }) : null,
    playerId ? getESPNPlayerImage(playerId) : null,
    '/api/placeholder/400/400',
  ].filter(Boolean) as string[];
  const currentImage = imageSources[Math.min(imageError, imageSources.length - 1)];

  const teamLogo = player?.team
    ? getMLBTeamLogoUrl(player.team)
    : (gameInfo?.team ? getMLBTeamLogoUrl(gameInfo.team) : null);
  const opponentLogo = gameInfo?.opponent ? getMLBTeamLogoUrl(gameInfo.opponent) : null;

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-white">

      {/* Nav */}
      <header className="bg-[#16213e] border-b border-gray-700">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-blue-400 hover:text-blue-300 font-medium text-sm">
              ← Back to Hitters
            </Link>
            {player && (
              <Link
                href={`/player/${id}`}
                className="px-3 py-1.5 bg-[#0d1b2a] hover:bg-[#1a2940] border border-gray-600 hover:border-blue-500 text-gray-300 hover:text-white rounded-lg text-xs font-semibold transition-colors"
              >
                📊 Season Card
              </Link>
            )}
            <Link href="/pitchers" className="text-green-400 hover:text-green-300 font-medium text-sm">
              View Pitchers →
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto px-6 py-6" style={{ maxWidth: 1400 }}>

        {/* ── MAIN CARD ── */}
        <div className="flex justify-center mb-6">
        <div className="bg-[#16213e] rounded-xl p-6 inline-block">
          {/* Loading / Error */}
          {loading && (
            <div className="flex items-center justify-center gap-2 mb-3">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-gray-400 text-xs">Loading...</span>
            </div>
          )}
          {!loading && error && (
            <div className="bg-[#0d1b2a] rounded-lg p-2 mb-3 text-center">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}
          {/* Main layout: [photo + at-bats] | center */}
          <div className="flex gap-4 items-start">
            {/* LEFT COLUMN: photo stacked above at-bats */}
            <div className="flex-shrink-0 flex flex-col gap-3 w-[180px]">
              <div className="flex items-start gap-2">
                {(() => {
                  const flag = getCountryFlagUrl(gameInfo?.team ?? null, 80);
                  return flag ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={flag} alt={gameInfo?.team ?? ''} className="w-8 h-[22px] object-cover rounded-sm flex-shrink-0 mt-1" />
                  ) : null;
                })()}
                <div className="rounded-lg overflow-hidden flex-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentImage}
                    alt={displayName}
                    className="w-full h-auto"
                    onError={() => setImageError(e => Math.min(e + 1, imageSources.length - 1))}
                  />
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">At-Bats</p>
                <AtBatPanel atBats={data?.pitchData?.atBats ?? []} loading={loading} maxHeight={400} />
              </div>
            </div>

            {/* CENTER: name/info/stats centered, zone chart centered below */}
            <div className="flex flex-col items-center">

              {/* Name / Bio / Game info / Stats */}
              <div className="flex flex-col items-center mb-4">
                <div className="flex items-center gap-3 mb-0.5">
                  <h1 className="text-2xl font-bold">{displayName}</h1>
                  {teamLogo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={teamLogo} alt={player?.team || gameInfo?.team || ''} className="w-8 h-8 object-contain flex-shrink-0" />
                  )}
                </div>

                {/* Bio */}
                {(() => {
                  const age = calcAge(playerBio?.birthDate ?? null);
                  const parts: string[] = [];
                  if (playerBio?.height) parts.push(playerBio.height);
                  if (playerBio?.weight) parts.push(`${playerBio.weight} lbs`);
                  if (age !== null) parts.push(`Age ${age}`);
                  if (playerBio?.batSide && playerBio?.pitchHand) parts.push(`${playerBio.batSide}/${playerBio.pitchHand}`);
                  return parts.length > 0
                    ? <p className="text-sm text-gray-300 mb-1">{parts.join(' • ')}</p>
                    : null;
                })()}

                {/* Game info */}
                <div className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-gray-400 mb-2">
                  {(player?.team || gameInfo?.team) && (
                    <span className="font-bold text-white">{player?.team || gameInfo?.team}</span>
                  )}
                  {gameInfo && (
                    <>
                      <span>·</span>
                      <span>{gameInfo.date}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        {gameInfo.isHome ? 'vs' : '@'}
                        {opponentLogo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={opponentLogo} alt={gameInfo.opponent || ''} className="w-4 h-4 object-contain inline" />
                        )}
                        <span className="font-semibold text-white">{gameInfo.opponentFull || gameInfo.opponent}</span>
                      </span>
                    </>
                  )}
                </div>

                {/* Stats grid */}
                {gameLine && !loading && (
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { label: 'AB',  value: String(gameLine.ab) },
                      { label: 'H',   value: String(gameLine.h) },
                      { label: 'HR',  value: String(gameLine.hr) },
                      { label: 'RBI', value: String(gameLine.rbi) },
                      { label: 'BB',  value: String(gameLine.bb) },
                      { label: 'K',   value: String(gameLine.k) },
                      { label: '2B',  value: String(gameLine.doubles) },
                      { label: '3B',  value: String(gameLine.triples) },
                      { label: 'PA',  value: String(gameLine.pa) },
                      { label: 'SB',  value: String(gameLine.sb) },
                    ].map(s => (
                      <div key={s.label} className="rounded px-2 py-0.5 text-center bg-[#0d1b2a] min-w-[36px]">
                        <div className="text-[7px] text-gray-400 uppercase font-semibold">{s.label}</div>
                        <div className="text-xs font-bold">{s.value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Zone chart + pitch type table */}
              {!loading && !error && (
                <div className="flex gap-4 items-start">
                  <div className="flex flex-col gap-2">

                    {/* Zone chart with reclassification popup */}
                    <div className="relative">
                      <HitterZoneChart
                        rawDots={data?.pitchData?.rawDots ?? []}
                        pitchOverrides={pitchOverrides}
                        onDotClick={(index, svgX, svgY) => {
                          setReclassifyDot(prev =>
                            prev?.index === index ? null : { index, svgX, svgY }
                          );
                        }}
                      />

                      {reclassifyDot && (
                        <>
                          {/* Backdrop — click outside closes popup */}
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => setReclassifyDot(null)}
                          />
                          {/* Popup */}
                          <div
                            className="absolute bg-[#0d1421] border border-blue-500/60 rounded-lg shadow-2xl z-50 p-2"
                            style={{
                              left: reclassifyDot.svgX > 190 ? reclassifyDot.svgX - 158 : reclassifyDot.svgX + 10,
                              top:  reclassifyDot.svgY > 220 ? reclassifyDot.svgY - 230 : reclassifyDot.svgY - 8,
                              minWidth: 152,
                            }}
                            onClick={e => e.stopPropagation()}
                          >
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
                                      isCurrent
                                        ? 'bg-blue-600/40 text-white'
                                        : 'hover:bg-[#1a2940] text-gray-200'
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
                                    setPitchOverrides(prev => {
                                      const n = { ...prev };
                                      delete n[reclassifyDot.index];
                                      return n;
                                    });
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

                    {/* Pitch type breakdown table */}
                    {computedPitchTypes.length > 0 && (
                      <div className="w-[300px] bg-[#0d1b2a] rounded-lg px-3 py-2">
                        {Object.keys(pitchOverrides).length > 0 && (
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[9px] text-blue-300 font-semibold uppercase tracking-wide">
                              {Object.keys(pitchOverrides).length} pitch{Object.keys(pitchOverrides).length !== 1 ? 'es' : ''} reclassified
                            </span>
                            <button
                              onClick={() => setPitchOverrides({})}
                              className="text-[9px] text-red-400 hover:text-red-300 transition-colors"
                            >
                              Reset all
                            </button>
                          </div>
                        )}
                        <table className="w-full">
                          <thead>
                            <tr className="text-gray-500 text-[9px] uppercase border-b border-gray-700/60">
                              <th className="text-left pb-1 font-semibold pr-2">Pitch</th>
                              <th className="text-right pb-1 font-semibold pr-1">#</th>
                              <th className="text-right pb-1 font-semibold pr-1">Usage</th>
                              <th className="text-right pb-1 font-semibold pr-1">Zone%</th>
                              <th className="text-right pb-1 font-semibold">Whiff%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {computedPitchTypes.map(pt => (
                              <tr key={pt.name} className="border-t border-gray-800/40">
                                <td className="py-0.5 pr-2">
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className="w-2 h-2 rounded-full flex-shrink-0"
                                      style={{ background: pitchColors(pt.name).color }}
                                    />
                                    <span className="text-[10px] text-gray-200 whitespace-nowrap">{pt.name}</span>
                                  </div>
                                </td>
                                <td className="text-right text-[10px] text-gray-200 pr-1">{pt.count}</td>
                                <td className="text-right text-[10px] text-gray-400 pr-1">
                                  {effectiveRawDots.length > 0
                                    ? ((pt.count / effectiveRawDots.length) * 100).toFixed(0) + '%'
                                    : '—'}
                                </td>
                                <td className="text-right text-[10px] text-gray-400 pr-1">
                                  {pt.count > 0
                                    ? ((pt.inZone / pt.count) * 100).toFixed(0) + '%'
                                    : '—'}
                                </td>
                                <td className="text-right text-[10px] text-gray-400">
                                  {pt.swings > 0
                                    ? ((pt.whiffs / pt.swings) * 100).toFixed(0) + '%'
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {loading && (
                <div className="flex gap-4 items-start">
                  <div className="w-[300px] h-[300px] bg-[#0d1b2a] rounded-lg" />
                </div>
              )}
            </div>

          </div>

        </div>
        </div>

        {/* ── Date picker ── */}
        {availableDates.length > 0 && (
          <div className="bg-[#16213e] rounded-xl p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-400 uppercase">
                Game Log
                <span className="ml-2 text-gray-600 font-normal normal-case">
                  {filterHR
                    ? `${availableDates.filter(d => d.hr > 0).length} HR games`
                    : `${availableDates.length} games`}
                </span>
              </h3>
              <button
                onClick={() => setFilterHR(v => !v)}
                className={`px-2.5 py-1 rounded text-xs font-bold transition-colors border ${
                  filterHR
                    ? 'bg-yellow-500/20 border-yellow-400/60 text-yellow-300'
                    : 'bg-[#0d1b2a] border-gray-600 text-gray-400 hover:border-yellow-500 hover:text-yellow-300'
                }`}
              >
                ⚾ HR Only
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableDates.filter(d => !filterHR || d.hr > 0).map((d, i) => {
                const isSelected = d.date === selectedDate;
                return (
                  <button
                    key={`${d.date}-${d.gamePk ?? i}`}
                    onClick={() => handleDateChange(d.date)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isSelected
                        ? 'bg-blue-600 text-white'
                        : 'bg-[#0d1b2a] text-gray-300 hover:bg-[#1a2940] hover:text-white border border-gray-600'
                    }`}
                  >
                    <span className="font-semibold">{d.date}</span>
                    <span className="text-gray-400 ml-1">vs {d.opponent}</span>
                    <span className="ml-1">{d.h}/{d.ab}</span>
                    {d.hr > 0 && <span className="ml-1 text-yellow-400">{d.hr}HR</span>}
                  </button>
                );
              })}
              {filterHR && availableDates.filter(d => d.hr > 0).length === 0 && (
                <p className="text-gray-600 text-xs italic">No home run games found</p>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
