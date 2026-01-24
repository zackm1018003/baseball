const { execSync } = require('child_process');

const testNames = [
  'Tommy White',
  'Termarr Johnson',
  'Walker Jenkins',
  'Charlie Condon',
  'Travis Bazzana'
];

console.log('Testing MLB Stats API with known prospects:\n');

testNames.forEach(name => {
  try {
    const encodedName = encodeURIComponent(name);
    const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodedName}`;
    const result = execSync(`curl -s "${url}"`, { encoding: 'utf8' });
    const json = JSON.parse(result);

    if (json.people && json.people.length > 0) {
      console.log(`✓ ${name}: Found ID ${json.people[0].id} (${json.people[0].fullName})`);
    } else {
      console.log(`✗ ${name}: Not found`);
    }
  } catch (error) {
    console.log(`✗ ${name}: Error - ${error.message}`);
  }
});
