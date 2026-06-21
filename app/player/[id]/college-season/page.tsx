'use client';

import React, { use, useState, useEffect, useCallback, useRef } from 'react';
import { getPlayerById, getPlayerByName } from '@/lib/database';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import { getCountryFlagUrl } from '@/lib/country-flags';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CollegeSeasonPageProps {
  params: Promise<{ id: string }>;
}

interface HitterRawDot {
  pitchType: string; px: number; pz: number;
  isWhiff: boolean; isBarrel: boolean; isSwing: boolean; isTake: boolean;
  exitVelo: number | null; atBatNum?: number;
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
interface SeasonTotals {
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
  pitches: AtBatPitch[]; date: string; opponent: string | null; isHome: boolean | null;
  maxEv: number | null; isBarrel: boolean; isHit: boolean; score: number;
}
interface CollegeSeasonData {
  playerId: number; playerName: string | null; playerHeight: string | null;
  playerWeight: number | null; playerBirthDate: string | null;
  playerBatSide: string | null; playerPitchHand: string | null;
  season: string; team: string | null; level: string | null;
  games: GameResult[]; topAtBats: TopAtBat[]; totals: SeasonTotals | null;
  rawDots: HitterRawDot[]; hitDots: HitterHitDot[];
  barrels: number; barrelPct: number | null;
  avgBatSpeed: number | null; avgEv: number | null; maxEv: number | null;
  avgLaHard: number | null; ev90: number | null;
  discipline: {
    swingPct: number | null; zSwingPct: number | null; chasePct: number | null;
    zContactPct: number | null; oContactPct: number | null;
  } | null;
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
function pitchColors(name: string) { return PITCH_COLORS[name] || { color: '#888', bg: '#888', text: '#fff' }; }

const PITCH_ABBREV: Record<string, string> = {
  '4-Seam Fastball': 'FF', 'Sinker': 'SI', 'Cutter': 'CT', 'Changeup': 'CH',
  'Curveball': 'CU', 'Slider': 'SL', 'Sweeper': 'SW', 'Knuckle Curve': 'KC',
  'Splitter': 'SP', 'Slurve': 'SV',
};

// ─── Zone chart ───────────────────────────────────────────────────────────────

function HitterZoneChart({ rawDots, heightIn }: { rawDots: HitterRawDot[]; heightIn?: number }) {
  const size = 380, xMin = -1.8, xMax = 1.8, zMin = 0.5, zMax = 4.5, pad = 26;
  const w = size - pad * 2, h = size - pad * 2;
  const toSvgX = (px: number) => pad + ((px - xMin) / (xMax - xMin)) * w;
  const toSvgY = (pz: number) => pad + ((zMax - pz) / (zMax - zMin)) * h;
  const ht = heightIn ?? 72;
  const szLeft = toSvgX(-0.708), szRight = toSvgX(0.708);
  const szTop  = toSvgY((ht * 0.535) / 12), szBot  = toSvgY((ht * 0.27) / 12);
  const thirdW = (szRight - szLeft) / 3, thirdH = (szBot - szTop) / 3;

  if (rawDots.length === 0)
    return <div style={{ width: size, height: size }} className="bg-bone flex items-center justify-center"><p className="text-ink-4 text-xs">No pitch data</p></div>;

  return (
    <svg width={size} height={size} style={{ background: '#f5f3ef' }}>
      <defs>
        <linearGradient id="csFireGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff2200"/><stop offset="50%" stopColor="#ff8800"/><stop offset="100%" stopColor="#ffdd00"/>
        </linearGradient>
      </defs>
      <text x={size/2} y={16} textAnchor="middle" fontSize="10" fontWeight="600" fill="#111827">
        Pitches Seen — {rawDots.length} total
      </text>
      <rect x={szLeft} y={szTop} width={szRight-szLeft} height={szBot-szTop} fill="rgba(0,0,0,0.06)" stroke="#000" strokeWidth="2"/>
      {[1,2].map(i=><line key={`v${i}`} x1={szLeft+thirdW*i} y1={szTop} x2={szLeft+thirdW*i} y2={szBot} stroke="#00000033" strokeWidth="0.75"/>)}
      {[1,2].map(i=><line key={`h${i}`} x1={szLeft} y1={szTop+thirdH*i} x2={szRight} y2={szTop+thirdH*i} stroke="#00000033" strokeWidth="0.75"/>)}
      {rawDots.map((dot, i) => {
        const cx = toSvgX(dot.px), cy = toSvgY(dot.pz);
        const col = pitchColors(dot.pitchType).color;
        if (dot.isWhiff) {
          const s = 3.5;
          return <g key={i}>
            <line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke="#000" strokeWidth={3.5} opacity="0.85"/>
            <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke="#000" strokeWidth={3.5} opacity="0.85"/>
            <line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke={col} strokeWidth={2.2} opacity="0.95"/>
            <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke={col} strokeWidth={2.2} opacity="0.95"/>
          </g>;
        }
        if (dot.isBarrel) return <g key={i}>
          <text x={cx} y={cy+4} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#000" stroke="#000" strokeWidth="4" strokeLinejoin="round" opacity="0.85">B</text>
          <text x={cx} y={cy+4} textAnchor="middle" fontSize={11} fontWeight="bold" fill="url(#csFireGrad)">B</text>
        </g>;
        if (dot.isSwing && !dot.isWhiff && dot.exitVelo !== null && dot.exitVelo >= 95)
          return <text key={i} x={cx} y={cy+4} textAnchor="middle" fontSize={11} opacity="0.9">🔥</text>;
        if (dot.isTake)
          return <circle key={i} cx={cx} cy={cy} r={3} fill="none" stroke={col} strokeWidth="1.5" opacity="0.6"/>;
        return <circle key={i} cx={cx} cy={cy} r={3} fill={col} stroke="#000" strokeWidth="0.5" opacity="0.75"/>;
      })}
      {/* Legend */}
      {(() => { const lx = (size - 180) / 2; return (<>
        <circle cx={lx+4} cy={size-9} r="3" fill="#555" opacity="0.8"/>
        <text x={lx+10} y={size-6} fontSize="7" fill="#000">swing</text>
        <circle cx={lx+41} cy={size-9} r="3" fill="none" stroke="#555" strokeWidth="1.5"/>
        <text x={lx+47} y={size-6} fontSize="7" fill="#000">take</text>
        <line x1={lx+72} y1={size-13} x2={lx+78} y2={size-6} stroke="#555" strokeWidth="1.5"/>
        <line x1={lx+78} y1={size-13} x2={lx+72} y2={size-6} stroke="#555" strokeWidth="1.5"/>
        <text x={lx+82} y={size-6} fontSize="7" fill="#000">whiff</text>
        <text x={lx+110} y={size-6} fontSize="7" fontWeight="bold" fill="url(#csFireGrad)" stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
        <text x={lx+119} y={size-6} fontSize="7" fill="#000">barrel</text>
        <text x={lx+150} y={size-6} fontSize="7">🔥</text>
        <text x={lx+158} y={size-6} fontSize="7" fill="#000">95+ev</text>
      </>); })()}
    </svg>
  );
}

// ─── Spray chart ─────────────────────────────────────────────────────────────

function SprayChart({ hitDots, batSide }: { hitDots: HitterHitDot[]; batSide?: string }) {
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
    <svg width={380} height={380} viewBox="70 120 370 370" style={{ background: '#f5f3ef' }}>
      <text x={250} y={162} textAnchor="middle" fontSize="10" fontWeight="600" fill="#111827">
        Batted Balls — {hitDots.length} BIP
      </text>
      <polygon points={`250,450 ${RF_CORNER.x},${RF_CORNER.y} ${RF_TOP.x},${RF_TOP.y} 250,186 ${LF_TOP.x},${LF_TOP.y} ${LF_CORNER.x},${LF_CORNER.y}`} fill="#f5f5f5"/>
      <line x1="250" y1="450" x2={RF_CORNER.x} y2={RF_CORNER.y} stroke="#000" strokeWidth="1.5"/>
      <line x1="250" y1="450" x2={LF_CORNER.x} y2={LF_CORNER.y} stroke="#000" strokeWidth="1.5"/>
      <path d={`M ${RF_CORNER.x} ${RF_CORNER.y} L 354.6 235.5 Q ${RF_TOP.x} ${RF_TOP.y} 323.2 213.1 L 250 186 L 176.8 213.1 Q ${LF_TOP.x} ${LF_TOP.y} 145.4 235.5 L ${LF_CORNER.x} ${LF_CORNER.y}`} fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round"/>
      <polygon points="250,450 291,409 250,367 209,409" fill="none" stroke="#000" strokeWidth="1.5"/>
      <circle cx="250" cy="411" r="12" fill="none" stroke="#000" strokeWidth="1"/>
      <rect x="246" y="408.5" width="8" height="3" rx="0.5" fill="#333"/>
      <rect x="287" y="405" width="8" height="8" fill="#333"/>
      <g transform="rotate(45,250,367)"><rect x="246" y="363" width="8" height="8" fill="#333"/></g>
      <rect x="205" y="405" width="8" height="8" fill="#333"/>
      <path d="M 243 453 L 257 453 L 257 447 L 250 442 L 243 447 Z" fill="#333"/>
      <defs><linearGradient id="csScFire" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ff2200"/><stop offset="50%" stopColor="#ff8800"/><stop offset="100%" stopColor="#ffdd00"/>
      </linearGradient></defs>
      {hitDots.map((dot, i) => {
        const { x, y } = toSvg(dot.hcX, dot.hcY, dot.hitDistance);
        const col = pitchColors(dot.pitchType).color;
        const isHit = ['single','double','triple','home_run'].includes(dot.result.toLowerCase().replace(/\s/g,'_'));
        return <g key={i}>
          <circle cx={x} cy={y} r={7} fill={isHit ? col : 'none'} fillOpacity={isHit ? 0.85 : 0} stroke={col} strokeWidth={isHit ? 1.2 : 2}/>
          {dot.isBarrel
            ? <text x={x} y={y+3.5} textAnchor="middle" fontSize="8" fontWeight="bold" fill="url(#csScFire)" stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
            : (dot.exitVelo !== null && dot.exitVelo >= 95)
              ? <text x={x} y={y+3.5} textAnchor="middle" fontSize="8" fill={isHit ? '#fff' : col} fontWeight="bold">🔥</text>
              : null}
        </g>;
      })}
      {hitDots.length === 0 && <text x={250} y={390} textAnchor="middle" fontSize="11" fill="#bbb">No balls in play</text>}
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate), now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() - birth.getMonth() < 0 || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
  return age;
}

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
    strikeout: 'K', strikeout_double_play: 'KDP', walk: 'BB', intent_walk: 'IBB',
    hit_by_pitch: 'HBP', field_out: 'Out', force_out: 'FC Out',
    fielders_choice: 'FC', fielders_choice_out: 'FC Out',
    grounded_into_double_play: 'GIDP', double_play: 'DP',
    sac_fly: 'SF', sac_bunt: 'SH', other_out: 'Out',
    homeRun: 'HR', strikeOut: 'K', intentionalWalk: 'IBB', hitByPitch: 'HBP',
    fieldOut: 'Out', forceOut: 'FC Out', sacFly: 'SF', sacBunt: 'SH',
    'Home Run': 'HR', 'Single': '1B', 'Double': '2B', 'Triple': '3B',
    'Strikeout': 'K', 'Walk': 'BB', 'Field Out': 'Out',
  };
  return map[events] || events.replace(/_/g, ' ');
}

