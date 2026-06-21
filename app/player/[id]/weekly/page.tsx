'use client';

import React, { use, useState, useEffect, useCallback, useRef } from 'react';
import { getPlayerById, getPlayerByName } from '@/lib/database';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import { getCountryFlagUrl } from '@/lib/country-flags';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeeklyPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}

interface HitterRawDot {
  pitchType: string; px: number; pz: number;
  isWhiff: boolean; isBarrel: boolean; isSwing: boolean; isTake: boolean;
  exitVelo: number | null; atBatNum?: number; pitchNum?: number;
}

interface HitterHitDot {
  hcX: number; hcY: number; hitDistance: number | null;
  result: string; pitchType: string; exitVelo: number | null; isBarrel: boolean;
}

interface GameResult {
  date: string; dateShort: string; opponent: string | null; opponentFull: string | null;
  isHome: boolean | null;
  ab: number; h: number; hr: number; rbi: number; bb: number; k: number;
  pa: number; sb: number;
  avgEv: number | null; barrels: number; avgBatSpeed: number | null;
  gamePk: number | null;
}

interface WeeklyTotals {
  ab: number; h: number; hr: number; rbi: number; bb: number; k: number;
  doubles: number; triples: number; pa: number; sb: number;
}

interface AtBatPitch {
  pitchNum: number; pitchType: string; velo: number | null;
  description: string; batSpeed: number | null; exitVelo: number | null;
  launchAngle: number | null; hitDistance: number | null;
  hcX: number | null; hcY: number | null; isBarrel: boolean;
}

interface ApproachStat {
  pitches: number;
  zSwingPct: number | null; chasePct: number | null;
  contactPct: number | null; xslg: number | null; brlPct: number | null; bip: number;
}

