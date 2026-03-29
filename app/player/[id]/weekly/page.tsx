'use client';

import React, { use, useState, useEffect, useCallback } from 'react';
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

interface TopAtBat {
  atBatNum: number; pitcherName: string; pitcherHand: string; result: string;
  pitches: AtBatPitch[];
  date: string; opponent: string | null; isHome: boolean | null;
  maxEv: number | null; isBarrel: boolean; isHit: boolean; score: number;
}

interface WeeklyData {
  playerId: number; playerName: string | null; playerHeight: string | null;
  playerWeight: number | null; playerBirthDate: string | null;
  playerBatSide: string | null; playerPitchHand: string | null;
  weekStart: string; weekEnd: string;
  games: GameResult[]; topAtBats: TopAtBat[]; totals: WeeklyTotals | null;
  rawDots: HitterRawDot[]; hitDots: HitterHitDot[];
  barrels: number; avgBatSpeed: number | null; ev90: number | null; team: string | null;
  discipline: { zSwingPct: number | null; chasePct: number | null; zContactPct: number | null; oContactPct: number | null; } | null;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

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
  const size = 280, xMin = -1.8, xMax = 1.8, zMin = 0.5, zMax = 4.5, pad = 28;
  const w = size - pad * 2, h = size - pad * 2;
  const toSvgX = (px: number) => pad + ((px - xMin) / (xMax - xMin)) * w;
  const toSvgY = (pz: number) => pad + ((zMax - pz) / (zMax - zMin)) * h;
  const ht = heightIn ?? 72;
  const szLeft = toSvgX(-0.708), szRight = toSvgX(0.708);
  const szTop  = toSvgY((ht * 0.535) / 12), szBot = toSvgY((ht * 0.27) / 12);
  const thirdW = (szRight - szLeft) / 3, thirdH = (szBot - szTop) / 3;

  if (rawDots.length === 0)
    return <div style={{ width: size, height: size }} className="bg-[#d1d5db] flex items-center justify-center"><p className="text-gray-500 text-xs">No Statcast data</p></div>;

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
    <svg width={280} height={280} viewBox="70 120 370 370" style={{ background: '#f5f3ef' }}>
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
      <path d="M 341.9 358.1 A 130 130 0 0 0 158.1 358.1" fill="none" stroke="#000" strokeWidth="1"/>
      <polygon points="250,450 291,409 250,367 209,409" fill="none" stroke="#000" strokeWidth="1.5"/>
      <circle cx="250" cy="411" r="12" fill="none" stroke="#000" strokeWidth="1"/>
      <rect x="246" y="408.5" width="8" height="3" rx="0.5" fill="#333"/>
      <rect x="287" y="405" width="8" height="8" fill="#333"/>
      <g transform="rotate(45,250,367)"><rect x="246" y="363" width="8" height="8" fill="#333"/></g>
      <rect x="205" y="405" width="8" height="8" fill="#333"/>
      <path d="M 243 453 L 257 453 L 257 447 L 250 442 L 243 447 Z" fill="#333"/>
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
    strikeout: 'K', walk: 'BB', intent_walk: 'IBB', hit_by_pitch: 'HBP',
    field_out: 'Out', force_out: 'FC Out', fielders_choice: 'FC',
    grounded_into_double_play: 'GIDP', sac_fly: 'SF', sac_bunt: 'SH',
    other_out: 'Out', double_play: 'DP',
  };
  return map[events] || events.replace(/_/g, ' ');
}

