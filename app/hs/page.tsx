'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';

// ─── Types ───────────────────────────────────────────────────────────────────

interface HSPlayer {
  playerUrl:   string;
  name:        string;
  position:    string | null;
  school:      string | null;
  commit:      string | null;
  bt:          string | null;
  height:      string | null;
  weight:      string | null;
  hometown:    string | null;
  draftYear:   string | null;
  photoUrl:    string | null;
  // TrackMan
  whiffPct:    number | null;
  izWhiffPct:  number | null;
  oozWhiffPct: number | null;
  chasePct:    number | null;
  kPct:        number | null;
  bbPct:       number | null;
  avgEv:       number | null;
  ev90:        number | null;
  barrelPct:   number | null;
  pullAirPct:  number | null;
  xWoba:       number | null;
  // Summer circuit counting stats
  scPA:   number | null;
  scBA:   string | null;
  scOBP:  string | null;
  scSLG:  string | null;
  scOPS:  string | null;
  scISO:  string | null;
  // Summer circuit percentiles + deltas
  scContact: number | null;    scContactDelta: number | null;
  scChase:   number | null;    scChaseDelta:   number | null;
  scIzContact: number | null;  scIzContactDelta: number | null;
  scOozContact: number | null; scOozContactDelta: number | null;
  scK:       number | null;    scKDelta:       number | null;
  scGb:      number | null;    scGbDelta:      number | null;
  scFb:      number | null;    scFbDelta:      number | null;
  scAirPull: number | null;    scAirPullDelta: number | null;
  scSprint:  number | null;    scSprintDelta:  number | null;
  scBatSpeed: number | null;   scBatSpeedDelta: number | null;
  scRotAcc:  number | null;    scRotAccDelta:  number | null;
  scPeakHand: number | null;   scPeakHandDelta: number | null;
  scExplosive: number | null;  scExplosiveDelta: number | null;
}

