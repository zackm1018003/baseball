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
    statsBg:      light ? '#f7f7f7' : '#1a1a1a',
    banner:       light ? '#e8e8e8' : '#000000',
    label:        light ? '#000000' : '#777777',
    fg:           light ? '#000000' : '#ffffff',
    divider:      'divide-ink/10',
    border:       'border-ink/10',
    statsBoxStyle:light ? { border: BW } as React.CSSProperties
                        : { border: '1px solid rgba(255,255,255,0.2)' } as React.CSSProperties,
    btnFg:        light ? 'rgba(0,0,0,0.55)'  : 'rgba(255,255,255,0.6)',
    btnBg:        light ? 'rgba(0,0,0,0.05)'  : 'rgba(255,255,255,0.08)',
    btnBorder:    light ? 'rgba(0,0,0,0.18)'  : 'rgba(255,255,255,0.18)',
    atBatStyle:   light ? { background: '#f8f8f8', border: '1px solid #d4d4d4', borderLeft: '3px solid #ff2d2d', borderRadius: 4 } as React.CSSProperties : {} as React.CSSProperties,
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
            Last {lastN} Days: {formatWeekLabel(data.weekStart, data.weekEnd)}
          </span>
        )}
      </div>

      <div className="mx-auto px-6 py-6" style={{ maxWidth: 1400 }}>
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
              <div className="font-display italic text-[10px] uppercase text-right tracking-[0.08em]" style={{ color: light ? '#000000' : '#ff2d2d', fontWeight: 900 }}>By @Piratefan003</div>
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
              <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-0.5 border-b ${th.border}`}
                   style={{ background: th.banner, color: light ? '#000000' : '#ff2d2d', fontWeight: 900 }}>
                Last {lastN} Days
              </div>
              {[statsRow1, statsRow2, statsRow3].map((row, ri) => (
                <div key={ri} className={`grid grid-cols-6 divide-x ${th.divider} ${ri < 2 ? `border-b ${th.border}` : ''}`} style={{ background: th.statsBg }}>
                  {row.map(s => (
                    <div key={s.label} className="text-center px-2 py-1.5">
                      <div className="text-[9px] uppercase tracking-wide whitespace-nowrap" style={{ color: th.label }}>{s.label}</div>
                      <div className="text-sm font-bold font-display tabular-nums" style={{ color: th.fg }}>{String(s.value)}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* ── BOTTOM SECTIONS ── */}
          {!loading && (data?.games?.length ?? 0) > 0 ? (
            <div className="flex flex-col gap-4">

              {/* TOP AT BATS — full width, 2-per-row */}
              <div style={light ? { border: BW } as React.CSSProperties : {}}>
                <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-0.5 border-b ${th.border}`}
                     style={{ background: th.banner, color: light ? '#000000' : '#ff2d2d', fontWeight: 900 }}>
                  Top At Bats
                </div>
                <div className="flex flex-wrap justify-center gap-2 w-full max-w-full mx-auto" style={{ padding: light ? 12 : 0 }}>
                {(data!.topAtBats ?? []).map((ab, abIdx) => {
                  const oppLogo = ab.opponent ? getMLBTeamLogoUrl(ab.opponent) : null;
                  const dateObj = new Date(ab.date + 'T12:00:00Z');
                  const dateShort = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
                  const homeAway = ab.isHome === null ? '' : ab.isHome ? 'vs' : '@';
                  const resultPitch = [...(ab.pitches ?? [])].reverse().find(p => p.exitVelo != null) ?? ab.pitches?.[ab.pitches.length - 1];
                  return (
                    <Link
                      key={abIdx}
                      href={`/player/${id}/daily?date=${ab.date}`}
                      className={`px-2 py-2 transition-colors ${light ? '' : 'bg-[#171b24] hover:bg-[#1e2330]'}`}
                      style={{ ...th.atBatStyle, flex: '0 0 calc(50% - 4px)', minWidth: 0 }}
                    >
                      {/* Header: date + opponent + result */}
                      <div className="flex items-center gap-1 mb-1.5 flex-nowrap min-w-0">
                        <span className="text-[9px] flex-shrink-0" style={{ color: light ? '#000000' : 'var(--color-ink-4)' }}>{dateShort}</span>
                        <span className="text-[9px] flex-shrink-0" style={{ color: light ? '#000000' : 'var(--color-ink-4)' }}>{homeAway}</span>
                        {oppLogo && <img src={oppLogo} alt={ab.opponent ?? ''} className="w-3 h-3 object-contain flex-shrink-0"/>}
                        {ab.result && (
                          <span className={`text-[9px] font-bold px-1 py-0 leading-4 whitespace-nowrap flex-shrink-0 ${resultColor(ab.result)}`}
                            style={resultColor(ab.result) !== 'bg-bone text-ink-2' ? { textShadow: '-1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000' } : {}}>
                            {cleanResult(ab.result)}
                          </span>
                        )}
                        <span className="text-[9px] truncate min-w-0" style={{ color: light ? '#000000' : 'var(--color-ink-3)' }}>{ab.pitcherName}{ab.pitcherHand ? ` · ${ab.pitcherHand}HP` : ''}</span>
                      </div>

                      {/* Pitch rows */}
                      <div className="flex flex-col" style={{ gap: 3 }}>
                        {(ab.pitches ?? []).map((p, pi) => {
                          const col = PITCH_COLORS[p.pitchType];
                          const abbrev = PITCH_ABBREV[p.pitchType] || p.pitchType.slice(0,2).toUpperCase();
                          const desc = cleanDesc(p.description);
                          return (
                            <div key={pi} className="flex flex-col rounded px-0.5">
                              <div className="flex items-center gap-1" style={{ lineHeight: '14px' }}>
                                <span className="rounded px-1 font-bold flex-shrink-0"
                                  style={{ backgroundColor: col?.bg||'#555', color: col?.text||'#fff', fontSize: 10, lineHeight: '14px' }}>
                                  {abbrev}
                                </span>
                                {p.velo != null && (
                                  <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: light ? '#000000' : 'var(--color-ink-2)' }}>{p.velo.toFixed(1)}</span>
                                )}
                                {p.isBarrel ? (
                                  <span className="text-[9px] font-bold text-orange-400 flex-shrink-0">B</span>
                                ) : p.exitVelo != null && p.exitVelo >= 95 ? (
                                  <span className="text-[9px] flex-shrink-0">🔥</span>
                                ) : null}
                                <span className="text-[9px] flex-shrink-0" style={{ color: light ? '#000000' : 'var(--color-ink-3)' }}>{desc}</span>
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
                              <span className="text-yellow-400 font-semibold text-[9px] tabular-nums flex-shrink-0"
                                style={{ textShadow: '-1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000' }}>
                                {isLightning && <span>⚡</span>}{maxBS.toFixed(1)} <span style={{ color: light ? '#000000' : 'var(--color-ink-5)', fontWeight: 400, textShadow: 'none' }}>bs</span>
                              </span>
                            );
                          })()}
                          {resultPitch.exitVelo != null && (
                            <span className="text-[9px] tabular-nums flex-shrink-0" style={{ color: light ? '#000000' : 'var(--color-ink-2)' }}>{resultPitch.exitVelo.toFixed(1)} <span style={{ color: light ? '#000000' : 'var(--color-ink-5)' }}>ev</span></span>
                          )}
                          {resultPitch.launchAngle != null && (
                            <span className="text-[9px] tabular-nums flex-shrink-0" style={{ color: light ? '#000000' : 'var(--color-ink-4)' }}>{resultPitch.launchAngle}° <span style={{ color: light ? '#000000' : 'var(--color-ink-5)' }}>la</span></span>
                          )}
                          {resultPitch.hitDistance != null && (
                            <span className="text-[9px] tabular-nums flex-shrink-0" style={{ color: light ? '#000000' : 'var(--color-ink-4)' }}>{resultPitch.hitDistance} <span style={{ color: light ? '#000000' : 'var(--color-ink-5)' }}>ft</span></span>
                          )}
                        </div>
                      )}
                    </Link>
                  );
                })}
                </div>
              </div>

              {/* CHARTS — full width, side by side */}
              <div style={light ? { border: BW } as React.CSSProperties : {}}>
                <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-0.5 border-b ${th.border}`}
                     style={{ background: th.banner, color: light ? '#000000' : '#ff2d2d', fontWeight: 900 }}>
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
