'use client';

import { useRef, useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { toPng } from 'html-to-image';

interface PlayerGrades {
  hit:        string;
  power:      string;
  fielding:   string;
  arm:        string;
  run:        string;
  fv:         string;
  name:       string;
  team:       string;
  position:   string;
  draftYear:  string;
  playerType: 'hs' | 'college';
}

interface GradeEntry {
  playerUrl: string;
  grades: Partial<PlayerGrades>;
}

interface Props {
  entries: GradeEntry[];
  onClose: () => void;
}

function gradeColor(val: string | undefined): string {
  if (!val) return 'transparent';
  const n = parseFloat(val);
  if (isNaN(n)) return 'transparent';
  if (n >= 70) return '#16a34a';
  if (n >= 60) return '#22c55e';
  if (n >= 55) return '#84cc16';
  if (n >= 50) return '#ca8a04';
  if (n >= 45) return '#d97706';
  if (n >= 40) return '#ea580c';
  return '#dc2626';
}

function decodeHtml(str: string | undefined): string {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function splitName(fullName: string | undefined): { first: string; last: string } {
  const decoded = decodeHtml(fullName).trim();
  if (!decoded) return { first: '', last: '' };
  const idx = decoded.indexOf(' ');
  if (idx === -1) return { first: decoded, last: '' };
  return { first: decoded.slice(0, idx), last: decoded.slice(idx + 1) };
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

const GRADE_COLS: { key: keyof PlayerGrades; label: string }[] = [
  { key: 'hit',      label: 'HIT' },
  { key: 'power',    label: 'POW' },
  { key: 'run',      label: 'RUN' },
  { key: 'fielding', label: 'FLD' },
  { key: 'arm',      label: 'ARM' },
  { key: 'fv',       label: 'FV'  },
];

// Column widths (px)
const W = { rank: 34, pos: 52, first: 110, last: 148, team: 0 /* flex */, grade: 48, fy: 52 };
const PADDING = 40; // total horizontal padding
const FIXED_WIDTH = W.rank + W.pos + W.first + W.last + W.grade * GRADE_COLS.length + W.fy + PADDING;
const TEAM_WIDTH = 170;
const TOTAL_WIDTH = FIXED_WIDTH + TEAM_WIDTH;
const ROW_H = 30;

export default function GradesGraphic({ entries, onClose }: Props) {
  const graphicRef = useRef<HTMLDivElement>(null);
  const [imageUrl, setImageUrl]   = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [copied, setCopied]       = useState(false);
  const [portalEl, setPortalEl]   = useState<HTMLDivElement | null>(null);

  // Off-screen portal so toPng has no fixed-ancestor artifacts
  useEffect(() => {
    const el = document.createElement('div');
    el.setAttribute('data-grades-graphic', 'true');
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none;z-index:-1;';
    document.body.appendChild(el);
    setPortalEl(el);
    return () => { if (el.parentNode) el.parentNode.removeChild(el); };
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!graphicRef.current) return;
      try {
        const url = await toPng(graphicRef.current, {
          pixelRatio: 2,
          backgroundColor: '#0a0a0a',
        });
        setImageUrl(url);
      } catch (e) {
        console.error('GradesGraphic toPng error:', e);
      } finally {
        setRendering(false);
      }
    }, 700);
    return () => clearTimeout(t);
  }, []);

  function download() {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.download = `scout-grades-${new Date().toISOString().slice(0, 10)}.png`;
    a.href = imageUrl;
    a.click();
  }

  async function copy() {
    if (!imageUrl) return;
    try {
      const blob = await (await fetch(imageUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.open(imageUrl, '_blank');
    }
  }

  // ── Graphic markup ──────────────────────────────────────────────────────────
  const graphic = (
    <div
      ref={graphicRef}
      style={{
        width: TOTAL_WIDTH,
        background: '#0a0a0a',
        fontFamily: 'Arial, Helvetica, sans-serif',
        padding: '18px 20px 14px',
        borderRadius: 10,
      }}
    >
      {/* Title */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>
          Scout Grades · {formatDate()}
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, color: '#ffffff', lineHeight: 1, textTransform: 'uppercase', letterSpacing: -0.5 }}>
          Prospect Rankings
        </div>
        <div style={{ height: 2, background: 'linear-gradient(90deg, transparent, #f59e0b, transparent)', marginTop: 8 }} />
      </div>

      {/* Column headers */}
      <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 6, borderBottom: '1px solid #2a2a2a' }}>
        {[
          { label: '#',      width: W.rank,  align: 'left'   },
          { label: 'POS',    width: W.pos,   align: 'left'   },
          { label: 'FIRST',  width: W.first, align: 'left'   },
          { label: 'LAST',   width: W.last,  align: 'left'   },
          { label: 'SCHOOL', width: TEAM_WIDTH, align: 'left', flex: true },
        ].map(col => (
          <div
            key={col.label}
            style={{
              width: col.flex ? undefined : col.width,
              flex: col.flex ? 1 : undefined,
              fontSize: 9,
              color: '#6b7280',
              fontWeight: 700,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              textAlign: col.align as 'left',
            }}
          >{col.label}</div>
        ))}
        {GRADE_COLS.map(c => (
          <div key={c.key} style={{ width: W.grade, fontSize: 9, color: '#6b7280', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', textAlign: 'center' }}>
            {c.label}
          </div>
        ))}
        <div style={{ width: W.fy, fontSize: 9, color: '#f59e0b', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', textAlign: 'center' }}>
          FY
        </div>
      </div>

      {/* Data rows */}
      {entries.map((entry, i) => {
        const { first, last } = splitName(entry.grades.name);
        return (
          <div
            key={entry.playerUrl}
            style={{
              display: 'flex',
              alignItems: 'center',
              height: ROW_H,
              background: i % 2 === 0 ? '#111111' : '#0d0d0d',
              borderBottom: '1px solid #181818',
            }}
          >
            {/* # */}
            <div style={{ width: W.rank, fontSize: 10, color: '#6b7280', fontWeight: 700 }}>{i + 1}</div>
            {/* Pos */}
            <div style={{ width: W.pos, fontSize: 11, color: '#d1d5db', fontWeight: 600 }}>
              {entry.grades.position || '—'}
            </div>
            {/* First */}
            <div style={{ width: W.first, fontSize: 12, color: '#e5e7eb', fontWeight: 400, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {first || '—'}
            </div>
            {/* Last */}
            <div style={{ width: W.last, fontSize: 12, color: '#ffffff', fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {last || '—'}
            </div>
            {/* Team / School */}
            <div style={{ flex: 1, fontSize: 11, color: '#9ca3af', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', paddingRight: 8 }}>
              {entry.grades.team || '—'}
            </div>
            {/* Grade badges */}
            {GRADE_COLS.map(col => {
              const val = entry.grades[col.key];
              const color = gradeColor(val);
              return (
                <div key={col.key} style={{ width: W.grade, textAlign: 'center' }}>
                  {val ? (
                    <span style={{
                      display: 'inline-block',
                      background: color,
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 700,
                      borderRadius: 3,
                      padding: '1px 5px',
                      minWidth: 28,
                      textAlign: 'center',
                    }}>
                      {val}
                    </span>
                  ) : (
                    <span style={{ color: '#374151', fontSize: 11 }}>—</span>
                  )}
                </div>
              );
            })}
            {/* FY */}
            <div style={{ width: W.fy, textAlign: 'center', fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>
              {entry.grades.draftYear || '—'}
            </div>
          </div>
        );
      })}

      {/* Footer */}
      <div style={{ marginTop: 10, textAlign: 'center', fontSize: 9, color: '#374151', letterSpacing: 1.5, textTransform: 'uppercase' }}>
        20–80 Scouting Scale
      </div>
    </div>
  );

  // ── Modal UI ────────────────────────────────────────────────────────────────
  return (
    <>
      {portalEl && ReactDOM.createPortal(graphic, portalEl)}

      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-auto">
        <div className="flex flex-col items-center gap-4 max-w-5xl w-full">

          {/* Controls */}
          <div className="flex gap-3 w-full justify-end items-center">
            {rendering && <span className="text-gray-400 text-sm mr-auto">Rendering image…</span>}
            {imageUrl && !rendering && (
              <span className="text-gray-400 text-sm mr-auto">Right-click → Save · or use buttons</span>
            )}
            <button
              onClick={copy}
              disabled={!imageUrl}
              className="bg-[#1a1f30] hover:bg-[#262e4a] disabled:opacity-40 border border-[#303a5c] text-gray-300 font-medium px-4 py-2 rounded text-sm transition-colors"
            >
              {copied ? '✓ Copied!' : '📋 Copy'}
            </button>
            <button
              onClick={download}
              disabled={!imageUrl}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold px-4 py-2 rounded text-sm transition-colors"
            >
              ⬇ Download
            </button>
            <button
              onClick={onClose}
              className="bg-[#1c1c1c] hover:bg-[#272727] text-gray-300 font-medium px-4 py-2 rounded text-sm transition-colors"
            >
              ✕ Close
            </button>
          </div>

          {/* Preview */}
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt="Scout grades graphic"
              style={{ maxWidth: '100%', borderRadius: 10, cursor: 'context-menu' }}
              title="Right-click → Save Image As"
            />
          ) : (
            <div className="w-full bg-[#1a1f30] rounded-xl flex items-center justify-center" style={{ height: 200 }}>
              <span className="text-gray-500 text-sm">Building graphic…</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
