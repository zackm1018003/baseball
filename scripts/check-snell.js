const d = require('../data/pitchers.json');
const p = d.find(x => x.player_id === 605483);
console.log('Blake Snell:');
console.log('Team:', p.team, '| Age:', p.age, '| Throws:', p.throws);
const keys = ['ff', 'si', 'fc', 'ch', 'fs', 'fo', 'cu', 'kc', 'sl', 'st', 'sv'];
const names = ['4-Seam', 'Sinker', 'Cutter', 'Changeup', 'Splitter', 'Forkball', 'Curveball', 'Knuckle Curve', 'Slider', 'Sweeper', 'Slurve'];
keys.forEach((k, i) => {
  if (p[k]) {
    const d = p[k];
    console.log(`${names[i].padEnd(14)} usage: ${String(d.usage || '—').padStart(5)}%  velo: ${String(d.velo || '—').padStart(5)}  IVB: ${String(d.movement_v || '—').padStart(6)}  HB: ${String(d.movement_h || '—').padStart(6)}  VAA: ${String(d.vaa || '—').padStart(6)}`);
  }
});
