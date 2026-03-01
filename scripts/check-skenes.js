const d = require('../data/pitchers.json');
const p = d.find(x => x.player_id === 694973);
console.log('Paul Skenes pitches:');
const keys = ['ff', 'si', 'fc', 'ch', 'fs', 'cu', 'kc', 'sl', 'st', 'sv'];
const names = ['4-Seam', 'Sinker', 'Cutter', 'Changeup', 'Splitter', 'Curveball', 'Knuckle Curve', 'Slider', 'Sweeper', 'Slurve'];
keys.forEach((k, i) => {
  if (p[k]) {
    const d = p[k];
    console.log(`${names[i].padEnd(14)} usage: ${(d.usage||'—').toString().padStart(5)}%  velo: ${(d.velo||'—').toString().padStart(5)}  IVB: ${(d.movement_v||'—').toString().padStart(5)}  HB: ${(d.movement_h||'—').toString().padStart(5)}  VAA: ${(d.vaa||'—').toString().padStart(5)}`);
  }
});
