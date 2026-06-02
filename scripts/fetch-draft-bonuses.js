/**
 * Fetches signing bonus data for draft picks from MLB Stats API (2017–2025)
 * and writes data/signing-bonuses.json mapping MLB person ID → signing bonus (dollars).
 *
 * Run: node scripts/fetch-draft-bonuses.js
 */

const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, '..', 'data', 'signing-bonuses.json');
const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

async function fetchYear(year) {
  const bonuses = {};
  const url = `https://statsapi.mlb.com/api/v1/draft/${year}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const data = await res.json();

  // Structure: drafts.rounds[].picks[]
  const rounds = data?.drafts?.rounds ?? [];
  let totalPicks = 0;
  let withBonus = 0;

  for (const round of rounds) {
    for (const pick of (round.picks ?? [])) {
      totalPicks++;
      const personId = pick?.person?.id;
      const bonus = pick?.signingBonus;
      if (personId && bonus && bonus !== '0' && bonus !== '') {
        bonuses[personId] = parseInt(bonus, 10);
        withBonus++;
      }
    }
  }

  console.log(`  ${year}: ${totalPicks} picks, ${withBonus} with bonus data`);
  return bonuses;
}

async function main() {
  const all = {};

  for (const year of YEARS) {
    console.log(`Fetching ${year} draft...`);
    try {
      const bonuses = await fetchYear(year);
      Object.assign(all, bonuses);
    } catch (err) {
      console.error(`  Error fetching ${year}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  const total = Object.keys(all).length;
  console.log(`\nTotal: ${total} players with signing bonus data`);

  fs.writeFileSync(OUTPUT, JSON.stringify(all, null, 2));
  console.log(`Written to ${OUTPUT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