function resultColor(events: string): string {
  if (['single','double','triple','home_run','homeRun','Home Run','Single','Double','Triple'].includes(events))
    return 'bg-green-700 text-green-200';
  if (['strikeout','strikeOut','field_out','fieldOut','force_out','grounded_into_double_play',
       'double_play','sac_fly','fielders_choice','Strikeout','Field Out','Other Out'].includes(events))
    return 'bg-red-900 text-red-300';
  if (['walk','intent_walk','hit_by_pitch','Walk','Intentional Walk','Hit By Pitch'].includes(events))
    return 'bg-walk text-outcome-fg';
  return 'bg-bone text-ink-2';
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => String(CURRENT_YEAR - i));

export default function CollegeSeasonPage({ params }: CollegeSeasonPageProps) {
  const { id } = use(params);

  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [data, setData] = useState<CollegeSeasonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState(0);
  const [light, setLight] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

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
      const res = await fetch(`/api/hitter-college-season?playerId=${pid}&year=${year}`);
      const json = await res.json();
      if (json.error && !json.playerName) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [year, id, player?.player_id]);

  useEffect(() => { load(); }, [load]);

  const displayName = data?.playerName ?? player?.full_name ?? decodeURIComponent(id);
  const teamLogo = (data?.team ? getMLBTeamLogoUrl(data.team) : null) ?? (player?.team ? getMLBTeamLogoUrl(player.team) : null);
  const flag = getCountryFlagUrl(data?.team ?? player?.team ?? null, 80);

  const totals = data?.totals;
  const singles = (totals?.h ?? 0) - (totals?.doubles ?? 0) - (totals?.triples ?? 0) - (totals?.hr ?? 0);
  const avg  = totals && totals.ab > 0 ? (totals.h / totals.ab).toFixed(3) : '—';
  const obp  = totals && (totals.ab + totals.bb) > 0 ? ((totals.h + totals.bb) / (totals.ab + totals.bb)).toFixed(3) : '—';
  const slgV = totals && totals.ab > 0 ? (singles + 2*(totals.doubles??0) + 3*(totals.triples??0) + 4*(totals.hr??0)) / totals.ab : null;
  const slg  = slgV != null ? slgV.toFixed(3) : '—';
  const opsV = (obp !== '—' && slg !== '—') ? parseFloat(obp) + parseFloat(slg) : null;
  const ops  = opsV != null ? opsV.toFixed(3) : '—';

  const age = calcAge(data?.playerBirthDate ?? null);
  const bioParts: string[] = [];
  if (data?.playerHeight) bioParts.push(data.playerHeight);
  if (data?.playerWeight) bioParts.push(`${data.playerWeight} lbs`);
  if (age !== null) bioParts.push(`Age ${age}`);
  if (data?.playerBatSide && data?.playerPitchHand) bioParts.push(`${data.playerBatSide}/${data.playerPitchHand}`);

  // capture helpers
  const captureCard = async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    const { toPng } = await import('html-to-image');
    return toPng(cardRef.current, { pixelRatio: 2, cacheBust: true,
      filter: (node) => !(node as HTMLElement).classList?.contains('export-ignore') });
  };
  const handleDownload = async () => {
    if (capturing) return; setCapturing(true);
    try {
      const url = await captureCard();
      if (!url) return;
      const a = document.createElement('a');
      a.download = `${displayName.replace(/\s+/g,'-')}-${year}-season.png`;
      a.href = url; a.click();
    } catch(e){ console.error(e); } finally { setCapturing(false); }
  };
  const handleCopy = async () => {
    if (capturing) return; setCapturing(true);
    try {
      const url = await captureCard();
      if (!url) return;
      const blob = await fetch(url).then(r => r.blob());
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch(e){ console.error(e); } finally { setCapturing(false); }
  };

  const BW = '2px solid #000';
  const th = {
    statsBg:      light ? '#ffffff' : '#1a1a1a',
    banner:       light ? '#374151' : '#000',
    label:        light ? '#6b7280' : '#777',
    fg:           light ? '#000' : '#fff',
    divider:      'divide-ink/10',
    border:       'border-ink/10',
    statsBoxStyle:light ? { border: BW } as React.CSSProperties : { border: '1px solid rgba(255,255,255,0.2)' } as React.CSSProperties,
    btnFg:        light ? 'rgba(0,0,0,0.55)'  : 'rgba(255,255,255,0.6)',
    btnBg:        light ? 'rgba(0,0,0,0.05)'  : 'rgba(255,255,255,0.08)',
    btnBorder:    light ? 'rgba(0,0,0,0.18)'  : 'rgba(255,255,255,0.18)',
    atBatStyle:   light ? { background: '#f8f8f8', border: '1px solid #d4d4d4', borderLeft: '3px solid #ff2d2d', borderRadius: 4 } as React.CSSProperties : {} as React.CSSProperties,
  };

  const hasStatcast = (data?.rawDots?.length ?? 0) > 0 || (data?.hitDots?.length ?? 0) > 0 || data?.avgEv != null;

  return (
    <div className="min-h-screen bg-page text-deep-fg" data-light={light ? 'true' : undefined}>
      {/* Nav */}
      <header className="bg-page border-b border-ink/20">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="text-ink-3 hover:text-ink font-medium text-sm transition-colors">Hitters</Link>
          <div className="flex items-center gap-2">
            <Link href={`/player/${id}`} className="px-3 py-1.5 bg-panel hover:bg-bone border border-ink/20 text-ink-3 hover:text-ink text-xs font-semibold transition-colors tracking-wide">
              Season Stats
            </Link>
            <Link href={`/player/${id}/daily`} className="px-3 py-1.5 bg-panel hover:bg-bone border border-ink/20 text-ink-3 hover:text-ink text-xs font-semibold transition-colors tracking-wide">
              Daily Card
            </Link>
            <Link href={`/player/${id}/weekly`} className="px-3 py-1.5 bg-panel hover:bg-bone border border-ink/20 text-ink-3 hover:text-ink text-xs font-semibold transition-colors tracking-wide">
              Weekly Card
            </Link>
          </div>
          <Link href="/pitchers" className="text-ink-3 hover:text-ink font-medium text-sm transition-colors">Pitchers</Link>
        </div>
      </header>

      {/* Year selector */}
      <div className="flex items-center justify-center gap-3 py-3 border-b border-ink/20 bg-page">
        <span className="text-xs text-ink-4">Season:</span>
        <div className="flex overflow-hidden border border-ink/20">
          {YEARS.map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                year === y ? 'bg-deep text-deep-fg' : 'bg-panel text-ink-3 hover:text-ink'
              }`}>
              {y}
            </button>
          ))}
        </div>
        {data && data.games.length > 0 && (
          <span className="text-sm font-semibold text-deep-fg">
            {year} · {data.games.length} games
          </span>
        )}
      </div>

      <div className="mx-auto px-4 py-6" style={{ maxWidth: 960 }}>
        <div className="mb-6">
        <div ref={cardRef} className="bg-page p-6 w-full" style={{ position: 'relative' }}>

          {/* Export buttons */}
          {!loading && (
            <div className="export-ignore" style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 6, zIndex: 10 }}>
              <button onClick={() => setLight(l => !l)} title="Toggle light/dark"
                style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  background: th.btnBg, border: `1px solid ${th.btnBorder}`, color: th.btnFg, borderRadius: 3 }}>
                {light ? '☀ Light' : '☾ Dark'}
              </button>
              <button onClick={handleCopy} disabled={capturing}
                style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: capturing ? 'wait' : 'pointer',
                  background: copied ? '#166534' : th.btnBg, border: `1px solid ${copied ? '#16a34a' : th.btnBorder}`,
                  color: copied ? '#4ade80' : th.btnFg, borderRadius: 3 }}>
                {copied ? '✓ Copied' : capturing ? '…' : '⎘ Copy'}
              </button>
              <button onClick={handleDownload} disabled={capturing}
                style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: capturing ? 'wait' : 'pointer',
                  background: th.btnBg, border: `1px solid ${th.btnBorder}`, color: th.btnFg, borderRadius: 3 }}>
                {capturing ? '…' : '↓ PNG'}
              </button>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent animate-spin"/>
              <span className="text-ink-3 text-sm">Fetching {year} season from daily logs…</span>
              <span className="text-ink-4 text-xs">May take 20–40 seconds for a full season</span>
            </div>
          )}
          {!loading && error && (
            <div className="text-center py-8">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {!loading && data && (
            <>
              {/* Header */}
              <div className="flex gap-3 items-stretch mx-auto" style={{ maxWidth: 960, marginBottom: 12 }}>
                {/* Watermark */}
                <div className="flex-shrink-0 flex flex-col items-end justify-center" style={{ width: 76 }}>
                  <div className="font-display italic text-[10px] uppercase text-right tracking-[0.08em]" style={{ color: light ? '#000' : '#ff2d2d', fontWeight: 900 }}>By @Piratefan003</div>
                  <div className="text-[8px] leading-tight mt-0.5 text-right" style={{ color: light ? '#000' : 'var(--color-ink-4)' }}>
                    Data: MLB Stats API<br/>Via Statcast / Game Feed
                  </div>
                </div>

                {/* Headshot */}
                <div className="flex-shrink-0" style={{ width: 140 }}>
                  {flag && <img src={flag} alt={data.team ?? ''} className="w-8 h-[22px] object-cover mb-1"/>}
                  <div className="w-full overflow-hidden bg-page" style={{ height: 140 }}>
                    <img src={currentImage} alt={displayName}
                      className="w-full h-full object-cover object-top"
                      onError={() => setImageError(e => Math.min(e+1, imageSources.length-1))}/>
                  </div>
                </div>

                {/* Name / bio */}
                <div className="flex-1 flex flex-col items-center justify-center text-center min-w-0">
                  <h1 className="font-display text-2xl uppercase tracking-[0.02em] mb-1">{displayName}</h1>
                  {bioParts.length > 0 && (
                    <p className="text-sm mb-2" style={{ color: light ? '#000' : 'var(--color-ink-2)' }}>{bioParts.join(' · ')}</p>
                  )}
                  <div className="flex flex-wrap items-center justify-center gap-x-2 text-xs" style={{ color: light ? '#000' : 'var(--color-ink-4)' }}>
                    {data.team && <span className="font-bold">{data.team}</span>}
                    <span>·</span><span>{year} Season</span>
                    <span>·</span><span>{data.games.length}G</span>
                    {totals && <><span>·</span><span>AVG {avg}</span></>}
                  </div>
                </div>

                {/* Team logo */}
                <div className="flex-shrink-0 flex flex-col items-center justify-center" style={{ width: 140 }}>
                  {teamLogo && <img src={teamLogo} alt={data.team ?? ''} className="object-contain" style={{ width: 105, height: 105 }}/>}
                </div>

                <div className="flex-shrink-0" style={{ width: 76 }} />
              </div>

              {/* ── STATS BOX ─────────────────────────────────────────────── */}
              {totals && (
                <div className="w-full max-w-full mx-auto mb-3" style={th.statsBoxStyle}>
                  <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`}
                       style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                    {year} Season Totals
                  </div>

                  {/* Row 1: AVG / OBP / SLG / OPS / HR / RBI */}
                  <div className={`grid grid-cols-6 divide-x ${th.divider} border-b ${th.border}`} style={{ background: th.statsBg }}>
                    {[
                      { label: 'AVG', value: avg },
                      { label: 'OBP', value: obp },
                      { label: 'SLG', value: slg },
                      { label: 'OPS', value: ops },
                      { label: 'HR',  value: totals.hr },
                      { label: 'RBI', value: totals.rbi },
                    ].map(s => (
                      <div key={s.label} className="text-center px-1 py-0.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                        <div className="font-bold font-display tabular-nums" style={{ fontSize: 18, color: th.fg, lineHeight: '22px' }}>{String(s.value)}</div>
                      </div>
                    ))}
                  </div>

                  {/* Row 2: G / AB / H / BB / K / SB */}
                  <div className={`grid grid-cols-6 divide-x ${th.divider} border-b ${th.border}`} style={{ background: th.statsBg }}>
                    {[
                      { label: 'G',  value: data.games.length },
                      { label: 'AB', value: totals.ab },
                      { label: 'H',  value: totals.h },
                      { label: 'BB', value: totals.bb },
                      { label: 'K',  value: totals.k },
                      { label: 'SB', value: totals.sb },
                    ].map(s => (
                      <div key={s.label} className="text-center px-1 py-0.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                        <div className="font-bold font-display tabular-nums" style={{ fontSize: 18, color: th.fg, lineHeight: '22px' }}>{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Extra counting row: 2B / 3B / PA / HBP placeholder / ISO / wOBA */}
                  <div className={`grid grid-cols-6 divide-x ${th.divider} border-b ${th.border}`} style={{ background: th.statsBg }}>
                    {[
                      { label: '2B',  value: totals.doubles },
                      { label: '3B',  value: totals.triples },
                      { label: 'PA',  value: totals.pa },
                      { label: 'ISO', value: slgV != null && avg !== '—' ? (slgV - totals.h/totals.ab).toFixed(3) : '—' },
                      { label: 'wRC', value: '—' },
                      { label: 'BABIP', value: (() => {
                          if (!totals.ab || (totals.hr + totals.k) >= totals.ab) return '—';
                          const babip = (totals.h - totals.hr) / (totals.ab - totals.k - totals.hr + (totals.sb ?? 0) * 0);
                          // simple BABIP: (H-HR)/(AB-K-HR)
                          const b = (totals.h - totals.hr) / Math.max(1, totals.ab - totals.k - totals.hr);
                          return b > 0 ? b.toFixed(3) : '—';
                        })() },
                    ].map(s => (
                      <div key={s.label} className="text-center px-1 py-0.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                        <div className="font-bold font-display tabular-nums" style={{ fontSize: 18, color: th.fg, lineHeight: '22px' }}>{String(s.value)}</div>
                      </div>
                    ))}
                  </div>

                  {/* Statcast row — only when data exists */}
                  {hasStatcast && (
                    <div className={`grid grid-cols-5 divide-x ${th.divider} border-b ${th.border}`} style={{ background: th.statsBg }}>
                      {[
                        { label: 'Max EV',  value: data.maxEv      != null ? `${data.maxEv.toFixed(1)}` : '—' },
                        { label: 'EV90',    value: data.ev90        != null ? `${data.ev90.toFixed(1)}`  : '—' },
                        { label: 'Avg EV',  value: data.avgEv       != null ? `${data.avgEv.toFixed(1)}` : '—' },
                        { label: 'Brl%',    value: data.barrelPct   != null ? `${data.barrelPct.toFixed(1)}%` : '—' },
                        { label: 'Avg BS',  value: data.avgBatSpeed != null ? `${data.avgBatSpeed.toFixed(1)}` : '—' },
                      ].map(s => (
                        <div key={s.label} className="text-center px-1 py-0.5">
                          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                          <div className="font-bold font-display tabular-nums" style={{ fontSize: 18, color: th.fg, lineHeight: '22px' }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Discipline row — only when data exists */}
                  {data.discipline && (data.discipline.swingPct != null || data.discipline.zSwingPct != null) && (
                    <div className={`grid grid-cols-5 divide-x ${th.divider}`} style={{ background: th.statsBg }}>
                      {[
                        { label: 'Swing%',     value: data.discipline.swingPct    != null ? `${data.discipline.swingPct.toFixed(1)}%`    : '—' },
                        { label: 'Z-Swing%',   value: data.discipline.zSwingPct   != null ? `${data.discipline.zSwingPct.toFixed(1)}%`   : '—' },
                        { label: 'Z-Contact%', value: data.discipline.zContactPct != null ? `${data.discipline.zContactPct.toFixed(1)}%` : '—' },
                        { label: 'Chase%',     value: data.discipline.chasePct    != null ? `${data.discipline.chasePct.toFixed(1)}%`    : '—' },
                        { label: 'O-Contact%', value: data.discipline.oContactPct != null ? `${data.discipline.oContactPct.toFixed(1)}%` : '—' },
                      ].map(s => (
                        <div key={s.label} className="text-center px-1 py-0.5">
                          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                          <div className="font-bold font-display tabular-nums" style={{ fontSize: 18, color: th.fg, lineHeight: '22px' }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── CHARTS ─────────────────────────────────────────────────── */}
              <div className="flex flex-col gap-4">

                {/* Pitch zone + spray side by side */}
                {(data.rawDots.length > 0 || data.hitDots.length > 0) && (
                  <div style={light ? { border: BW } : {}}>
                    <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`}
                         style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                      {year} Season Charts
                    </div>
                    <div className="flex gap-2 justify-center flex-wrap" style={{ padding: light ? 12 : 0 }}>
                      <HitterZoneChart rawDots={data.rawDots} />
                      <SprayChart hitDots={data.hitDots} batSide={data.playerBatSide ?? undefined} />
                    </div>
                  </div>
                )}

                {/* Top at-bats */}
                {data.topAtBats.length > 0 && (
                  <div style={light ? { border: BW } : {}}>
                    <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`}
                         style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                      Top At Bats
                    </div>
                    <div className="flex flex-wrap justify-center gap-2 w-full" style={{ padding: light ? 12 : 0 }}>
                      {data.topAtBats.map((ab, abIdx) => {
                        const dateShort = new Date(ab.date + 'T12:00:00Z')
                          .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
                        const homeAway = ab.isHome === null ? '' : ab.isHome ? 'vs' : '@';
                        return (
                          <Link key={abIdx} href={`/player/${id}/daily?date=${ab.date}`}
                            className={`px-2 py-2 transition-colors ${light ? '' : 'bg-[#171b24] hover:bg-[#1e2330]'}`}
                            style={{ ...th.atBatStyle, flex: '0 0 calc(25% - 6px)', minWidth: 0 }}>
                            <div className="flex items-center gap-1 mb-1.5 flex-nowrap min-w-0">
                              <span className="text-[11px] font-bold flex-shrink-0" style={{ color: light ? '#000' : 'var(--color-ink-5)' }}>{dateShort} {homeAway} {ab.opponent ?? ''}</span>
                              {ab.result && (
                                <span className={`text-[11px] font-bold px-1 py-0 leading-5 whitespace-nowrap flex-shrink-0 ${resultColor(ab.result)}`}>
                                  {cleanResult(ab.result)}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] mb-1" style={{ color: light ? '#555' : 'var(--color-ink-4)' }}>
                              {ab.pitcherName}{ab.pitcherHand ? ` · ${ab.pitcherHand}HP` : ''}
                            </div>
                            <div className="flex flex-col" style={{ gap: 4 }}>
                              {(ab.pitches ?? []).map((p, pi) => {
                                const col = PITCH_COLORS[p.pitchType];
                                const abbrev = PITCH_ABBREV[p.pitchType] || p.pitchType.slice(0,2).toUpperCase();
                                const desc = cleanDesc(p.description);
                                const dl = p.description.toLowerCase();
                                const isWhiff = dl.includes('swinging_strike') || dl.includes('swinging strike');
                                return (
                                  <div key={pi} className="flex flex-col px-0.5">
                                    <div className="flex items-center gap-1" style={{ lineHeight: '15px' }}>
                                      <span className="rounded px-1 font-bold flex-shrink-0"
                                        style={{ backgroundColor: col?.bg||'#555', color: col?.text||'#fff', fontSize: 11, lineHeight: '15px' }}>
                                        {abbrev}
                                      </span>
                                      {p.velo != null && <span className="font-semibold flex-shrink-0" style={{ fontSize: 12, color: light ? '#000' : 'var(--color-deep-fg)' }}>{p.velo.toFixed(1)}</span>}
                                      {isWhiff && <span className="text-red-400 font-bold text-[10px]">✕</span>}
                                      <span className="truncate min-w-0" style={{ fontSize: 11, color: light ? '#000' : 'var(--color-ink-2)' }}>{desc}</span>
                                    </div>
                                    {(p.exitVelo !== null || p.batSpeed !== null) && (
                                      <div className="pl-1 mt-0.5 flex gap-2">
                                        {p.batSpeed != null && p.batSpeed >= 40 && <span className="text-yellow-400 font-semibold" style={{ fontSize: 12 }}>{p.batSpeed.toFixed(1)} <span style={{ color: light ? '#000' : 'var(--color-ink-5)', fontWeight: 400 }}>bs</span></span>}
                                        {p.exitVelo != null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 12 }}>{p.exitVelo.toFixed(1)} <span style={{ color: light ? '#000' : 'var(--color-ink-5)', fontWeight: 400 }}>ev</span></span>}
                                        {p.launchAngle != null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 12 }}>{p.launchAngle.toFixed(0)}° <span style={{ color: light ? '#000' : 'var(--color-ink-5)', fontWeight: 400 }}>la</span></span>}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Game log */}
                {data.games.length > 0 && (
                  <div style={light ? { border: BW } : {}}>
                    <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`}
                         style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                      Game Log
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                        <thead>
                          <tr className={`border-b ${th.border}`} style={{ background: th.banner }}>
                            {['Date','Opp','AB','H','HR','RBI','BB','K','SB','Avg EV','Brls'].map(h => (
                              <th key={h} className="px-2 py-1 text-center font-bold uppercase tracking-wider"
                                style={{ fontSize: 9, color: th.label }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.games.map((g, gi) => {
                            const gameAvg = g.ab > 0 ? (g.h / g.ab).toFixed(3) : '—';
                            return (
                              <tr key={gi} className={`border-b ${th.border} hover:bg-panel/50 transition-colors cursor-pointer`}
                                style={{ background: gi % 2 === 0 ? th.statsBg : undefined }}
                                onClick={() => window.location.href = `/player/${id}/daily?date=${g.date}`}>
                                <td className="px-2 py-1 text-center tabular-nums" style={{ color: th.label, fontSize: 11 }}>{g.dateShort}</td>
                                <td className="px-2 py-1 text-center font-semibold" style={{ color: th.fg, fontSize: 11 }}>
                                  {g.isHome === false ? '@' : 'vs'}{g.opponent ?? '?'}
                                </td>
                                <td className="px-2 py-1 text-center tabular-nums" style={{ color: th.fg, fontSize: 11 }}>{g.ab}</td>
                                <td className="px-2 py-1 text-center tabular-nums font-bold" style={{ fontSize: 11,
                                  color: g.h >= 3 ? '#22c55e' : g.h >= 2 ? '#a3e635' : g.h >= 1 ? th.fg : '#ef4444' }}>
                                  {g.h}
                                </td>
                                <td className="px-2 py-1 text-center tabular-nums" style={{ fontSize: 11,
                                  color: g.hr >= 2 ? '#22c55e' : g.hr >= 1 ? '#eab308' : th.label }}>
                                  {g.hr || '—'}
                                </td>
                                <td className="px-2 py-1 text-center tabular-nums" style={{ color: th.fg, fontSize: 11 }}>{g.rbi || '—'}</td>
                                <td className="px-2 py-1 text-center tabular-nums" style={{ color: th.fg, fontSize: 11 }}>{g.bb || '—'}</td>
                                <td className="px-2 py-1 text-center tabular-nums" style={{ color: th.fg, fontSize: 11 }}>{g.k || '—'}</td>
                                <td className="px-2 py-1 text-center tabular-nums" style={{ color: th.fg, fontSize: 11 }}>{g.sb || '—'}</td>
                                <td className="px-2 py-1 text-center tabular-nums" style={{ fontSize: 11,
                                  color: g.avgEv != null ? (g.avgEv >= 95 ? '#22c55e' : g.avgEv >= 88 ? '#eab308' : th.label) : th.label }}>
                                  {g.avgEv != null ? g.avgEv.toFixed(1) : '—'}
                                </td>
                                <td className="px-2 py-1 text-center tabular-nums" style={{ fontSize: 11,
                                  color: g.barrels > 0 ? '#ff8800' : th.label }}>
                                  {g.barrels > 0 ? g.barrels : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {data.games.length === 0 && (
                  <div className="text-center py-12 text-ink-4 text-sm">
                    No games found for {year}.{' '}
                    {year === String(CURRENT_YEAR) && 'Try selecting a past season.'}
                  </div>
                )}
              </div>
            </>
          )}

        </div>
        </div>
      </div>
    </div>
  );
}
