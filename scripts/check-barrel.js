const https = require('https');

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  result.push(current.trim());
  return result;
}

const url = 'https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfPT=FF%7C&hfSea=2025%7C&player_type=pitcher&min_pitches=0&min_results=0&group_by=name-event&sort_col=pitches&sort_order=desc&type=details&game_date_gt=2025-03-01&game_date_lt=2025-04-30';

https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const lines = d.trim().split('\n');
    const headers = parseCSVLine(lines[0]);
    const lsaIdx = headers.indexOf('launch_speed_angle');
    const lsIdx = headers.indexOf('launch_speed');
    const laIdx = headers.indexOf('launch_angle');
    const bbIdx = headers.indexOf('bb_type');

    console.log('launch_speed_angle idx:', lsaIdx);
    console.log('launch_speed idx:', lsIdx);
    console.log('bb_type idx:', bbIdx);

    // Check rows with launch_speed present (= batted balls)
    const lsaVals = {};
    let checked = 0;
    for (let i = 1; i < lines.length && checked < 500; i++) {
      const fields = parseCSVLine(lines[i]);
      const ls = fields[lsIdx];
      if (ls && ls !== '' && !isNaN(parseFloat(ls))) {
        const lsa = fields[lsaIdx] || 'empty';
        lsaVals[lsa] = (lsaVals[lsa] || 0) + 1;
        checked++;
      }
    }
    console.log('\nlaunch_speed_angle distribution (batted balls):', lsaVals);
    console.log('Total batted balls checked:', checked);
    // 6 = barrel per Savant definition
  });
});
