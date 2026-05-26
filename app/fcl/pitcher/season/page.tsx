'use client';

import React, { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import { captureCardDesktop, shareOrCopyImage } from '@/lib/capture-card';
import { PITCH_SHORT, pitchColors, PitchLocationChart, PitchMovementChart } from '@/components/PitchCharts';
import type { RawDot } from '@/components/PitchCharts';

// ─── Benchmark constants (MLB p10/p90 — same as daily card) ──────────────────

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

interface PitchData {
  totalPitches: number; pitchTypes: PitchType[];
  rawDots: RawDot[]; throws: 'L' | 'R' | null;
  armAngle: number | null; strikePct: number | null;
  swingAndMissPct: number | null; totalWhiffs: number;
}

interface AggGameLine {
  games: number; ip: string;
  h: number; er: number; bb: number; k: number; hr: number;
  pitches: number; bf: number; era: string | null;
}

interface Outing {
  date: string; opponent: string; ip: string;
  h: number; er: number; bb: number; k: number; hr: number;
  pitches: number; bf: number;
  gamePk: number | undefined; isHome: boolean | null; team: string | null;
}

interface SeasonData {
  playerId: number;
  playerName: string | null;
  playerHeight: string | null; playerWeight: number | null;
  playerBirthDate: string | null; playerPitchHand: string | null;
  playerBatSide: string | null;
  currentTeamAbbr: string | null;
  season: number;
  aggregatedGameLine: AggGameLine;
  pitchData: PitchData | null;
  outings: Outing[];
}

// ─── Inner page ───────────────────────────────────────────────────────────────

function FclPitcherSeasonInner() {
  const params = useSearchParams();
  const pitcherId = Number(params.get('pitcherId') ?? '0');
  const seasonParam = params.get('season') ?? String(new Date().getFullYear());

  const [data, setData]           = useState<SeasonData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [light, setLight]         = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [copied, setCopied]       = useState(false);
  const [imgErr, setImgErr]       = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pitcherId) return;
    setLoading(true); setError(null);
    fetch(`/api/fcl-pitcher-season?playerId=${pitcherId}&season=${seasonParam}`)
      .then(r => r.json())
      .then(json => {
        if (json.error) setError(json.error);
        else setData(json);
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [pitcherId, seasonParam]);

  // ── Derived values ───────────────────────────────────────────────────────────
  const displayName  = data?.playerName ?? (pitcherId ? `Player #${pitcherId}` : '—');
  const agl          = data?.aggregatedGameLine ?? null;
  const pitchData    = data?.pitchData ?? null;

  // Prefer currentTeamAbbr from bio (always populated); fall back to first outing's team
  const teamAbbr     = data?.currentTeamAbbr ?? data?.outings?.[0]?.team ?? '';
  const teamLogo     = teamAbbr ? getMLBTeamLogoUrl(teamAbbr) : null;

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
      a.download = `${displayName.replace(/\s+/g, '-')}-${seasonParam}-FCL-Season.png`;
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
    banner:        light ? '#e8e8e8'              : '#000000',
    label:         light ? '#000000'              : '#777777',
    fg:            light ? '#000000'              : '#ffffff',
    ink2:          light ? '#111111'              : 'var(--color-ink-2)',
    ink3:          light ? '#333333'              : 'var(--color-ink-3)',
    ink4:          light ? '#555555'              : 'var(--color-ink-4)',
    tableBg:       light ? '#f7f7f7'              : undefined,
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
        <div className="mx-auto px-4 py-3 flex items-center justify-between" style={{ maxWidth: 1088 }}>
          <Link
            href={`/fcl/pitcher?pitcherId=${pitcherId}`}
            className="text-blue-400 hover:text-blue-300 font-medium text-sm"
          >
            ← Daily Card
          </Link>
          <span className="text-ink-3 text-xs font-semibold uppercase tracking-wider">
            FCL · ACL Season Summary
          </span>
          <Link href="/pitchers?league=fcl" className="text-orange-400 hover:text-orange-300 font-medium text-sm">
            Leaderboard →
          </Link>
        </div>
      </header>

      <div className="mx-auto px-2 py-3" style={{ maxWidth: 1088 }}>

        {/* Export buttons */}
        <div className="export-ignore flex justify-end gap-2 mb-2">
          <button onClick={() => setLight(l => !l)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: th.btnBg, border: `1px solid ${th.btnBorder}`, color: th.btnFg, borderRadius: 3 }}>
            {light ? '☀ Light' : '☾ Dark'}
          </button>
          <button onClick={handleCopy} disabled={capturing} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: capturing ? 'wait' : 'pointer', background: copied ? '#166534' : th.btnBg, border: `1px solid ${copied ? '#16a34a' : th.btnBorder}`, color: copied ? '#4ade80' : th.btnFg, borderRadius: 3 }}>
            {copied ? '✓ Done' : capturing ? '…' : '⎘ Copy'}
          </button>
          <button onClick={handleDownload} disabled={capturing} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: capturing ? 'wait' : 'pointer', background: th.btnBg, border: `1px solid ${th.btnBorder}`, color: th.btnFg, borderRadius: 3 }}>
            {capturing ? '…' : '↓ PNG'}
          </button>
        </div>

        {/* ── CARD ──────────────────────────────────────────────────────────── */}
        <div ref={cardRef} className="bg-panel" style={light ? { background: '#ffffff', border: BL } : {}}>

          {/* Header: photo + name / bio / season label */}
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

              {/* Name / bio / season */}
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
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" style={{ color: th.ink3 }}>
                  {teamAbbr && <span className="font-bold" style={{ color: th.fg }}>{teamAbbr}</span>}
                  <span>·</span>
                  <span className="font-semibold" style={{ color: th.fg }}>{seasonParam} FCL/ACL Season</span>
                  {agl && agl.games > 0 && (
                    <>
                      <span>·</span>
                      <span>{agl.games} {agl.games === 1 ? 'appearance' : 'appearances'}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Season aggregate stats box */}
          {agl && !loading && agl.games > 0 && (
            <div className="mx-4 mb-3" style={th.sectionBorder}>
              <div
                className="font-display italic text-[13px] uppercase tracking-widest text-center py-0.5 border-b border-ink/10"
                style={{ background: th.banner, color: th.fg, fontWeight: 900 }}
              >
                {seasonParam} Season
              </div>
              <div className="grid grid-cols-9 divide-x divide-ink/10" style={{ background: th.tableBg }}>
                {(() => {
                  const bbPct = agl.bf > 0 ? agl.bb / agl.bf * 100 : null;
                  const kPct  = agl.bf > 0 ? agl.k  / agl.bf * 100 : null;
                  const kbb   = bbPct != null && kPct != null ? kPct - bbPct : null;
                  return [
                  { label: 'G',     value: String(agl.games) },
                  { label: 'IP',    value: agl.ip },
                  { label: 'H',     value: String(agl.h) },
                  { label: 'ER',    value: String(agl.er) },
                  { label: 'BB%',   value: bbPct != null ? `${bbPct.toFixed(1)}%` : '—' },
                  { label: 'K%',    value: kPct  != null ? `${kPct.toFixed(1)}%`  : '—' },
                  { label: 'K-BB%', value: kbb   != null ? `${kbb.toFixed(1)}%`   : '—' },
                  { label: 'HR',    value: String(agl.hr) },
                  { label: 'ERA',   value: agl.era ?? '—' },
                  ];
                })().map(s => (
                  <div key={s.label} className="text-center px-2 py-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                    <div className="font-bold font-display tabular-nums" style={{ fontSize: 15, color: th.fg }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Loading / error */}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent animate-spin" />
              <span className="text-ink-3 text-xs">Loading season pitch data…</span>
            </div>
          )}
          {!loading && error && (
            <div className="mx-4 mb-3 bg-bone p-3">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}
          {!loading && !error && agl && agl.games === 0 && (
            <div className="mx-4 mb-3 text-ink-3 text-sm text-center py-6">
              No FCL/ACL appearances found for {seasonParam}.
            </div>
          )}

          {/* Charts row */}
          {(pitchData?.rawDots?.length ?? 0) > 0 && (
            <div className="flex justify-center gap-4 px-4 mb-1">
              <PitchLocationChart rawDots={pitchData!.rawDots} batterSide="L" label="vs LHH" />
              <PitchLocationChart rawDots={pitchData!.rawDots} batterSide="R" label="vs RHH" />
              <PitchMovementChart
                rawDots={pitchData!.rawDots}
                throws={(pitchData?.throws ?? data?.playerPitchHand ?? undefined) as 'L' | 'R' | undefined}
                armAngle={pitchData?.armAngle ?? undefined}
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
                      <th key={h} className="px-1 py-2 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: th.label }}>{h}</th>
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
                        {/* Velo */}
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
                        {/* Barrel% — inverted */}
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
                        {/* Whiffs count */}
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
                  <tr className="font-bold border-t border-ink/30" style={{ background: th.banner }}>
                    <td className="px-1 py-1.5 text-center">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: light ? '#d0d0d0' : '', color: th.fg }}>All</span>
                    </td>
                    <td className="px-1 py-1.5 text-center" style={{ color: th.fg }}>{pitchData?.totalPitches ?? '—'}</td>
                    <td className="px-1 py-1.5 text-center" style={{ color: th.fg }}>100%</td>
                    {Array.from({ length: 13 }).map((_, i) => (
                      <td key={i} className="px-1 py-1.5 text-center" style={{ color: th.fg }}>—</td>
                    ))}
                    <td className="px-1 py-1.5 text-center" style={{ color: th.fg }}>
                      {pitchData?.swingAndMissPct != null ? `${pitchData.swingAndMissPct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-1 py-1.5 text-center" style={{ color: th.fg }}>
                      {(pitchData?.totalWhiffs ?? 0) > 0 ? pitchData!.totalWhiffs : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* SwStr% footer */}
              {(pitchData?.strikePct != null || pitchData?.swingAndMissPct != null) && (
                <div className="px-4 py-2 border-t border-ink/20 text-xs flex gap-6" style={{ color: th.ink4 }}>
                  {pitchData?.strikePct != null && (
                    <span>Strike%: <span className="font-semibold" style={{ color: th.fg }}>{pitchData.strikePct.toFixed(1)}%</span></span>
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
              By @Piratefan003 &nbsp; Data: MLB Stats API
            </span>
          </div>

        </div>
        {/* end cardRef */}

        {/* ── Outings table — outside card (excluded from image export) ──────── */}
        {(data?.outings?.length ?? 0) > 0 && (
          <div className="mt-4 border border-ink/30 bg-panel">
            <div className="px-3 py-2 border-b border-ink/20">
              <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wide">
                Game Log
                <span className="ml-2 font-normal normal-case text-ink-4">{data!.outings.length} appearances</span>
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-ink/20 bg-bone/40">
                    {['Date','Opp','IP','H','ER','BB','K','HR','P','BF'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-ink-3 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...data!.outings].sort((a, b) => b.date.localeCompare(a.date)).map((o, i) => (
                    <tr key={`${o.date}-${o.gamePk ?? i}`} className="border-b border-ink/10 hover:bg-bone/30 transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {o.gamePk ? (
                          <Link
                            href={`/fcl/pitcher?pitcherId=${pitcherId}&date=${o.date}&gamePk=${o.gamePk}`}
                            className="text-blue-400 hover:text-blue-300 font-medium"
                          >
                            {o.date}
                          </Link>
                        ) : (
                          <span className="text-ink-2">{o.date}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-semibold text-ink-2 whitespace-nowrap">
                        {o.isHome === false ? '@' : 'vs'} {o.opponent}
                      </td>
                      <td className="px-3 py-2 font-bold text-ink">{o.ip}</td>
                      <td className="px-3 py-2 text-ink-2">{o.h}</td>
                      <td className="px-3 py-2 text-ink-2">{o.er}</td>
                      <td className="px-3 py-2 text-ink-2">{o.bb}</td>
                      <td className="px-3 py-2 font-semibold text-ink-2">{o.k}</td>
                      <td className="px-3 py-2 text-ink-2">{o.hr}</td>
                      <td className="px-3 py-2 text-ink-2">{o.pitches || '—'}</td>
                      <td className="px-3 py-2 text-ink-2">{o.bf || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default function FclPitcherSeasonPage() {
  return (
    <Suspense fallback={<div className="p-8 text-ink-3 text-sm">Loading…</div>}>
      <FclPitcherSeasonInner />
    </Suspense>
  );
}