interface PlayerGrades {
  // Present/future tool grades stored as "present/future" e.g. "30/50"
  hit:       string;
  power:     string;
  decisions: string;
  speed:     string;
  defense:   string;
  // Single-value grades
  fv:   string;
  rank: string;
  // Stored metadata
  name: string; team: string; position: string; draftYear: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const YEARS = ['2026', '2027', '2028'];

const TM_COLS: { key: keyof HSPlayer; label: string; title: string; lower?: boolean;
  bad: number; good: number; invert: boolean; fmt: (v: number) => string }[] = [
  { key: 'avgEv',       label: 'Avg EV',     title: 'Average Exit Velocity',         bad: 84,   good: 95,   invert: false, fmt: v => v.toFixed(1) },
  { key: 'ev90',        label: '90th EV',    title: '90th Percentile Exit Velocity',  bad: 98,   good: 114,  invert: false, fmt: v => v.toFixed(1) },
  { key: 'barrelPct',   label: 'Barrel%',    title: 'Barrel %',                      bad: 3,    good: 25,   invert: false, fmt: v => v.toFixed(1) },
  { key: 'xWoba',       label: 'xWOBA',      title: 'Expected wOBA',                 bad: 0.27, good: 0.44, invert: false, fmt: v => v.toFixed(3).replace(/^0/,'') },
  { key: 'whiffPct',    label: 'Whiff%',     title: 'Whiff %',                       bad: 35,   good: 12,   invert: true,  lower: true, fmt: v => v.toFixed(1) },
  { key: 'izWhiffPct',  label: 'IZ Whiff%',  title: 'In-Zone Whiff %',               bad: 25,   good: 8,    invert: true,  lower: true, fmt: v => v.toFixed(1) },
  { key: 'oozWhiffPct', label: 'OOZ Whiff%', title: 'Out-of-Zone Whiff %',           bad: 55,   good: 20,   invert: true,  lower: true, fmt: v => v.toFixed(1) },
  { key: 'chasePct',    label: 'Chase%',     title: 'Chase %',                       bad: 38,   good: 16,   invert: true,  lower: true, fmt: v => v.toFixed(1) },
  { key: 'kPct',        label: 'K%',         title: 'Strikeout %',                   bad: 35,   good: 10,   invert: true,  lower: true, fmt: v => v.toFixed(1) },
  { key: 'bbPct',       label: 'BB%',        title: 'Walk %',                        bad: 4,    good: 18,   invert: false, fmt: v => v.toFixed(1) },
  { key: 'pullAirPct',  label: 'Pull Air%',  title: 'Pull Air Ball %',               bad: 10,   good: 45,   invert: false, fmt: v => v.toFixed(1) },
];

// Summer circuit percentile rows shown in the card
const SC_ROWS: { key: keyof HSPlayer; deltaKey: keyof HSPlayer; label: string; higherBetter: boolean }[] = [
  { key: 'scContact',    deltaKey: 'scContactDelta',    label: 'Contact%',       higherBetter: true  },
  { key: 'scChase',      deltaKey: 'scChaseDelta',      label: 'Chase%',         higherBetter: false },
  { key: 'scIzContact',  deltaKey: 'scIzContactDelta',  label: 'IZ Contact%',    higherBetter: true  },
  { key: 'scOozContact', deltaKey: 'scOozContactDelta', label: 'OOZ Contact%',   higherBetter: false },
  { key: 'scK',          deltaKey: 'scKDelta',          label: 'K%',             higherBetter: false },
  { key: 'scGb',         deltaKey: 'scGbDelta',         label: 'GB%',            higherBetter: false },
  { key: 'scFb',         deltaKey: 'scFbDelta',         label: 'FB%',            higherBetter: true  },
  { key: 'scAirPull',    deltaKey: 'scAirPullDelta',    label: 'Air PULL%',      higherBetter: true  },
  { key: 'scSprint',     deltaKey: 'scSprintDelta',     label: 'Sprint Speed',   higherBetter: true  },
  { key: 'scBatSpeed',   deltaKey: 'scBatSpeedDelta',   label: 'Bat Speed',      higherBetter: true  },
  { key: 'scRotAcc',     deltaKey: 'scRotAccDelta',     label: 'Avg Rot. Acc.',  higherBetter: true  },
  { key: 'scPeakHand',   deltaKey: 'scPeakHandDelta',   label: 'Peak Hand Speed', higherBetter: true },
  { key: 'scExplosive',  deltaKey: 'scExplosiveDelta',  label: 'Explosiveness',  higherBetter: true  },
];

// Tool grades shown as present/future
const PF_GRADE_FIELDS: { key: keyof PlayerGrades; label: string }[] = [
  { key: 'hit',       label: 'Hit'       },
  { key: 'power',     label: 'Power'     },
  { key: 'decisions', label: 'Decisions' },
  { key: 'speed',     label: 'Speed'     },
  { key: 'defense',   label: 'Defense'   },
];

const GRADE_OPTIONS = ['', '20', '25', '30', '35', '40', '45', '50', '55', '60', '65', '70', '75', '80'];

// ─── Color helpers ───────────────────────────────────────────────────────────

function statColor(n: number, bad: number, good: number, invert: boolean): string {
  const lo = Math.min(bad, good);
  const hi = Math.max(bad, good);
  const clamped = Math.max(lo, Math.min(hi, n));
  const raw = hi === lo ? 0 : (clamped - lo) / (hi - lo);
  const t = invert ? 1 - raw : raw;
  if (t < 0.5) {
    const r = 220, g = Math.round(80 + t * 2 * 140);
    return `rgb(${r},${g},60)`;
  }
  const r = Math.round(220 - (t - 0.5) * 2 * 180), g = 200;
  return `rgb(${r},${g},60)`;
}

function gradeColor(val: string): string {
  const n = parseFloat(val);
  if (isNaN(n)) return '#374151';
  if (n >= 70) return '#16a34a';
  if (n >= 60) return '#22c55e';
  if (n >= 55) return '#84cc16';
  if (n >= 50) return '#ca8a04';
  if (n >= 45) return '#d97706';
  if (n >= 40) return '#ea580c';
  return '#dc2626';
}

// Percentile bar color: blue spectrum for low, red spectrum for high
function pctColor(score: number, higherBetter: boolean): string {
  // Normalize to 0–1 where 1 = "good"
  const goodness = higherBetter ? score / 100 : 1 - score / 100;
  if (goodness >= 0.80) return '#16a34a';  // bright green
  if (goodness >= 0.65) return '#65a30d';  // lime
  if (goodness >= 0.50) return '#ca8a04';  // amber
  if (goodness >= 0.35) return '#d97706';  // orange
  if (goodness >= 0.20) return '#ea580c';  // red-orange
  return '#dc2626';                         // red
}

// ─── Grades localStorage helpers ─────────────────────────────────────────────

function loadGrades(url: string): Partial<PlayerGrades> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(`og_grade:${url}`) ?? '{}'); } catch { return {}; }
}

function saveGrades(url: string, g: Partial<PlayerGrades>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`og_grade:${url}`, JSON.stringify(g));
}

