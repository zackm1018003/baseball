'use client';

import React, { use, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getPlayerById, getPlayerByName } from '@/lib/database';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getMLBTeamLogoUrl, getParentOrgAbbr, getMLBTeamColor } from '@/lib/mlb-team-logos';
import { getCollegeLogoUrl } from '@/lib/college-logos';
import { getCountryFlagUrl } from '@/lib/country-flags';
import { MiniPercentileBar } from '@/components/MiniPercentileBar';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DailyPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string; gamePk?: string }>;
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
  atBatNum?: number;
  pitchNum?: number;
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
  batSpeed: number | null;
  exitVelo: number | null;
  launchAngle: number | null;
  hitDistance: number | null;
  hcX: number | null;
  hcY: number | null;
  isBarrel: boolean;
}

interface AtBat {
  atBatNum: number;
  pitcherName: string;
  pitcherHand: string;
  result: string;
  pitches: AtBatPitch[];
}

interface HitterHitDot {
  hcX: number;
  hcY: number;
  hitDistance: number | null;
  result: string;
  pitchType: string;
  exitVelo: number | null;
  isBarrel: boolean;
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
  sportId?: number;
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
    // snake_case
    single: '1B', double: '2B', triple: '3B', home_run: 'HR',
    strikeout: 'K', strikeout_double_play: 'KDP',
    walk: 'BB', intent_walk: 'IBB',
    hit_by_pitch: 'HBP',
    field_out: 'Out', force_out: 'FC Out',
    fielders_choice: 'FC', fielders_choice_out: 'FC Out',
    grounded_into_double_play: 'GIDP',
    double_play: 'DP', triple_play: 'TP',
    sac_fly: 'SF', sac_fly_double_play: 'SF-DP',
    sac_bunt: 'SH', sac_bunt_double_play: 'SH-DP',
    catcher_interf: 'CI', other_out: 'Out',
    // camelCase
    homeRun: 'HR', strikeOut: 'K', strikeout_Double_Play: 'KDP',
    intentionalWalk: 'IBB', hitByPitch: 'HBP',
    fieldOut: 'Out', forceOut: 'FC Out',
    fieldersChoice: 'FC', fieldersChoiceOut: 'FC Out',
    groundedIntoDoublePlay: 'GIDP',
    doublePlay: 'DP', triplePlay: 'TP',
    sacFly: 'SF', sacFlyDoublePlay: 'SF-DP',
    sacBunt: 'SH', sacBuntDoublePlay: 'SH-DP',
    catcherInterference: 'CI', otherOut: 'Out',
    // Human-readable (MLB live feed event names)
    'Home Run': 'HR', 'Single': '1B', 'Double': '2B', 'Triple': '3B',
    'Strikeout': 'K', 'Strikeout Double Play': 'KDP',
    'Walk': 'BB', 'Intentional Walk': 'IBB',
    'Hit By Pitch': 'HBP',
    'Field Out': 'Out', 'Force Out': 'FC Out',
    'Fielders Choice': 'FC', 'Fielders Choice Out': 'FC Out',
    'Grounded Into Double Play': 'GIDP',
    'Double Play': 'DP', 'Triple Play': 'TP',
    'Sac Fly': 'SF', 'Sac Fly Double Play': 'SF-DP',
    'Sac Bunt': 'SH', 'Sac Bunt Double Play': 'SH-DP',
    'Catcher Interference': 'CI', 'Other Out': 'Out',
  };
  return map[events] || events.replace(/_/g, ' ');
}

function resultColor(events: string): string {
  if (['single','double','triple','home_run','homeRun',
       'Home Run','Single','Double','Triple'].includes(events))
    return 'bg-green-700 text-green-200';
  if (['strikeout','strikeOut','strikeout_double_play','field_out','fieldOut',
       'force_out','forceOut','grounded_into_double_play','groundedIntoDoublePlay',
       'double_play','doublePlay','triple_play','sac_fly','sacFly',
       'sac_fly_double_play','sac_bunt','sac_bunt_double_play',
       'other_out','otherOut','fielders_choice','fieldersChoice',
       'fielders_choice_out','fieldersChoiceOut',
       'Strikeout','Strikeout Double Play','Field Out','Force Out',
       'Grounded Into Double Play','Double Play','Triple Play',
       'Sac Fly','Sac Fly Double Play','Sac Bunt','Sac Bunt Double Play',
       'Other Out','Fielders Choice','Fielders Choice Out'].includes(events))
    return 'bg-red-900 text-red-300';
  if (['walk','intent_walk','intentionalWalk','hit_by_pitch','hitByPitch',
       'Walk','Intentional Walk','Hit By Pitch'].includes(events))
    return 'bg-walk text-outcome-fg';
  return 'bg-bone text-ink-2';
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

function HitterZoneChart({ rawDots, heightIn, hoveredPitch, onHover, light }: {
  rawDots: HitterRawDot[];
  heightIn?: number;
  hoveredPitch?: { atBatNum: number; pitchNum: number } | null;
  onHover?: (pitch: { atBatNum: number; pitchNum: number } | null) => void;
  light?: boolean;
}) {
  const size = 300;
  const xMin = -1.8, xMax = 1.8;
  const zMin = 0.5,  zMax = 4.5;
  const pad = 28;
  const w = size - pad * 2;
  const h = size - pad * 2;

  const toSvgX = (px: number) => pad + ((px - xMin) / (xMax - xMin)) * w;
  const toSvgY = (pz: number) => pad + ((zMax - pz) / (zMax - zMin)) * h;

  // ABS zone: top=53.5% of height, bottom=27% of height (in feet)
  const ht = heightIn ?? 72; // default 6'0"
  const absTop = (ht * 0.535) / 12;
  const absBot = (ht * 0.27)  / 12;

  const szLeft  = toSvgX(-0.708);
  const szRight = toSvgX(0.708);
  const szTop   = toSvgY(absTop);
  const szBot   = toSvgY(absBot);

  const thirdW = (szRight - szLeft) / 3;
  const thirdH = (szBot - szTop) / 3;

  if (rawDots.length === 0) {
    return (
      <div style={{ width: size, height: size }}
        className="bg-bone flex items-center justify-center">
        <p className="text-ink-4 text-xs text-center px-6">No Statcast data</p>
      </div>
    );
  }

  return (
    <svg width={size} height={size} style={{ background: '#f5f3ef' }}>
      <defs>
        <linearGradient id="fireGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff2200" />
          <stop offset="50%" stopColor="#ff8800" />
          <stop offset="100%" stopColor="#ffdd00" />
        </linearGradient>
      </defs>
      {/* Title */}
      <text x={size / 2} y={18} textAnchor="middle" fontSize="10" fontWeight="600" fill="#111827">
        Pitches Seen
      </text>


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
        const col = pitchColors(dot.pitchType).color;
        const isHovered = hoveredPitch && dot.atBatNum !== undefined && dot.pitchNum !== undefined
          && dot.atBatNum === hoveredPitch.atBatNum && dot.pitchNum === hoveredPitch.pitchNum;
        const hoverHandlers = dot.atBatNum !== undefined && dot.pitchNum !== undefined && onHover ? {
          onMouseEnter: () => onHover({ atBatNum: dot.atBatNum!, pitchNum: dot.pitchNum! }),
          onMouseLeave: () => onHover(null),
        } : {};

        let visual: React.ReactNode;
        if (dot.isWhiff) {
          const s = isHovered ? 6 : 4;
          visual = (
            <>
              <line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke="#000" strokeWidth={isHovered ? 5 : 4} opacity="0.9" />
              <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke="#000" strokeWidth={isHovered ? 5 : 4} opacity="0.9" />
              <line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke={col} strokeWidth={isHovered ? 3.5 : 2.5} opacity="0.95" />
              <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke={col} strokeWidth={isHovered ? 3.5 : 2.5} opacity="0.95" />
            </>
          );
        } else if (dot.isBarrel) {
          visual = (
            <>
              {isHovered && <circle cx={cx} cy={cy} r="11" fill="white" opacity="0.35" />}
              <text x={cx} y={cy+5} textAnchor="middle" fontSize={isHovered ? 14 : 12} fontWeight="bold"
                fill="#000" stroke="#000" strokeWidth="4" strokeLinejoin="round" opacity="0.9">B</text>
              <text x={cx} y={cy+5} textAnchor="middle" fontSize={isHovered ? 14 : 12} fontWeight="bold"
                fill="url(#fireGrad)" opacity="0.95">B</text>
            </>
          );
        } else if (dot.isSwing && !dot.isWhiff && dot.exitVelo !== null && dot.exitVelo >= 95) {
          visual = (
            <>
              {isHovered && <circle cx={cx} cy={cy} r="11" fill="white" opacity="0.35" />}
              <text x={cx} y={cy + 5} textAnchor="middle" fontSize={isHovered ? 14 : 12} opacity="0.95">🔥</text>
            </>
          );
        } else if (dot.isTake) {
          visual = <circle cx={cx} cy={cy} r={isHovered ? 5 : 3.5} fill={isHovered ? col : 'none'}
            stroke={col} strokeWidth="1.5" opacity={isHovered ? 0.95 : 0.75} />;
        } else {
          visual = <circle cx={cx} cy={cy} r={isHovered ? 5 : 3.5} fill={col}
            stroke={isHovered ? '#fff' : '#000'} strokeWidth={isHovered ? 1.5 : 0.6} opacity="0.8" />;
        }

        return (
          <g key={i} style={{ cursor: onHover ? 'pointer' : undefined }} {...hoverHandlers}>
            {visual}
            {/* Invisible larger hit target for easy hovering */}
            <circle cx={cx} cy={cy} r="9" fill="transparent" />
          </g>
        );
      })}

      {/* Legend */}
      {(() => { const lx = (size - 188) / 2; return (<>
      <circle cx={lx + 4} cy={size - 10} r="3" fill="#555" opacity="0.8" />
      <text x={lx + 10} y={size - 7} fontSize="7.5" fill="#000">swing</text>
      <circle cx={lx + 42} cy={size - 10} r="3" fill="none" stroke="#555" strokeWidth="1.5" />
      <text x={lx + 48} y={size - 7} fontSize="7.5" fill="#000">take</text>
      <line x1={lx + 75} y1={size - 14} x2={lx + 81} y2={size - 7} stroke="#555" strokeWidth="1.5" />
      <line x1={lx + 81} y1={size - 14} x2={lx + 75} y2={size - 7} stroke="#555" strokeWidth="1.5" />
      <text x={lx + 85} y={size - 7} fontSize="7.5" fill="#000">whiff</text>
      <text x={lx + 114} y={size - 7} fontSize="7.5" fontWeight="bold" fill="url(#fireGrad)" stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
      <text x={lx + 122} y={size - 7} fontSize="7.5" fill="#000">barrel</text>
      <text x={lx + 152} y={size - 7} fontSize="7.5">🔥</text>
      <text x={lx + 160} y={size - 7} fontSize="7.5" fill="#000">95+ev</text>
      </>); })()}
    </svg>
  );
}

