// Country names to ISO 2-letter codes for flag URLs
const COUNTRY_CODES: Record<string, string> = {
  'USA': 'us',
  'United States': 'us',
  'Dominican Republic': 'do',
  'Venezuela': 've',
  'Cuba': 'cu',
  'Puerto Rico': 'pr',
  'Mexico': 'mx',
  'Canada': 'ca',
  'Japan': 'jp',
  'South Korea': 'kr',
  'Korea': 'kr',
  'Taiwan': 'tw',
  'Panama': 'pa',
  'Colombia': 'co',
  'Nicaragua': 'ni',
  'Curacao': 'cw',
  'Curaçao': 'cw',
  'Netherlands': 'nl',
  'Australia': 'au',
  'Brazil': 'br',
  'Germany': 'de',
  'Italy': 'it',
  'Aruba': 'aw',
  'Bahamas': 'bs',
  'Honduras': 'hn',
  'Peru': 'pe',
  'US Virgin Islands': 'vi',
  'Virgin Islands': 'vi',
};

export function getCountryFlagUrl(countryName: string | null | undefined, width: number = 80): string | null {
  if (!countryName) return null;

  const code = COUNTRY_CODES[countryName];
  if (code) {
    return `https://flagcdn.com/w${width}/${code}.png`;
  }

  return null;
}

export function hasCountryFlag(countryName: string | null | undefined): boolean {
  if (!countryName) return false;
  return countryName in COUNTRY_CODES;
}
