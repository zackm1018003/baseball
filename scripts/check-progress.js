const d = require('../data/pitchers.json');
const enriched = d.filter(p => p.ff && p.ff.movement_v !== undefined);
const withTeam = d.filter(p => p.team);
const withERA = d.filter(p => p.era !== undefined);
console.log('Total:', d.length);
console.log('With movement data:', enriched.length);
console.log('With team:', withTeam.length);
console.log('With ERA:', withERA.length);
console.log('Still need enrichment:', d.length - enriched.length);