// ─── Spray Chart ─────────────────────────────────────────────────────────────

function SprayChart({ hitDots, batSide, playerImageUrl }: { hitDots: HitterHitDot[]; batSide?: string; playerImageUrl?: string }) {
  // 300×300 output matching the zone chart size
  // viewBox covers the full field (x: 80–420, y: 150–490) plus legend space
  const HOME_X = 250, HOME_Y = 450, SCALE = 1.65;

  // 330ft foul corner at SVG (402,298) → dist=214.9 units → 1ft = 214.9/330 = 0.6512 SVG units
  const FT_TO_SVG = 0.6512;

  const toSvg = (hcX: number, hcY: number, hitDist?: number | null) => {
    const dx = hcX - 125, dy = 208 - hcY;
    const r = Math.sqrt(dx*dx + dy*dy);
    if (hitDist && hitDist > 0 && r > 0) {
      // Use hitDistance for magnitude, hcX/hcY for direction
      const svgDist = hitDist * FT_TO_SVG;
      return { x: HOME_X + (dx/r) * svgDist, y: HOME_Y - (dy/r) * svgDist };
    }
    return { x: HOME_X + dx * SCALE, y: HOME_Y + (hcY - 208) * SCALE };
  };

  // Foul line corners (where foul lines meet the wall)
  const RF_CORNER = { x: 402, y: 298 };
  const LF_CORNER = { x: 98,  y: 298 };
  // 375ft top corners (215/330 * 375 = 244.3 SVG units at ~22° from CF)
  const RF_TOP = { x: 342, y: 220 };
  const LF_TOP = { x: 158, y: 220 };

  // Clip guide lines to the 4-segment trapezoid wall
  function fenceIntersect(L: number): {x: number, y: number} {
    const deg = (315 - L * 0.5) * Math.PI / 180;
    const rdx = Math.cos(deg), rdy = Math.sin(deg);
    let bestT = 999, best = { x: 250 + rdx*220, y: 450 + rdy*220 };

    const segs = [
      [RF_CORNER, RF_TOP],                     // right slanted wall
      [RF_TOP,    LF_TOP],                     // flat top wall
      [LF_TOP,    LF_CORNER],                  // left slanted wall
    ] as [typeof RF_CORNER, typeof RF_CORNER][];

    for (const [p, q] of segs) {
      const sx = q.x - p.x, sy = q.y - p.y;
      const denom = rdx * sy - rdy * sx;
      if (Math.abs(denom) < 1e-6) continue;
      const t = ((p.x - 250) * sy - (p.y - 450) * sx) / denom;
      const u = ((p.x - 250) * rdy - (p.y - 450) * rdx) / denom;
      if (t > 0 && u >= 0 && u <= 1 && t < bestT) { bestT = t; best = { x: 250 + rdx*t, y: 450 + rdy*t }; }
    }
    return best;
  }

  return (
    <svg width={300} height={300} viewBox="70 120 370 370" style={{ background: '#f5f3ef' }}>
      <text x={250} y={164} textAnchor="middle" fontSize="11" fontWeight="600" fill="#111827">Spray Angle Chart</text>

      {/* Fair territory fill — trapezoid shape */}
      <polygon
        points={`250,450 ${RF_CORNER.x},${RF_CORNER.y} ${RF_TOP.x},${RF_TOP.y} 250,186 ${LF_TOP.x},${LF_TOP.y} ${LF_CORNER.x},${LF_CORNER.y}`}
        fill="#f5f5f5"/>

      {/* Foul lines */}
      <line x1="250" y1="450" x2={RF_CORNER.x} y2={RF_CORNER.y} stroke="#000" strokeWidth="1.5"/>
      <line x1="250" y1="450" x2={LF_CORNER.x} y2={LF_CORNER.y} stroke="#000" strokeWidth="1.5"/>

      {/* Wall distance labels */}
      <text x={RF_CORNER.x - 28} y={RF_CORNER.y - 8} fontSize="9" fill="#000" textAnchor="middle">330ft</text>
      <text x={250} y={181} fontSize="9" fill="#000" textAnchor="middle">400ft</text>
      <text x={LF_CORNER.x + 28} y={LF_CORNER.y - 8} fontSize="9" fill="#000" textAnchor="middle">330ft</text>

      {/* Center field 400ft marker */}
      <circle cx={250} cy={186} r="3" fill="#000"/>

      {/* Corner 375ft markers */}
      <text x={RF_TOP.x + 2} y={RF_TOP.y - 6} fontSize="9" fill="#000" textAnchor="middle">375ft</text>
      <text x={LF_TOP.x - 2} y={LF_TOP.y - 6} fontSize="9" fill="#000" textAnchor="middle">375ft</text>

      {/* Outfield wall — bezier rounded corners for RF_TOP(342,220)/LF_TOP(158,220) */}
      <path
        d={`M ${RF_CORNER.x} ${RF_CORNER.y}
            L 354.6 235.5 Q ${RF_TOP.x} ${RF_TOP.y} 323.2 213.1
            L 250 186
            L 176.8 213.1 Q ${LF_TOP.x} ${LF_TOP.y} 145.4 235.5
            L ${LF_CORNER.x} ${LF_CORNER.y}`}
        fill="none" stroke="#000" strokeWidth="3.5" strokeLinecap="round"/>

      {/* Protractor arc */}
      <path d="M 341.9 358.1 A 130 130 0 0 0 158.1 358.1" fill="none" stroke="#000" strokeWidth="1"/>

      {/* Minor ticks */}
      {([{o:[337.8,354.2],i:[331.8,360.5]},{o:[329.1,346.9],i:[323.7,353.8]},{o:[319.8,340.4],i:[315.0,347.8]},{o:[310.0,334.7],i:[305.9,342.3]},{o:[299.8,329.9],i:[296.2,338.8]},{o:[289.1,326.0],i:[286.4,334.6]},{o:[278.1,323.1],i:[276.2,331.8]},{o:[267.0,321.1],i:[265.8,329.9]},{o:[255.7,320.1],i:[255.3,329.1]},{o:[244.3,320.1],i:[244.7,329.1]},{o:[233.0,321.1],i:[234.2,329.9]},{o:[221.9,323.1],i:[223.8,331.8]},{o:[210.9,326.0],i:[213.6,334.6]},{o:[200.2,329.9],i:[203.8,338.8]},{o:[190.0,334.7],i:[194.1,343.3]},{o:[180.2,340.4],i:[185.0,348.0]},{o:[170.9,346.9],i:[176.3,353.8]},{o:[162.2,354.2],i:[168.2,360.5]}] as {o:number[],i:number[]}[]).map(({o,i},idx) => (
        <line key={idx} x1={o[0]} y1={o[1]} x2={i[0]} y2={i[1]} stroke="#000" strokeWidth="0.7"/>
      ))}

      {/* Major ticks + labels */}
      {([
        {L:0,  ox:341.9,oy:358.1,ix:329.9,iy:370.0,lx:354.6,ly:349.1},
        {L:10, ox:333.6,oy:350.4,ix:322.6,iy:363.5,lx:344.9,ly:340.1},
        {L:20, ox:324.6,oy:343.5,ix:314.8,iy:357.4,lx:334.6,ly:332.7},
        {L:30, ox:315.0,oy:337.4,ix:306.6,iy:352.1,lx:323.5,ly:325.3},
        {L:40, ox:304.9,oy:332.2,ix:297.8,iy:347.8,lx:312.4,ly:319.5},
        {L:50, ox:294.5,oy:327.8,ix:288.6,iy:343.8,lx:300.5,ly:314.9},
        {L:60, ox:283.6,oy:324.5,ix:279.2,iy:341.2,lx:288.3,ly:311.2},
        {L:70, ox:272.6,oy:322.0,ix:269.6,iy:338.8,lx:275.7,ly:308.7},
        {L:80, ox:261.3,oy:320.5,ix:259.9,iy:337.5,lx:262.9,ly:307.2},
        {L:90, ox:250.0,oy:320.0,ix:250.0,iy:337.0,lx:250.0,ly:306.5},
        {L:100,ox:238.7,oy:320.5,ix:240.1,iy:337.5,lx:237.1,ly:307.2},
        {L:110,ox:227.4,oy:322.0,ix:230.4,iy:338.8,lx:224.3,ly:308.7},
        {L:120,ox:216.4,oy:324.5,ix:220.8,iy:341.2,lx:211.7,ly:311.2},
        {L:130,ox:205.5,oy:327.8,ix:211.4,iy:343.8,lx:199.5,ly:314.9},
        {L:140,ox:195.1,oy:332.2,ix:202.2,iy:347.8,lx:187.6,ly:319.5},
        {L:150,ox:185.0,oy:337.4,ix:193.4,iy:352.1,lx:176.5,ly:325.3},
        {L:160,ox:175.4,oy:343.5,ix:185.2,iy:357.4,lx:165.4,ly:332.7},
        {L:170,ox:166.4,oy:350.4,ix:177.4,iy:363.5,lx:155.1,ly:340.1},
        {L:180,ox:158.1,oy:358.1,ix:170.1,iy:370.0,lx:145.4,ly:349.1},
      ] as {L:number,ox:number,oy:number,ix:number,iy:number,lx:number,ly:number}[]).map(({L,ox,oy,ix,iy,lx,ly}) => (
        <g key={L}>
          <line x1={ox} y1={oy} x2={ix} y2={iy} stroke="#000" strokeWidth={L===90?1.4:1}/>
          <text x={lx} y={ly} fontSize={L===90?9:8} fontWeight={L===90?'bold':undefined}
            textAnchor="middle" fill="#000">{90 - L}</text>
        </g>
      ))}

      {/* Diamond */}
      <polygon points="250,450 291,409 250,367 209,409" fill="none" stroke="#000" strokeWidth="1.5"/>
      {/* Pitcher's mound */}
      <circle cx="250" cy="411" r="12" fill="none" stroke="#000" strokeWidth="1"/>
      <rect x="246" y="408.5" width="8" height="3" rx="0.5" fill="#333"/>
      {/* Bases */}
      <rect x="287" y="405" width="8" height="8" fill="#333"/>
      <g transform="rotate(45,250,367)"><rect x="246" y="363" width="8" height="8" fill="#333"/></g>
      <rect x="205" y="405" width="8" height="8" fill="#333"/>
      {/* Home plate */}
      <path d="M 243 453 L 257 453 L 257 447 L 250 442 L 243 447 Z" fill="#333"/>
      {/* Dugouts / batter's boxes */}
      <rect x="308" y="432" width="28" height="12" rx="2" fill="#eee" stroke="#000" strokeWidth="0.8"/>
      <rect x="164" y="432" width="28" height="12" rx="2" fill="#eee" stroke="#000" strokeWidth="0.8"/>
      {/* Player image above batter's box — RHB=left, LHB=right, S=both */}
      {playerImageUrl && (batSide === 'R' || batSide === 'S') && (
        <image href={playerImageUrl} x="164" y="402" width="28" height="28" preserveAspectRatio="xMidYMid meet" clipPath="url(#batBoxClipL)" crossOrigin="anonymous"/>
      )}
      {playerImageUrl && (batSide === 'L' || batSide === 'S') && (
        <image href={playerImageUrl} x="308" y="402" width="28" height="28" preserveAspectRatio="xMidYMid meet" clipPath="url(#batBoxClipR)" crossOrigin="anonymous"/>
      )}

      {/* ── Hit dots ── */}
      <defs>
        <linearGradient id="scFire" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff2200"/>
          <stop offset="50%" stopColor="#ff8800"/>
          <stop offset="100%" stopColor="#ffdd00"/>
        </linearGradient>
      </defs>

      {hitDots.map((dot, i) => {
        const { x, y } = toSvg(dot.hcX, dot.hcY, dot.hitDistance);
        const col = pitchColors(dot.pitchType).color;
        const isHit = ['single','double','triple','home_run'].includes(
          dot.result.toLowerCase().replace(/\s/g,'_')
        );
        const isOut = !isHit;
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={8}
              fill={isOut ? 'none' : col} fillOpacity={isOut ? 0 : 0.88}
              stroke={col} strokeWidth={isOut ? 2 : 1.2}/>
            {dot.isBarrel ? (
              <text x={x} y={y+4} textAnchor="middle" fontSize="9" fontWeight="bold"
                fill="url(#scFire)" stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
            ) : dot.exitVelo !== null && dot.exitVelo >= 95 ? (
              <text x={x} y={y+4} textAnchor="middle" fontSize="9"
                fill={isOut ? col : '#fff'} fontWeight="bold">🔥</text>
            ) : null}
          </g>
        );
      })}

      {hitDots.length === 0 && (
        <text x={250} y={390} textAnchor="middle" fontSize="12" fill="#bbb">No balls in play</text>
      )}

      {/* Legend — matches zone chart style, centered at x=250 */}
      {(() => {
        const ly = 474;
        const lx = 250 - 107;
        return (
          <>
            <circle cx={lx + 5}  cy={ly - 4} r="4" fill="#888" opacity="0.88"/>
            <text x={lx + 13} y={ly} fontSize="10.5" fill="#000">hit</text>
            <circle cx={lx + 48} cy={ly - 4} r="4" fill="none" stroke="#888" strokeWidth="2"/>
            <text x={lx + 56} y={ly} fontSize="10.5" fill="#000">out</text>
            <text x={lx + 95}  y={ly} fontSize="10.5" fontWeight="bold"
              fill="url(#scFire)" stroke="#000" strokeWidth="2.5" strokeLinejoin="round" paintOrder="stroke">B</text>
            <text x={lx + 106} y={ly} fontSize="10.5" fill="#000">barrel</text>
            <text x={lx + 163} y={ly} fontSize="10.5">🔥</text>
            <text x={lx + 175} y={ly} fontSize="10.5" fill="#000">95+ev</text>
          </>
        );
      })()}
    </svg>
  );
}

