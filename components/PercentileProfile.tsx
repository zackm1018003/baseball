'use client';

import { useEffect, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ProfileStatcast {
  ev90: number | null;
  avgLaHard: number | null;
  chasePct: number | null;
  zSwingPct: number | null;
  zContactPct: number | null;
  whiffPct: number | null;
  xwoba: number | null;
}

interface RadarMetric { label: string; pct: number | null; valueStr?: string | null; }

interface AgeMetric { value: number | null; pct: number | null; label: string; higherBetter: boolean }

interface CompResult {
  playerId: number;
  playerName: string;
  season: number;
  age: number | null;
  team: string | null;
  similarity: number;
}

// ─── Radar chart ────────────────────────────────────────────────────────────────
function PercentileRadarChart({ metrics, subtitle, light }: {
  metrics: RadarMetric[]; subtitle: string; light: boolean;
}) {
  const N = metrics.length;
  if (N < 3) return null;
  const SIZE = 220, CX = SIZE / 2, CY = SIZE / 2, R_MAX = 72, PAD = 28, TITLE_H = 30;
  const angleOf = (i: number) => (Math.PI * 2 * i) / N - Math.PI / 2;
  const toXY = (pct: number, i: number) => {
    const r = (Math.max(0, Math.min(99, pct)) / 99) * R_MAX;
    const a = angleOf(i);
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  };
  const rings = [25, 50, 75];
  const ringPath = (r: number) => Array.from({ length: N }, (_, i) => toXY(r, i))
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + 'Z';
  const polyStr = metrics.map((m, i) => toXY(m.pct ?? 1, i))
    .map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const bg     = light ? '#f5f3ef' : '#1a1a1a';
  const fg     = light ? '#111827' : '#eee';
  const dim    = light ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.1)';
  const fill   = light ? 'rgba(234,138,0,0.22)' : 'rgba(255,160,0,0.22)';
  const stroke = '#E87D00';
  const vbW = SIZE + PAD * 2, vbH = SIZE + PAD * 2 + TITLE_H;
  return (
    <svg width={vbW} height={vbH}
         viewBox={`${-PAD} ${-PAD - TITLE_H} ${vbW} ${vbH}`}
         style={{ background: bg }}>
      <text x={CX} y={-PAD - TITLE_H + 13} textAnchor="middle" fontSize={10} fontWeight="600" fill={fg}>
        Percentile Profile
      </text>
      <text x={CX} y={-PAD - TITLE_H + 24} textAnchor="middle" fontSize={8} fill={light ? '#6b7280' : '#9ca3af'}>
        {subtitle}
      </text>
      {rings.map(r => <path key={r} d={ringPath(r)} fill="none" stroke={dim} strokeWidth={r === 50 ? 1.5 : 0.8} />)}
      <text x={CX} y={CY - (50 / 99) * R_MAX - 3} textAnchor="middle" fontSize={8} fill={dim}>50</text>
      {Array.from({ length: N }, (_, i) => {
        const outer = toXY(99, i);
        return <line key={i} x1={CX} y1={CY} x2={outer.x} y2={outer.y} stroke={dim} strokeWidth={0.8} />;
      })}
      <polygon points={polyStr} fill={fill} stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
      {metrics.map((m, i) => {
        const { x, y } = toXY(m.pct ?? 1, i);
        return m.pct != null ? <circle key={i} cx={x} cy={y} r={4} fill={stroke} stroke={bg} strokeWidth={1.5} /> : null;
      })}
      {metrics.map((m, i) => {
        const a = angleOf(i);
        const lx = CX + (R_MAX + PAD - 6) * Math.cos(a);
        const ly = CY + (R_MAX + PAD - 6) * Math.sin(a);
        const anchor = Math.cos(a) > 0.25 ? 'start' : Math.cos(a) < -0.25 ? 'end' : 'middle';
        const hasVal = m.valueStr != null;
        return (
          <g key={i}>
            {hasVal && (
              <text x={lx} y={ly - 14} textAnchor={anchor} fontSize={9} fill={light ? '#374151' : '#d1d5db'}>
                {m.valueStr}
              </text>
            )}
            <text x={lx} y={hasVal ? ly - 3 : ly - 5} textAnchor={anchor} fontSize={9.5} fontWeight="600" fill={fg}>{m.label}</text>
            {m.pct != null && (
              <text x={lx} y={hasVal ? ly + 9 : ly + 7} textAnchor={anchor} fontSize={9}
                    fill={m.pct >= 70 ? stroke : light ? '#6b7280' : '#666'}>{m.pct}th</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Client-side percentile helpers ──────────────────────────────────────────
export function clientNormalPct(val: number, mean: number, std: number, higher = true): number {
  if (std === 0) return 50;
  const z = (val - mean) / std;
  const az = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * az);
  const p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - p * Math.exp(-az * az);
  const cdf = 0.5 * (1 + (z >= 0 ? 1 : -1) * erf);
  const pct = Math.round(Math.max(1, Math.min(99, cdf * 100)));
  return higher ? pct : 100 - pct;
}

// Age-calibrated baselines for MiLB / younger players
export function clientAgeBaseline(age: number) {
  const t = Math.max(0, Math.min(1, (age - 18) / 10));
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    avgLaHard: { mean: lerp(8.2, 11.2), std: lerp(5.0, 4.3) },
    chasePct:  { mean: lerp(33.0, 27.5), std: lerp(8.0,  6.5) },
    zSwingPct: { mean: lerp(62.0, 68.0), std: lerp(10.0, 8.5) },
    zoneWhiff: { mean: lerp(22.0, 15.0), std: lerp(8.5,  6.5) },
    ev90:      { mean: lerp(104.5, 106.5), std: lerp(3.8, 3.2) },
    xwoba:     { mean: lerp(0.285, 0.315), std: 0.045 },
  };
}

// General MLB baselines (not age-specific)
export function clientMLBBaseline() {
  return {
    avgLaHard: { mean: 13.5,  std: 8.0 },
    chasePct:  { mean: 27.5,  std: 6.5 },
    zSwingPct: { mean: 68.0,  std: 8.5 },
    zoneWhiff: { mean: 16.0,  std: 7.0 },
    ev90:      { mean: 107.0, std: 3.5 },
    xwoba:     { mean: 0.315, std: 0.044 },
  };
}

// ─── Percentile profile ───────────────────────────────────────────────────────
export function PercentileProfile({ playerId, age, season, statcast, light, sportId = 1 }: {
  playerId: string | number;
  age: number | null;
  season: string;
  statcast: ProfileStatcast | null;
  light: boolean;
  sportId?: number;
}) {
  const [ap, setAp] = useState<{ peerCount: number; metrics: Record<string, AgeMetric> } | null>(null);
  const [comp, setComp] = useState<CompResult | null>(null);
  const [compLoading, setCompLoading] = useState(true);

  const isMLB = sportId === 1;

  // For MiLB only: fetch age-peer percentiles for peer count
  useEffect(() => {
    if (!playerId || !age || isMLB) return;
    let cancelled = false;
    fetch(`/api/hitter-age-percentiles?playerId=${playerId}&age=${age}&season=${season}`)
      .then(r => r.json())
      .then(d => { if (!cancelled && !d.error && d.metrics) setAp({ peerCount: d.peerCount ?? 0, metrics: d.metrics }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [playerId, age, season, isMLB]);

  // Fetch comp player
  const sd = statcast;
  useEffect(() => {
    if (!playerId || !sd) { setCompLoading(false); return; }
    let cancelled = false;
    setCompLoading(true);

    const zoneWhiffVal = sd.zContactPct != null
      ? Math.round((100 - sd.zContactPct) * 10) / 10
      : (sd.whiffPct ?? null);

    const params = new URLSearchParams({ playerId: String(playerId), season, sportId: String(sportId) });
    if (age != null) params.set('age', String(age));
    if (sd.ev90 != null) params.set('ev90', String(sd.ev90));
    if (sd.xwoba != null) params.set('xwoba', String(sd.xwoba));
    if (sd.chasePct != null) params.set('chasePct', String(sd.chasePct));
    if (sd.zSwingPct != null) params.set('zSwingPct', String(sd.zSwingPct));
    if (zoneWhiffVal != null) params.set('zoneWhiff', String(zoneWhiffVal));
    if (sd.avgLaHard != null) params.set('avgLaHard', String(sd.avgLaHard));

    fetch(`/api/player-comps?${params}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setComp(d.comp ?? null); setCompLoading(false); } })
      .catch(() => { if (!cancelled) setCompLoading(false); });

    return () => { cancelled = true; };
  }, [playerId, season, sportId, age,
      sd?.ev90, sd?.xwoba, sd?.chasePct, sd?.zSwingPct, sd?.zContactPct, sd?.whiffPct, sd?.avgLaHard]);

  const baseline = isMLB ? clientMLBBaseline() : (age ? clientAgeBaseline(age) : null);
  // For MLB we always use client-side baselines; API metrics are only used for MiLB peer counts
  const m = isMLB ? null : ap?.metrics;
  if (!sd) return null;

  const zoneWhiffRaw = sd.zContactPct != null
    ? Math.round((100 - sd.zContactPct) * 10) / 10
    : (sd.whiffPct ?? null);

  const fmtPct = (v: number | null | undefined) => v != null ? `${v.toFixed(1)}%` : null;
  const fmtDeg = (v: number | null | undefined) => v != null ? `${v.toFixed(1)}°` : null;
  const fmtEv  = (v: number | null | undefined) => v != null ? v.toFixed(1) : null;
  const fmtXw  = (v: number | null | undefined) => v != null ? v.toFixed(3).replace(/^0/, '') : null;

  const radarMetrics: RadarMetric[] = [
    { label: m?.avgLaHard?.label ?? 'Avg LA 95+', pct:
        m?.avgLaHard?.pct ?? (sd.avgLaHard != null && baseline
          ? clientNormalPct(sd.avgLaHard, baseline.avgLaHard.mean, baseline.avgLaHard.std, true) : null),
      valueStr: fmtDeg(m?.avgLaHard?.value ?? sd.avgLaHard) },
    { label: m?.ev90?.label ?? 'EV 90th', pct:
        m?.ev90?.pct ?? (sd.ev90 != null && baseline
          ? clientNormalPct(sd.ev90, baseline.ev90.mean, baseline.ev90.std, true) : null),
      valueStr: fmtEv(m?.ev90?.value ?? sd.ev90) },
    { label: m?.xwoba?.label ?? 'xwOBA', pct:
        m?.xwoba?.pct ?? (sd.xwoba != null && baseline
          ? clientNormalPct(sd.xwoba, baseline.xwoba.mean, baseline.xwoba.std, true) : null),
      valueStr: fmtXw(m?.xwoba?.value ?? sd.xwoba) },
    { label: m?.zoneWhiff?.label ?? 'Zone Whiff%', pct:
        m?.zoneWhiff?.pct ?? (zoneWhiffRaw != null && baseline
          ? clientNormalPct(zoneWhiffRaw, baseline.zoneWhiff.mean, baseline.zoneWhiff.std, false) : null),
      valueStr: fmtPct(m?.zoneWhiff?.value ?? zoneWhiffRaw) },
    { label: m?.zSwingPct?.label ?? 'Z-Swing%', pct:
        m?.zSwingPct?.pct ?? (sd.zSwingPct != null && baseline
          ? clientNormalPct(sd.zSwingPct, baseline.zSwingPct.mean, baseline.zSwingPct.std, true) : null),
      valueStr: fmtPct(m?.zSwingPct?.value ?? sd.zSwingPct) },
    { label: m?.chasePct?.label ?? 'Chase%', pct:
        m?.chasePct?.pct ?? (sd.chasePct != null && baseline
          ? clientNormalPct(sd.chasePct, baseline.chasePct.mean, baseline.chasePct.std, false) : null),
      valueStr: fmtPct(m?.chasePct?.value ?? sd.chasePct) },
  ];

  const bg     = light ? '#f5f3ef' : '#1a1a1a';
  const fg     = light ? '#111827' : '#eee';
  const dimC   = light ? 'rgba(0,0,0,0.40)' : '#777';
  const border = light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)';

  const subtitle = isMLB
    ? 'vs MLB average'
    : `vs ${ap?.peerCount ?? 0} age-${age} peers`;

  const showComp = comp != null;

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', background: bg }}>
      <PercentileRadarChart metrics={radarMetrics} subtitle={subtitle} light={light} />

      {/* Comp section — always reserve space while loading so layout doesn't jump */}
      <div style={{
        borderTop: `1px solid ${border}`,
        padding: '7px 10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 9,
        minHeight: 52,
      }}>
        {compLoading ? (
          <span style={{ fontSize: 9, color: dimC, margin: '0 auto' }}>Finding match…</span>
        ) : showComp ? (
          <>
            <img
              src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_96,q_auto:best/v1/people/${comp!.playerId}/headshot/67/current`}
              alt={comp!.playerName}
              style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 7.5, color: dimC, letterSpacing: '0.06em', marginBottom: 1 }}>
                SIMILAR PROFILE
              </div>
              <div style={{
                fontSize: 12, fontWeight: 700, color: fg,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {comp!.playerName}
              </div>
              <div style={{ fontSize: 9, color: dimC }}>
                {comp!.season}
                {comp!.team ? ` · ${comp!.team}` : ''}
                {comp!.age ? ` · Age ${comp!.age}` : ''}
              </div>
            </div>
          </>
        ) : (
          <span style={{ fontSize: 9, color: dimC, margin: '0 auto' }}>No match found</span>
        )}
      </div>
    </div>
  );
}
