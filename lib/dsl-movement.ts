// Movement-only pitch CSV (DSL/showcase "pitch_data" exports): velo, IVB, HB, spin, tilt,
// exit speed — NO pitch tags, NO ball/strike/whiff outcomes, NO location/release. So we
// CLASSIFY pitch types from movement and produce a velo+movement pitchData. Fields that
// need outcomes or release data (whiff%, zone%, VAA/HAA, release, arm angle) stay null.

import type { RawDot, PitchType, PitchData } from './trackman';

function parseLine(line: string): string[] {
  const out: string[] = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseMovementCsv(text: string): Record<string, string>[] {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  const hdr = parseLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(l => {
    const v = parseLine(l); const r: Record<string, string> = {};
    hdr.forEach((h, i) => { r[h] = (v[i] ?? '').trim(); });
    return r;
  });
}

// "1:15" -> 1.25, "12:45" -> 12.75, "7:00" -> 7.0 (clock hours)
function parseTilt(s: string): number {
  const m = (s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  return parseInt(m[1]) + parseInt(m[2]) / 60;
}
const num = (s: string | undefined) => { const v = parseFloat(s ?? ''); return isNaN(v) ? NaN : v; };

export function listPitchers(rows: Record<string, string>[]): { name: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const r of rows) { const n = r.pitcher; if (n) counts[n] = (counts[n] || 0) + 1; }
  return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

interface Pitch { velo: number; ivb: number; hb: number; spin: number; tilt: number; ev: number }

// Classify one pitch given the pitcher's fastball velo + arm-side sign.
function classify(p: Pitch, fbVelo: number, armSign: number): string {
  const hbArm = p.hb * armSign;          // arm-side positive
  // Drop family = topspin axis (≈4–9 o'clock) OR genuine drop (low/negative IVB).
  const dropAxis = !isNaN(p.tilt) && p.tilt >= 4 && p.tilt <= 9.5;
  const isBreaking = dropAxis || p.ivb < 3;
  if (isBreaking) {
    // Curveball: slow + real drop; Slider: harder + gyro/short.
    if (p.velo <= fbVelo - 9 && p.ivb < -2) return 'Curveball';
    if (p.ivb < -8) return 'Curveball';
    return 'Slider';
  }
  // Ride family (fastball / sinker / cutter / changeup)
  if (p.velo >= fbVelo - 4.5) {
    if (Math.abs(hbArm) < 5.5 && p.ivb >= 7) return 'Cutter';
    if (hbArm >= 13 && p.ivb < 15) return 'Sinker';
    return '4-Seam Fastball';
  }
  // Notably slower than the fastball → changeup (low spin / arm-side run reinforce it)
  return 'Changeup';
}

export interface MovementMeta { name: string; team: string; opponent: string | null; level: string }

export function aggregateMovement(rows: Record<string, string>[], pitcherName: string): { pitchData: PitchData; battersFaced: number } {
  const mine: Pitch[] = [];
  let prevBatter = ''; let battersFaced = 0;
  for (const r of rows) {
    if (r.pitcher !== pitcherName) { prevBatter = ''; continue; }
    const velo = num(r.release_speed_mph);
    if (isNaN(velo)) continue;
    if (r.batter && r.batter !== prevBatter) { battersFaced++; prevBatter = r.batter; }
    mine.push({ velo, ivb: num(r.induced_vertical_break_in), hb: num(r.horizontal_break_in), spin: num(r.spin_rate_rpm), tilt: parseTilt(r.tilt), ev: num(r.exit_speed_mph) });
  }

  // Fastball velo = 80th percentile of all velos; arm-side from mean HB of the hard pitches.
  const velos = mine.map(p => p.velo).sort((a, b) => a - b);
  const fbVelo = velos.length ? velos[Math.min(velos.length - 1, Math.floor(velos.length * 0.8))] : 0;
  const hard = mine.filter(p => p.velo >= fbVelo - 2 && !isNaN(p.hb));
  const meanHardHb = hard.length ? hard.reduce((s, p) => s + p.hb, 0) / hard.length : 1;
  const armSign = meanHardHb >= 0 ? 1 : -1;
  const throws: 'L' | 'R' | null = mine.length ? (armSign === 1 ? 'R' : 'L') : null;

  interface G { velos: number[]; spins: number[]; ivbs: number[]; hbs: number[]; count: number }
  const groups: Record<string, G> = {};
  const rawDots: RawDot[] = [];
  for (const p of mine) {
    const name = classify(p, fbVelo, armSign);
    if (!groups[name]) groups[name] = { velos: [], spins: [], ivbs: [], hbs: [], count: 0 };
    const g = groups[name]; g.count++;
    g.velos.push(p.velo);
    if (!isNaN(p.spin)) g.spins.push(p.spin);
    if (!isNaN(p.ivb)) g.ivbs.push(p.ivb);
    if (!isNaN(p.hb)) g.hbs.push(p.hb * armSign); // arm-side positive
    if (!isNaN(p.ivb) && !isNaN(p.hb)) {
      rawDots.push({
        hb: p.hb * armSign, ivb: p.ivb, pitchType: name,
        px: null, pz: null, isWhiff: false, isSwing: false, isBarrel: false, batterSide: null,
        velo: p.velo, spin: !isNaN(p.spin) ? p.spin : null,
        vaa: null, haa: null, hRel: null, vRel: null, extension: null,
      });
    }
  }

  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const r1 = (v: number | null) => v !== null ? Math.round(v * 10) / 10 : null;
  const counted = Object.values(groups).reduce((s, g) => s + g.count, 0);

  const pitchTypes: PitchType[] = [];
  for (const [name, g] of Object.entries(groups)) {
    const usage = counted > 0 ? (g.count / counted) * 100 : 0;
    if (usage < 1) continue;
    pitchTypes.push({
      name, count: g.count, usage: Math.round(usage * 10) / 10,
      velo: r1(avg(g.velos)), maxVelo: g.velos.length ? r1(Math.max(...g.velos)) : null,
      spin: avg(g.spins) !== null ? Math.round(avg(g.spins)!) : null,
      h_movement: r1(avg(g.hbs)), v_movement: r1(avg(g.ivbs)),
      vaa: null, haa: null,                 // need release/trajectory — not in this feed
      whiff: null, whiffs: 0, swings: 0,    // no pitch outcomes in this feed
      zone_pct: null, barrel_pct: null, h_rel: null, v_rel: null, extension: null, arm_angle: null,
    });
  }
  pitchTypes.sort((a, b) => b.usage - a.usage);

  const pitchData: PitchData = {
    totalPitches: mine.length, pitchTypes, rawDots, throws, armAngle: null,
    strikePct: null, swingAndMissPct: null, totalWhiffs: 0,
  };
  return { pitchData, battersFaced };
}