// ─── At-bat breakdown panel ───────────────────────────────────────────────────

function AtBatPanel({ atBats, loading, hoveredPitch, light, cols = 4 }: { atBats: AtBat[]; loading: boolean; hoveredPitch?: { atBatNum: number; pitchNum: number } | null; light?: boolean; cols?: number }) {
  const slots = (!loading && atBats && atBats.length > 0) ? atBats : [];
  const padded: (AtBat | null)[] = [...slots, ...Array(Math.max(0, cols - slots.length)).fill(null)];
  const abStyle = light ? { background: '#f8f8f8', border: '1px solid #d4d4d4', borderLeft: '3px solid #ff2d2d', borderRadius: 4 } : {};

  // Exact flex-basis so n items + (n-1) gaps of 8px fill 100% with no overflow.
  // subtract = (cols-1)/cols * 8px  →  cols=4: 6px, cols=5: 6.4px, cols=3: 5.33px
  const subtractPx = ((cols - 1) / cols) * 8;
  const cardStyle: React.CSSProperties = { flex: `0 0 calc(${100 / cols}% - ${subtractPx}px)`, minWidth: 0 };

  if (loading) {
    return (
      <>
        {[0,1,2,3].map(i => (
          <div key={i} className={light ? '' : 'bg-[#171b24]'} style={{ ...cardStyle, minHeight: 80, ...(light ? { background: '#e8e8e8' } : {}), opacity: 0.3 }} />
        ))}
      </>
    );
  }

  if (!atBats || atBats.length === 0) {
    return (
      <>
        {[0,1,2,3].map(i => (
          <div key={i} className={`flex items-center justify-center ${light ? '' : 'bg-[#171b24]'}`} style={{ ...cardStyle, minHeight: 80, ...(light ? { background: '#e8e8e8' } : {}), opacity: 0.2 }}>
            {i === 1 && <p className="text-[9px] text-center px-2" style={{ color: light ? '#555555' : 'var(--color-ink-5)' }}>No at-bat data</p>}
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {padded.map((ab, idx) => ab ? (
        <div key={ab.atBatNum} className={`px-2 py-2 ${light ? '' : 'bg-[#171b24]'}`} style={{ ...cardStyle, ...abStyle }}>
          {/* Header */}
          <div className="flex items-center gap-1 mb-1.5 flex-nowrap min-w-0">
            <span className="text-[11px] font-bold flex-shrink-0" style={{ color: light ? '#000000' : 'var(--color-ink-5)' }}>AB {ab.atBatNum}</span>
            {ab.result && (
              <span className={`text-[11px] font-bold px-1 py-0 leading-5 whitespace-nowrap flex-shrink-0 ${resultColor(ab.result)}`}
                style={resultColor(ab.result) !== 'bg-bone text-ink-2' ? { textShadow: '-1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000' } : {}}>
                {cleanResult(ab.result)}
              </span>
            )}
            <span className="text-[11px] truncate min-w-0" style={{ color: light ? '#555555' : 'var(--color-deep-fg-3)' }}>{ab.pitcherName}{ab.pitcherHand ? ` · ${ab.pitcherHand}HP` : ''}</span>
          </div>

          {/* Pitch rows */}
          <div className="flex flex-col" style={{ gap: 5 }}>
            {ab.pitches.map((p, i) => {
              const col = PITCH_COLORS[p.pitchType];
              const abbrev = PITCH_ABBREV[p.pitchType] || p.pitchType.slice(0, 2).toUpperCase();
              const isHighlighted = hoveredPitch && ab.atBatNum === hoveredPitch.atBatNum && p.pitchNum === hoveredPitch.pitchNum;
              return (
                <div key={i} className={`flex flex-col px-0.5 transition-colors ${isHighlighted ? 'bg-deep-fg/10 ring-1 ring-deep-fg/30' : ''}`}>
                  <div className="grid items-center" style={{ gridTemplateColumns: '30px 40px 20px 1fr', lineHeight: '16px', columnGap: 3 }}>
                  {/* Type badge */}
                  <span
                    className="rounded px-1 font-bold text-center"
                    style={{ backgroundColor: col?.bg || '#555', color: col?.text || '#fff', fontSize: 12, lineHeight: '16px' }}
                  >
                    {abbrev}
                  </span>

                  {/* Velo — always occupies the column; empty if missing */}
                  <span className="font-semibold text-right" style={{ fontSize: 13, color: light ? '#000000' : 'var(--color-deep-fg)' }}>
                    {p.velo !== null ? p.velo.toFixed(1) : ''}
                  </span>

                  {/* Pitch result icon — centered in fixed-width column */}
                  <div className="flex justify-center items-center">
                    {(() => {
                      const d = p.description.toLowerCase();
                      const isWhiff = d.includes('swinging_strike') || d.includes('swinging strike') || d.includes('foul_tip') || d === 'foul tip';
                      const isInPlay = d.includes('hit_into_play') || d.includes('in play');
                      const isTake = !isWhiff && !isInPlay && !d.includes('foul');
                      const isBarrel = isInPlay && p.isBarrel;
                      const is95ev = isInPlay && !isBarrel && p.exitVelo !== null && p.exitVelo >= 95;
                      const pitchCol = col?.color || '#888';
                      if (isBarrel) return (
                        <svg width="16" height="16" style={{ overflow: 'visible' }}>
                          <defs><linearGradient id="abFire" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff2200"/><stop offset="50%" stopColor="#ff8800"/><stop offset="100%" stopColor="#ffdd00"/></linearGradient></defs>
                          <text x="8" y="13" textAnchor="middle" fontSize="14" fontWeight="bold" fill="url(#abFire)" stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
                        </svg>
                      );
                      if (is95ev) return <span style={{ fontSize: 14, lineHeight: '16px' }}>🔥</span>;
                      if (isWhiff) return (
                        <svg width="16" height="16">
                          <line x1="2" y1="2" x2="14" y2="14" stroke="#000" strokeWidth="3"/><line x1="14" y1="2" x2="2" y2="14" stroke="#000" strokeWidth="3"/>
                          <line x1="2" y1="2" x2="14" y2="14" stroke={pitchCol} strokeWidth="2"/><line x1="14" y1="2" x2="2" y2="14" stroke={pitchCol} strokeWidth="2"/>
                        </svg>
                      );
                      if (isTake) return (
                        <svg width="16" height="16">
                          <circle cx="8" cy="8" r="6" fill="none" stroke={pitchCol} strokeWidth="2"/>
                        </svg>
                      );
                      return (
                        <svg width="16" height="16">
                          <circle cx="8" cy="8" r="6" fill={pitchCol} stroke="#000" strokeWidth="0.6"/>
                        </svg>
                      );
                    })()}
                  </div>

                  {/* Description */}
                  <span className="truncate" style={{ fontSize: 12, color: light ? '#000000' : 'var(--color-ink-2)' }}>{cleanDesc(p.description)}</span>
                  </div>
                {/* Stats line */}
                {(p.batSpeed !== null || p.exitVelo !== null || p.hitDistance !== null) && (
                  <div className="pl-1 mt-1 flex gap-2" style={{ position: 'relative', flexWrap: 'wrap', whiteSpace: 'nowrap' }}>
                    {p.batSpeed !== null && p.batSpeed >= 75 && (
                      <span style={{ position: 'absolute', left: -8, top: 0, fontSize: 11, lineHeight: '16px', pointerEvents: 'none' }}>⚡</span>
                    )}
                    {p.batSpeed !== null && p.batSpeed >= 40 && <span className="text-yellow-400 font-semibold" style={{ fontSize: 13, textShadow: '-1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000' }}>{p.batSpeed.toFixed(1)} <span style={{ color: light ? '#000000' : 'var(--color-ink-5)', fontWeight: 400, textShadow: 'none' }}>bs</span></span>}
                    {p.exitVelo !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 13, textShadow: '-1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000' }}>{p.exitVelo.toFixed(1)} <span style={{ color: light ? '#000000' : 'var(--color-ink-5)', fontWeight: 400, textShadow: 'none' }}>ev</span></span>}
                    {p.launchAngle !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 13, textShadow: '-1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000' }}>{p.launchAngle.toFixed(0)}° <span style={{ color: light ? '#000000' : 'var(--color-ink-5)', fontWeight: 400, textShadow: 'none' }}>la</span></span>}
                    {p.launchAngle !== null && p.hcX !== null && p.hcY !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 13, textShadow: '-1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000' }}>{Math.round(Math.atan2(p.hcX - 125, 208 - p.hcY) * (360 / Math.PI))}° <span style={{ color: light ? '#000000' : 'var(--color-ink-5)', fontWeight: 400, textShadow: 'none' }}>sa</span></span>}
                    {p.hitDistance !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 13, textShadow: '-1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000' }}>{p.hitDistance} <span style={{ color: light ? '#000000' : 'var(--color-ink-5)', fontWeight: 400, textShadow: 'none' }}>ft</span></span>}
                  </div>
                )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div key={`empty-${idx}`} className={light ? '' : 'bg-[#171b24]'} style={{ ...cardStyle, minHeight: 80, ...(light ? { background: '#e8e8e8' } : {}), opacity: 0.2 }} />
      ))}
    </>
  );
}


// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HitterDailyPage({ params, searchParams }: DailyPageProps) {
  const { id } = use(params);
  const { date: initialDate, gamePk: initialGamePk } = use(searchParams);

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
  const [hoveredPitch, setHoveredPitch] = useState<{ atBatNum: number; pitchNum: number } | null>(null);
  const [seasonStats, setSeasonStats] = useState<{
    avg?: string; obp?: string; slg?: string; ops?: string;
    hr?: number; rbi?: number; bb?: number; k?: number;
    g?: number; pa?: number; sb?: number; hits?: number; ab?: number;
    doubles?: number; triples?: number;
    avgBatSpeed?: number | null; fastSwingPct?: number | null;
    avgEv?: number | null; maxEv?: number | null; ev90?: number | null;
    barrels?: number | null; barrelPct?: number | null;
    savantBipCount?: number; // how many BIPs Savant returned (coverage proxy)
    evs?: number[] | null;
    vsLHP?: { avg?: string; obp?: string; slg?: string; ops?: string; hr?: number; rbi?: number; pa?: number; barrelPct?: number | null; contactPct?: number | null; xwoba?: number | null; bip?: number; swings?: number } | null;
    vsRHP?: { avg?: string; obp?: string; slg?: string; ops?: string; hr?: number; rbi?: number; pa?: number; barrelPct?: number | null; contactPct?: number | null; xwoba?: number | null; bip?: number; swings?: number } | null;
  } | null>(null);
  const [milbEvStats, setMilbEvStats] = useState<{
    avgEv: number | null; maxEv: number | null; ev90: number | null;
    barrels: number | null; barrelPct: number | null;
    bipCount: number; // how many BIPs the game-log aggregation found
    evs?: number[] | null;
  } | null>(null);
  const [playerBio, setPlayerBio]     = useState<{
    height?: string; weight?: number; birthDate?: string;
    pitchHand?: string; batSide?: string;
  } | null>(null);
  const [seasonDiscipline, setSeasonDiscipline] = useState<{
    whiffPct: number | null; chasePct: number | null; zSwingPct: number | null;
    zContactPct: number | null; ozContactPct: number | null; swingPct: number | null;
    avgLaHard: number | null; xwoba: number | null;
  } | null>(null);

  // gamePk from URL — pins the doubleheader game so the card shows the right game
  const [pinnedGamePk] = useState<string | null>(initialGamePk ?? null);

  // Card capture
  const cardRef = useRef<HTMLDivElement>(null);
  const [capturing, setCapturing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [screenshotMode, setScreenshotMode] = useState(false);

  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (screenshotMode) {
      document.documentElement.classList.add('screenshot-mode');
      if (meta) meta.setAttribute('content', 'width=960, initial-scale=1');
    } else {
      document.documentElement.classList.remove('screenshot-mode');
      if (meta) meta.setAttribute('content', 'width=1200, initial-scale=1');
    }
    return () => {
      document.documentElement.classList.remove('screenshot-mode');
      if (meta) meta.setAttribute('content', 'width=1200, initial-scale=1');
    };
  }, [screenshotMode]);

  const captureCard = async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    const { toPng } = await import('html-to-image');
    const node = cardRef.current;
    const opts = {
      pixelRatio: 2,
      cacheBust: false,
      filter: (n: HTMLElement) => !n.classList?.contains('export-ignore'),
    };
    const withTimeout = (p: Promise<string>) =>
      Promise.race([p, new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 10000))]);
    // iOS Safari: first pass loads external images into the canvas cache; second pass renders correctly.
    try { await withTimeout(toPng(node, opts)); } catch { /* ignore first-pass errors */ }
    return withTimeout(toPng(node, opts));
  };

  const handleDownload = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const dataUrl = await captureCard();
      if (!dataUrl) return;
      const name = (player?.full_name ?? data?.playerName ?? 'card').replace(/\s+/g, '-');
      const a = document.createElement('a');
      a.download = `${name}-${selectedDate}.png`;
      a.href = dataUrl;
      a.click();
    } catch (e) { console.error('capture failed', e); }
    finally { setCapturing(false); }
  };

  const handleCopy = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const dataUrl = await captureCard();
      if (!dataUrl) return;
      const blob = await fetch(dataUrl).then(r => r.blob());

      // Desktop: clipboard API
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          return;
        } catch { /* fall through */ }
      }

      // Mobile: show overlay so user can long-press to save
      setPreviewUrl(dataUrl);
    } catch (e) { console.error('copy failed', e); }
    finally { setCapturing(false); }
  };

  const fetchData = useCallback(async (date?: string, silent = false) => {
    if (!playerId) return;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const gpParam = pinnedGamePk ? `&gamePk=${pinnedGamePk}` : '';
      const res = await fetch(`/api/hitter-daily?playerId=${playerId}&date=${date ?? today()}${gpParam}`, { cache: 'no-store' });
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

  // Fetch season stats filtered to the league the game is being played in.
  // Wait for gameInfo.sportId so we show the right level (e.g. FCL stats for FCL rehab game).
  const gameSportId = data?.gameInfo?.sportId;
  useEffect(() => {
    if (!playerId) return;
    if (data !== null && gameSportId == null) return; // data loaded but no sportId — nothing to show
    const year = selectedDate.slice(0, 4) || String(new Date().getFullYear());
    const url = gameSportId
      ? `/api/season-stats?playerId=${playerId}&year=${year}&sportId=${gameSportId}`
      : `/api/season-stats?playerId=${playerId}&year=${year}`;
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (d.avg == null && d.hr == null && d.g == null) return; // empty response
        setSeasonStats(prev => ({
          ...(prev ?? {}),
          avg: d.avg, obp: d.obp, slg: d.slg, ops: d.ops,
          hr: d.hr, rbi: d.rbi, bb: d.bb, k: d.k,
          g: d.g, pa: d.pa, sb: d.sb,
          hits: d.hits, ab: d.ab, doubles: d.doubles, triples: d.triples,
          vsLHP: d.vsLHP ?? null, vsRHP: d.vsRHP ?? null,
        }));
      }).catch(() => {});
  }, [playerId, selectedDate, gameSportId, data]);

  // Fallback: fetch college season stats from overslot when MLB Stats API returns nothing
  useEffect(() => {
    const playerName = data?.playerName;
    if (!playerName) return;
    // Only run when traditional stats are missing (college players)
    if (seasonStats?.avg != null || seasonStats?.hr != null || seasonStats?.g != null) return;
    const year = selectedDate.slice(0, 4) || String(new Date().getFullYear());
    fetch(`/api/overslot-stats?type=hit&year=${year}`)
      .then(r => r.json())
      .then((d: { players: Record<string, string>[] }) => {
        const players = d.players ?? [];
        // Normalize names for matching: lowercase, letters/spaces only
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').trim();
        const target = normalize(playerName);
        const match = players.find(p => normalize(p['Player'] ?? '') === target);
        if (!match) return;
        setSeasonStats(prev => ({
          ...(prev ?? {}),
          avg:     match['BA']  || undefined,
          obp:     match['OBP'] || undefined,
          slg:     match['SLG'] || undefined,
          ops:     match['OPS'] || undefined,
          hr:      match['HR']  ? Number(match['HR'])  : undefined,
          bb:      match['BB']  ? Number(match['BB'])  : undefined,
          k:       match['SO']  ? Number(match['SO'])  : undefined,
          g:       match['G']   ? Number(match['G'])   : undefined,
          pa:      match['PA']  ? Number(match['PA'])  : undefined,
          sb:      match['SB']  ? Number(match['SB'])  : undefined,
          hits:    match['H']   ? Number(match['H'])   : undefined,
          doubles: match['2B']  ? Number(match['2B'])  : undefined,
          triples: match['3B']  ? Number(match['3B'])  : undefined,
        }));
      }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.playerName, selectedDate, seasonStats?.avg, seasonStats?.hr, seasonStats?.g]);

  // Fetch season bat speed from Savant bat-tracking leaderboard
  useEffect(() => {
    if (!playerId) return;
    const year = selectedDate.slice(0, 4) || String(new Date().getFullYear());
    fetch(`/api/bat-speed?playerId=${playerId}&year=${year}`)
      .then(r => r.json())
      .then(d => {
        setSeasonStats(prev => prev
          ? { ...prev, avgBatSpeed: d.avgBatSpeed ?? null, fastSwingPct: d.fastSwingPct ?? null }
          : { avgBatSpeed: d.avgBatSpeed ?? null, fastSwingPct: d.fastSwingPct ?? null }
        );
      }).catch(() => {});
  }, [playerId, selectedDate]);

  // Fetch season EV stats from Savant CSV (covers MLB fully; covers MiLB at tracked parks)
  useEffect(() => {
    if (!playerId) return;
    const year = selectedDate.slice(0, 4) || String(new Date().getFullYear());
    fetch(`/api/ev-stats?playerId=${playerId}&year=${year}`)
      .then(r => r.json())
      .then(d => {
        setSeasonStats(prev => prev
          ? { ...prev, avgEv: d.avgEv ?? null, maxEv: d.maxEv ?? null, ev90: d.ev90 ?? null, barrels: d.barrels ?? null, barrelPct: d.barrelPct ?? null, savantBipCount: d.bipCount ?? 0, evs: d.evs ?? null }
          : { avgEv: d.avgEv ?? null, maxEv: d.maxEv ?? null, ev90: d.ev90 ?? null, barrels: d.barrels ?? null, barrelPct: d.barrelPct ?? null, savantBipCount: d.bipCount ?? 0, evs: d.evs ?? null }
        );
      }).catch(() => {});
  }, [playerId, selectedDate]);

  // Season EV aggregation via game-log feeds (covers parks with HawkEye but not Statcast).
  // Runs for all players; the evSource logic below picks the more complete dataset.
  useEffect(() => {
    if (!playerId) return;
    const year = selectedDate.slice(0, 4) || String(new Date().getFullYear());
    fetch(`/api/fcl-season-ev?batterId=${playerId}&season=${year}`)
      .then(r => r.json())
      .then(d => setMilbEvStats({
        avgEv: d.avgEv ?? null, maxEv: d.maxEv ?? null, ev90: d.ev90 ?? null,
        barrels: d.barrels ?? null, barrelPct: d.barrelPct ?? null,
        bipCount: d.bipCount ?? 0, evs: d.evs ?? null,
      }))
      .catch(() => {});
  }, [playerId, selectedDate]);

  // Fetch season discipline stats (whiff%, chase%, z-swing%, xwOBA, etc.) for every
  // affiliated minor-league level. player-season aggregates the live MLB Stats API feed
  // (EV, launch angle, zone with px/pz fallback, xwOBA from the EV/LA model) across all
  // season games. MLB (sportId 1) is excluded — those cards use the age-percentile +
  // Savant path. Complex leagues (16/17) without pitch tracking simply return no statcast,
  // leaving seasonDiscipline null with no harm.
  useEffect(() => {
    const sportId = data?.gameInfo?.sportId;
    if (sportId == null || sportId === 1) { setSeasonDiscipline(null); return; }
    if (!playerId) return;
    const year = selectedDate.slice(0, 4) || String(new Date().getFullYear());
    fetch(`/api/player-season?playerId=${playerId}&season=${year}&sportId=${sportId}`)
      .then(r => r.json())
      .then(d => {
        const sc = d.statcast;
        if (!sc) return;
        setSeasonDiscipline({
          whiffPct:    sc.whiffPct    ?? null,
          chasePct:    sc.chasePct    ?? null,
          zSwingPct:   sc.zSwingPct   ?? null,
          zContactPct: sc.zContactPct ?? null,
          ozContactPct:sc.ozContactPct?? null,
          swingPct:    sc.swingPct    ?? null,
          avgLaHard:   sc.avgLaHard   ?? null,
          xwoba:       sc.xwoba       ?? null,
        });
      })
      .catch(() => {});
  }, [data?.gameInfo?.sportId, playerId, selectedDate]);

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    fetchData(date);
  };

  const displayName = player?.full_name ?? data?.playerName ?? `Player ${id}`;
  const availableDates = data?.availableDates ?? [];
  const gameLine = data?.gameLine;
  const gameInfo = data?.gameInfo;

  // Game-level bat speed — used as fallback when season API hasn't loaded yet
  const gameAvgBs = useMemo(() => {
    const pitches = data?.pitchData?.atBats?.flatMap(ab => ab.pitches) ?? [];
    const swings = pitches.filter(p => p.batSpeed !== null && p.batSpeed! >= 40);
    if (swings.length === 0) return null;
    return swings.reduce((s, p) => s + p.batSpeed!, 0) / swings.length;
  }, [data]);

  const gameFastSwingPct = useMemo(() => {
    const pitches = data?.pitchData?.atBats?.flatMap(ab => ab.pitches) ?? [];
    const swings = pitches.filter(p => p.batSpeed !== null && p.batSpeed! >= 40);
    if (swings.length === 0) return null;
    const fast = swings.filter(p => p.batSpeed! >= 75);
    return (fast.length / swings.length) * 100;
  }, [data]);

  // Game-level EV stats — used as last-resort fallback (single game only)
  const gameEvStats = useMemo(() => {
    const pitches = data?.pitchData?.atBats?.flatMap(ab => ab.pitches) ?? [];
    const bips = pitches.filter(p => p.exitVelo !== null && p.exitVelo! > 0 && p.exitVelo! <= 130);
    const evs = bips.map(p => p.exitVelo!).sort((a, b) => b - a); // descending
    if (evs.length === 0) return { maxEv: null, avgEv: null, ev90: null, barrels: null, barrelPct: null };
    const maxEv = evs[0];
    const avgEv = evs.reduce((s, v) => s + v, 0) / evs.length;
    const barrels = bips.filter(p => p.isBarrel).length;
    const barrelPct = Math.round((barrels / bips.length) * 1000) / 10;
    // EV90 = average of top 10% hardest-hit balls; show with ≥2 BIP
    const top10Count = Math.max(1, Math.round(evs.length * 0.1));
    const ev90 = evs.length >= 2
      ? Math.round((evs.slice(0, top10Count).reduce((a, b) => a + b, 0) / top10Count) * 10) / 10
      : null;
    return {
      maxEv: Math.round(maxEv * 10) / 10,
      avgEv: Math.round(avgEv * 10) / 10,
      ev90:  ev90 !== null ? Math.round(ev90 * 10) / 10 : null,
      barrels,
      barrelPct,
    };
  }, [data]);

  // Resolve team affiliation first — isAffiliate gates the evSource logic below.
  const rawTeamAbbr = gameInfo?.team || player?.team || null;
  const parentOrgAbbr = rawTeamAbbr ? getParentOrgAbbr(rawTeamAbbr) : null;
  // isAffiliate = true when the player is on a MiLB team (parent org ≠ raw abbr)
  const isAffiliate = parentOrgAbbr !== null && parentOrgAbbr !== rawTeamAbbr?.toUpperCase();

  // Pick one consistent EV source so all five EV stats come from the same dataset.
  //
  // MiLB players (isAffiliate = true):
  //   Savant only covers games at Statcast-equipped parks — sometimes just a handful
  //   out of the full season.  The game-log aggregation (fcl-season-ev) reads every
  //   game feed and reflects the complete season, so it always wins when available.
  //   Savant is kept as a fallback in case the game-log aggregation returns nothing.
  //
  // MLB players (isAffiliate = false):
  //   Every MLB park has Statcast, so Savant is complete and very fast to query.
  //   We prefer it and only fall back to the game-log aggregation when Savant has
  //   no data yet (e.g. early in the season, fewer than 10 BIP on record).
  const evSource: { maxEv: number | null; avgEv: number | null; ev90: number | null; barrels: number | null; barrelPct: number | null } = (() => {
    let result: { maxEv: number | null; avgEv: number | null; ev90: number | null; barrels: number | null; barrelPct: number | null };
    if (isAffiliate) {
      // MiLB: Savant covers Statcast-equipped parks; game-log feeds cover HawkEye parks.
      // These can be different sets of games, so pick whichever source has MORE BIPs
      // — that's the more complete dataset for this player's season.
      const savantBip = seasonStats?.savantBipCount ?? 0;
      const feedBip   = milbEvStats?.bipCount ?? 0;
      if (savantBip > feedBip && seasonStats?.avgEv != null) {
        result = {
          maxEv: seasonStats.maxEv ?? null, avgEv: seasonStats.avgEv ?? null,
          ev90: seasonStats.ev90 ?? null,
          barrels: seasonStats.barrels ?? null, barrelPct: seasonStats.barrelPct ?? null,
        };
      } else if (milbEvStats?.avgEv != null) {
        result = {
          maxEv: milbEvStats.maxEv, avgEv: milbEvStats.avgEv, ev90: milbEvStats.ev90,
          barrels: milbEvStats.barrels, barrelPct: milbEvStats.barrelPct,
        };
      } else if (seasonStats?.avgEv != null) {
        result = {
          maxEv: seasonStats.maxEv ?? null, avgEv: seasonStats.avgEv ?? null,
          ev90: seasonStats.ev90 ?? null,
          barrels: seasonStats.barrels ?? null, barrelPct: seasonStats.barrelPct ?? null,
        };
      } else {
        result = gameEvStats;
      }
    } else {
      // MLB: Savant only — never fall back to the game-log aggregation, which
      // blends in AAA data for recently called-up players.
      if (seasonStats?.avgEv != null) {
        result = {
          maxEv: seasonStats.maxEv ?? null, avgEv: seasonStats.avgEv ?? null,
          ev90: seasonStats.ev90 ?? null,
          barrels: seasonStats.barrels ?? null, barrelPct: seasonStats.barrelPct ?? null,
        };
      } else {
        result = gameEvStats;
      }
    }
    // Max EV should always reflect the true season high — take the best across
    // all season sources (Savant and game-log), not just the "winning" source.
    const candidateMaxEvs = [seasonStats?.maxEv, milbEvStats?.maxEv].filter((v): v is number => v != null);
    if (candidateMaxEvs.length > 0) result = { ...result, maxEv: Math.max(...candidateMaxEvs) };
    return result;
  })();

  const imageSources = [
    playerId ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_426,q_auto:best/v1/people/${playerId}/headshot/silo/current` : null,
    playerId ? getMLBStaticPlayerImage(playerId, { width: 426 }) : null,
    playerId ? getESPNPlayerImage(playerId) : null,
    '/api/placeholder/400/400',
  ].filter(Boolean) as string[];
  const currentImage = imageSources[Math.min(imageError, imageSources.length - 1)];

  // Remaining logo helpers (used only in JSX)
  // A game is MLB only if sportId=1 AND the opponent resolves to a known MLB logo
  // AND the opponent full name isn't a known college team (prevents "Louisville Cardinals" → STL).
  const _opponentMLBLogo = gameInfo?.opponent ? getMLBTeamLogoUrl(gameInfo.opponent) : null;
  // Only treat opponent as a college team if it has NO MLB logo — prevents
  // "Houston Astros" partial-matching "Houston" (university) via the college logo lookup.
  const _opponentIsCollege = !_opponentMLBLogo && !!(
    getCollegeLogoUrl(gameInfo?.opponentFull) || getCollegeLogoUrl(gameInfo?.opponent)
  );
  const isMLBGame  = (gameInfo?.sportId ?? 1) === 1 && _opponentMLBLogo !== null && !_opponentIsCollege;
  const isMiLBGame = [11, 12, 13, 14, 15, 16, 17].includes(gameInfo?.sportId ?? 0);
  // Always try MLB logo first — college logo only as fallback for true college players
  const teamLogo = (rawTeamAbbr ? getMLBTeamLogoUrl(rawTeamAbbr) : null)
    ?? (rawTeamAbbr ? getMLBTeamLogoUrl(parentOrgAbbr) : null)
    ?? getCollegeLogoUrl(rawTeamAbbr) ?? null;
  // Always prefer MLB opponent logo; college only when no MLB logo exists
  const opponentLogo = _opponentMLBLogo
    ?? getCollegeLogoUrl(gameInfo?.opponentFull)
    ?? getCollegeLogoUrl(gameInfo?.opponent)
    ?? null;

  const [light, setLight] = useState(true);
  const BD = '2px solid #000000';
  const th = {
    statsBg:      light ? '#ffffff' : '#1a1a1a',
    banner:       light ? getMLBTeamColor(rawTeamAbbr) : '#000000',
    label:        light ? '#6b7280' : '#777777',
    fg:           light ? '#000000' : '#ffffff',
    divider:      'divide-ink/10',
    border:       'border-ink/10',
    outerBorder:  light ? 'border-white/0'  : 'border-white/20',
    boxStyle:     light ? { padding: 12, marginBottom: 12 } as React.CSSProperties
                        : { marginBottom: 12 } as React.CSSProperties,
    sectionStyle: light ? { border: BD, padding: 12, background: '#f8fafc' } as React.CSSProperties : {},
    statsBoxStyle:light ? { border: BD } as React.CSSProperties
                        : { border: '1px solid rgba(255,255,255,0.2)' } as React.CSSProperties,
    btnFg:        light ? 'rgba(0,0,0,0.55)'  : 'rgba(255,255,255,0.6)',
    btnBg:        light ? 'rgba(0,0,0,0.05)'  : 'rgba(255,255,255,0.08)',
    btnBorder:    light ? 'rgba(0,0,0,0.18)'  : 'rgba(255,255,255,0.18)',
    atBatStyle:   light ? { background: '#ffffff', border: '1px solid #d4d4d4', borderLeft: '4px solid #ff2d2d', borderRadius: 4 } : {},
  };

  return (
    <>
    <div className={screenshotMode ? 'bg-page text-deep-fg' : 'min-h-screen bg-page text-deep-fg'} data-light={screenshotMode ? 'true' : (light ? 'true' : undefined)}>

      {/* Nav */}
      {!screenshotMode && <header className="bg-page border-b border-ink/20">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-ink-3 hover:text-ink font-medium text-sm transition-colors">
              Hitters
            </Link>
            {player && (
              <Link
                href={`/player/${id}`}
                className="px-3 py-1.5 bg-panel hover:bg-bone border border-ink/20 hover:border-ink/40 text-ink-3 hover:text-ink text-xs font-semibold transition-colors tracking-wide"
              >
                Season Stats
              </Link>
            )}
            <Link
              href={`/player/${id}/season`}
              className="px-3 py-1.5 bg-panel hover:bg-bone border border-ink/20 hover:border-ink/40 text-ink-3 hover:text-ink text-xs font-semibold transition-colors tracking-wide"
            >
              Season Card
            </Link>
            <Link
              href={`/player/${id}/weekly`}
              className="px-3 py-1.5 bg-panel hover:bg-bone border border-ink/20 hover:border-ink/40 text-ink-3 hover:text-ink text-xs font-semibold transition-colors tracking-wide"
            >
              Weekly Card
            </Link>
            <Link href="/pitchers" className="text-ink-3 hover:text-ink font-medium text-sm transition-colors">
              Pitchers
            </Link>
          </div>
        </div>
      </header>}

      <div className="mx-auto" style={screenshotMode ? { padding: 0 } : { maxWidth: 960, padding: '24px 16px' }}>

        {/* ── MAIN CARD ── */}
        <div className={screenshotMode ? '' : 'mb-6'}>
        <div ref={cardRef} className="bg-page p-6 w-full" style={{ position: 'relative' }}>

          {/* Export buttons — excluded from image capture */}
          {!loading && (data || error) && !screenshotMode && (
            <div className="export-ignore" style={{
              position: 'absolute', top: 10, right: 10, display: 'flex', gap: 6, zIndex: 10,
            }}>
              <button
                onClick={() => setLight(l => !l)}
                title="Toggle light/dark mode"
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  background: th.btnBg, border: `1px solid ${th.btnBorder}`,
                  color: th.btnFg, borderRadius: 3, transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
              >
                {light ? '☀ Light' : '☾ Dark'}
              </button>
              <button
                onClick={handleCopy}
                disabled={capturing}
                title="Copy image to clipboard"
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: capturing ? 'wait' : 'pointer',
                  background: copied ? '#166534' : th.btnBg,
                  border: `1px solid ${copied ? '#16a34a' : th.btnBorder}`,
                  color: copied ? '#4ade80' : th.btnFg,
                  borderRadius: 3, transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
              >
                {copied ? '✓ Copied' : capturing ? '…' : '⎘ Copy'}
              </button>
              <button
                onClick={handleDownload}
                disabled={capturing}
                title="Download as PNG"
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: capturing ? 'wait' : 'pointer',
                  background: th.btnBg, border: `1px solid ${th.btnBorder}`,
                  color: th.btnFg,
                  borderRadius: 3, transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
              >
                {capturing ? '…' : '↓ PNG'}
              </button>
              <button
                onClick={() => setScreenshotMode(true)}
                title="Screenshot mode"
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  background: th.btnBg, border: `1px solid ${th.btnBorder}`,
                  color: th.btnFg, borderRadius: 3, transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
              >
                📷
              </button>
            </div>
          )}

          {/* Loading / Error */}
          {loading && (
            <div className="flex items-center justify-center gap-2 mb-3">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent animate-spin" />
              <span className="text-ink-3 text-xs">Loading...</span>
            </div>
          )}
          {!loading && error && (
            <div className="bg-bone p-2 mb-3 text-center">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          {/* TOP ROW: [Watermark] [Headshot] [Name/Info/Game] [Team Logo] */}
          <div className="flex gap-3 items-stretch mx-auto" style={{ maxWidth: 960, ...th.boxStyle }}>
            {/* Col 0: Watermark */}
            <div className="flex-shrink-0 flex flex-col items-end justify-center" style={{ width: 76 }}>
              <div className="font-display italic text-[11px] uppercase text-right" style={{ color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>By @Piratefan003</div>
              <div className="text-[8px] leading-tight mt-0.5 text-right" style={{ color: light ? '#000000' : 'var(--color-ink-4)' }}>
                Data: MLB Statcast<br />Baseball Savant
              </div>
            </div>

            {/* Col 1: Headshot */}
            <div className="flex-shrink-0" style={{ width: 150 }}>
              <div className="w-full overflow-hidden bg-page" style={{ height: 150 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentImage}
                  alt={displayName}
                  crossOrigin="anonymous"
                  className="w-full h-full object-cover object-top"
                  onError={() => setImageError(e => Math.min(e + 1, imageSources.length - 1))}
                />
              </div>
            </div>

            {/* Col 2: Name / Bio / Game info */}
            <div className="flex-1 flex flex-col items-center justify-center text-center min-w-0">
              <h1 className="font-display text-2xl uppercase tracking-[0.02em] mb-1">{displayName}</h1>
              {(() => {
                const age = calcAge(playerBio?.birthDate ?? null);
                const parts: string[] = [];
                if (playerBio?.height) parts.push(playerBio.height);
                if (playerBio?.weight) parts.push(`${playerBio.weight} lbs`);
                if (age !== null) parts.push(`Age ${age}`);
                if (playerBio?.batSide && playerBio?.pitchHand) parts.push(`${playerBio.batSide}/${playerBio.pitchHand}`);
                return parts.length > 0
                  ? <p className="text-sm mb-2" style={{ color: light ? '#000000' : 'var(--color-ink-3)' }}>{parts.join(' · ')}</p>
                  : null;
              })()}
              <div className="flex flex-wrap items-center justify-center gap-x-2 text-xs" style={{ color: light ? '#000000' : 'var(--color-ink-4)' }}>
                {(gameInfo?.team || player?.team) && (
                  <span className="font-bold" style={{ color: light ? '#000000' : 'var(--color-ink)' }}>{gameInfo?.team || player?.team}</span>
                )}
                {isAffiliate && parentOrgAbbr && (
                  <>
                    <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: '#ff2d2d' }}>{parentOrgAbbr}</span>
                    <span className="text-[9px] tracking-wider uppercase ml-1" style={{ color: light ? '#555555' : 'var(--color-ink-5)' }}>Affiliate</span>
                  </>
                )}
                {gameInfo && (
                  <>
                    <span>·</span>
                    <span>{gameInfo.date}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      {opponentLogo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={opponentLogo} alt={gameInfo.opponent || ''} crossOrigin="anonymous" className="w-4 h-4 object-contain inline" />
                      )}
                      <span>{gameInfo.isHome ? 'vs' : '@'}</span>
                      <span className="font-semibold" style={{ color: light ? '#000000' : 'var(--color-ink)' }}>{gameInfo.opponentFull || gameInfo.opponent}</span>
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Col 3: Team Logo */}
            <div className="flex-shrink-0 flex flex-col items-center justify-center gap-1" style={{ width: 150 }}>
              {teamLogo ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={teamLogo} alt={parentOrgAbbr || rawTeamAbbr || ''} className="object-contain" style={{ width: 115, height: 115 }} />
                  {isAffiliate && parentOrgAbbr && (
                    <div className="text-center">
                      <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: '#ff2d2d' }}>{parentOrgAbbr}</span>
                      <span className="text-[9px] tracking-wider uppercase ml-1" style={{ color: light ? '#555555' : 'var(--color-ink-5)' }}>Affiliate</span>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ width: 150 }} />
              )}
            </div>

            {/* Col 4: Spacer */}
            <div className="flex-shrink-0" style={{ width: 76 }} />
          </div>

          {/* SEASON STATS — full width */}
          {seasonStats && (
            <div className="w-full max-w-full mx-auto mb-2" style={th.statsBoxStyle}>
              <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`} style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                {selectedDate.slice(0, 4)} Season
              </div>
              <div className={`grid grid-cols-6 divide-x ${th.divider}`} style={{ background: th.statsBg }}>
                {[
                  { label: 'AVG', value: seasonStats.avg ?? '—' },
                  { label: 'OBP', value: seasonStats.obp ?? '—' },
                  { label: 'SLG', value: seasonStats.slg ?? '—' },
                  { label: 'OPS', value: seasonStats.ops ?? '—' },
                  { label: 'HR',  value: seasonStats.hr  != null ? String(seasonStats.hr)  : '—' },
                  { label: 'RBI', value: seasonStats.rbi != null ? String(seasonStats.rbi) : '—' },
                ].map(s => (
                  <div key={s.label} className="text-center px-1 py-1.5">
                    <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                    <div className="font-bold font-display tabular-nums" style={{ fontSize: 19, color: th.fg, lineHeight: '22px' }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {isMLBGame ? (
                // MLB: full second row with raw counts
                <div className={`grid grid-cols-7 divide-x ${th.divider} border-t ${th.border}`} style={{ background: th.statsBg }}>
                  {[
                    { label: 'G',  value: seasonStats.g    != null ? String(seasonStats.g)    : '—' },
                    { label: 'PA', value: seasonStats.pa   != null ? String(seasonStats.pa)   : '—' },
                    { label: 'AB', value: seasonStats.ab   != null ? String(seasonStats.ab)   : '—' },
                    { label: 'H',  value: seasonStats.hits != null ? String(seasonStats.hits) : '—' },
                    { label: 'BB', value: seasonStats.bb   != null ? String(seasonStats.bb)   : '—' },
                    { label: 'K',  value: seasonStats.k    != null ? String(seasonStats.k)    : '—' },
                    { label: 'SB', value: seasonStats.sb   != null ? String(seasonStats.sb)   : '—' },
                  ].map(s => (
                    <div key={s.label} className="text-center px-1 py-0.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                      <div className="font-bold font-display tabular-nums" style={{ fontSize: 15, color: th.fg }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              ) : (
                // College: BB% and K% instead of raw counts
                <div className={`grid grid-cols-7 divide-x ${th.divider} border-t ${th.border}`} style={{ background: th.statsBg }}>
                  {[
                    { label: 'G',   value: seasonStats.g    != null ? String(seasonStats.g)    : '—' },
                    { label: 'PA',  value: seasonStats.pa   != null ? String(seasonStats.pa)   : '—' },
                    { label: 'AB',  value: seasonStats.ab   != null ? String(seasonStats.ab)   : '—' },
                    { label: 'H',   value: seasonStats.hits != null ? String(seasonStats.hits) : '—' },
                    { label: 'BB%', value: seasonStats.bb != null && seasonStats.pa ? `${(seasonStats.bb / seasonStats.pa * 100).toFixed(1)}%` : '—' },
                    { label: 'K%',  value: seasonStats.k  != null && seasonStats.pa ? `${(seasonStats.k  / seasonStats.pa * 100).toFixed(1)}%` : '—' },
                    { label: 'SB',  value: seasonStats.sb   != null ? String(seasonStats.sb)   : '—' },
                  ].map(s => (
                    <div key={s.label} className="text-center px-1 py-0.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                      <div className="font-bold font-display tabular-nums" style={{ fontSize: 15, color: th.fg }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              )}
              {isMLBGame && !isAffiliate && (
                <div className={`grid grid-cols-2 divide-x ${th.divider} border-t ${th.border}`} style={{ background: th.statsBg }}>
                  <div className="text-center px-1 py-0.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>Avg BS</div>
                    <div className="font-bold font-display tabular-nums" style={{ fontSize: 15, color: th.fg }}>
                      {seasonStats.avgBatSpeed != null
                        ? seasonStats.avgBatSpeed.toFixed(1)
                        : '—'}
                    </div>
                  </div>
                  <div className="text-center px-1 py-0.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>Fast Swing%</div>
                    <div className="font-bold font-display tabular-nums" style={{ fontSize: 15, color: th.fg }}>
                      {seasonStats.fastSwingPct != null
                        ? seasonStats.fastSwingPct.toFixed(1) + '%'
                        : '—'}
                    </div>
                  </div>
                </div>
              )}
              {(isMLBGame || isMiLBGame) && (
                <div className={`grid grid-cols-5 divide-x ${th.divider} border-t ${th.border}`} style={{ background: th.statsBg }}>
                  {[
                    { label: 'Max EV', value: evSource.maxEv?.toFixed(1)    ?? '—' },
                    { label: 'Avg EV', value: evSource.avgEv?.toFixed(1)    ?? '—' },
                    { label: 'EV90',   value: evSource.ev90?.toFixed(1)     ?? '—' },
                    { label: 'Brls',   value: evSource.barrels != null ? String(evSource.barrels) : '—' },
                    { label: 'Brl%',   value: evSource.barrelPct != null ? `${evSource.barrelPct.toFixed(1)}%` : '—' },
                  ].map(s => (
                    <div key={s.label} className="text-center px-1 py-0.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                      <div className="font-bold font-display tabular-nums" style={{ fontSize: 15, color: th.fg }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* PLATOON SPLITS — own box + header */}
          {(seasonStats?.vsLHP || seasonStats?.vsRHP) && (
            <div className="w-full max-w-full mx-auto mb-2" style={th.statsBoxStyle}>
              <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`} style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                Platoon Splits
              </div>
              {([
                { key: 'vsLHP' as const, label: 'VS LHP' },
                { key: 'vsRHP' as const, label: 'VS RHP' },
              ]).map(({ key, label }, i) => {
                const s = seasonStats![key];
                const SPORT_ID_LEVEL: Record<number, string> = {
                  1: 'MLB', 11: 'AAA', 12: 'AA', 13: 'High-A', 14: 'Low-A', 15: 'Rookie', 16: 'FCL', 17: 'ACL',
                };
                const pctLevel = SPORT_ID_LEVEL[gameSportId ?? 1] ?? 'MLB';
                const opsNum = s?.ops != null ? parseFloat(s.ops) : null;
                const cols: { label: string; value: string; num: number | null; lk: string; sample?: number; minPa: number }[] = [
                  { label: 'OPS',   value: s?.ops ?? '—', num: opsNum, lk: 'ops', sample: s?.pa, minPa: 20 },
                  { label: 'xwOBA', value: s?.xwoba != null ? s.xwoba.toFixed(3).replace(/^0\./, '.') : '—', num: s?.xwoba ?? null, lk: 'xwoba', sample: s?.pa, minPa: 20 },
                  { label: 'Brl%',  value: s?.barrelPct  != null ? `${s.barrelPct.toFixed(1)}%`  : '—', num: s?.barrelPct  ?? null, lk: 'barrelPct',  sample: s?.bip,    minPa: 10 },
                  { label: 'Con%',  value: s?.contactPct != null ? `${s.contactPct.toFixed(1)}%` : '—', num: s?.contactPct ?? null, lk: 'contactPct', sample: s?.swings, minPa: 15 },
                ];
                return (
                  <div key={key}>
                    <div className={`text-center px-2 py-1 border-b ${th.border} ${i > 0 ? `border-t ${th.border}` : ''}`} style={{ background: th.statsBg }}>
                      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: light ? '#111111' : '#ff2d2d' }}>
                        {s?.pa != null ? `${s.pa} PAs ` : ''}{label}
                      </span>
                    </div>
                    <div className={`grid grid-cols-4 divide-x ${th.divider}`} style={{ background: th.statsBg }}>
                      {cols.map(c => (
                        <div key={c.label} className="text-center px-1 py-0.5">
                          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{c.label}</div>
                          <div className="font-bold font-display tabular-nums" style={{ fontSize: 19, color: th.fg }}>{c.value}</div>
                          {c.lk && (
                            <MiniPercentileBar value={c.num} leagueKey={c.lk} level={pctLevel} pa={c.sample} minPa={c.minPa} light={light} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* GAME STATS — full width */}
          {gameLine && !loading && (() => {
            const allPitches = data?.pitchData?.atBats?.flatMap(ab => ab.pitches) ?? [];
            const barrels = allPitches.filter(p => p.isBarrel).length;
            const swingsWithBs = allPitches.filter((p): p is typeof p & { batSpeed: number } => p.batSpeed !== null && p.batSpeed >= 40);
            const sorted = [...swingsWithBs].sort((a, b) => b.batSpeed - a.batSpeed);
            const top90Count = Math.ceil(sorted.length * 0.9);
            const top90 = sorted.slice(0, top90Count);
            const bottom10 = sorted.slice(top90Count);
            const extraSwings = bottom10.filter(p => p.batSpeed >= 60 && p.exitVelo !== null && p.exitVelo >= 90);
            const competitive = [...top90, ...extraSwings];
            const avgBs = competitive.length > 0 ? competitive.reduce((a, p) => a + p.batSpeed, 0) / competitive.length : null;
            return (
              <div className="w-full max-w-full mx-auto mb-3" style={th.statsBoxStyle}>
                <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`} style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>Game</div>
                <div className={`grid grid-cols-6 divide-x ${th.divider}`} style={{ background: th.statsBg }}>
                  {[
                    { label: 'AB',   value: String(gameLine.ab) },
                    { label: 'H',    value: String(gameLine.h) },
                    { label: 'HR',   value: String(gameLine.hr) },
                    { label: 'RBI',  value: String(gameLine.rbi) },
                    { label: 'BB',   value: String(gameLine.bb) },
                    { label: 'Brls', value: String(barrels) },
                  ].map(s => (
                    <div key={s.label} className="text-center px-1 py-1">
                      <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                      <div className="font-bold font-display tabular-nums" style={{ fontSize: 15, color: th.fg, lineHeight: '19px' }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                <div className={`grid divide-x ${th.divider} border-t ${th.border} ${isAffiliate ? 'grid-cols-5' : 'grid-cols-6'}`} style={{ background: th.statsBg }}>
                  {[
                    { label: 'K',      value: String(gameLine.k) },
                    { label: '2B',     value: String(gameLine.doubles) },
                    { label: '3B',     value: String(gameLine.triples) },
                    { label: 'PA',     value: String(gameLine.pa) },
                    { label: 'SB',     value: String(gameLine.sb) },
                    ...(!isAffiliate ? [{ label: 'Avg BS', value: avgBs !== null ? avgBs.toFixed(1) : '—' }] : []),
                  ].map(s => (
                    <div key={s.label} className="text-center px-1 py-1">
                      <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                      <div className="font-bold font-display tabular-nums" style={{ fontSize: 15, color: th.fg, lineHeight: '19px' }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* BOTTOM SECTIONS */}
          <div className="flex flex-col gap-4">
            {/* AA / High-A: no Statcast — show season rate stats instead */}
            {(gameInfo?.sportId === 12 || gameInfo?.sportId === 13) ? (() => {
              const pa  = seasonStats?.pa  ?? 0;
              const bb  = seasonStats?.bb  ?? 0;
              const k   = seasonStats?.k   ?? 0;
              const hr  = seasonStats?.hr  ?? 0;
              const ab  = seasonStats?.ab  ?? 0;
              const h   = seasonStats?.hits ?? 0;
              const avgN = seasonStats?.avg  != null ? parseFloat(String(seasonStats.avg))  : null;
              const slgN = seasonStats?.slg  != null ? parseFloat(String(seasonStats.slg))  : null;
              const bbPct   = pa > 0 ? (bb / pa * 100)       : null;
              const kPct    = pa > 0 ? (k  / pa * 100)       : null;
              const hrPct   = pa > 0 ? (hr / pa * 100)       : null;
              const iso     = avgN != null && slgN != null ? (slgN - avgN) : null;
              const babipDenom = ab - k - hr;
              const babip  = babipDenom > 0 ? ((h - hr) / babipDenom) : null;
              const fmt1 = (v: number | null) => v != null ? v.toFixed(1) + '%' : '—';
              const fmtD = (v: number | null) => v != null ? v.toFixed(3).replace(/^0/, '') : '—';
              const ratesRow1 = [
                { label: 'BB%',   value: bbPct  != null ? fmt1(bbPct)  : '—' },
                { label: 'K%',    value: kPct   != null ? fmt1(kPct)   : '—' },
                { label: 'ISO',   value: fmtD(iso) },
                { label: 'BABIP', value: fmtD(babip) },
                { label: 'HR%',   value: hrPct  != null ? fmt1(hrPct)  : '—' },
                { label: 'OPS',   value: seasonStats?.ops != null ? String(seasonStats.ops) : '—' },
              ];
              const sd = seasonDiscipline;
              const ratesRow2 = sd ? [
                { label: 'Swing%',    value: fmt1(sd.swingPct) },
                { label: 'Z-Swing%',  value: fmt1(sd.zSwingPct) },
                { label: 'Chase%',    value: fmt1(sd.chasePct) },
                { label: 'Whiff%',    value: fmt1(sd.whiffPct) },
                { label: 'Z-Con%',    value: fmt1(sd.zContactPct) },
                { label: 'OOZ-Con%',  value: fmt1(sd.ozContactPct) },
              ] : null;
              return (
                <div style={light ? { border: BD } as React.CSSProperties : {}}>
                  <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`}
                       style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                    Season Rates
                  </div>
                  <div style={{ padding: light ? 16 : 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: ratesRow2 ? 8 : 0 }}>
                      {ratesRow1.map(r => (
                        <div key={r.label} style={{ ...th.statsBoxStyle, padding: '10px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: th.label, marginBottom: 4 }}>{r.label}</div>
                          <div style={{ fontSize: 18, fontWeight: 900, color: th.fg, fontFamily: 'var(--font-display, monospace)' }}>{r.value}</div>
                        </div>
                      ))}
                    </div>
                    {ratesRow2 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                        {ratesRow2.map(r => (
                          <div key={r.label} style={{ ...th.statsBoxStyle, padding: '10px 8px', textAlign: 'center' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: th.label, marginBottom: 4 }}>{r.label}</div>
                            <div style={{ fontSize: 18, fontWeight: 900, color: th.fg, fontFamily: 'var(--font-display, monospace)' }}>{r.value}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {!ratesRow2 && (
                      <p style={{ fontSize: 10, color: th.label, textAlign: 'center', marginTop: 8, opacity: 0.5 }}>
                        Loading zone stats…
                      </p>
                    )}
                  </div>
                </div>
              );
            })() : (
              <>
                {/* AT BATS */}
                <div style={light ? { border: BD } as React.CSSProperties : {}}>
                  <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`}
                       style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                    At Bats
                  </div>
                  <div className="flex flex-wrap justify-center gap-2 w-full max-w-full mx-auto" style={{ padding: light ? 12 : 0 }}>
                    <AtBatPanel
                      atBats={data?.pitchData?.atBats ?? []}
                      loading={loading}
                      hoveredPitch={hoveredPitch}
                      light={light}
                      cols={(() => {
                        const n = data?.pitchData?.atBats?.length ?? 0;
                        if (n <= 4) return 4;
                        if (n === 5) return 5;
                        return 3;
                      })()}
                    />
                  </div>
                </div>
                {/* CHARTS */}
                <div style={light ? { border: BD } as React.CSSProperties : {}}>
                  <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`}
                       style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                    Charts
                  </div>
                  <div className="flex gap-3 justify-center flex-wrap" style={{ padding: light ? 12 : 0 }}>
                    {!loading && !error ? (
                      <>
                        <HitterZoneChart
                          rawDots={data?.pitchData?.rawDots ?? []}
                          heightIn={playerBio?.height ? (() => {
                            const m = playerBio.height!.match(/(\d+)'\s*(\d+)/);
                            return m ? parseInt(m[1]) * 12 + parseInt(m[2]) : undefined;
                          })() : undefined}
                          hoveredPitch={hoveredPitch}
                          onHover={setHoveredPitch}
                          light={light}
                        />
                        <SprayChart hitDots={data?.pitchData?.hitDots ?? []} batSide={playerBio?.batSide} playerImageUrl={currentImage} />
                      </>
                    ) : (
                      <>
                        <div className="w-[400px] h-[400px] bg-bone" />
                        <div className="w-[400px] h-[400px] bg-bone" />
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>


        </div>
        </div>

        {/* ── Date picker ── */}
        {availableDates.length > 0 && !screenshotMode && (
          <div className="bg-page p-4 mb-6 border border-ink/30">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-ink-3 uppercase">
                Game Log
                <span className="ml-2 text-ink-3 font-normal normal-case">
                  {filterHR
                    ? `${availableDates.filter(d => d.hr > 0).length} HR games`
                    : `${availableDates.length} games`}
                </span>
              </h3>
              <button
                onClick={() => setFilterHR(v => !v)}
                className={`px-2.5 py-1 text-xs font-bold transition-colors border ${
                  filterHR
                    ? 'bg-yellow-500/20 border-yellow-400/60 text-yellow-300'
                    : 'bg-bone border-ink/20 text-ink-3 hover:border-yellow-500/60 hover:text-yellow-300'
                }`}
              >
                HR Only
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableDates.filter(d => !filterHR || d.hr > 0).map((d, i) => {
                const isSelected = d.date === selectedDate;
                return (
                  <button
                    key={`${d.date}-${d.gamePk ?? i}`}
                    onClick={() => handleDateChange(d.date)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      isSelected
                        ? 'bg-deep text-deep-fg'
                        : 'bg-bone text-ink-2 hover:bg-panel hover:text-ink border border-ink/20'
                    }`}
                  >
                    <span className="font-semibold">{d.date}</span>
                    <span className="text-ink-3 ml-1">vs {d.opponent}</span>
                    <span className="ml-1">{d.h}/{d.ab}</span>
                    {d.hr > 0 && <span className="ml-1 text-yellow-400">{d.hr}HR</span>}
                  </button>
                );
              })}
              {filterHR && availableDates.filter(d => d.hr > 0).length === 0 && (
                <p className="text-ink-3 text-xs italic">No home run games found</p>
              )}
            </div>
          </div>
        )}

      </div>
    </div>

    {/* Screenshot mode exit pill */}
    {screenshotMode && (
      <button
        onClick={() => setScreenshotMode(false)}
        style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, background: 'rgba(0,0,0,0.75)', color: '#fff',
          border: 'none', borderRadius: 999, padding: '10px 28px',
          fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        ✕ Exit screenshot mode
      </button>
    )}

    {/* Mobile image save overlay */}
    {previewUrl && (
      <div
        onClick={() => setPreviewUrl(null)}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.9)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }}
      >
        <p style={{ color: '#fff', fontSize: 13, marginBottom: 12, opacity: 0.75 }}>
          Long-press the image to save
        </p>
        <img
          src={previewUrl}
          alt="Card preview"
          style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 4 }}
          onClick={e => e.stopPropagation()}
        />
        <button
          onClick={() => setPreviewUrl(null)}
          style={{
            marginTop: 16, color: '#fff', fontSize: 14, opacity: 0.7,
            background: 'none', border: 'none', cursor: 'pointer', padding: '8px 16px',
          }}
        >
          ✕ Close
        </button>
      </div>
    )}
    </>
  );
}