// ─── Grade Card Component ─────────────────────────────────────────────────────

function GradeCard({ label, value, isEditing, onChange, type = 'pf' }: {
  label: string;
  value: string;
  isEditing: boolean;
  onChange: (v: string) => void;
  type?: 'single' | 'pf';
}) {
  const badgeBase = 'bg-[#4338ca] text-white font-bold rounded-md text-center select-none';
  if (type === 'single') {
    return (
      <div className="flex flex-col items-center bg-[#141414] border border-[#262626] rounded-xl px-4 py-2.5 min-w-[62px]">
        <span className="text-[10px] text-[#555] mb-2 font-semibold uppercase tracking-wider">{label}</span>
        {isEditing ? (
          <select value={value} onChange={e => onChange(e.target.value)}
            className={`${badgeBase} px-2 py-1 text-sm border-0 outline-none cursor-pointer w-16`}
            style={{ background: '#4338ca' }}>
            {['', '1','2','3','4','5','6','7','8','9','10',
              '15','20','25','30','35','40','45','50',
              '55','60','65','70','75','80','NR'].map(o => (
              <option key={o} value={o} style={{ background: '#111' }}>{o || '—'}</option>
            ))}
          </select>
        ) : (
          <div className={`${badgeBase} px-3 py-1 text-base min-w-[48px]`}>{value || '—'}</div>
        )}
      </div>
    );
  }
  // Present/Future
  const parts = value.split('/');
  const present = parts[0] ?? '';
  const future  = parts[1] ?? '';
  return (
    <div className="flex flex-col items-center bg-[#141414] border border-[#262626] rounded-xl px-3 py-2.5">
      <span className="text-[10px] text-[#555] mb-2 font-semibold uppercase tracking-wider">{label}</span>
      {isEditing ? (
        <div className="flex items-center gap-1">
          <select value={present} onChange={e => onChange(`${e.target.value}/${future}`)}
            className={`${badgeBase} px-1 py-1 text-xs border-0 outline-none cursor-pointer w-12`}
            style={{ background: '#4338ca' }}>
            {GRADE_OPTIONS.map(o => <option key={o} value={o} style={{ background: '#111' }}>{o || '—'}</option>)}
          </select>
          <span className="text-[#444] text-xs font-bold">/</span>
          <select value={future} onChange={e => onChange(`${present}/${e.target.value}`)}
            className={`${badgeBase} px-1 py-1 text-xs border-0 outline-none cursor-pointer w-12`}
            style={{ background: '#4338ca' }}>
            {GRADE_OPTIONS.map(o => <option key={o} value={o} style={{ background: '#111' }}>{o || '—'}</option>)}
          </select>
        </div>
      ) : (
        <div className={`${badgeBase} px-3 py-1 text-sm min-w-[64px]`}>
          {value || '—/—'}
        </div>
      )}
    </div>
  );
}

// ─── Percentile Bar Component ─────────────────────────────────────────────────

function PercentileBar({ label, score, delta, higherBetter }: {
  label: string;
  score: number | null;
  delta: number | null;
  higherBetter: boolean;
}) {
  if (score == null) return null;
  const color = pctColor(score, higherBetter);
  const rounded = Math.round(score);
  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <span className="text-[11px] text-[#666] w-28 text-right flex-shrink-0 leading-tight">{label}</span>
      <div className="flex-1 relative h-5 rounded-sm overflow-hidden" style={{ background: '#1c1c1c' }}>
        <div className="absolute inset-y-0 left-0 rounded-sm"
          style={{ width: `${score}%`, background: color, opacity: 0.85 }} />
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white"
          style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
          {rounded}
        </span>
      </div>
      <span className={`text-[11px] font-mono w-10 text-right flex-shrink-0 ${
        delta == null ? 'text-[#444]' : delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-[#666]'
      }`}>
        {delta == null ? '' : delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
      </span>
    </div>
  );
}

// ─── Player Card ─────────────────────────────────────────────────────────────

