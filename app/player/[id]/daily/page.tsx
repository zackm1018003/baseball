'use client';

import React, { use, useState, useEffect, useCallback } from 'react';
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
  if (['walk','intent_walk','hit_by_pitch'].includes(events)) return 'bg-walk text-outcome-fg';
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

function HitterZoneChart({ rawDots, heightIn, hoveredPitch, onHover }: {
  rawDots: HitterRawDot[];
  heightIn?: number;
  hoveredPitch?: { atBatNum: number; pitchNum: number } | null;
  onHover?: (pitch: { atBatNum: number; pitchNum: number } | null) => void;
}) {
  const size = 280;
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
    <svg width={280} height={280} viewBox="70 120 370 370" style={{ background: '#f5f3ef' }}>
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
        <image href={playerImageUrl} x="164" y="402" width="28" height="28" preserveAspectRatio="xMidYMid meet" clipPath="url(#batBoxClipL)"/>
      )}
      {playerImageUrl && (batSide === 'L' || batSide === 'S') && (
        <image href={playerImageUrl} x="308" y="402" width="28" height="28" preserveAspectRatio="xMidYMid meet" clipPath="url(#batBoxClipR)"/>
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

function AtBatPanel({ atBats, loading, hoveredPitch }: { atBats: AtBat[]; loading: boolean; hoveredPitch?: { atBatNum: number; pitchNum: number } | null }) {
  if (loading) {
    return (
      <div className="bg-deep flex items-center justify-center" style={{ height: 80 }}>
        <div className="w-4 h-4 border-2 border-ink-5 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!atBats || atBats.length === 0) {
    return (
      <div className="bg-deep flex items-center justify-center" style={{ height: 60 }}>
        <p className="text-ink-5 text-xs text-center px-4">No at-bat data</p>
      </div>
    );
  }

  return (
    <>
      {atBats.map(ab => (
        <div key={ab.atBatNum} className="bg-deep px-2 py-2 flex-shrink-0 flex-1 min-w-[180px] max-w-[220px]">
          {/* Header */}
          <div className="flex items-center gap-1 mb-1.5 flex-nowrap min-w-0">
            <span className="text-[9px] font-bold text-ink-5 flex-shrink-0">AB {ab.atBatNum}</span>
            {ab.result && (
              <span className={`text-[9px] font-bold px-1 py-0 leading-4 whitespace-nowrap flex-shrink-0 ${resultColor(ab.result)}`}>
                {cleanResult(ab.result)}
              </span>
            )}
            <span className="text-[9px] text-deep-fg-3 truncate min-w-0" style={{ color: 'var(--color-deep-fg-3)' }}>{ab.pitcherName}{ab.pitcherHand ? ` · ${ab.pitcherHand}HP` : ''}</span>
          </div>

          {/* Pitch rows */}
          <div className="flex flex-col" style={{ gap: 4 }}>
            {ab.pitches.map((p, i) => {
              const col = PITCH_COLORS[p.pitchType];
              const abbrev = PITCH_ABBREV[p.pitchType] || p.pitchType.slice(0, 2).toUpperCase();
              const isHighlighted = hoveredPitch && ab.atBatNum === hoveredPitch.atBatNum && p.pitchNum === hoveredPitch.pitchNum;
              return (
                <div key={i} className={`flex flex-col px-0.5 transition-colors ${isHighlighted ? 'bg-deep-fg/10 ring-1 ring-deep-fg/30' : ''}`}>
                  <div className="flex items-center gap-1" style={{ lineHeight: '14px' }}>
                  {/* Type badge */}
                  <span
                    className="rounded px-1 font-bold flex-shrink-0"
                    style={{ backgroundColor: col?.bg || '#555', color: col?.text || '#fff', fontSize: 10, lineHeight: '14px' }}
                  >
                    {abbrev}
                  </span>

                  {/* Velo */}
                  {p.velo !== null && (
                    <span className="font-semibold w-9 text-right flex-shrink-0" style={{ fontSize: 11, color: 'var(--color-deep-fg)' }}>
                      {p.velo.toFixed(1)}
                    </span>
                  )}

                  {/* Pitch result icon */}
                  {(() => {
                    const d = p.description.toLowerCase();
                    const isWhiff = d.includes('swinging_strike') || d.includes('swinging strike') || d.includes('foul_tip') || d === 'foul tip';
                    const isInPlay = d.includes('hit_into_play') || d.includes('in play');
                    const isTake = !isWhiff && !isInPlay && !d.includes('foul');
                    const isBarrel = isInPlay && p.isBarrel;
                    const is95ev = isInPlay && !isBarrel && p.exitVelo !== null && p.exitVelo >= 95;
                    const pitchCol = col?.color || '#888';
                    if (isBarrel) return (
                      <svg width="13" height="13" className="flex-shrink-0" style={{ overflow: 'visible' }}>
                        <defs><linearGradient id="abFire" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff2200"/><stop offset="50%" stopColor="#ff8800"/><stop offset="100%" stopColor="#ffdd00"/></linearGradient></defs>
                        <text x="6.5" y="11" textAnchor="middle" fontSize="12" fontWeight="bold" fill="url(#abFire)" stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
                      </svg>
                    );
                    if (is95ev) return <span className="flex-shrink-0" style={{ fontSize: 12, lineHeight: '13px' }}>🔥</span>;
                    if (isWhiff) return (
                      <svg width="13" height="13" className="flex-shrink-0">
                        <line x1="2" y1="2" x2="11" y2="11" stroke="#000" strokeWidth="3"/><line x1="11" y1="2" x2="2" y2="11" stroke="#000" strokeWidth="3"/>
                        <line x1="2" y1="2" x2="11" y2="11" stroke={pitchCol} strokeWidth="2"/><line x1="11" y1="2" x2="2" y2="11" stroke={pitchCol} strokeWidth="2"/>
                      </svg>
                    );
                    if (isTake) return (
                      <svg width="13" height="13" className="flex-shrink-0">
                        <circle cx="6.5" cy="6.5" r="5" fill="none" stroke={pitchCol} strokeWidth="2"/>
                      </svg>
                    );
                    return (
                      <svg width="13" height="13" className="flex-shrink-0">
                        <circle cx="6.5" cy="6.5" r="5" fill={pitchCol} stroke="#000" strokeWidth="0.6"/>
                      </svg>
                    );
                  })()}

                  {/* Description */}
                  <span className="text-ink-2 truncate min-w-0" style={{ fontSize: 10 }}>{cleanDesc(p.description)}</span>
                  </div>
                {/* Stats line */}
                {(p.batSpeed !== null || p.exitVelo !== null || p.hitDistance !== null) && (
                  <div className="pl-1 mt-1 flex gap-2" style={{ position: 'relative' }}>
                    {p.batSpeed !== null && p.batSpeed >= 75 && (
                      <span style={{ position: 'absolute', left: -7, top: 0, fontSize: 9, lineHeight: '14px', pointerEvents: 'none' }}>⚡</span>
                    )}
                    {p.batSpeed !== null && p.batSpeed >= 40 && <span className="text-yellow-400 font-semibold" style={{ fontSize: 10 }}>{p.batSpeed.toFixed(1)} <span style={{ color: 'var(--color-ink-5)', fontWeight: 400 }}>bs</span></span>}
                    {p.exitVelo !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 10 }}>{p.exitVelo.toFixed(1)} <span style={{ color: 'var(--color-ink-5)', fontWeight: 400 }}>ev</span></span>}
                    {p.launchAngle !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 10 }}>{p.launchAngle.toFixed(0)}° <span style={{ color: 'var(--color-ink-5)', fontWeight: 400 }}>la</span></span>}
                    {p.launchAngle !== null && p.hcX !== null && p.hcY !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 10 }}>{Math.round(Math.atan2(p.hcX - 125, 208 - p.hcY) * (360 / Math.PI))}° <span style={{ color: 'var(--color-ink-5)', fontWeight: 400 }}>sa</span></span>}
                    {p.hitDistance !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 10 }}>{p.hitDistance} <span style={{ color: 'var(--color-ink-5)', fontWeight: 400 }}>ft</span></span>}
                  </div>
                )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
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
  const [hoveredPitch, setHoveredPitch] = useState<{ atBatNum: number; pitchNum: number } | null>(null);
  const [seasonStats, setSeasonStats] = useState<{
    avg?: string; obp?: string; slg?: string; ops?: string;
    hr?: number; rbi?: number; bb?: number; k?: number;
    g?: number; pa?: number; sb?: number; hits?: number; ab?: number;
    doubles?: number; triples?: number;
  } | null>(null);
  const [playerBio, setPlayerBio]     = useState<{
    height?: string; weight?: number; birthDate?: string;
    pitchHand?: string; batSide?: string;
  } | null>(null);

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

  // Fetch season stats
  useEffect(() => {
    if (!playerId) return;
    const year = selectedDate.slice(0, 4) || String(new Date().getFullYear());
    fetch(`https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=hitting&season=${year}`)
      .then(r => r.json())
      .then(d => {
        const s = d.stats?.[0]?.splits?.[0]?.stat;
        if (s) setSeasonStats({
          avg: s.avg, obp: s.obp, slg: s.slg, ops: s.ops,
          hr: s.homeRuns, rbi: s.rbi, bb: s.baseOnBalls, k: s.strikeOuts,
          g: s.gamesPlayed, pa: s.plateAppearances, sb: s.stolenBases,
          hits: s.hits, ab: s.atBats, doubles: s.doubles, triples: s.triples,
        });
      }).catch(() => {});
  }, [playerId, selectedDate]);

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
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

  // For logo: live API team wins, but fall back to static DB team if the live
  // abbreviation is a MiLB team code that has no MLB logo (e.g. "IND", "LHV")
  const teamLogo =
    (gameInfo?.team ? getMLBTeamLogoUrl(gameInfo.team) : null) ??
    (player?.team  ? getMLBTeamLogoUrl(player.team)   : null);
  const opponentLogo = gameInfo?.opponent ? getMLBTeamLogoUrl(gameInfo.opponent) : null;

  return (
    <div className="min-h-screen bg-page text-deep-fg">

      {/* Nav */}
      <header className="bg-page border-b border-ink/20">
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
      </header>

      <div className="mx-auto px-6 py-6" style={{ maxWidth: 1400 }}>

        {/* ── MAIN CARD ── */}
        <div className="flex justify-center mb-6">
        <div className="bg-page p-6 inline-block border border-ink/30">
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
          {/* TOP ROW: photo + name/info/stats */}
          <div className="flex gap-4 items-start mb-4">
            <div className="flex-shrink-0 flex flex-col items-center">
              {/* Headshot block — square silo cutout with hard ink border */}
              <div className="w-[120px] h-[144px] border-2 border-ink bg-bone overflow-hidden relative flex-shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentImage}
                  alt={displayName}
                  className="w-full h-full object-cover object-top"
                  onError={() => setImageError(e => Math.min(e + 1, imageSources.length - 1))}
                />
              </div>
              {/* Byline + data sources */}
              <div className="mt-1.5 text-center w-[120px]">
                <div className="text-[10px] font-bold text-ink-3 tracking-[0.08em] uppercase">By @Piratefan003</div>
                <div className="text-[8px] text-ink-4 leading-tight mt-0.5">
                  Data: MLB Statcast<br />Baseball Savant
                </div>
              </div>
            </div>

            {/* CENTER: name/info/stats */}
            <div className="flex flex-col items-center flex-1">

              {/* Name / Bio / Game info / Stats */}
              <div className="flex flex-col items-center mb-4">
                <div className="flex items-center gap-3 mb-0.5">
                  <h1 className="font-display text-2xl uppercase tracking-[0.02em]">{displayName}</h1>
                  {teamLogo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={teamLogo} alt={gameInfo?.team || player?.team || ''} className="w-8 h-8 object-contain flex-shrink-0 drop-shadow-[0_0_6px_rgba(255,255,255,0.35)]" />
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
                    ? <p className="text-sm text-ink-2 mb-1">{parts.join(' • ')}</p>
                    : null;
                })()}

                {/* Game info */}
                <div className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-ink-3 mb-2">
                  {(gameInfo?.team || player?.team) && (
                    <span className="font-bold text-deep-fg">{gameInfo?.team || player?.team}</span>
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
                        <span className="font-semibold text-deep-fg">{gameInfo.opponentFull || gameInfo.opponent}</span>
                      </span>
                    </>
                  )}
                </div>

                {/* Stats grid */}
                {gameLine && !loading && (() => {
                  const allPitches = data?.pitchData?.atBats?.flatMap(ab => ab.pitches) ?? [];
                  const barrels = allPitches.filter(p => p.isBarrel).length;
                  // Statcast "competitive swings": fastest 90% + any 60+ MPH swings with 90+ MPH exit velo
                  // Filter out sub-40 mph readings — those are check swings/foul tips, not real swings
                  const swingsWithBs = allPitches.filter((p): p is typeof p & { batSpeed: number } => p.batSpeed !== null && p.batSpeed >= 40);
                  const sorted = [...swingsWithBs].sort((a, b) => b.batSpeed - a.batSpeed);
                  const top90Count = Math.ceil(sorted.length * 0.9);
                  const top90 = sorted.slice(0, top90Count);
                  const bottom10 = sorted.slice(top90Count);
                  const extraSwings = bottom10.filter(p => p.batSpeed >= 60 && p.exitVelo !== null && p.exitVelo >= 90);
                  const competitive = [...top90, ...extraSwings];
                  const avgBs = competitive.length > 0 ? competitive.reduce((a, p) => a + p.batSpeed, 0) / competitive.length : null;
                  return (
                  <div className="border border-ink/20">
                    <div className="text-[8px] text-ink-4 uppercase tracking-widest text-center py-0.5 bg-bone border-b border-ink/20">Game</div>
                    <div className="grid grid-cols-6 divide-x divide-[#28304e]">
                      {[
                        { label: 'AB',   value: String(gameLine.ab) },
                        { label: 'H',    value: String(gameLine.h) },
                        { label: 'HR',   value: String(gameLine.hr) },
                        { label: 'RBI',  value: String(gameLine.rbi) },
                        { label: 'BB',   value: String(gameLine.bb) },
                        { label: 'Brls', value: String(barrels) },
                      ].map(s => (
                        <div key={s.label} className="text-center px-1.5 py-1.5">
                          <div className="text-[9px] text-ink-4 uppercase tracking-wide">{s.label}</div>
                          <div className="text-sm font-bold tabular-nums">{s.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-6 divide-x divide-[#28304e] border-t border-ink/20">
                      {[
                        { label: 'K',      value: String(gameLine.k) },
                        { label: '2B',     value: String(gameLine.doubles) },
                        { label: '3B',     value: String(gameLine.triples) },
                        { label: 'PA',     value: String(gameLine.pa) },
                        { label: 'SB',     value: String(gameLine.sb) },
                        { label: 'Avg BS', value: avgBs !== null ? avgBs.toFixed(1) : '—' },
                      ].map(s => (
                        <div key={s.label} className="text-center px-1.5 py-1.5">
                          <div className="text-[9px] text-ink-4 uppercase tracking-wide">{s.label}</div>
                          <div className="text-sm font-bold tabular-nums">{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  );
                })()}
                  {/* Season stat grid */}
                  {seasonStats && (
                    <div className="border border-ink/20 mt-2">
                      <div className="text-[8px] text-ink-4 uppercase tracking-widest text-center py-0.5 bg-bone border-b border-ink/20">
                        {selectedDate.slice(0, 4)} Season
                      </div>
                      <div className="grid grid-cols-6 divide-x divide-[#28304e]">
                        {[
                          { label: 'AVG', value: seasonStats.avg ?? '—' },
                          { label: 'OBP', value: seasonStats.obp ?? '—' },
                          { label: 'SLG', value: seasonStats.slg ?? '—' },
                          { label: 'OPS', value: seasonStats.ops ?? '—' },
                          { label: 'HR',  value: seasonStats.hr  != null ? String(seasonStats.hr)  : '—' },
                          { label: 'RBI', value: seasonStats.rbi != null ? String(seasonStats.rbi) : '—' },
                        ].map(s => (
                          <div key={s.label} className="text-center px-1.5 py-1.5">
                            <div className="text-[9px] text-ink-4 uppercase tracking-wide">{s.label}</div>
                            <div className="text-sm font-bold tabular-nums">{s.value}</div>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-6 divide-x divide-[#28304e] border-t border-ink/20">
                        {[
                          { label: 'G',  value: seasonStats.g    != null ? String(seasonStats.g)    : '—' },
                          { label: 'AB', value: seasonStats.ab   != null ? String(seasonStats.ab)   : '—' },
                          { label: 'H',  value: seasonStats.hits != null ? String(seasonStats.hits) : '—' },
                          { label: 'BB', value: seasonStats.bb   != null ? String(seasonStats.bb)   : '—' },
                          { label: 'K',  value: seasonStats.k    != null ? String(seasonStats.k)    : '—' },
                          { label: 'SB', value: seasonStats.sb   != null ? String(seasonStats.sb)   : '—' },
                        ].map(s => (
                          <div key={s.label} className="text-center px-1.5 py-1.5">
                            <div className="text-[9px] text-ink-4 uppercase tracking-wide">{s.label}</div>
                            <div className="text-sm font-bold tabular-nums">{s.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            </div>{/* end top row */}
          </div>

          {/* BOTTOM SECTIONS: ABs horizontal, then charts side by side */}
          <div className="flex flex-col gap-4">
            <div className="flex gap-2 flex-wrap justify-center">
              <AtBatPanel
                atBats={data?.pitchData?.atBats ?? []}
                loading={loading}
                hoveredPitch={hoveredPitch}
              />
            </div>
            <div className="flex gap-3 justify-center flex-wrap">
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
                  />
                  <SprayChart hitDots={data?.pitchData?.hitDots ?? []} batSide={playerBio?.batSide} playerImageUrl={currentImage} />
                </>
              ) : (
                <>
                  <div className="w-[280px] h-[280px] bg-bone" />
                  <div className="w-[280px] h-[280px] bg-bone" />
                </>
              )}
            </div>
          </div>


        </div>
        </div>

        {/* ── Date picker ── */}
        {availableDates.length > 0 && (
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
  );
}
