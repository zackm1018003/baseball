'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Line, ComposedChart, ReferenceLine,
} from 'recharts';

interface Player {
  playerId: number;
  name: string;
  team: string;
  height: string;
  heightIn: number;
  pa: number;
  k: number;
  kPct: number;
}

interface Avg {
  heightIn: number;
  height: string;
  kPct: number;
  pa: number;
}

const MIN_PA_OPTIONS = [1, 10, 25, 50, 100, 200];

function kPctColor(kPct: number): string {
  // green → yellow → red: 10% = green, 35% = red
  const t = Math.max(0, Math.min(1, (kPct - 10) / 25));
  const r = Math.round(255 * t);
  const g = Math.round(200 * (1 - t));
  return `rgb(${r},${g},60)`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomDot(props: any) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  const r = Math.max(3, Math.min(8, Math.sqrt(payload.pa / 8)));
  return <circle cx={cx} cy={cy} r={r} fill={kPctColor(payload.kPct)} fillOpacity={0.75} stroke="none" />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as Player;
  if (!d?.name) return null;
  return (
    <div className="bg-panel border border-ink/20 rounded px-3 py-2 text-sm">
      <div className="font-semibold text-ink">{d.name}</div>
      <div className="text-ink-3">{d.team} · {d.height}</div>
      <div className="mt-1 text-amber-400 font-mono">{d.kPct.toFixed(1)}% K</div>
      <div className="text-ink-3 font-mono">{d.pa} PA</div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AvgTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as Avg;
  if (!d?.height) return null;
  return (
    <div className="bg-panel border border-ink/20 rounded px-3 py-2 text-sm">
      <div className="font-semibold text-ink">{d.height} average</div>
      <div className="text-amber-400 font-mono">{d.kPct.toFixed(1)}% K</div>
      <div className="text-ink-3 font-mono">{d.pa} PA</div>
    </div>
  );
}

function heightLabel(in_: number): string {
  const ft = Math.floor(in_ / 12);
  const inches = in_ % 12;
  return `${ft}'${inches}"`;
}

export default function HeightStatsPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [averages, setAverages] = useState<Avg[]>([]);
  const [loading, setLoading] = useState(true);
  const [minPA, setMinPA] = useState(50);
  const [view, setView] = useState<'scatter' | 'avg'>('scatter');

  useEffect(() => {
    fetch('/api/height-stats')
      .then(r => r.json())
      .then(d => { setPlayers(d.players ?? []); setAverages(d.averages ?? []); })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => players.filter(p => p.pa >= minPA),
    [players, minPA]
  );

  const leagueAvg = useMemo(() => {
    if (!filtered.length) return null;
    const totalK  = filtered.reduce((s, p) => s + p.k,  0);
    const totalPA = filtered.reduce((s, p) => s + p.pa, 0);
    return totalPA > 0 ? Math.round(totalK / totalPA * 1000) / 10 : null;
  }, [filtered]);

  const avgFiltered = useMemo(
    () => averages.filter(a => a.pa >= minPA * 2),
    [averages, minPA]
  );

  const xDomain = [65, 81]; // 5'5" to 6'9"
  const xTicks = [66, 68, 70, 72, 74, 76, 78, 80];

  return (
    <div className="min-h-screen bg-page text-ink">
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/" className="text-ink-3 hover:text-ink text-sm">← Back</Link>
          <div>
            <h1 className="text-xl font-bold">K% by Height — 2025 MLB</h1>
            <p className="text-ink-3 text-sm mt-0.5">
              {filtered.length} players · {leagueAvg != null ? `League avg ${leagueAvg}% K` : ''}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-6 mb-6 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-ink-3 text-sm">Min PA:</span>
            <div className="flex gap-1">
              {MIN_PA_OPTIONS.map(n => (
                <button
                  key={n}
                  onClick={() => setMinPA(n)}
                  className={`px-2.5 py-1 rounded text-sm font-medium transition-colors ${
                    minPA === n
                      ? 'bg-amber-500 text-black'
                      : 'bg-bone text-ink-2 hover:bg-panel'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-1">
            {(['scatter', 'avg'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  view === v
                    ? 'bg-amber-500 text-black'
                    : 'bg-bone text-ink-2 hover:bg-panel'
                }`}
              >
                {v === 'scatter' ? 'Individual' : 'Averages'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-xs text-ink-3">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 bg-[rgb(0,200,60)]" /> Low K%
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 bg-[rgb(255,80,60)]" /> High K%
            </span>
            {view === 'scatter' && <span>Dot size = PA</span>}
          </div>
        </div>

        {/* Chart */}
        <div className="bg-bone p-4">
          {loading ? (
            <div className="h-96 flex items-center justify-center text-ink-3">Loading…</div>
          ) : view === 'scatter' ? (
            <ResponsiveContainer width="100%" height={420}>
              <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#28304e" />
                <XAxis
                  type="number" dataKey="heightIn"
                  domain={xDomain} ticks={xTicks}
                  tickFormatter={heightLabel}
                  stroke="#4b5563" tick={{ fill: '#9ca3af', fontSize: 12 }}
                  label={{ value: 'Height', position: 'insideBottom', offset: -10, fill: '#6b7280', fontSize: 13 }}
                />
                <YAxis
                  type="number" dataKey="kPct"
                  domain={[0, 60]} tickFormatter={v => `${v}%`}
                  stroke="#4b5563" tick={{ fill: '#9ca3af', fontSize: 12 }}
                  label={{ value: 'K%', angle: -90, position: 'insideLeft', offset: 10, fill: '#6b7280', fontSize: 13 }}
                />
                {leagueAvg != null && (
                  <ReferenceLine y={leagueAvg} stroke="#f59e0b" strokeDasharray="4 2" strokeOpacity={0.5}
                    label={{ value: `Avg ${leagueAvg}%`, position: 'right', fill: '#f59e0b', fontSize: 11 }} />
                )}
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#28304e' }} />
                <Scatter data={filtered} shape={<CustomDot />} />
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={420}>
              <ComposedChart data={avgFiltered} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#28304e" />
                <XAxis
                  dataKey="heightIn"
                  tickFormatter={heightLabel}
                  stroke="#4b5563" tick={{ fill: '#9ca3af', fontSize: 12 }}
                  label={{ value: 'Height', position: 'insideBottom', offset: -10, fill: '#6b7280', fontSize: 13 }}
                />
                <YAxis
                  dataKey="kPct" domain={['auto', 'auto']}
                  tickFormatter={v => `${v}%`}
                  stroke="#4b5563" tick={{ fill: '#9ca3af', fontSize: 12 }}
                  label={{ value: 'K%', angle: -90, position: 'insideLeft', offset: 10, fill: '#6b7280', fontSize: 13 }}
                />
                {leagueAvg != null && (
                  <ReferenceLine y={leagueAvg} stroke="#f59e0b" strokeDasharray="4 2" strokeOpacity={0.5}
                    label={{ value: `Avg ${leagueAvg}%`, position: 'right', fill: '#f59e0b', fontSize: 11 }} />
                )}
                <Tooltip content={<AvgTooltip />} />
                <Scatter
                  data={avgFiltered}
                  fill="#f59e0b"
                  r={6}
                />
                <Line
                  type="monotone" dataKey="kPct"
                  stroke="#f59e0b" strokeWidth={2} dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Table */}
        <div className="mt-6 bg-bone overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/20">
                <th className="text-left px-4 py-2.5 text-ink-3 font-medium">Height</th>
                <th className="text-right px-4 py-2.5 text-ink-3 font-medium">K%</th>
                <th className="text-right px-4 py-2.5 text-ink-3 font-medium">Players</th>
                <th className="text-right px-4 py-2.5 text-ink-3 font-medium">PA</th>
              </tr>
            </thead>
            <tbody>
              {avgFiltered.map((a, i) => (
                <tr key={a.heightIn} className={i % 2 === 0 ? 'bg-panel' : ''}>
                  <td className="px-4 py-2 font-mono">{a.height}</td>
                  <td className="px-4 py-2 text-right font-mono" style={{ color: kPctColor(a.kPct) }}>
                    {a.kPct.toFixed(1)}%
                  </td>
                  <td className="px-4 py-2 text-right text-ink-2">
                    {filtered.filter(p => p.heightIn === a.heightIn).length}
                  </td>
                  <td className="px-4 py-2 text-right text-ink-2">{a.pa.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