interface WeeklyData {
  playerId: number; playerName: string | null; playerHeight: string | null;
  playerWeight: number | null; playerBirthDate: string | null;
  playerBatSide: string | null; playerPitchHand: string | null;
  weekStart: string; weekEnd: string;
  games: GameResult[]; totals: WeeklyTotals | null;
  rawDots: HitterRawDot[]; hitDots: HitterHitDot[];
  barrels: number; barrelPct: number | null;
  avgBatSpeed: number | null; avgEv: number | null; maxEv: number | null;
  avgLaHard: number | null; ev90: number | null; team: string | null; level: string | null;
  discipline: {
    swingPct: number | null; zSwingPct: number | null; chasePct: number | null;
    zContactPct: number | null; oContactPct: number | null;
  } | null;
  approachStats: { twoStrike: ApproachStat; highVelo: ApproachStat; breaking: ApproachStat; offspeed: ApproachStat } | null;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00Z');
  const e = new Date(end   + 'T12:00:00Z');
  const sm = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const em = e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${sm} – ${em}`;
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

// ─── Approach breakdown baselines ────────────────────────────────────────────

type ApproachBase = { mean: number; std: number; inv?: boolean };
const APPROACH_MLB: Record<string, Record<string, ApproachBase>> = {
  twoStrike: { zSwingPct: { mean: 69, std: 9 }, chasePct: { mean: 33, std: 7, inv: true }, contactPct: { mean: 73, std: 8 }, xslg: { mean: 0.47, std: 0.12 }, brlPct: { mean: 7.5, std: 4.5 } },
  highVelo:  { zSwingPct: { mean: 65, std: 9 }, chasePct: { mean: 28, std: 7, inv: true }, contactPct: { mean: 70, std: 9 }, xslg: { mean: 0.50, std: 0.14 }, brlPct: { mean: 11.0, std: 5.5 } },
  breaking:  { zSwingPct: { mean: 67, std: 9 }, chasePct: { mean: 30, std: 7, inv: true }, contactPct: { mean: 74, std: 8 }, xslg: { mean: 0.48, std: 0.13 }, brlPct: { mean: 7.0, std: 4.5 } },
  offspeed:  { zSwingPct: { mean: 67, std: 9 }, chasePct: { mean: 28, std: 7, inv: true }, contactPct: { mean: 80, std: 7 }, xslg: { mean: 0.52, std: 0.13 }, brlPct: { mean: 9.0, std: 5.0 } },
};

function getApproachBase(catKey: string, statKey: string, level: string | null): ApproachBase {
  const base = APPROACH_MLB[catKey]?.[statKey] ?? { mean: 50, std: 10 };
  const l = (level ?? '').toLowerCase();
  let adj = 0;
  const isC = statKey === 'contactPct', isQ = statKey === 'chasePct';
  if      (l.includes('aaa') || l.includes('pcl') || l.includes('intl'))                                              { if (isC) adj=-1;  if (isQ) adj=1;  }
  else if (l.includes('aa')  || l.includes('double'))                                                                  { if (isC) adj=-2;  if (isQ) adj=2;  }
  else if (l.includes('high') || l.includes('florida state') || l.includes('california') || l.includes('texas league')){ if (isC) adj=-3;  if (isQ) adj=3;  }
  else if (l.includes('low')  || l.includes('midwest') || l.includes('south atlantic'))                                { if (isC) adj=-4;  if (isQ) adj=3;  }
  else if (l.includes('fcl')  || l.includes('acl') || l.includes('rookie') || l.includes('complex'))                  { if (isC) adj=-5;  if (isQ) adj=4;  }
  return { ...base, mean: base.mean + adj };
}

// ─── Pitch colours (shared with daily card) ───────────────────────────────────

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

// ─── Zone Chart ───────────────────────────────────────────────────────────────

function HitterZoneChart({ rawDots, heightIn }: { rawDots: HitterRawDot[]; heightIn?: number }) {
  const size = 400, xMin = -1.8, xMax = 1.8, zMin = 0.5, zMax = 4.5, pad = 28;
  const w = size - pad * 2, h = size - pad * 2;
  const toSvgX = (px: number) => pad + ((px - xMin) / (xMax - xMin)) * w;
  const toSvgY = (pz: number) => pad + ((zMax - pz) / (zMax - zMin)) * h;
  const ht = heightIn ?? 72;
  const szLeft = toSvgX(-0.708), szRight = toSvgX(0.708);
  const szTop  = toSvgY((ht * 0.535) / 12), szBot = toSvgY((ht * 0.27) / 12);
  const thirdW = (szRight - szLeft) / 3, thirdH = (szBot - szTop) / 3;

  if (rawDots.length === 0)
    return <div style={{ width: size, height: size }} className="bg-bone flex items-center justify-center"><p className="text-ink-4 text-xs">No Statcast data</p></div>;

  return (
    <svg width={size} height={size} style={{ background: '#f5f3ef' }}>
      <defs>
        <linearGradient id="wfireGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff2200"/><stop offset="50%" stopColor="#ff8800"/><stop offset="100%" stopColor="#ffdd00"/>
        </linearGradient>
      </defs>
      <text x={size/2} y={18} textAnchor="middle" fontSize="10" fontWeight="600" fill="#111827">Pitches Seen</text>
      <rect x={szLeft} y={szTop} width={szRight-szLeft} height={szBot-szTop} fill="rgba(0,0,0,0.06)" stroke="#000" strokeWidth="2"/>
      {[1,2].map(i=><line key={`v${i}`} x1={szLeft+thirdW*i} y1={szTop} x2={szLeft+thirdW*i} y2={szBot} stroke="#00000033" strokeWidth="0.75"/>)}
      {[1,2].map(i=><line key={`h${i}`} x1={szLeft} y1={szTop+thirdH*i} x2={szRight} y2={szTop+thirdH*i} stroke="#00000033" strokeWidth="0.75"/>)}
      {rawDots.map((dot, i) => {
        const cx = toSvgX(dot.px), cy = toSvgY(dot.pz);
        const col = pitchColors(dot.pitchType).color;
        let visual: React.ReactNode;
        if (dot.isWhiff) {
          const s = 4;
          visual = (<><line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke="#000" strokeWidth={4} opacity="0.9"/>
            <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke="#000" strokeWidth={4} opacity="0.9"/>
            <line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke={col} strokeWidth={2.5} opacity="0.95"/>
            <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke={col} strokeWidth={2.5} opacity="0.95"/></>);
        } else if (dot.isBarrel) {
          visual = (<><text x={cx} y={cy+5} textAnchor="middle" fontSize={12} fontWeight="bold" fill="#000" stroke="#000" strokeWidth="4" strokeLinejoin="round" opacity="0.9">B</text>
            <text x={cx} y={cy+5} textAnchor="middle" fontSize={12} fontWeight="bold" fill="url(#wfireGrad)" opacity="0.95">B</text></>);
        } else if (dot.isSwing && !dot.isWhiff && dot.exitVelo !== null && dot.exitVelo >= 95) {
          visual = <text x={cx} y={cy+5} textAnchor="middle" fontSize={12} opacity="0.95">🔥</text>;
        } else if (dot.isTake) {
          visual = <circle cx={cx} cy={cy} r={3.5} fill="none" stroke={col} strokeWidth="1.5" opacity="0.75"/>;
        } else {
          visual = <circle cx={cx} cy={cy} r={3.5} fill={col} stroke="#000" strokeWidth="0.6" opacity="0.8"/>;
        }
        return <g key={i}>{visual}</g>;
      })}
      {(() => { const lx=(size-188)/2; return (<>
        <circle cx={lx+4} cy={size-10} r="3" fill="#555" opacity="0.8"/>
        <text x={lx+10} y={size-7} fontSize="7.5" fill="#000">swing</text>
        <circle cx={lx+42} cy={size-10} r="3" fill="none" stroke="#555" strokeWidth="1.5"/>
        <text x={lx+48} y={size-7} fontSize="7.5" fill="#000">take</text>
        <line x1={lx+75} y1={size-14} x2={lx+81} y2={size-7} stroke="#555" strokeWidth="1.5"/>
        <line x1={lx+81} y1={size-14} x2={lx+75} y2={size-7} stroke="#555" strokeWidth="1.5"/>
        <text x={lx+85} y={size-7} fontSize="7.5" fill="#000">whiff</text>
        <text x={lx+114} y={size-7} fontSize="7.5" fontWeight="bold" fill="url(#wfireGrad)" stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
        <text x={lx+122} y={size-7} fontSize="7.5" fill="#000">barrel</text>
        <text x={lx+152} y={size-7} fontSize="7.5">🔥</text>
        <text x={lx+160} y={size-7} fontSize="7.5" fill="#000">95+ev</text>
      </>); })()}
    </svg>
  );
}

// ─── Spray Chart ──────────────────────────────────────────────────────────────

function SprayChart({ hitDots, batSide, playerImageUrl }: { hitDots: HitterHitDot[]; batSide?: string; playerImageUrl?: string }) {
  const HOME_X = 250, HOME_Y = 450, SCALE = 1.65, FT_TO_SVG = 0.6512;
  const RF_CORNER = { x: 402, y: 298 }, LF_CORNER = { x: 98, y: 298 };
  const RF_TOP = { x: 342, y: 220 }, LF_TOP = { x: 158, y: 220 };

  const toSvg = (hcX: number, hcY: number, hitDist?: number | null) => {
    const dx = hcX - 125, dy = 208 - hcY;
    const r = Math.sqrt(dx*dx + dy*dy);
    if (hitDist && hitDist > 0 && r > 0) {
      const svgDist = hitDist * FT_TO_SVG;
      return { x: HOME_X + (dx/r)*svgDist, y: HOME_Y - (dy/r)*svgDist };
    }
    return { x: HOME_X + dx*SCALE, y: HOME_Y + (hcY - 208)*SCALE };
  };

  return (
    <svg width={400} height={400} viewBox="70 120 370 370" style={{ background: '#f5f3ef' }}>
      <text x={250} y={164} textAnchor="middle" fontSize="11" fontWeight="600" fill="#111827">Spray Angle Chart</text>
      <polygon points={`250,450 ${RF_CORNER.x},${RF_CORNER.y} ${RF_TOP.x},${RF_TOP.y} 250,186 ${LF_TOP.x},${LF_TOP.y} ${LF_CORNER.x},${LF_CORNER.y}`} fill="#f5f5f5"/>
      <line x1="250" y1="450" x2={RF_CORNER.x} y2={RF_CORNER.y} stroke="#000" strokeWidth="1.5"/>
      <line x1="250" y1="450" x2={LF_CORNER.x} y2={LF_CORNER.y} stroke="#000" strokeWidth="1.5"/>
      <text x={RF_CORNER.x-28} y={RF_CORNER.y-8} fontSize="9" fill="#000" textAnchor="middle">330ft</text>
      <text x={250} y={181} fontSize="9" fill="#000" textAnchor="middle">400ft</text>
      <text x={LF_CORNER.x+28} y={LF_CORNER.y-8} fontSize="9" fill="#000" textAnchor="middle">330ft</text>
      <circle cx={250} cy={186} r="3" fill="#000"/>
      <text x={RF_TOP.x+2} y={RF_TOP.y-6} fontSize="9" fill="#000" textAnchor="middle">375ft</text>
      <text x={LF_TOP.x-2} y={LF_TOP.y-6} fontSize="9" fill="#000" textAnchor="middle">375ft</text>
      <path d={`M ${RF_CORNER.x} ${RF_CORNER.y} L 354.6 235.5 Q ${RF_TOP.x} ${RF_TOP.y} 323.2 213.1 L 250 186 L 176.8 213.1 Q ${LF_TOP.x} ${LF_TOP.y} 145.4 235.5 L ${LF_CORNER.x} ${LF_CORNER.y}`} fill="none" stroke="#000" strokeWidth="3.5" strokeLinecap="round"/>

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
          <text x={lx} y={ly} fontSize={L===90?9:8} fontWeight={L===90?'bold':undefined} textAnchor="middle" fill="#000">{90 - L}</text>
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
      {playerImageUrl && (batSide === 'R' || batSide === 'S') && (
        <image href={playerImageUrl} x="164" y="402" width="28" height="28" preserveAspectRatio="xMidYMid meet"/>
      )}
      {playerImageUrl && (batSide === 'L' || batSide === 'S') && (
        <image href={playerImageUrl} x="308" y="402" width="28" height="28" preserveAspectRatio="xMidYMid meet"/>
      )}
      <defs>
        <linearGradient id="wscFire" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff2200"/><stop offset="50%" stopColor="#ff8800"/><stop offset="100%" stopColor="#ffdd00"/>
        </linearGradient>
      </defs>
      {hitDots.map((dot, i) => {
        const { x, y } = toSvg(dot.hcX, dot.hcY, dot.hitDistance);
        const col = pitchColors(dot.pitchType).color;
        const isHit = ['single','double','triple','home_run'].includes(dot.result.toLowerCase().replace(/\s/g,'_'));
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={8} fill={isHit ? col : 'none'} fillOpacity={isHit ? 0.88 : 0} stroke={col} strokeWidth={isHit ? 1.2 : 2}/>
            {dot.isBarrel ? (
              <text x={x} y={y+4} textAnchor="middle" fontSize="9" fontWeight="bold" fill="url(#wscFire)" stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
            ) : dot.exitVelo !== null && dot.exitVelo >= 95 ? (
              <text x={x} y={y+4} textAnchor="middle" fontSize="9" fill={isHit ? '#fff' : col} fontWeight="bold">🔥</text>
            ) : null}
          </g>
        );
      })}
      {hitDots.length === 0 && <text x={250} y={390} textAnchor="middle" fontSize="12" fill="#bbb">No balls in play</text>}
      {(() => { const ly=474, lx=250-107; return (<>
        <circle cx={lx+5} cy={ly-4} r="4" fill="#888" opacity="0.88"/>
        <text x={lx+13} y={ly} fontSize="10.5" fill="#000">hit</text>
        <circle cx={lx+48} cy={ly-4} r="4" fill="none" stroke="#888" strokeWidth="2"/>
        <text x={lx+56} y={ly} fontSize="10.5" fill="#000">out</text>
        <text x={lx+95} y={ly} fontSize="10.5" fontWeight="bold" fill="url(#wscFire)" stroke="#000" strokeWidth="2.5" strokeLinejoin="round" paintOrder="stroke">B</text>
        <text x={lx+106} y={ly} fontSize="10.5" fill="#000">barrel</text>
        <text x={lx+163} y={ly} fontSize="10.5">🔥</text>
        <text x={lx+175} y={ly} fontSize="10.5" fill="#000">95+ev</text>
      </>); })()}
    </svg>
  );
}

// ─── Weekly percentile bar ────────────────────────────────────────────────────

function calcPctW(value: number, mean: number, std: number, invert = false): number | null {
  if (std === 0) return null;
  const z  = (value - mean) / std;
  const az = Math.abs(z) / Math.SQRT2;  // standard normal CDF = 0.5*(1+erf(z/√2))
  const t  = 1 / (1 + 0.3275911 * az);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-az * az);
  const cdf = 0.5 * (1 + (z >= 0 ? 1 : -1) * erf);
  const p = Math.round(Math.min(99, Math.max(1, cdf * 100)));
  return invert ? 100 - p : p;
}

function WeeklyPercentileBar({ value, mean, std, invert = false, light, sample, minSample = 0 }: {
  value: number | null | undefined;
  mean: number | null | undefined;
  std: number | null | undefined;
  invert?: boolean;
  light: boolean;
  sample?: number;    // optional sample size (e.g. BIP count for EV stats)
  minSample?: number; // minimum sample to show bar (default 0 = always show)
}) {
  if (value == null || mean == null || std == null) return <div style={{ height: 20 }} />;
  if (sample !== undefined && sample < minSample) return <div style={{ height: 20 }} />;
  const p = calcPctW(value, mean, std, invert);
  if (p == null) return <div style={{ height: 20 }} />;

  const isBelow = p <= 49;
  const isAbove = p >= 51;
  const blues = ['#1d7ab4','#1a6196','#184f82','#174678','#163d6e'];
  const reds  = ['#9e0808','#c41515','#e82525','#f72e2e','#ff2d2d'];
  const EMPTY = light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)';
  const lastBlue = isBelow ? Math.min(4, Math.floor((49 - p) / 10)) : -1;
  const lastRed  = isAbove ? Math.min(4, Math.floor((p - 51) / 10)) : -1;
  const lc = isBelow ? blues[lastBlue] : isAbove ? reds[lastRed] : (light ? '#666' : '#888');

  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 20, paddingTop: 3, paddingBottom: 2 }}>
      <span style={{ fontSize: 10, fontWeight: 800, lineHeight: 1, whiteSpace: 'nowrap',
        minWidth: 22, textAlign: 'left', flexShrink: 0, color: isBelow ? lc : 'transparent' }}>
        {isBelow ? `${p}%` : ' '}
      </span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row-reverse', gap: 1.5 }}>
        {blues.map((color, i) => (
          <div key={i} style={{ flex: 1, height: 6, borderRadius: 2,
            background: p <= (49 - i * 10) ? color : EMPTY }} />
        ))}
      </div>
      <div style={{ width: 3, flexShrink: 0 }} />
      <div style={{ flex: 1, display: 'flex', gap: 1.5 }}>
        {reds.map((color, i) => (
          <div key={i} style={{ flex: 1, height: 6, borderRadius: 2,
            background: p >= (51 + i * 10) ? color : EMPTY }} />
        ))}
      </div>
      <span style={{ fontSize: 10, fontWeight: 800, lineHeight: 1, whiteSpace: 'nowrap',
        minWidth: 22, textAlign: 'right', flexShrink: 0, color: isAbove ? lc : 'transparent' }}>
        {isAbove ? `${p}%` : ' '}
      </span>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PITCH_ABBREV: Record<string, string> = {
  '4-Seam Fastball': 'FF', 'Sinker': 'SI', 'Cutter': 'CT', 'Changeup': 'CH',
  'Curveball': 'CU', 'Slider': 'SL', 'Sweeper': 'SW', 'Knuckle Curve': 'KC',
  'Splitter': 'SP', 'Slurve': 'SV',
};

function cleanDesc(desc: string): string {
  const d = desc.toLowerCase();
  if (d.includes('swinging_strike') || d.includes('swinging strike')) return 'Whiff';
  if (d === 'called_strike' || d === 'called strike') return 'CS';
  if (d === 'ball' || d === 'blocked_ball') return 'Ball';
  if (d.includes('foul_tip')) return 'Foul Tip';
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
    homeRun: 'HR', strikeOut: 'K', intentionalWalk: 'IBB', hitByPitch: 'HBP',
    fieldOut: 'Out', forceOut: 'FC Out', fieldersChoice: 'FC', fieldersChoiceOut: 'FC Out',
    groundedIntoDoublePlay: 'GIDP', doublePlay: 'DP', triplePlay: 'TP',
    sacFly: 'SF', sacBunt: 'SH', catcherInterference: 'CI', otherOut: 'Out',
    'Home Run': 'HR', 'Single': '1B', 'Double': '2B', 'Triple': '3B',
    'Strikeout': 'K', 'Walk': 'BB', 'Intentional Walk': 'IBB',
    'Hit By Pitch': 'HBP', 'Field Out': 'Out', 'Force Out': 'FC Out',
    'Fielders Choice': 'FC', 'Fielders Choice Out': 'FC Out',
    'Grounded Into Double Play': 'GIDP', 'Double Play': 'DP', 'Triple Play': 'TP',
    'Sac Fly': 'SF', 'Sac Bunt': 'SH', 'Catcher Interference': 'CI', 'Other Out': 'Out',
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
       'Strikeout','Field Out','Force Out','Grounded Into Double Play',
       'Double Play','Triple Play','Sac Fly','Fielders Choice',
       'Fielders Choice Out','Other Out'].includes(events))
    return 'bg-red-900 text-red-300';
  if (['walk','intent_walk','intentionalWalk','hit_by_pitch','hitByPitch',
       'Walk','Intentional Walk','Hit By Pitch'].includes(events))
    return 'bg-walk text-outcome-fg';
  return 'bg-bone text-ink-2';
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WeeklyPage({ params, searchParams }: WeeklyPageProps) {
  const { id }   = use(params);
  const { week } = use(searchParams);

  const [lastN, setLastN] = useState<number>(() => {
    const n = parseInt(week ?? '7');
    return [7, 14, 21, 28].includes(n) ? n : 7;
  });

  const [data, setData]           = useState<WeeklyData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [imageError, setImageError] = useState(0);

  // Dynamic EV baselines — start with derived estimates, replace with real data on mount
  const [mlbEv90Base,   setMlbEv90Base]   = useState<{ mean: number; std: number }>({ mean: 107.0, std: 5.0 });
  const [mlbLaHardBase, setMlbLaHardBase] = useState<{ mean: number; std: number }>({ mean: 13.5,  std: 12.0 });

  useEffect(() => {
    fetch('/api/lg-ev-baseline')
      .then(r => r.json())
      .then((d: { ev90?: { mean: number; std: number }; avgLaHard?: { mean: number; std: number } }) => {
        // Weekly uses same mean as season but wider std (more variance from small sample)
        if (d.ev90?.mean)      setMlbEv90Base({ mean: d.ev90.mean,      std: Math.max(d.ev90.std + 1.5, 5.0) });
        if (d.avgLaHard?.mean) setMlbLaHardBase({ mean: d.avgLaHard.mean, std: Math.max(d.avgLaHard.std + 3.0, 12.0) });
      })
      .catch(() => { /* keep defaults */ });
  }, []);

  // Resolve player from DB for image
  const player = (() => {
    const byId = getPlayerById(parseInt(id));
    if (byId) return byId;
    return getPlayerByName(decodeURIComponent(id)) ?? null;
  })();

  const playerId = data?.playerId ?? (player ? player.player_id : null);

  const imageSources = [
    playerId ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_426,q_auto:best/v1/people/${playerId}/headshot/silo/current` : null,
    playerId ? getMLBStaticPlayerImage(playerId, { width: 426 }) : null,
    playerId ? getESPNPlayerImage(playerId) : null,
    '/api/placeholder/400/400',
  ].filter(Boolean) as string[];
  const currentImage = imageSources[Math.min(imageError, imageSources.length - 1)];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pid = player?.player_id ?? parseInt(id);
      const res = await fetch(`/api/hitter-weekly?playerId=${pid}&lastN=${lastN}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [lastN, id, player?.player_id]);

  useEffect(() => { load(); }, [load]);

  const displayName = data?.playerName ?? player?.full_name ?? decodeURIComponent(id);
  const teamLogo = (data?.team ? getMLBTeamLogoUrl(data.team) : null) ?? (player?.team ? getMLBTeamLogoUrl(player.team) : null);
  const flag = getCountryFlagUrl(data?.team ?? player?.team ?? null, 80);

  const totals = data?.totals;
  const ba = totals && totals.ab > 0 ? (totals.h / totals.ab).toFixed(3) : '—';

  // Stats grid rows — each cell may carry optional percentile baseline
  type StatCell = {
    label: string; value: string | number;
    num?: number | null; pctMean?: number | null; pctStd?: number | null; pctInv?: boolean;
    bip?: boolean; // true → use hitDots.length with min 50 BIP before showing percentile
  };

  const d     = data?.discipline;
  const level = data?.level ?? null;

  // ── Level-aware baselines (mirrors season card's getLG) ───────────────────
  type WkBaseline = { mean: number; std: number };
  type WkBaselines = {
    maxEv: WkBaseline; ev90: WkBaseline; avgEv: WkBaseline;
    barrelPct: WkBaseline; avgLaHard: WkBaseline; avgBatSpeed: WkBaseline;
    swingPct: WkBaseline; zSwingPct: WkBaseline; chasePct: WkBaseline;
    zContactPct: WkBaseline; oContactPct: WkBaseline;
  };
  // Savant 2025 real data: MLB avg EV=88.6, max EV=111.0(season)/~109(weekly), barrel%=9.4, bat speed=71.8
  // AAA reads identical to MLB in Statcast hardware (confirmed: 88.65 avg, 111.15 max).
  // Weekly maxEv ~2 mph lower than season (fewer BIP per window).
  // AA/High-A/Low-A: estimated ~1.5/3/4.5 mph below MLB; no per-level Savant leaderboard available.
  // NOTE: ev90 and avgLaHard values here are fallback-only — dynEv90/dynLaHard override them
  //       with real-data means from /api/lg-ev-baseline (computed across all qualifying MLB batters).
  const WK_MLB:    WkBaselines = { maxEv:{mean:109.0,std:4.0}, ev90:{mean:107.0,std:5.0}, avgEv:{mean:88.5,std:3.2}, barrelPct:{mean:9.4,std:4.8}, avgLaHard:{mean:13.5,std:12.0}, avgBatSpeed:{mean:71.5,std:3.5}, swingPct:{mean:47.0,std:5.5}, zSwingPct:{mean:68.0,std:8.5}, chasePct:{mean:27.5,std:6.5}, zContactPct:{mean:84.0,std:7.0}, oContactPct:{mean:59.0,std:9.0} };
  const WK_AAA:    WkBaselines = { maxEv:{mean:108.5,std:4.2}, ev90:{mean:106.5,std:5.2}, avgEv:{mean:88.0,std:3.4}, barrelPct:{mean:9.0,std:4.8}, avgLaHard:{mean:13.0,std:12.0}, avgBatSpeed:{mean:71.0,std:3.8}, swingPct:{mean:47.5,std:6.0}, zSwingPct:{mean:67.0,std:9.0}, chasePct:{mean:28.5,std:7.0}, zContactPct:{mean:82.0,std:8.0}, oContactPct:{mean:57.0,std:10.0} };
  const WK_AA:     WkBaselines = { maxEv:{mean:109.5,std:4.5}, ev90:{mean:105.0,std:5.5}, avgEv:{mean:87.5,std:3.5}, barrelPct:{mean:8.0,std:4.5}, avgLaHard:{mean:12.5,std:12.0}, avgBatSpeed:{mean:70.5,std:3.9}, swingPct:{mean:47.0,std:6.5}, zSwingPct:{mean:66.0,std:9.0}, chasePct:{mean:29.0,std:7.2}, zContactPct:{mean:81.5,std:8.0}, oContactPct:{mean:56.0,std:10.5} };
  const WK_HIGH_A: WkBaselines = { maxEv:{mean:108.0,std:4.8}, ev90:{mean:103.5,std:5.8}, avgEv:{mean:86.5,std:3.7}, barrelPct:{mean:7.5,std:4.5}, avgLaHard:{mean:12.0,std:12.0}, avgBatSpeed:{mean:70.0,std:4.0}, swingPct:{mean:46.5,std:7.0}, zSwingPct:{mean:65.5,std:9.2}, chasePct:{mean:29.5,std:7.5}, zContactPct:{mean:81.0,std:8.5}, oContactPct:{mean:55.5,std:10.8} };
  const WK_LOW_A:  WkBaselines = { maxEv:{mean:107.0,std:5.0}, ev90:{mean:103.0,std:6.0}, avgEv:{mean:85.5,std:3.8}, barrelPct:{mean:7.0,std:4.5}, avgLaHard:{mean:11.5,std:12.0}, avgBatSpeed:{mean:69.5,std:4.0}, swingPct:{mean:46.0,std:7.5}, zSwingPct:{mean:66.0,std:9.5}, chasePct:{mean:29.5,std:7.5}, zContactPct:{mean:80.0,std:9.0}, oContactPct:{mean:55.0,std:11.0} };
  const WK_ROOKIE: WkBaselines = { maxEv:{mean:102.5,std:5.5}, ev90:{mean:99.0,std:6.5},  avgEv:{mean:83.5,std:4.0}, barrelPct:{mean:6.5,std:5.0}, avgLaHard:{mean:11.0,std:12.0}, avgBatSpeed:{mean:69.0,std:4.2}, swingPct:{mean:45.5,std:8.0}, zSwingPct:{mean:64.5,std:9.5}, chasePct:{mean:30.5,std:8.0}, zContactPct:{mean:79.0,std:9.5}, oContactPct:{mean:54.0,std:11.5} };
  const getWkLG = (lv: string | null): WkBaselines => {
    if (!lv) return WK_MLB;
    const l = lv.toLowerCase();
    if (l.includes('aaa') || l.includes('triple')) return WK_AAA;
    if (l === 'aa' || l.includes(' aa') || l.includes('double')) return WK_AA;
    if (l.includes('high') || l.includes('florida state')) return WK_HIGH_A;
    if (l.includes('low') || l.includes('single')) return WK_LOW_A;
    if (l.includes('fcl') || l.includes('acl') || l.includes('rookie') || l.includes('complex')) return WK_ROOKIE;
    return WK_MLB;
  };
  const LG = getWkLG(level);

  // Dynamic overrides for ev90 and avgLaHard — scale MLB baseline to this level
  const dynEv90: WkBaseline = (() => {
    const l = (level ?? '').toLowerCase();
    let delta = 0, stdAdd = 0;
    if (l.includes('aaa') || l.includes('pcl') || l.includes('intl'))                     { delta = 0.5; stdAdd = 0.2; }
    else if (l.includes('aa') || l.includes('double'))                                     { delta = 2.5; stdAdd = 0.5; }
    else if (l.includes('high') || l.includes('florida state') || l.includes('california') || l.includes('texas league') || l.includes('southern league')) { delta = 4.5; stdAdd = 0.8; }
    else if (l.includes('low') || l.includes('midwest') || l.includes('south atlantic'))  { delta = 6.0; stdAdd = 1.0; }
    else if (l.includes('rookie') || l.includes('acl') || l.includes('fcl') || l.includes('complex')) { delta = 7.5; stdAdd = 1.5; }
    return { mean: mlbEv90Base.mean - delta, std: mlbEv90Base.std + stdAdd };
  })();
  const dynLaHard: WkBaseline = (() => {
    const l = (level ?? '').toLowerCase();
    let delta = 0;
    if (l.includes('aaa') || l.includes('pcl') || l.includes('intl'))                     delta = 0.5;
    else if (l.includes('aa') || l.includes('double'))                                     delta = 1.0;
    else if (l.includes('high') || l.includes('florida state') || l.includes('california') || l.includes('texas league') || l.includes('southern league')) delta = 1.5;
    else if (l.includes('low') || l.includes('midwest') || l.includes('south atlantic'))  delta = 2.0;
    else if (l.includes('rookie') || l.includes('acl') || l.includes('fcl') || l.includes('complex')) delta = 3.0;
    return { mean: mlbLaHardBase.mean - delta, std: mlbLaHardBase.std };
  })();

  // Computed rate stats
  const singles  = (totals?.h ?? 0) - (totals?.doubles ?? 0) - (totals?.triples ?? 0) - (totals?.hr ?? 0);
  const avgVal   = totals && totals.ab > 0 ? totals.h / totals.ab : null;
  const obpVal   = totals && (totals.ab + totals.bb) > 0 ? (totals.h + totals.bb) / (totals.ab + totals.bb) : null;
  const slgVal   = totals && totals.ab > 0
    ? (singles + 2 * (totals.doubles ?? 0) + 3 * (totals.triples ?? 0) + 4 * (totals.hr ?? 0)) / totals.ab
    : null;
  const opsVal   = obpVal != null && slgVal != null ? obpVal + slgVal : null;

  const ratesRow: StatCell[] = [
    { label: 'AVG', value: avgVal != null ? avgVal.toFixed(3) : '—' },
    { label: 'OBP', value: obpVal != null ? obpVal.toFixed(3) : '—' },
    { label: 'SLG', value: slgVal != null ? slgVal.toFixed(3) : '—' },
    { label: 'OPS', value: opsVal != null ? opsVal.toFixed(3) : '—' },
    { label: 'HR',  value: totals?.hr  ?? '—' },
    { label: 'RBI', value: totals?.rbi ?? '—' },
  ];

  const statsRow1: StatCell[] = [
    { label: 'G',   value: data?.games?.length ?? '—' },
    { label: 'AB',  value: totals?.ab  ?? '—' },
    { label: 'H',   value: totals?.h   ?? '—' },
    { label: 'BB',  value: totals?.bb  ?? '—' },
    { label: 'K',   value: totals?.k   ?? '—' },
    { label: 'SB',  value: totals?.sb  ?? '—' },
  ];

  // Statcast section cells — level-aware baselines (ev90 + avgLaHard use dynamic real-data baseline)
  const statcastCells: StatCell[] = [
    { label: 'Max EV',  value: data?.maxEv      != null ? data.maxEv.toFixed(1)           : '—', num: data?.maxEv      ?? null, pctMean: LG.maxEv.mean,       pctStd: LG.maxEv.std,       bip: true },
    { label: 'EV90',    value: data?.ev90        != null ? data.ev90.toFixed(1)            : '—', num: data?.ev90       ?? null, pctMean: dynEv90.mean,         pctStd: dynEv90.std,         bip: true },
    { label: 'Avg EV',  value: data?.avgEv       != null ? data.avgEv.toFixed(1)           : '—', num: data?.avgEv      ?? null, pctMean: LG.avgEv.mean,        pctStd: LG.avgEv.std,        bip: true },
    { label: 'Brl%',    value: data?.barrelPct   != null ? `${data.barrelPct.toFixed(1)}%` : '—', num: data?.barrelPct  ?? null, pctMean: LG.barrelPct.mean,    pctStd: LG.barrelPct.std,    bip: true },
    { label: '95+ LA',  value: data?.avgLaHard   != null ? `${data.avgLaHard.toFixed(1)}°` : '—', num: data?.avgLaHard  ?? null, pctMean: dynLaHard.mean,       pctStd: dynLaHard.std,       bip: true },
    // Avg BS only shown for MLB — Savant bat-tracking doesn't cover MiLB
    ...(level?.toUpperCase() === 'MLB' ? [
      { label: 'Avg BS', value: data?.avgBatSpeed != null ? data.avgBatSpeed.toFixed(1) : '—', num: data?.avgBatSpeed ?? null, pctMean: LG.avgBatSpeed.mean, pctStd: LG.avgBatSpeed.std },
    ] : []),
  ];

  // Discipline section cells — level-aware baselines
  const disciplineCells: StatCell[] = [
    { label: 'Swing%',     value: d?.swingPct    != null ? d.swingPct.toFixed(1)    + '%' : '—', num: d?.swingPct    ?? null, pctMean: LG.swingPct.mean,    pctStd: LG.swingPct.std    },
    { label: 'Z-Swing%',   value: d?.zSwingPct   != null ? d.zSwingPct.toFixed(1)   + '%' : '—', num: d?.zSwingPct   ?? null, pctMean: LG.zSwingPct.mean,   pctStd: LG.zSwingPct.std   },
    { label: 'Z-Contact%', value: d?.zContactPct != null ? d.zContactPct.toFixed(1) + '%' : '—', num: d?.zContactPct ?? null, pctMean: LG.zContactPct.mean, pctStd: LG.zContactPct.std },
    { label: 'Chase%',     value: d?.chasePct    != null ? d.chasePct.toFixed(1)    + '%' : '—', num: d?.chasePct    ?? null, pctMean: LG.chasePct.mean,    pctStd: LG.chasePct.std,   pctInv: true },
    { label: 'O-Contact%', value: d?.oContactPct != null ? d.oContactPct.toFixed(1) + '%' : '—', num: d?.oContactPct ?? null, pctMean: LG.oContactPct.mean, pctStd: LG.oContactPct.std },
  ];

  // Bio
  const age = calcAge(data?.playerBirthDate ?? null);
  const bioParts: string[] = [];
  if (data?.playerHeight) bioParts.push(data.playerHeight);
  if (data?.playerWeight) bioParts.push(`${data.playerWeight} lbs`);
  if (age !== null) bioParts.push(`Age ${age}`);
  if (data?.playerBatSide && data?.playerPitchHand) bioParts.push(`${data.playerBatSide}/${data.playerPitchHand}`);

  // Light mode + capture
  const [light, setLight]       = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [copied, setCopied]     = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const captureCard = async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    const { toPng } = await import('html-to-image');
    return toPng(cardRef.current, {
      pixelRatio: 2,
      cacheBust: true,
      filter: (node) => !(node as HTMLElement).classList?.contains('export-ignore'),
    });
  };

  const handleDownload = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const dataUrl = await captureCard();
      if (!dataUrl) return;
      const name = (data?.playerName ?? displayName).replace(/\s+/g, '-');
      const a = document.createElement('a');
      a.download = `${name}-weekly.png`;
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
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) { console.error('copy failed', e); }
    finally { setCapturing(false); }
  };

  const BW = '2px solid #000000';
  const th = {
    statsBg:      light ? '#ffffff' : '#1a1a1a',
    banner:       light ? '#374151' : '#000000',
    label:        light ? '#6b7280' : '#777777',
    fg:           light ? '#000000' : '#ffffff',
    divider:      'divide-ink/10',
    border:       'border-ink/10',
    statsBoxStyle:light ? { border: BW } as React.CSSProperties
                        : { border: '1px solid rgba(255,255,255,0.2)' } as React.CSSProperties,
    btnFg:        light ? 'rgba(0,0,0,0.55)'  : 'rgba(255,255,255,0.6)',
    btnBg:        light ? 'rgba(0,0,0,0.05)'  : 'rgba(255,255,255,0.08)',
    btnBorder:    light ? 'rgba(0,0,0,0.18)'  : 'rgba(255,255,255,0.18)',
    atBatStyle:   light ? { background: '#ffffff', border: '1px solid #d4d4d4', borderLeft: '4px solid #ff2d2d', borderRadius: 4 } as React.CSSProperties : {} as React.CSSProperties,
  };

  return (
    <div className="min-h-screen bg-page text-deep-fg" data-light={light ? 'true' : undefined}>
      {/* Nav */}
      <header className="bg-page border-b border-ink/20">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="text-ink-3 hover:text-ink font-medium text-sm transition-colors">Hitters</Link>
          <div className="flex items-center gap-2">
            {player && (
              <Link href={`/player/${id}`} className="px-3 py-1.5 bg-panel hover:bg-bone border border-ink/20 text-ink-3 hover:text-ink text-xs font-semibold transition-colors tracking-wide">
                Season Stats
              </Link>
            )}
            <Link href={`/player/${id}/daily`} className="px-3 py-1.5 bg-panel hover:bg-bone border border-ink/20 text-ink-3 hover:text-ink text-xs font-semibold transition-colors tracking-wide">
              Daily Card
            </Link>
          </div>
          <Link href="/pitchers" className="text-ink-3 hover:text-ink font-medium text-sm transition-colors">Pitchers</Link>
        </div>
      </header>

      {/* Last N Games selector */}
      <div className="flex items-center justify-center gap-3 py-3 border-b border-ink/20 bg-page">
        <span className="text-xs text-ink-4">Window:</span>
        <div className="flex overflow-hidden border border-ink/20">
          {[7, 14, 21, 28].map(n => (
            <button
              key={n}
              onClick={() => setLastN(n)}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                lastN === n
                  ? 'bg-deep text-deep-fg'
                  : 'bg-panel text-ink-3 hover:text-ink'
              }`}
            >
              L{n}
            </button>
          ))}
        </div>
        {data && (
          <span className="text-sm font-semibold text-deep-fg">
            Last {lastN} Games: {formatWeekLabel(data.weekStart, data.weekEnd)}
          </span>
        )}
      </div>

      <div className="mx-auto px-4 py-6" style={{ maxWidth: 960 }}>
        <div className="mb-6">
        <div ref={cardRef} className="bg-page p-6 w-full" style={{ position: 'relative' }}>

          {/* Export buttons */}
          {!loading && (data || error) && (
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
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: capturing ? 'wait' : 'pointer',
                  background: th.btnBg, border: `1px solid ${th.btnBorder}`,
                  color: th.btnFg, borderRadius: 3, transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
              >
                {capturing ? '…' : '↓ PNG'}
              </button>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center gap-2 mb-3">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent animate-spin"/>
              <span className="text-ink-3 text-xs">Loading week...</span>
            </div>
          )}
          {!loading && error && (
            <div className="bg-bone p-2 mb-3 text-center">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          {/* ── TOP ROW: [Watermark] [Headshot] [Name/Bio/Date] [Logo] [Spacer] ── */}
          <div className="flex gap-3 items-stretch mx-auto" style={{ maxWidth: 960, marginBottom: 12 }}>
            {/* Col 0: Watermark */}
            <div className="flex-shrink-0 flex flex-col items-end justify-center" style={{ width: 76 }}>
              <div className="font-display italic text-[10px] uppercase text-right tracking-[0.08em]" style={{ color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>By @Piratefan003</div>
              <div className="text-[8px] leading-tight mt-0.5 text-right" style={{ color: light ? '#000000' : 'var(--color-ink-4)' }}>
                Data: MLB Statcast<br/>Baseball Savant · MLB Stats API
              </div>
            </div>

            {/* Col 1: Headshot */}
            <div className="flex-shrink-0" style={{ width: 150 }}>
              {flag && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={flag} alt={data?.team ?? ''} className="w-8 h-[22px] object-cover mb-1"/>
              )}
              <div className="w-full overflow-hidden bg-page" style={{ height: 150 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentImage}
                  alt={displayName}
                  className="w-full h-full object-cover object-top"
                  onError={() => setImageError(e => Math.min(e + 1, imageSources.length - 1))}
                />
              </div>
            </div>

            {/* Col 2: Name / Bio / Date range */}
            <div className="flex-1 flex flex-col items-center justify-center text-center min-w-0">
              <h1 className="font-display text-2xl uppercase tracking-[0.02em] mb-1">{displayName}</h1>
              {bioParts.length > 0 && (
                <p className="text-sm mb-2" style={{ color: light ? '#000000' : 'var(--color-ink-2)' }}>{bioParts.join(' · ')}</p>
              )}
              <div className="flex flex-wrap items-center justify-center gap-x-2 text-xs" style={{ color: light ? '#000000' : 'var(--color-ink-4)' }}>
                {data?.team && <span className="font-bold" style={{ color: light ? '#000000' : 'var(--color-deep-fg)' }}>{data.team}</span>}
                {data && <><span>·</span><span>{formatWeekLabel(data.weekStart, data.weekEnd)}</span></>}
                {totals && <><span>·</span><span>AVG {ba}</span></>}
              </div>
            </div>

            {/* Col 3: Team Logo */}
            <div className="flex-shrink-0 flex flex-col items-center justify-center" style={{ width: 150 }}>
              {teamLogo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={teamLogo} alt={data?.team ?? ''} className="object-contain" style={{ width: 115, height: 115 }} />
              )}
            </div>

            {/* Col 4: Spacer */}
            <div className="flex-shrink-0" style={{ width: 76 }} />
          </div>

          {/* STATS — full width */}
          {totals && (
            <div className="w-full max-w-full mx-auto mb-2" style={th.statsBoxStyle}>
              <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`}
                   style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                Last {lastN} Games
              </div>
              {/* Rates + counting stats — 2 rows (matches season card) */}
              {[ratesRow, statsRow1].map((row, ri) => (
                <div key={ri} className={`grid grid-cols-6 divide-x ${th.divider} border-b ${th.border}`} style={{ background: th.statsBg }}>
                  {row.map(s => (
                    <div key={s.label} className="text-center px-1 py-1.5">
                      <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                      <div className="font-bold font-display tabular-nums" style={{ fontSize: 19, color: th.fg, lineHeight: '22px' }}>{String(s.value)}</div>
                    </div>
                  ))}
                </div>
              ))}
              {/* Statcast row */}
              {data && (data.maxEv != null || data.avgEv != null || data.avgBatSpeed != null) && (
                <div className={`grid grid-cols-${statcastCells.length} divide-x ${th.divider} border-b ${th.border}`} style={{ background: th.statsBg }}>
                  {statcastCells.map(s => (
                    <div key={s.label} className="text-center px-1 py-1.5">
                      <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                      <div className="font-bold font-display tabular-nums" style={{ fontSize: 19, color: th.fg, lineHeight: '22px' }}>{String(s.value)}</div>
                      {(s.pctMean != null && s.pctStd != null) ? (
                        <WeeklyPercentileBar value={s.num} mean={s.pctMean} std={s.pctStd} invert={s.pctInv ?? false} light={light}
                          sample={s.bip ? (data?.hitDots?.length ?? 0) : undefined}
                          minSample={s.bip ? 5 : 0} />
                      ) : <div style={{ height: 20 }} />}
                    </div>
                  ))}
                </div>
              )}
              {/* Discipline row */}
              {d && (
                <div className={`grid grid-cols-5 divide-x ${th.divider}`} style={{ background: th.statsBg }}>
                  {disciplineCells.map(s => (
                    <div key={s.label} className="text-center px-1 py-1.5">
                      <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                      <div className="font-bold font-display tabular-nums" style={{ fontSize: 19, color: th.fg, lineHeight: '22px' }}>{String(s.value)}</div>
                      {(s.pctMean != null && s.pctStd != null) ? (
                        <WeeklyPercentileBar value={s.num} mean={s.pctMean} std={s.pctStd} invert={s.pctInv ?? false} light={light} />
                      ) : <div style={{ height: 20 }} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── BOTTOM SECTIONS ── */}
          {!loading && (data?.games?.length ?? 0) > 0 ? (
            <div className="flex flex-col gap-4">

              {/* APPROACH BREAKDOWN */}
              {data?.approachStats && (
              <div style={light ? { border: BW } as React.CSSProperties : {}}>
                <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`}
                     style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                  Approach Breakdown
                </div>
                <div className={`grid grid-cols-4 divide-x ${th.divider}`} style={{ background: th.statsBg }}>
                  {([
                    { key: 'twoStrike' as const, label: '2-Strike' },
                    { key: 'highVelo'  as const, label: 'vs 95+ mph' },
                    { key: 'breaking'  as const, label: '83+ Breaking' },
                    { key: 'offspeed'  as const, label: 'vs Offspeed' },
                  ] as const).map(({ key, label }) => {
                    const s = data!.approachStats![key];
                    const cells = [
                      { label: 'Z-Swing%', value: s.zSwingPct,  base: getApproachBase(key, 'zSwingPct',  level), sample: s.pitches, minSample: 15 },
                      { label: 'Chase%',   value: s.chasePct,   base: getApproachBase(key, 'chasePct',   level), sample: s.pitches, minSample: 15 },
                      { label: 'Contact%', value: s.contactPct, base: getApproachBase(key, 'contactPct', level), sample: s.pitches, minSample: 15 },
                      s.xslg != null
                        ? { label: 'xSLG', value: s.xslg,   base: getApproachBase(key, 'xslg',   level), sample: s.bip, minSample: 5, fmt: (v: number) => v.toFixed(3) }
                        : { label: 'BRL%', value: s.brlPct, base: getApproachBase(key, 'brlPct', level), sample: s.bip, minSample: 5, fmt: (v: number) => `${v.toFixed(1)}%` },
                    ];
                    return (
                      <div key={key} className="flex flex-col">
                        <div className={`text-center px-2 py-1 border-b ${th.border}`}>
                          <span className="text-[13px] font-bold uppercase tracking-wide" style={{ color: th.label }}>{label}</span>
                          {s.pitches > 0 && (
                            <span className="text-[11px] ml-1" style={{ color: light ? '#777' : 'var(--color-ink-5)' }}>({s.pitches}p)</span>
                          )}
                        </div>
                        <div className={`grid grid-cols-2 divide-x ${th.divider}`}>
                          {cells.map(({ label: cl, value, base, sample, minSample, fmt }) => (
                            <div key={cl} className={`text-center px-1 py-1 border-b ${th.border}`}>
                              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{cl}</div>
                              <div className="font-bold font-display tabular-nums" style={{ fontSize: 18, color: th.fg, lineHeight: '22px' }}>
                                {value != null ? (fmt ? fmt(value) : `${value}%`) : '—'}
                              </div>
                              <WeeklyPercentileBar value={value} mean={base.mean} std={base.std} invert={base.inv ?? false} light={light} sample={sample} minSample={minSample} />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              )}

              {/* CHARTS — full width, side by side */}
              <div style={light ? { border: BW } as React.CSSProperties : {}}>
                <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`}
                     style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                  Charts
                </div>
                <div className="flex gap-3 justify-center flex-wrap" style={{ padding: light ? 12 : 0 }}>
                  <HitterZoneChart rawDots={data!.rawDots} />
                  <SprayChart hitDots={data!.hitDots} batSide={data?.playerBatSide ?? undefined} playerImageUrl={currentImage} />
                </div>
              </div>
            </div>
          ) : !loading && (
            <div className="flex items-center justify-center py-12 text-sm" style={{ color: light ? '#000000' : 'var(--color-ink-4)' }}>
              No games found for this week.
            </div>
          )}

        </div>
        </div>
      </div>
    </div>
  );
}