function HSPlayerCard({ player, onClose }: { player: HSPlayer; onClose: () => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  const [grades, setGrades] = useState<Partial<PlayerGrades>>(() => loadGrades(player.playerUrl));
  const [gradeEdit, setGradeEdit] = useState(false);

  const initials = player.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  const fv = grades.fv ?? '';

  function updateGrade(key: keyof PlayerGrades, val: string) {
    const next: Partial<PlayerGrades> = {
      ...grades, [key]: val,
      name: player.name, team: player.school ?? '',
      position: player.position ?? '', draftYear: player.draftYear ?? '',
    };
    setGrades(next);
    saveGrades(player.playerUrl, next);
  }

  function InfoPanel({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <div className="rounded-xl border border-[#262626] bg-[#101010] flex flex-col">
        <div className="px-4 pt-3 pb-2 border-b border-[#262626]">
          <span className="text-[10px] font-bold text-[#555] uppercase tracking-widest">{title}</span>
        </div>
        <div className="px-4 py-3 flex-1">{children}</div>
      </div>
    );
  }

  const hasTrackman  = TM_COLS.some(s => player[s.key] != null);
  const hasSummerCt  = SC_ROWS.some(s => player[s.key] != null);
  const hasSummerStd = player.scPA != null || player.scBA != null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div className="relative w-full max-w-4xl max-h-[95vh] overflow-y-auto rounded-2xl border border-[#222]"
        style={{ background: '#0a0a0a' }}
        onClick={e => e.stopPropagation()}>

        <button onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-[#1c1c1c] text-[#666] hover:text-white transition-colors text-lg leading-none">
          ×
        </button>

        {/* ── Top row: Photo | Info | FV | TrackMan ── */}
        <div className="grid grid-cols-4 gap-3 p-4 pb-3">

          {/* Photo */}
          <div className="rounded-xl border border-[#262626] bg-[#101010] overflow-hidden flex flex-col">
            <div className="flex-1 min-h-0">
              {player.photoUrl && !imgFailed ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/proxy-photo?url=${encodeURIComponent(player.photoUrl)}`}
                  alt={player.name} className="w-full h-full object-cover object-top"
                  style={{ minHeight: '160px', maxHeight: '200px' }}
                  onError={() => setImgFailed(true)} />
              ) : (
                <div className="w-full flex items-center justify-center text-5xl font-bold text-[#333] bg-[#111]"
                  style={{ minHeight: '160px' }}>{initials}</div>
              )}
            </div>
            <div className="px-3 py-2 border-t border-[#262626] text-center">
              <div className="font-bold text-white text-sm leading-tight">{player.name}</div>
              <div className="text-xs text-[#888] mt-0.5">
                {player.position && <span className="text-white font-semibold">{player.position} · </span>}
                {player.school}
              </div>
              {player.playerUrl && (
                <a href={`https://overslotbaseball.com${player.playerUrl}`} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-[#888] hover:text-white transition-colors mt-0.5 inline-block">
                  View on Over Slot ↗
                </a>
              )}
            </div>
          </div>

          {/* Player Info */}
          <InfoPanel title="Player Info">
            <div className="space-y-2.5">
              {[
                { label: 'HIGH SCHOOL', val: player.school },
                { label: 'COMMIT',      val: player.commit },
                { label: 'HOMETOWN',    val: player.hometown },
                { label: 'B/T',         val: player.bt },
                { label: 'HEIGHT',      val: player.height },
                { label: 'WEIGHT',      val: player.weight },
                { label: 'DRAFT',       val: player.draftYear ? `${player.draftYear} Draft` : null },
              ].map(({ label, val }) => val ? (
                <div key={label}>
                  <div className="text-[10px] text-[#666] font-bold tracking-wider mb-0.5">{label}</div>
                  <div className="text-sm text-white font-medium">{val}</div>
                </div>
              ) : null)}
            </div>
          </InfoPanel>

          {/* FV panel */}
          <InfoPanel title="Future Value">
            <div className="flex flex-col items-center justify-center h-full py-2">
              <div className="text-6xl font-black leading-none" style={{ color: fv ? gradeColor(fv) : '#333' }}>
                {fv || '—'}
              </div>
              {fv && (
                <div className="text-xs mt-2 font-semibold" style={{ color: gradeColor(fv) }}>
                  {parseFloat(fv) >= 65 ? 'Plus-Plus' : parseFloat(fv) >= 60 ? 'Plus' : parseFloat(fv) >= 55 ? 'Above Avg' : parseFloat(fv) >= 50 ? 'Average' : parseFloat(fv) >= 45 ? 'Fringe' : 'Below Avg'}
                </div>
              )}
              <a href="/grades" className="text-[10px] text-[#555] hover:text-white mt-4 transition-colors">
                Grades Board ↗
              </a>
            </div>
          </InfoPanel>

          {/* TrackMan highlight */}
          <InfoPanel title="TrackMan">
            {hasTrackman ? (
              <div className="space-y-2">
                {[
                  { key: 'xWoba' as keyof HSPlayer,    label: 'xWOBA',    bad: 0.27, good: 0.44, invert: false, fmt: (v: number) => v.toFixed(3).replace(/^0/,'') },
                  { key: 'barrelPct' as keyof HSPlayer, label: 'Barrel%',  bad: 3,    good: 25,   invert: false, fmt: (v: number) => v.toFixed(1)+'%' },
                  { key: 'avgEv' as keyof HSPlayer,     label: 'Avg EV',   bad: 84,   good: 95,   invert: false, fmt: (v: number) => v.toFixed(1)+' mph' },
                  { key: 'ev90' as keyof HSPlayer,      label: '90th EV',  bad: 98,   good: 114,  invert: false, fmt: (v: number) => v.toFixed(1)+' mph' },
                  { key: 'whiffPct' as keyof HSPlayer,  label: 'Whiff%',   bad: 35,   good: 12,   invert: true,  fmt: (v: number) => v.toFixed(1)+'%' },
                  { key: 'chasePct' as keyof HSPlayer,  label: 'Chase%',   bad: 38,   good: 16,   invert: true,  fmt: (v: number) => v.toFixed(1)+'%' },
                  { key: 'kPct' as keyof HSPlayer,      label: 'K%',       bad: 35,   good: 10,   invert: true,  fmt: (v: number) => v.toFixed(1)+'%' },
                  { key: 'bbPct' as keyof HSPlayer,     label: 'BB%',      bad: 4,    good: 18,   invert: false, fmt: (v: number) => v.toFixed(1)+'%' },
                ].map(({ key, label, bad, good, invert, fmt }) => {
                  const raw = player[key] as number | null;
                  if (raw == null) return null;
                  return (
                    <div key={String(key)} className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-[#666]">{label}</span>
                      <span className="text-sm font-bold font-mono" style={{ color: statColor(raw, bad, good, invert) }}>{fmt(raw)}</span>
                    </div>
                  );
                }).filter(Boolean)}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full py-6">
                <span className="text-[#444] text-xs">No TrackMan data</span>
              </div>
            )}
          </InfoPanel>
        </div>

        {/* ── Scouting Grades bar ── */}
        <div className="px-4 pb-3">
          <div className="rounded-xl border border-[#262626] bg-[#101010]">
            <div className="px-4 py-2.5 border-b border-[#262626] flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#555] uppercase tracking-widest">Scouting Grades</span>
              <button
                onClick={() => setGradeEdit(e => !e)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  gradeEdit ? 'bg-white text-black' : 'bg-[#1c1c1c] text-[#666] hover:text-white'
                }`}>
                {gradeEdit ? '✓ Done' : '✏️ Edit'}
              </button>
            </div>
            <div className="px-4 py-3 flex flex-wrap gap-2 justify-start">
              <GradeCard label="Rank" value={grades.rank ?? ''} type="single" isEditing={gradeEdit} onChange={v => updateGrade('rank', v)} />
              <GradeCard label="FV"   value={grades.fv   ?? ''} type="single" isEditing={gradeEdit} onChange={v => updateGrade('fv',   v)} />
              {PF_GRADE_FIELDS.map(({ key, label }) => (
                <GradeCard key={key} label={label} value={grades[key] ?? ''} type="pf" isEditing={gradeEdit} onChange={v => updateGrade(key, v)} />
              ))}
            </div>
          </div>
        </div>

        {/* ── TrackMan full breakdown ── */}
        {hasTrackman && (
          <div className="px-4 pb-3">
            <div className="rounded-xl border border-[#262626] bg-[#101010]">
              <div className="px-4 py-2 border-b border-[#262626]">
                <span className="text-[10px] font-bold text-[#555] uppercase tracking-widest">TrackMan Breakdown</span>
              </div>
              <div className="grid grid-cols-3 divide-x divide-[#262626] border-b border-[#262626]">
                {[
                  { key: 'xWoba' as keyof HSPlayer,    label: 'xWOBA',    bad: 0.27, good: 0.44, invert: false, fmt: (v: number) => v.toFixed(3).replace(/^0/,'') },
                  { key: 'barrelPct' as keyof HSPlayer, label: 'Barrel %', bad: 3,    good: 25,   invert: false, fmt: (v: number) => v.toFixed(1)+'%' },
                  { key: 'avgEv' as keyof HSPlayer,     label: 'Avg EV',   bad: 84,   good: 95,   invert: false, fmt: (v: number) => v.toFixed(1)+' mph' },
                ].map(({ key, label, bad, good, invert, fmt }) => {
                  const raw = player[key] as number | null;
                  return (
                    <div key={String(key)} className="text-center py-4 px-3">
                      <div className="text-xs text-[#555] mb-1">{label}</div>
                      <div className="text-3xl font-black" style={{ color: raw != null ? statColor(raw, bad, good, invert) : '#333' }}>
                        {raw != null ? fmt(raw) : '—'}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-4 gap-x-4 gap-y-2 px-5 py-3">
                {TM_COLS.filter(s => !['xWoba','barrelPct','avgEv'].includes(s.key as string)).map(({ key, label, bad, good, invert, fmt }) => {
                  const raw = player[key] as number | null;
                  if (raw == null) return null;
                  return (
                    <div key={String(key)} className="flex items-center justify-between gap-1">
                      <span className="text-[11px] text-[#555]">{label}</span>
                      <span className="text-sm font-bold font-mono" style={{ color: statColor(raw, bad, good, invert) }}>{fmt(raw)}</span>
                    </div>
                  );
                }).filter(Boolean)}
              </div>
            </div>
          </div>
        )}

        {/* ── Summer Circuit section ── */}
        {(hasSummerCt || hasSummerStd) && (
          <div className="px-4 pb-4">
            <div className="rounded-xl border border-[#262626] bg-[#101010]">
              <div className="px-4 py-2 border-b border-[#262626] flex items-center gap-3">
                <span className="text-[10px] font-bold text-[#555] uppercase tracking-widest">Summer Circuit</span>
                <span className="text-[10px] text-[#444]">Percentile vs HS peers · delta = actual vs median</span>
              </div>

              {/* Counting stats row */}
              {hasSummerStd && (
                <div className="flex gap-6 px-5 py-3 border-b border-[#1e1e1e]">
                  {[
                    { label: 'PA',  val: player.scPA  != null ? String(player.scPA) : null },
                    { label: 'BA',  val: player.scBA  },
                    { label: 'OBP', val: player.scOBP },
                    { label: 'SLG', val: player.scSLG },
                    { label: 'OPS', val: player.scOPS },
                    { label: 'ISO', val: player.scISO },
                  ].map(({ label, val }) => (
                    <div key={label} className="text-center">
                      <div className="text-[10px] text-[#555] font-bold tracking-wider mb-0.5">{label}</div>
                      <div className="text-base font-bold text-white">{val ?? '—'}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Percentile bars */}
              {hasSummerCt && (
                <div className="px-5 py-3">
                  <div className="grid grid-cols-2 gap-x-8 gap-y-0.5">
                    {SC_ROWS.map(({ key, deltaKey, label, higherBetter }) => {
                      const score = player[key] as number | null;
                      const delta = player[deltaKey] as number | null;
                      if (score == null) return null;
                      return (
                        <PercentileBar
                          key={String(key)}
                          label={label}
                          score={score}
                          delta={delta}
                          higherBetter={higherBetter}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TableView = 'trackman' | 'summer';

export default function HSPage() {
  const [year, setYear]         = useState('2026');
  const [players, setPlayers]   = useState<HSPlayer[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState('');
  const [tableView, setTableView] = useState<TableView>('trackman');
  const [sortCol, setSortCol]   = useState<keyof HSPlayer>('avgEv');
  const [sortAsc, setSortAsc]   = useState(false);
  const [selected, setSelected] = useState<HSPlayer | null>(null);
  const loadedYear              = useRef('');

  const load = useCallback(async (y: string) => {
    if (loadedYear.current === y) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hs-players?year=${y}`);
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setPlayers(d.players ?? []);
      loadedYear.current = y;
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(year); }, [year, load]);

  // Summer circuit table columns (sortable numeric ones)
  const SC_TABLE_COLS: { key: keyof HSPlayer; label: string; title: string; lower?: boolean }[] = [
    { key: 'scBatSpeed',  label: 'Bat Spd%',   title: 'Bat Speed Percentile' },
    { key: 'scExplosive', label: 'Explode%',    title: 'Explosiveness Percentile' },
    { key: 'scSprint',    label: 'Sprint%',     title: 'Sprint Speed Percentile' },
    { key: 'scContact',   label: 'Contact%',    title: 'Contact % Percentile' },
    { key: 'scIzContact', label: 'IZ Cont%',    title: 'In-Zone Contact % Percentile' },
    { key: 'scChase',     label: 'Chase%',      title: 'Chase % Percentile',   lower: true },
    { key: 'scK',         label: 'K%',          title: 'K % Percentile',       lower: true },
    { key: 'scGb',        label: 'GB%',         title: 'GB % Percentile',      lower: true },
    { key: 'scFb',        label: 'FB%',         title: 'FB % Percentile' },
    { key: 'scRotAcc',    label: 'Rot Acc%',    title: 'Avg Rotational Acc. Percentile' },
    { key: 'scPeakHand',  label: 'Peak Hnd%',   title: 'Peak Hand Speed Percentile' },
    { key: 'scAirPull',   label: 'Air Pull%',   title: 'Air PULL % Percentile' },
  ];

  const activeCols = tableView === 'trackman' ? TM_COLS : SC_TABLE_COLS;

  const filtered = useMemo(() => {
    let rows = players;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.school?.toLowerCase().includes(q) ||
        p.commit?.toLowerCase().includes(q) ||
        p.hometown?.toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => {
      const av = (a[sortCol] as number | string | null) ?? null;
      const bv = (b[sortCol] as number | string | null) ?? null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const an = typeof av === 'string' ? parseFloat(av) : av;
      const bn = typeof bv === 'string' ? parseFloat(bv) : bv;
      if (isNaN(an) || isNaN(bn)) return 0;
      return sortAsc ? an - bn : bn - an;
    });
  }, [players, search, sortCol, sortAsc]);

  function handleSort(key: keyof HSPlayer) {
    const col = [...TM_COLS, ...SC_TABLE_COLS].find(c => c.key === key);
    if (key === sortCol) { setSortAsc(a => !a); }
    else { setSortCol(key); setSortAsc(col?.lower ?? false); }
  }

  const withTM = players.filter(p => p.avgEv != null || p.barrelPct != null).length;
  const withSC = players.filter(p => p.scBatSpeed != null || p.scExplosive != null).length;

  return (
    <div className="min-h-screen text-white" style={{ background: '#0c0c0c' }}>
      <div className="max-w-full mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center gap-4 mb-5">
          <Link href="/" className="text-[#666] hover:text-white text-sm flex-shrink-0 transition-colors">← Back</Link>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">High School Prospects</h1>
            <p className="text-[#666] text-sm mt-0.5">
              {loading ? 'Loading…' : error ? 'Error' : `${filtered.length} players · ${withTM} TrackMan · ${withSC} Summer Circuit · via Over Slot`}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {/* Year */}
          <div className="flex gap-1">
            {YEARS.map(y => (
              <button key={y} onClick={() => { setYear(y); loadedYear.current = ''; }}
                className={`px-2.5 py-1.5 rounded text-sm font-medium transition-colors ${
                  year === y ? 'bg-white text-black' : 'bg-[#1c1c1c] text-[#888] hover:bg-[#222] hover:text-white'
                }`}>
                {y}
              </button>
            ))}
          </div>

          {/* Table view toggle */}
          <div className="flex gap-1">
            <button onClick={() => { setTableView('trackman'); setSortCol('avgEv'); setSortAsc(false); }}
              className={`px-2.5 py-1.5 rounded text-sm font-medium transition-colors ${
                tableView === 'trackman' ? 'bg-white text-black' : 'bg-[#1c1c1c] text-[#888] hover:bg-[#222] hover:text-white'
              }`}>
              TrackMan
            </button>
            <button onClick={() => { setTableView('summer'); setSortCol('scBatSpeed'); setSortAsc(false); }}
              className={`px-2.5 py-1.5 rounded text-sm font-medium transition-colors ${
                tableView === 'summer' ? 'bg-white text-black' : 'bg-[#1c1c1c] text-[#888] hover:bg-[#222] hover:text-white'
              }`}>
              Summer Circuit
            </button>
          </div>

          {/* Search */}
          <input type="text" placeholder="Search name, school, commit…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="bg-[#1c1c1c] border border-[#2e2e2e] rounded px-3 py-1.5 text-sm text-white placeholder-[#555] focus:outline-none focus:border-white/40 w-64" />
        </div>

        {/* Table */}
        <div className="rounded-xl overflow-auto border border-[#222]" style={{ background: '#141414' }}>
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-[#555]">
              <div className="w-6 h-6 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
              <span className="text-sm">Fetching {year} HS prospects (~25s)…</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-48 text-red-500 text-sm">{error}</div>
          ) : (
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#222]">
                  <th className="text-left px-3 py-2.5 text-[#555] font-medium">#</th>
                  <th className="text-left px-3 py-2.5 text-[#555] font-medium">Player</th>
                  <th className="text-left px-3 py-2.5 text-[#555] font-medium">Pos</th>
                  <th className="text-left px-3 py-2.5 text-[#555] font-medium">School</th>
                  <th className="text-left px-3 py-2.5 text-[#555] font-medium">Commit</th>
                  <th className="text-center px-3 py-2.5 text-[#555] font-medium">Yr</th>

                  {/* Summer circuit counting stats header */}
                  {tableView === 'summer' && (
                    <>
                      {(['scPA','scBA','scOBP','scSLG','scOPS'] as (keyof HSPlayer)[]).map(k => (
                        <th key={k} onClick={() => handleSort(k)}
                          className={`px-3 py-2.5 text-right font-medium cursor-pointer select-none transition-colors hover:text-white ${sortCol === k ? 'text-white' : 'text-[#555]'}`}>
                          {k.slice(2).toUpperCase()}
                          {sortCol === k && <span className="ml-1 text-xs">{sortAsc ? '↑' : '↓'}</span>}
                        </th>
                      ))}
                    </>
                  )}

                  {activeCols.map(col => (
                    <th key={col.key} onClick={() => handleSort(col.key)}
                      title={col.title}
                      className={`px-3 py-2.5 text-right font-medium cursor-pointer select-none transition-colors hover:text-white ${
                        sortCol === col.key ? 'text-white' : 'text-[#555]'
                      }`}>
                      {col.label}
                      {sortCol === col.key && <span className="ml-1 text-xs">{sortAsc ? '↑' : '↓'}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((player, i) => (
                  <tr key={player.playerUrl}
                    className="border-b border-[#1a1a1a] cursor-pointer hover:bg-[#1c1c1c] transition-colors"
                    style={{ background: i % 2 === 0 ? '#111111' : '#0f0f0f' }}
                    onClick={() => setSelected(player)}>
                    <td className="px-3 py-2 text-[#444] text-xs">{i + 1}</td>
                    <td className="px-3 py-2">
                      <span className="text-white font-medium">{player.name}</span>
                    </td>
                    <td className="px-3 py-2 text-[#888] font-medium">{player.position || '—'}</td>
                    <td className="px-3 py-2 text-[#888]">{player.school || '—'}</td>
                    <td className="px-3 py-2 text-[#888]">{player.commit || '—'}</td>
                    <td className="px-3 py-2 text-center text-[#666]">{player.draftYear || '—'}</td>

                    {/* Summer circuit counting stats */}
                    {tableView === 'summer' && (
                      <>
                        <td className="px-3 py-2 text-right text-[#aaa] font-mono">{player.scPA ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-[#aaa] font-mono">{player.scBA ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-[#aaa] font-mono">{player.scOBP ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-[#aaa] font-mono">{player.scSLG ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-[#aaa] font-mono">{player.scOPS ?? '—'}</td>
                      </>
                    )}

                    {/* Active stat columns */}
                    {activeCols.map(col => {
                      const raw = player[col.key] as number | null;
                      if (raw == null) return <td key={col.key} className="px-3 py-2 text-right text-[#333]">—</td>;
                      let color: string;
                      if (tableView === 'trackman') {
                        const tm = col as typeof TM_COLS[0];
                        color = statColor(raw, tm.bad, tm.good, tm.invert);
                      } else {
                        // Summer circuit: percentile 0-100, higher = better unless lower: true
                        const isLow = col.lower ?? false;
                        color = pctColor(raw, !isLow);
                      }
                      const display = tableView === 'trackman'
                        ? (col as typeof TM_COLS[0]).fmt(raw)
                        : Math.round(raw).toString();
                      return (
                        <td key={col.key} className="px-3 py-2 text-right font-mono text-sm">
                          <span style={{ color }}>{display}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {filtered.length === 0 && !loading && (
                  <tr><td colSpan={10 + activeCols.length} className="text-center py-12 text-[#444]">No players found</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {tableView === 'summer' && (
          <p className="mt-2 text-xs text-[#444]">
            Summer Circuit columns show percentile rank (0–100) vs HS peers. Click a player row to see the full lollipop chart with deltas.
          </p>
        )}

        <p className="mt-3 text-xs text-[#333] text-right">
          Data via <a href="https://overslotbaseball.com" target="_blank" rel="noopener noreferrer"
            className="hover:text-[#666] transition-colors">Over Slot</a>
        </p>
      </div>

      {selected && <HSPlayerCard player={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
