'use client';

import React, { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import { captureCardDesktop, shareOrCopyImage } from '@/lib/capture-card';
import { PITCH_SHORT, pitchColors, PitchLocationChart, PitchMovementChart } from '@/components/PitchCharts';
import type { RawDot } from '@/components/PitchCharts';

// ─── Benchmark constants (MLB p10/p90 — same as pitcher daily page) ───────────

const VELO_BENCHMARKS: Record<string, { p10: number; p90: number }> = {
  '4-Seam Fastball': { p10: 91.0, p90: 97.2 },
  'Sinker':          { p10: 90.4, p90: 96.6 },
  'Cutter':          { p10: 86.3, p90: 92.7 },
  'Changeup':        { p10: 81.7, p90: 90.4 },
  'Splitter':        { p10: 83.1, p90: 90.3 },
  'Curveball':       { p10: 74.8, p90: 84.2 },
  'Knuckle Curve':   { p10: 74.8, p90: 84.2 },
  'Slider':          { p10: 82.0, p90: 89.0 },
  'Sweeper':         { p10: 78.6, p90: 85.1 },
  'Slurve':          { p10: 78.5, p90: 84.6 },
};
const EXT_BENCHMARK = { p10: 5.9, p90: 6.9 };
const BARREL_BENCHMARKS: Record<string, { p10: number; p90: number }> = {
  '4-Seam Fastball': { p10: 0, p90:  9.9 },
  'Sinker':          { p10: 0, p90:  8.8 },
  'Cutter':          { p10: 0, p90: 12.5 },
  'Changeup':        { p10: 0, p90: 10.0 },
  'Splitter':        { p10: 0, p90:  9.1 },
  'Curveball':       { p10: 0, p90: 10.7 },
  'Knuckle Curve':   { p10: 0, p90:  8.3 },
  'Slider':          { p10: 0, p90: 10.7 },
  'Sweeper':         { p10: 0, p90: 10.3 },
  'Slurve':          { p10: 0, p90:  7.1 },
};
const ZONE_BENCHMARKS: Record<string, { p10: number; p90: number }> = {
  '4-Seam Fastball': { p10: 45.2, p90: 63.2 },
  'Sinker':          { p10: 43.5, p90: 66.1 },
  'Cutter':          { p10: 39.6, p90: 64.0 },
  'Changeup':        { p10: 23.8, p90: 50.2 },
  'Splitter':        { p10: 23.8, p90: 50.0 },
  'Curveball':       { p10: 29.1, p90: 54.5 },
  'Knuckle Curve':   { p10: 32.7, p90: 55.0 },
  'Slider':          { p10: 33.3, p90: 58.3 },
  'Sweeper':         { p10: 31.4, p90: 56.1 },
  'Slurve':          { p10: 25.0, p90: 49.1 },
};
const WHIFF_BENCHMARKS: Record<string, { p10: number; p90: number }> = {
  '4-Seam Fastball': { p10: 11.0, p90: 30.4 },
  'Sinker':          { p10:  4.5, p90: 21.5 },
  'Cutter':          { p10: 11.1, p90: 32.2 },
  'Changeup':        { p10: 12.5, p90: 46.2 },
  'Splitter':        { p10: 17.8, p90: 49.5 },
  'Curveball':       { p10: 14.1, p90: 44.6 },
  'Knuckle Curve':   { p10:  6.7, p90: 43.1 },
  'Slider':          { p10: 16.4, p90: 45.5 },
  'Sweeper':         { p10: 17.2, p90: 45.2 },
  'Slurve':          { p10: 16.7, p90: 44.8 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getHeatColor(t: number): { bg: string; text: string } {
  const c = Math.max(0, Math.min(1, t));
  let r: number, g: number, b: number;
  if (c <= 0.5) {
    const s = (0.5 - c) / 0.5;
    r = Math.round(255 + s * (22  - 255));
    g = Math.round(255 + s * (61  - 255));
    b = Math.round(255 + s * (110 - 255));
  } else {
    const s = (c - 0.5) / 0.5;
    r = 255;
    g = Math.round(255 + s * (45  - 255));
    b = Math.round(255 + s * (45  - 255));
  }
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return { bg: `rgb(${r},${g},${b})`, text: lum > 0.5 ? '#111827' : '#ffffff' };
}

function calcAge(bd: string | null): number | null {
  if (!bd) return null;
  const b = new Date(bd), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  const m = n.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--;
  return a;
}

function parseIp(ip: string): number {
  if (!ip) return 0;
  const parts = ip.split('.');
  return (parseInt(parts[0]) || 0) + (parseInt(parts[1]) || 0) / 3;
}

type UsageStrip = { name: string; pct: number; velo: number | null }[];
function computeUsageByHand(rawDots: { pitchType: string; batterSide: string | null; velo: number | null }[]): { L: UsageStrip; R: UsageStrip } {
  const acc: Record<'L' | 'R', Record<string, { count: number; veloSum: number; veloCnt: number }>> = { L: {}, R: {} };
  for (const dot of rawDots) {
    if (dot.batterSide !== 'L' && dot.batterSide !== 'R') continue;
    const s = dot.batterSide as 'L' | 'R';
    if (!acc[s][dot.pitchType]) acc[s][dot.pitchType] = { count: 0, veloSum: 0, veloCnt: 0 };
    acc[s][dot.pitchType].count++;
    if (dot.velo !== null) { acc[s][dot.pitchType].veloSum += dot.velo; acc[s][dot.pitchType].veloCnt++; }
  }
  const toStrip = (map: Record<string, { count: number; veloSum: number; veloCnt: number }>): UsageStrip => {
    const total = Object.values(map).reduce((s, v) => s + v.count, 0);
    return Object.entries(map).sort((a, b) => b[1].count - a[1].count).map(([name, stats]) => ({
      name,
      pct: total > 0 ? (stats.count / total) * 100 : 0,
      velo: stats.veloCnt > 0 ? stats.veloSum / stats.veloCnt : null,
    }));
  };
  return { L: toStrip(acc.L), R: toStrip(acc.R) };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PitchType {
  name: string; count: number; usage: number;
  velo: number | null; maxVelo: number | null; spin: number | null;
  h_movement: number | null; v_movement: number | null;
  vaa: number | null; haa: number | null;
  whiff: number | null; whiffs: number; swings: number;
  zone_pct: number | null; barrel_pct: number | null;
  h_rel: number | null; v_rel: number | null; extension: number | null;
}

interface GameLine {
  date: string; ip: string; h: number; er: number; bb: number;
  k: number; hr: number; pitches: number; strikes: number; bf: number;
  era: string | null;
}

interface PitchData {
  totalPitches: number; pitchTypes: PitchType[];
  rawDots: RawDot[]; throws: 'L' | 'R' | null;
  armAngle: number | null; strikePct: number | null;
  swingAndMissPct: number | null; totalWhiffs: number;
}

interface DailyData {
  playerId: number;
  playerName: string | null;
  playerHeight: string | null; playerWeight: number | null;
  playerBirthDate: string | null; playerPitchHand: string | null;
  playerBatSide: string | null;
  date: string;
  gameLine: GameLine;
  gameInfo: {
    gamePk: number | null; opponent: string | null; opponentFull: string | null;
    team: string | null; isHome: boolean | null; date: string; sportId: number;
  };
  pitchData: PitchData | null;
  availableDates: { date: string; opponent: string; ip: string; er: number; k: number; gamePk?: number }[];
}

// ─── Inner page ───────────────────────────────────────────────────────────────

function FclPitcherPageInner() {
  const params = useSearchParams();
  const pitcherId = Number(params.get('pitcherId') ?? '0');
  const dateParam  = params.get('date') ?? '';
  const gamePkParam = params.get('gamePk') ?? '';

  const [data, setData]         = useState<DailyData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(dateParam || new Date().toISOString().slice(0, 10));
  const [light, setLight]       = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [copied, setCopied]     = useState(false);
  const [imgErr, setImgErr]     = useState(0);
  const [customArmAngle, setCustomArmAngle] = useState<string>('');
  const cardRef = useRef<HTMLDivElement>(null);

  const fetchData = async (date?: string) => {
    if (!pitcherId) return;
    setLoading(true); setError(null);
    try {
      const d = date ?? selectedDate;
      const gpParam = gamePkParam ? `&gamePk=${gamePkParam}` : '';
      const res = await fetch(`/api/pitcher-daily?playerId=${pitcherId}&date=${d}${gpParam}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'No game found for this date');
        // Preserve player info + available dates from the error body
        setData(prev => ({
          ...(prev ?? {}),
          playerName: json.playerName ?? prev?.playerName ?? null,
          playerHeight: json.playerHeight ?? prev?.playerHeight ?? null,
          playerWeight: json.playerWeight ?? prev?.playerWeight ?? null,
          playerBirthDate: json.playerBirthDate ?? prev?.playerBirthDate ?? null,
          playerPitchHand: json.playerPitchHand ?? prev?.playerPitchHand ?? null,
          playerBatSide: json.playerBatSide ?? prev?.playerBatSide ?? null,
          availableDates: json.availableDates ?? prev?.availableDates ?? [],
        } as DailyData));
      } else {
        setData(json);
        setSelectedDate(json.date);
      }
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(dateParam || undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived values ───────────────────────────────────────────────────────────
  const displayName  = data?.playerName ?? (pitcherId ? `Player #${pitcherId}` : '—');
  const gameLine     = data?.gameLine   ?? null;
  const gameInfo     = data?.gameInfo   ?? null;
  const pitchData    = data?.pitchData  ?? null;
  const usageByHand  = pitchData?.rawDots ? computeUsageByHand(pitchData.rawDots) : { L: [], R: [] };
  const totalPitches = pitchData?.totalPitches ?? gameLine?.pitches ?? 0;
  const strikePct    = pitchData?.strikePct
    ?? (gameLine && totalPitches > 0 ? Math.round((gameLine.strikes / totalPitches) * 1000) / 10 : null);

  const teamAbbr     = gameInfo?.team     ?? '';
  const oppAbbr      = gameInfo?.opponent ?? '';
  const oppFull      = gameInfo?.opponentFull ?? oppAbbr;
  const teamLogo     = teamAbbr ? getMLBTeamLogoUrl(teamAbbr) : null;
  const oppLogo      = oppAbbr  ? getMLBTeamLogoUrl(oppAbbr)  : null;

  const imgSrcs = [
    `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_213,q_auto:best/v1/people/${pitcherId}/headshot/silo/current`,
    '/placeholder-player.png',
  ];
  const currentImg = imgSrcs[Math.min(imgErr, imgSrcs.length - 1)];

  const bio = (() => {
    const parts: string[] = [];
    if (data?.playerHeight) parts.push(data.playerHeight);
    if (data?.playerWeight) parts.push(`${data.playerWeight} lbs`);
    const age = calcAge(data?.playerBirthDate ?? null);
    if (age !== null) parts.push(`Age ${age}`);
    if (data?.playerBatSide && data?.playerPitchHand) parts.push(`${data.playerBatSide}/${data.playerPitchHand}`);
    return parts.join(' • ');
  })();

  // ── Image export ─────────────────────────────────────────────────────────────
  const captureCard = async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    const { toPng } = await import('html-to-image');
    return toPng(cardRef.current, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: light ? '#ffffff' : '#161616',
      filter: (node) => !(node as HTMLElement).classList?.contains('export-ignore'),
    });
  };
  const handleDownload = async () => {
    if (capturing) return; setCapturing(true);
    try {
      const url = await captureCard(); if (!url) return;
      const a = document.createElement('a');
      a.download = `${displayName.replace(/\s+/g, '-')}-${selectedDate}.png`;
      a.href = url; a.click();
    } catch (e) { console.error(e); } finally { setCapturing(false); }
  };
  const handleCopy = async () => {
    if (capturing) return; setCapturing(true);
    try {
      const url = await captureCard(); if (!url) return;
      const blob = await fetch(url).then(r => r.blob());
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch (e) { console.error('copy failed', e); } finally { setCapturing(false); }
  };

  // ── Theme ────────────────────────────────────────────────────────────────────
  const BL = '2px solid #000000';
  const th = {
    banner:        light ? '#374151'              : '#000000',
    label:         light ? '#6b7280'              : '#777777',
    fg:            light ? '#000000'              : '#ffffff',
    ink2:          light ? '#111111'              : 'var(--color-ink-2)',
    ink3:          light ? '#333333'              : 'var(--color-ink-3)',
    ink4:          light ? '#555555'              : 'var(--color-ink-4)',
    tableBg:       light ? '#f7f7f7'              : undefined,
    cardBg:        light ? '#ffffff'              : undefined,
    btnFg:         light ? 'rgba(0,0,0,0.55)'    : 'rgba(255,255,255,0.6)',
    btnBg:         light ? 'rgba(0,0,0,0.05)'    : 'rgba(255,255,255,0.08)',
    btnBorder:     light ? 'rgba(0,0,0,0.18)'    : 'rgba(255,255,255,0.18)',
    sectionBorder: light ? { border: BL }         : {} as React.CSSProperties,
  };

  if (!pitcherId) {
    return <div className="p-8 text-ink-3 text-sm">No pitcher ID — add ?pitcherId=XXXXX to the URL.</div>;
  }

  return (
    <div className="min-h-screen bg-panel text-deep-fg" data-light={light ? 'true' : undefined}>
      {/* Nav */}
      <header className="bg-panel border-b border-ink/20">
        <div className="mx-auto px-4 py-3 flex items-center justify-between" style={{ maxWidth: 960 }}>
          <Link href="/pitchers" className="text-blue-400 hover:text-blue-300 font-medium text-sm">
            ← Daily Pitchers
          </Link>
          <span className="text-ink-3 text-xs font-semibold uppercase tracking-wider">FCL · ACL Pitcher Card</span>
          <div className="flex items-center gap-3">
            <Link
              href={`/fcl/pitcher/season?pitcherId=${pitcherId}`}
              className="text-orange-400 hover:text-orange-300 font-medium text-sm"
            >
              📊 Season
            </Link>
            <Link href="/fcl" className="text-green-400 hover:text-green-300 font-medium text-sm">
              FCL Games →
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto px-2 py-3" style={{ maxWidth: 960 }}>

        {/* Export buttons — outside card */}
        <div className="export-ignore flex justify-between items-center mb-2">
          {/* Arm angle override */}
          <div className="flex items-center gap-1 text-xs text-ink-3">
            <span>Arm Angle:</span>
            <input
              type="number"
              placeholder={pitchData?.armAngle != null ? String(Math.round(Math.abs(pitchData.armAngle))) : 'auto'}
              value={customArmAngle}
              onChange={e => setCustomArmAngle(e.target.value)}
              className="w-14 px-1 py-0.5 rounded bg-bone border border-ink/30 text-deep-fg text-xs text-center"
            />
            {customArmAngle !== '' && (
              <button onClick={() => setCustomArmAngle('')} className="text-ink-4 hover:text-ink text-xs">✕</button>
            )}
          </div>
          <div className="flex items-center gap-2">
          <button onClick={() => setLight(l => !l)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: th.btnBg, border: `1px solid ${th.btnBorder}`, color: th.btnFg, borderRadius: 3, whiteSpace: 'nowrap' }}>
            {light ? '☀ Light' : '☾ Dark'}
          </button>
          <button onClick={handleCopy} disabled={capturing} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: capturing ? 'wait' : 'pointer', background: copied ? '#166534' : th.btnBg, border: `1px solid ${copied ? '#16a34a' : th.btnBorder}`, color: copied ? '#4ade80' : th.btnFg, borderRadius: 3, whiteSpace: 'nowrap' }}>
            {copied ? '✓ Done' : capturing ? '…' : '⎘ Copy'}
          </button>
          <button onClick={handleDownload} disabled={capturing} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: capturing ? 'wait' : 'pointer', background: th.btnBg, border: `1px solid ${th.btnBorder}`, color: th.btnFg, borderRadius: 3, whiteSpace: 'nowrap' }}>
            {capturing ? '…' : '↓ PNG'}
          </button>
          </div>
        </div>

        {/* ── CARD ──────────────────────────────────────────────────────────── */}
        <div ref={cardRef} className="bg-panel" style={light ? { background: '#ffffff', border: BL } : {}}>

          {/* Header: photo + name/bio/game */}
          <div className="p-4 pb-2" style={light ? { background: '#ffffff' } : {}}>
            <div className="flex items-center justify-center gap-4">
              {/* Headshot */}
              <div className="flex-shrink-0 w-20 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentImg}
                  alt={displayName}
                  className="w-full h-auto"
                  onError={() => setImgErr(e => Math.min(e + 1, imgSrcs.length - 1))}
                />
              </div>
              {/* Name / bio / game info */}
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-3 mb-0.5">
                  <h1 className="font-display text-3xl uppercase tracking-[0.02em]" style={{ color: th.fg }}>
                    {displayName}
                  </h1>
                  {teamLogo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={teamLogo} alt={teamAbbr} className="w-10 h-10 object-contain flex-shrink-0" />
                  )}
                </div>
                {bio && <p className="text-sm mb-1" style={{ color: th.ink4 }}>{bio}</p>}
                <div className="text-xs leading-snug" style={{ color: th.ink3 }}>
                  {/* Line 1: team · date */}
                  <div className="flex items-center gap-x-2">
                    {teamAbbr && <span className="font-bold" style={{ color: th.fg }}>{teamAbbr}</span>}
                    {gameInfo && <><span>·</span><span>{gameInfo.date}</span></>}
                  </div>
                  {/* Line 2: vs/@ opponent */}
                  {gameInfo && (
                    <div className="flex items-center gap-x-1 mt-0.5">
                      <span>{gameInfo.isHome ? 'vs' : '@'}</span>
                      {oppLogo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={oppLogo} alt={oppAbbr} className="w-4 h-4 object-contain inline" />
                      )}
                      <span className="font-semibold" style={{ color: th.fg }}>{oppFull}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Game log stats box */}
          {gameLine && !loading && (
            <div className="mx-4 mb-3" style={th.sectionBorder}>
              <div
                className="font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b border-ink/10"
                style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}
              >
                Game Log
              </div>
              <div className="grid grid-cols-8 divide-x divide-ink/10" style={{ background: th.tableBg }}>
                {[
                  { label: 'IP',   value: gameLine.ip },
                  { label: 'H',    value: String(gameLine.h) },
                  { label: 'ER',   value: String(gameLine.er) },
                  { label: 'BB',   value: String(gameLine.bb) },
                  { label: 'K',    value: String(gameLine.k) },
                  { label: 'HR',   value: String(gameLine.hr) },
                  { label: 'P',    value: totalPitches ? String(totalPitches) : '—' },
                  { label: 'STR%', value: strikePct != null ? `${strikePct}%` : '—' },
                ].map(s => (
                  <div key={s.label} className="text-center px-2 py-1.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                    <div className="font-bold font-display tabular-nums" style={{ fontSize: 18, color: th.fg }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Loading / error */}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent animate-spin" />
              <span className="text-ink-3 text-xs">Loading pitch data…</span>
            </div>
          )}
          {!loading && error && (
            <div className="mx-4 mb-3 bg-bone p-3">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          {/* Charts row: vs LHH · vs RHH · Pitch Breaks */}
          {(pitchData?.rawDots?.length ?? 0) > 0 && (
            <div className="flex justify-center gap-4 px-4 mb-1">
              <div className="flex flex-col items-center">
                <PitchLocationChart rawDots={pitchData!.rawDots} batterSide="L" label="vs LHH" size={280} />
                {usageByHand.L.length > 0 && (
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 justify-center mt-1 px-1" style={{ width: 280 }}>
                    {usageByHand.L.map(({ name, pct, velo }) => {
                      const col = pitchColors(name);
                      const short = PITCH_SHORT[name] ?? name;
                      return (
                        <div key={name} className="flex items-center gap-1">
                          <span className="px-1 py-px rounded text-[9px] font-bold leading-none" style={{ background: col.bg, color: col.text }}>{short}</span>
                          <span className="text-[10px] font-medium text-black">{pct.toFixed(0)}%</span>
                          {velo !== null && <span className="text-[10px] text-black">{velo.toFixed(1)}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-center">
                <PitchLocationChart rawDots={pitchData!.rawDots} batterSide="R" label="vs RHH" size={280} />
                {usageByHand.R.length > 0 && (
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 justify-center mt-1 px-1" style={{ width: 280 }}>
                    {usageByHand.R.map(({ name, pct, velo }) => {
                      const col = pitchColors(name);
                      const short = PITCH_SHORT[name] ?? name;
                      return (
                        <div key={name} className="flex items-center gap-1">
                          <span className="px-1 py-px rounded text-[9px] font-bold leading-none" style={{ background: col.bg, color: col.text }}>{short}</span>
                          <span className="text-[10px] font-medium text-black">{pct.toFixed(0)}%</span>
                          {velo !== null && <span className="text-[10px] text-black">{velo.toFixed(1)}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <PitchMovementChart
                rawDots={pitchData!.rawDots}
                throws={(pitchData?.throws ?? data?.playerPitchHand ?? undefined) as 'L' | 'R' | undefined}
                armAngle={customArmAngle !== '' ? parseFloat(customArmAngle) : (pitchData?.armAngle ?? undefined)}
                size={280}
              />
            </div>
          )}

          {/* Pitch type table */}
          {(pitchData?.pitchTypes?.length ?? 0) > 0 && (
            <div className="overflow-hidden" style={light ? { background: '#ffffff' } : {}}>
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '6%' }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-ink/20" style={{ background: th.banner }}>
                    {['Pitch','Pitches','Usage','Velo','Max Velo','IVB','HB','Spin','VAA','HAA','vRel','hRel','Ext.','Zone%','Barrel%','Whiff%','Whiffs'].map(h => (
                      <th key={h} className="px-1 py-2 text-[11px] font-semibold uppercase tracking-wider text-center" style={{ color: light ? '#ffffff' : th.label }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pitchData!.pitchTypes.map(p => {
                    const col       = pitchColors(p.name);
                    const shortName = PITCH_SHORT[p.name] ?? p.name.slice(0, 2).toUpperCase();
                    return (
                      <tr key={p.name} className="border-b border-ink/10" style={{ background: th.tableBg }}>
                        {/* Pitch label */}
                        <td className="px-1 py-1.5">
                          <div className="flex items-center gap-1 justify-center">
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0"
                              style={{ backgroundColor: col.bg, color: col.text }}>{shortName}</span>
                            <span className="text-[9px] truncate" style={{ color: th.ink2 }}>{p.name}</span>
                          </div>
                        </td>
                        <td className="px-1 py-1.5 text-center font-semibold" style={{ color: th.fg }}>{p.count}</td>
                        <td className="px-1 py-1.5 text-center font-semibold" style={{ color: th.fg }}>{p.usage.toFixed(1)}%</td>
                        {/* Velo — heat colored */}
                        {(() => {
                          const bm = VELO_BENCHMARKS[p.name] ?? { p10: 80, p90: 97 };
                          const t  = p.velo != null ? Math.max(0, Math.min(1, (p.velo - bm.p10) / (bm.p90 - bm.p10))) : null;
                          const wc = t != null ? getHeatColor(t) : null;
                          return <td className="px-1 py-1.5 text-center font-semibold" style={{ backgroundColor: wc?.bg, color: wc?.text ?? th.fg }}>{p.velo?.toFixed(1) ?? '—'}</td>;
                        })()}
                        {/* Max Velo */}
                        {(() => {
                          const bm = VELO_BENCHMARKS[p.name] ?? { p10: 80, p90: 97 };
                          const t  = p.maxVelo != null ? Math.max(0, Math.min(1, (p.maxVelo - bm.p10) / (bm.p90 - bm.p10))) : null;
                          const wc = t != null ? getHeatColor(t) : null;
                          return <td className="px-1 py-1.5 text-center font-semibold" style={{ backgroundColor: wc?.bg, color: wc?.text ?? th.fg }}>{p.maxVelo?.toFixed(1) ?? '—'}</td>;
                        })()}
                        <td className="px-1 py-1.5 text-center font-semibold" style={{ color: th.fg }}>{p.v_movement?.toFixed(1) ?? '—'}</td>
                        <td className="px-1 py-1.5 text-center font-semibold" style={{ color: th.fg }}>{p.h_movement?.toFixed(1) ?? '—'}</td>
                        <td className="px-1 py-1.5 text-center font-semibold" style={{ color: th.fg }}>{p.spin ?? '—'}</td>
                        <td className="px-1 py-1.5 text-center font-semibold" style={{ color: th.fg }}>{p.vaa != null ? `${p.vaa.toFixed(1)}°` : '—'}</td>
                        <td className="px-1 py-1.5 text-center font-semibold" style={{ color: th.fg }}>{p.haa != null ? `${p.haa.toFixed(1)}°` : '—'}</td>
                        <td className="px-1 py-1.5 text-center font-semibold" style={{ color: th.fg }}>{p.v_rel?.toFixed(2) ?? '—'}</td>
                        <td className="px-1 py-1.5 text-center font-semibold" style={{ color: th.fg }}>{p.h_rel?.toFixed(2) ?? '—'}</td>
                        {/* Extension */}
                        {(() => {
                          const t  = p.extension != null ? Math.max(0, Math.min(1, (p.extension - EXT_BENCHMARK.p10) / (EXT_BENCHMARK.p90 - EXT_BENCHMARK.p10))) : null;
                          const wc = t != null ? getHeatColor(t) : null;
                          return <td className="px-1 py-1.5 text-center font-semibold" style={{ backgroundColor: wc?.bg, color: wc?.text ?? th.fg }}>{p.extension?.toFixed(2) ?? '—'}</td>;
                        })()}
                        {/* Zone% */}
                        {(() => {
                          const bm = ZONE_BENCHMARKS[p.name] ?? { p10: 0, p90: 100 };
                          const t  = p.zone_pct != null ? Math.max(0, Math.min(1, (p.zone_pct - bm.p10) / (bm.p90 - bm.p10))) : null;
                          const wc = t != null ? getHeatColor(t) : null;
                          return <td className="px-1 py-1.5 text-center font-semibold" style={{ backgroundColor: wc?.bg, color: wc?.text ?? th.fg }}>{p.zone_pct != null ? `${p.zone_pct.toFixed(1)}%` : '—'}</td>;
                        })()}
                        {/* Barrel% — inverted (lower = better) */}
                        {(() => {
                          const bm = BARREL_BENCHMARKS[p.name] ?? { p10: 0, p90: 10 };
                          const t  = p.barrel_pct != null ? Math.max(0, Math.min(1, 1 - (p.barrel_pct - bm.p10) / (bm.p90 - bm.p10))) : null;
                          const wc = t != null ? getHeatColor(t) : null;
                          return <td className="px-1 py-1.5 text-center font-semibold" style={{ backgroundColor: wc?.bg, color: wc?.text ?? th.fg }}>{p.barrel_pct != null ? `${p.barrel_pct.toFixed(1)}%` : '—'}</td>;
                        })()}
                        {/* Whiff% */}
                        {(() => {
                          const bm = WHIFF_BENCHMARKS[p.name] ?? { p10: 0, p90: 100 };
                          const t  = p.whiff != null ? Math.max(0, Math.min(1, (p.whiff - bm.p10) / (bm.p90 - bm.p10))) : null;
                          const wc = t != null ? getHeatColor(t) : null;
                          return <td className="px-1 py-1.5 text-center font-semibold" style={{ backgroundColor: wc?.bg, color: wc?.text ?? th.fg }}>{p.whiff != null ? `${p.whiff.toFixed(1)}%` : '—'}</td>;
                        })()}
                        {/* Whiffs count — same heat color as Whiff% */}
                        {(() => {
                          const bm = WHIFF_BENCHMARKS[p.name] ?? { p10: 0, p90: 100 };
                          const t  = p.whiff != null ? Math.max(0, Math.min(1, (p.whiff - bm.p10) / (bm.p90 - bm.p10))) : null;
                          const wc = t != null ? getHeatColor(t) : null;
                          return <td className="px-1 py-1.5 text-center font-semibold" style={{ backgroundColor: wc?.bg, color: wc?.text ?? th.fg }}>{p.whiffs > 0 ? p.whiffs : '—'}</td>;
                        })()}
                      </tr>
                    );
                  })}
                  {/* All row */}
                  <tr className="font-bold border-t border-ink/30" style={{ background: th.banner, color: light ? '#ffffff' : 'var(--color-deep-fg)' }}>
                    <td className="px-1 py-1.5 text-center">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: light ? '#d0d0d0' : '' }}>All</span>
                    </td>
                    <td className="px-1 py-1.5 text-center">{pitchData?.totalPitches ?? '—'}</td>
                    <td className="px-1 py-1.5 text-center">100%</td>
                    {Array.from({ length: 13 }).map((_, i) => (
                      <td key={i} className="px-1 py-1.5 text-center">—</td>
                    ))}
                    <td className="px-1 py-1.5 text-center">
                      {pitchData?.swingAndMissPct != null ? `${pitchData.swingAndMissPct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-1 py-1.5 text-center">
                      {(pitchData?.totalWhiffs ?? 0) > 0 ? pitchData!.totalWhiffs : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Strike% / SwStr% footer */}
              {(strikePct != null || pitchData?.swingAndMissPct != null) && (
                <div className="px-4 py-2 border-t border-ink/20 text-xs flex gap-6" style={{ color: th.ink4 }}>
                  {strikePct != null && (
                    <span>Strike%: <span className="font-semibold" style={{ color: th.fg }}>{strikePct.toFixed(1)}%</span></span>
                  )}
                  {pitchData?.swingAndMissPct != null && (
                    <span>SwStr%: <span className="font-semibold" style={{ color: th.fg }}>{pitchData.swingAndMissPct.toFixed(1)}%</span></span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Credit line */}
          <div className="flex justify-end px-4 py-2">
            <span className="font-display text-[9px] font-bold tracking-[0.08em] uppercase" style={{ color: th.ink4 }}>
              By @Piratefan003 &nbsp; Data: MLB Stats API · Baseball Savant
            </span>
          </div>

        </div>
        {/* end cardRef */}

        {/* ── Available games — outside card (excluded from image export) ── */}
        {(data?.availableDates?.length ?? 0) > 0 && (
          <div className="mt-4 border border-ink/30 bg-panel p-3">
            <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wide mb-3">
              Available Games
              <span className="ml-2 font-normal normal-case text-ink-4">{data!.availableDates.length} games</span>
            </h3>
            <div className="flex flex-wrap gap-2">
              {data!.availableDates.map(g => {
                const isSelected = g.date === selectedDate;
                return (
                  <button
                    key={`${g.date}-${g.gamePk}`}
                    onClick={() => { setSelectedDate(g.date); fetchData(g.date); }}
                    className={`text-xs px-3 py-1.5 border transition-colors text-left ${
                      isSelected
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-panel border-ink/20 text-ink-2 hover:border-ink/40 hover:text-ink'
                    }`}
                  >
                    <div className="font-semibold">{g.date}</div>
                    <div className="text-[10px] mt-0.5 opacity-70">
                      vs {g.opponent} · {g.ip} IP · {g.k}K · {g.er}ER
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default function FclPitcherPage() {
  return (
    <Suspense fallback={<div className="p-8 text-ink-3 text-sm">Loading…</div>}>
      <FclPitcherPageInner />
    </Suspense>
  );
}
