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

// ─── Radar chart ────────────────────────────────────────────────────────────────
function PercentileRadarChart({ metrics, age, peerCount, light }: {
  metrics: RadarMetric[]; age: number | null; peerCount: number; light: boolean;
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
        vs {peerCount} age-{age} peers
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
// Mirrors hitter-age-percentiles/route.ts so the radar can render from locally-loaded
// season statcast when the API has no per-player percentile (e.g. minor leaguers).
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

// Age-calibrated baselines for the radar. EV90 and Avg-LA-95+ are calibrated against the
// real measured full-season distributions of affiliated hitters (see notes per metric).
export function clientAgeBaseline(age: number) {
  const t = Math.max(0, Math.min(1, (age - 18) / 10));
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    // Avg launch angle on 95+ mph contact. Measured age-20 affiliated full-season peers
    // (≥15 hard-hit balls): mean ~8.8°, sd ~4.8°. The prior sd (8.5) was far too wide and
    // compressed genuinely elevated hitters toward the middle.
    avgLaHard: { mean: lerp(8.2, 11.2), std: lerp(5.0, 4.3) },
    chasePct:  { mean: lerp(33.0, 27.5), std: lerp(8.0,  6.5) },
    zSwingPct: { mean: lerp(62.0, 68.0), std: lerp(10.0, 8.5) },
    zoneWhiff: { mean: lerp(22.0, 15.0), std: lerp(8.5,  6.5) },
    // EV90 = mean of a hitter's top 10% exit velocities. Measured age-20 affiliated
    // full-season peers (≥80 BBE): mean ~105.4, sd ~2.9. Anchored ~105 at age 20 with a
    // gentle age slope; sd widened to ~3.5 to avoid hypersensitivity.
    ev90:      { mean: lerp(104.5, 106.5), std: lerp(3.8, 3.2) },
    xwoba:     { mean: lerp(0.285, 0.315), std: 0.045 },
  };
}

// ─── Self-contained season percentile profile ───────────────────────────────
// Renders the radar from a player's season statcast aggregate. Fetches age-peer
// percentiles for peer count + (MLB) Savant-based ranks; minor leaguers fall back to
// the age-calibrated baselines above.
export function PercentileProfile({ playerId, age, season, statcast, light }: {
  playerId: string | number;
  age: number | null;
  season: string;
  statcast: ProfileStatcast | null;
  light: boolean;
}) {
  const [ap, setAp] = useState<{ peerCount: number; metrics: Record<string, AgeMetric> } | null>(null);

  useEffect(() => {
    if (!playerId || !age) return;
    let cancelled = false;
    fetch(`/api/hitter-age-percentiles?playerId=${playerId}&age=${age}&season=${season}`)
      .then(r => r.json())
      .then(d => { if (!cancelled && !d.error && d.metrics) setAp({ peerCount: d.peerCount ?? 0, metrics: d.metrics }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [playerId, age, season]);

  const baseline = age ? clientAgeBaseline(age) : null;
  const m = ap?.metrics;
  const sd = statcast;
  if (!m && !sd) return null;

  // Zone Whiff% = miss rate on in-zone swings = 100 − Z-Contact% (per-swing, the
  // complement of Z-Contact%). Not the per-pitch swinging-strike rate.
  const zoneWhiffRaw = sd?.zContactPct != null
    ? Math.round((100 - sd.zContactPct) * 10) / 10
    : (sd?.whiffPct ?? null);

  const fmtPct = (v: number | null | undefined) => v != null ? `${v.toFixed(1)}%` : null;
  const fmtDeg = (v: number | null | undefined) => v != null ? `${v.toFixed(1)}°` : null;
  const fmtEv  = (v: number | null | undefined) => v != null ? v.toFixed(1) : null;
  const fmtXw  = (v: number | null | undefined) => v != null ? v.toFixed(3).replace(/^0/, '') : null;

  const radarMetrics: RadarMetric[] = [
    { label: m?.avgLaHard?.label ?? 'Avg LA 95+', pct:
        m?.avgLaHard?.pct ?? (sd?.avgLaHard != null && baseline
          ? clientNormalPct(sd.avgLaHard, baseline.avgLaHard.mean, baseline.avgLaHard.std, true) : null),
      valueStr: fmtDeg(m?.avgLaHard?.value ?? sd?.avgLaHard) },
    { label: m?.ev90?.label ?? 'EV 90th', pct:
        m?.ev90?.pct ?? (sd?.ev90 != null && baseline
          ? clientNormalPct(sd.ev90, baseline.ev90.mean, baseline.ev90.std, true) : null),
      valueStr: fmtEv(m?.ev90?.value ?? sd?.ev90) },
    { label: m?.xwoba?.label ?? 'xwOBA', pct:
        m?.xwoba?.pct ?? (sd?.xwoba != null && baseline
          ? clientNormalPct(sd.xwoba, baseline.xwoba.mean, baseline.xwoba.std, true) : null),
      valueStr: fmtXw(m?.xwoba?.value ?? sd?.xwoba) },
    { label: m?.zoneWhiff?.label ?? 'Zone Whiff%', pct:
        m?.zoneWhiff?.pct ?? (zoneWhiffRaw != null && baseline
          ? clientNormalPct(zoneWhiffRaw, baseline.zoneWhiff.mean, baseline.zoneWhiff.std, false) : null),
      valueStr: fmtPct(m?.zoneWhiff?.value ?? zoneWhiffRaw) },
    { label: m?.zSwingPct?.label ?? 'Z-Swing%', pct:
        m?.zSwingPct?.pct ?? (sd?.zSwingPct != null && baseline
          ? clientNormalPct(sd.zSwingPct, baseline.zSwingPct.mean, baseline.zSwingPct.std, true) : null),
      valueStr: fmtPct(m?.zSwingPct?.value ?? sd?.zSwingPct) },
    { label: m?.chasePct?.label ?? 'Chase%', pct:
        m?.chasePct?.pct ?? (sd?.chasePct != null && baseline
          ? clientNormalPct(sd.chasePct, baseline.chasePct.mean, baseline.chasePct.std, false) : null),
      valueStr: fmtPct(m?.chasePct?.value ?? sd?.chasePct) },
  ];

  return (
    <PercentileRadarChart
      metrics={radarMetrics}
      age={age}
      peerCount={ap?.peerCount ?? 0}
      light={light}
    />
  );
}
