// ESPN college team IDs for logo URLs
const COLLEGE_ESPN_IDS: Record<string, number> = {
  'Alabama': 333,
  'Florida': 57,
  'Georgia Tech': 59,
  'Kentucky': 96,
  'LSU': 99,
  'Miami': 2390,
  'Mississippi State': 344,
  'TCU': 2628,
  'Tennessee': 2633,
  'Texas': 251,
  'Texas A&M': 245,
  'UCLA': 26,
  'Virginia': 258,
  'Wake Forest': 154,
};

export function getCollegeLogoUrl(collegeName: string | null | undefined, size: number = 100): string | null {
  if (!collegeName) return null;

  const espnId = COLLEGE_ESPN_IDS[collegeName];
  if (espnId) {
    return `https://a.espncdn.com/i/teamlogos/ncaa/500/${espnId}.png`;
  }

  return null;
}

export function hasCollegeLogo(collegeName: string | null | undefined): boolean {
  if (!collegeName) return false;
  return collegeName in COLLEGE_ESPN_IDS;
}