function resultColor(events: string): string {
  if (['single','double','triple','home_run'].includes(events)) return 'bg-green-700 text-green-200';
  if (['strikeout','field_out','force_out','grounded_into_double_play',
       'double_play','sac_fly','sac_bunt','other_out','fielders_choice'].includes(events))
    return 'bg-red-900 text-red-300';
  if (['walk','intent_walk','hit_by_pitch'].includes(events)) return 'bg-blue-800 text-blue-200';
  return 'bg-gray-700 text-gray-300';
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WeeklyPage({ params, searchParams }: WeeklyPageProps) {
  const { id }   = use(params);
  const { week } = use(searchParams);

  const [weekStart, setWeekStart] = useState<string>(() => {
    if (week) return week;
    return getMondayOf(new Date().toISOString().slice(0, 10));
  });
  const weekEnd = addDays(weekStart, 6);

  const [data, setData]           = useState<WeeklyData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [imageError, setImageError] = useState(0);

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
      const res = await fetch(`/api/hitter-weekly?playerId=${pid}&weekStart=${weekStart}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [weekStart, id, player?.player_id]);

  useEffect(() => { load(); }, [load]);

  const displayName = data?.playerName ?? player?.full_name ?? decodeURIComponent(id);
  const teamLogo = (data?.team ? getMLBTeamLogoUrl(data.team) : null) ?? (player?.team ? getMLBTeamLogoUrl(player.team) : null);
  const flag = getCountryFlagUrl(data?.team ?? player?.team ?? null, 80);

  const totals = data?.totals;
  const ba = totals && totals.ab > 0 ? (totals.h / totals.ab).toFixed(3) : '—';

  // Stats grid rows
  const statsRow1 = [
    { label: 'AB',    value: totals?.ab  ?? '—' },
    { label: 'H',     value: totals?.h   ?? '—' },
    { label: 'HR',    value: totals?.hr  ?? '—' },
    { label: 'RBI',   value: totals?.rbi ?? '—' },
    { label: 'BB',    value: totals?.bb  ?? '—' },
    { label: 'BRLS',  value: data?.barrels ?? '—' },
  ];
  const statsRow2 = [
    { label: 'K',     value: totals?.k   ?? '—' },
    { label: '2B',    value: totals?.doubles ?? '—' },
    { label: '3B',    value: totals?.triples ?? '—' },
    { label: 'PA',    value: totals?.pa  ?? '—' },
    { label: 'SB',    value: totals?.sb  ?? '—' },
    data?.avgBatSpeed != null
      ? { label: 'AVG BS', value: data.avgBatSpeed.toFixed(1) }
      : { label: 'EV90',   value: data?.ev90?.toFixed(1) ?? '—' },
  ];
  const d = data?.discipline;
  const pa = totals?.pa ?? 0;
  const statsRow3 = [
    { label: 'ZSWG%',  value: d?.zSwingPct   != null ? d.zSwingPct.toFixed(1)   + '%' : '—' },
    { label: 'CHASE%', value: d?.chasePct     != null ? d.chasePct.toFixed(1)    + '%' : '—' },
    { label: 'ZCON%',  value: d?.zContactPct  != null ? d.zContactPct.toFixed(1) + '%' : '—' },
    { label: 'OCON%',  value: d?.oContactPct  != null ? d.oContactPct.toFixed(1) + '%' : '—' },
    { label: 'K%',     value: pa > 0 && totals?.k   != null ? ((totals.k   / pa) * 100).toFixed(1) + '%' : '—' },
    { label: 'BB%',    value: pa > 0 && totals?.bb  != null ? ((totals.bb  / pa) * 100).toFixed(1) + '%' : '—' },
  ];

  // Bio
  const age = calcAge(data?.playerBirthDate ?? null);
  const bioParts: string[] = [];
  if (data?.playerHeight) bioParts.push(data.playerHeight);
  if (data?.playerWeight) bioParts.push(`${data.playerWeight} lbs`);
  if (age !== null) bioParts.push(`Age ${age}`);
  if (data?.playerBatSide && data?.playerPitchHand) bioParts.push(`${data.playerBatSide}/${data.playerPitchHand}`);

  return (
    <div className="min-h-screen bg-[#0a0b10] text-white">
      {/* Nav */}
      <header className="bg-[#0f1117] border-b border-white/[0.06]">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="text-gray-400 hover:text-white font-medium text-sm transition-colors">Hitters</Link>
          <div className="flex items-center gap-2">
            {player && (
              <Link href={`/player/${id}`} className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-gray-400 hover:text-white text-xs font-semibold transition-colors tracking-wide">
                Season Stats
              </Link>
            )}
            <Link href={`/player/${id}/daily`} className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-gray-400 hover:text-white text-xs font-semibold transition-colors tracking-wide">
              Daily Card
            </Link>
          </div>
          <Link href="/pitchers" className="text-gray-400 hover:text-white font-medium text-sm transition-colors">Pitchers</Link>
        </div>
      </header>

      {/* Week navigation */}
      <div className="flex items-center justify-center gap-4 py-3 border-b border-white/[0.06] bg-[#0f1117]">
        <button
          onClick={() => setWeekStart(w => addDays(w, -7))}
          className="px-3 py-1 text-xs text-gray-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors"
        >
          ← Prev Week
        </button>
        <span className="text-sm font-semibold text-white">Week of {formatWeekLabel(weekStart, weekEnd)}</span>
        <button
          onClick={() => setWeekStart(w => addDays(w, 7))}
          className="px-3 py-1 text-xs text-gray-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors"
        >
          Next Week →
        </button>
      </div>

      <div className="mx-auto px-6 py-6" style={{ maxWidth: 1400 }}>
        <div className="flex justify-center mb-6">
        <div className="bg-[#0f1117] p-6 inline-block border border-white/[0.05]">

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center gap-2 mb-3">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"/>
              <span className="text-gray-400 text-xs">Loading week...</span>
            </div>
          )}
          {!loading && error && (
            <div className="bg-[#171b24] p-2 mb-3 text-center">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          {/* ── TOP ROW: photo + info ── */}
          <div className="flex gap-4 items-start mb-4">

            {/* Left: player image + byline */}
            <div className="flex-shrink-0 flex flex-col items-center w-[220px]">
              {flag && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={flag} alt={data?.team ?? ''} className="w-8 h-[22px] object-cover mb-1"/>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={currentImage}
                alt={displayName}
                className="h-auto max-w-[165px] block mx-auto"
                onError={() => setImageError(e => Math.min(e + 1, imageSources.length - 1))}
              />
              <div className="mt-1.5 text-center">
                <div className="text-[10px] font-semibold text-blue-400 tracking-wide">By @Piratefan003</div>
                <div className="text-[8.5px] text-gray-500 leading-tight mt-0.5">
                  Data: MLB Statcast<br/>Baseball Savant · MLB Stats API
                </div>
              </div>
            </div>

            {/* Right: name / bio / stats */}
            <div className="flex flex-col items-center flex-1">
              {/* Name + logo */}
              <div className="flex items-center gap-3 mb-0.5">
                <h1 className="text-2xl font-bold">{displayName}</h1>
                {teamLogo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={teamLogo} alt={data?.team ?? ''} className="w-8 h-8 object-contain flex-shrink-0 drop-shadow-[0_0_6px_rgba(255,255,255,0.35)]"/>
                )}
              </div>
              {/* Bio */}
              {bioParts.length > 0 && (
                <p className="text-sm text-gray-300 mb-1">{bioParts.join(' • ')}</p>
              )}
              {/* Date range */}
              <div className="text-xs text-gray-400 mb-3">
                {data?.team && <span className="font-bold text-white mr-2">{data.team}</span>}
                <span>{formatWeekLabel(weekStart, weekEnd)}</span>
                {totals && <span className="ml-2 text-gray-500">· AVG {ba}</span>}
              </div>

              {/* Stats grid */}
              {totals && (
                <div className="w-full">
                  {[statsRow1, statsRow2, statsRow3].map((row, ri) => (
                    <div key={ri} className={`grid grid-cols-6 ${ri < 2 ? 'border-b border-white/[0.06]' : ''}`}>
                      {row.map(s => (
                        <div key={s.label} className="text-center px-2 py-1.5">
                          <div className="text-[9px] text-gray-500 uppercase tracking-wide whitespace-nowrap">{s.label}</div>
                          <div className="text-sm font-bold tabular-nums">{String(s.value)}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── BOTTOM ROW: top at-bats | charts ── */}
          {!loading && (data?.games?.length ?? 0) > 0 ? (
            <div className="flex gap-4 items-start">

              {/* Left: top 4 at-bats */}
              <div className="flex-shrink-0 w-[220px] flex flex-col gap-px overflow-hidden">
                {(data!.topAtBats ?? []).map((ab, abIdx) => {
                  const oppLogo = ab.opponent ? getMLBTeamLogoUrl(ab.opponent) : null;
                  const dateObj = new Date(ab.date + 'T12:00:00Z');
                  const dateShort = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
                  const homeAway = ab.isHome === null ? '' : ab.isHome ? 'vs' : '@';
                  // Last pitch with exit velo (the result pitch)
                  const resultPitch = [...(ab.pitches ?? [])].reverse().find(p => p.exitVelo != null) ?? ab.pitches?.[ab.pitches.length - 1];
                  return (
                    <Link
                      key={abIdx}
                      href={`/player/${id}/daily?date=${ab.date}`}
                      className="bg-[#171b24] hover:bg-[#1e2330] px-2 py-2 transition-colors block"
                    >
                      {/* Header: date + opponent + result */}
                      <div className="flex items-center gap-1 mb-1.5 flex-nowrap min-w-0">
                        <span className="text-[9px] text-gray-500 flex-shrink-0">{dateShort}</span>
                        <span className="text-[9px] text-gray-500 flex-shrink-0">{homeAway}</span>
                        {oppLogo && <img src={oppLogo} alt={ab.opponent ?? ''} className="w-3 h-3 object-contain flex-shrink-0"/>}
                        {ab.result && (
                          <span className={`text-[9px] font-bold px-1 py-0 leading-4 whitespace-nowrap flex-shrink-0 ${resultColor(ab.result)}`}>
                            {cleanResult(ab.result)}
                          </span>
                        )}
                        <span className="text-[9px] text-gray-400 truncate min-w-0">{ab.pitcherName}{ab.pitcherHand ? ` · ${ab.pitcherHand}HP` : ''}</span>
                      </div>

                      {/* Pitch rows */}
                      <div className="flex flex-col" style={{ gap: 3 }}>
                        {(ab.pitches ?? []).map((p, pi) => {
                          const col = PITCH_COLORS[p.pitchType];
                          const abbrev = PITCH_ABBREV[p.pitchType] || p.pitchType.slice(0,2).toUpperCase();
                          const desc = cleanDesc(p.description);
                          const isLightning = p.batSpeed != null && p.batSpeed >= 75;
                          return (
                            <div key={pi} className="flex flex-col rounded px-0.5">
                              <div className="flex items-center gap-1" style={{ lineHeight: '14px' }}>
                                <span className="rounded px-1 font-bold flex-shrink-0"
                                  style={{ backgroundColor: col?.bg||'#555', color: col?.text||'#fff', fontSize: 10, lineHeight: '14px' }}>
                                  {abbrev}
                                </span>
                                {p.velo != null && (
                                  <span className="text-[10px] text-gray-300 tabular-nums flex-shrink-0">{p.velo.toFixed(1)}</span>
                                )}
                                {p.isBarrel ? (
                                  <span className="text-[9px] font-bold text-orange-400 flex-shrink-0">B</span>
                                ) : p.exitVelo != null && p.exitVelo >= 95 ? (
                                  <span className="text-[9px] flex-shrink-0">🔥</span>
                                ) : null}
                                <span className="text-[9px] text-gray-400 flex-shrink-0">{desc}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Result pitch stats */}
                      {resultPitch && (resultPitch.exitVelo != null || resultPitch.launchAngle != null) && (
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          {(ab.pitches ?? []).find(p => p.batSpeed != null && p.batSpeed >= 40) && (() => {
                            const maxBS = Math.max(...(ab.pitches ?? []).filter(p => p.batSpeed != null && p.batSpeed! >= 40).map(p => p.batSpeed!));
                            const isLightning = maxBS >= 75;
                            return (
                              <span className="text-[9px] text-blue-300 tabular-nums flex-shrink-0">
                                {isLightning && <span className="text-yellow-400">⚡</span>}{maxBS.toFixed(1)} bs
                              </span>
                            );
                          })()}
                          {resultPitch.exitVelo != null && (
                            <span className="text-[9px] text-gray-300 tabular-nums flex-shrink-0">{resultPitch.exitVelo.toFixed(1)} ev</span>
                          )}
                          {resultPitch.launchAngle != null && (
                            <span className="text-[9px] text-gray-500 tabular-nums flex-shrink-0">{resultPitch.launchAngle}° la</span>
                          )}
                          {resultPitch.hitDistance != null && (
                            <span className="text-[9px] text-gray-500 tabular-nums flex-shrink-0">{resultPitch.hitDistance} ft</span>
                          )}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>

              {/* Right: charts */}
              <div className="flex flex-1 flex-col items-center gap-2">
                <HitterZoneChart rawDots={data!.rawDots} />
                <SprayChart hitDots={data!.hitDots} batSide={data?.playerBatSide ?? undefined} playerImageUrl={currentImage} />
              </div>
            </div>
          ) : !loading && (
            <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
              No games found for this week.
            </div>
          )}

        </div>
        </div>
      </div>
    </div>
  );
}
