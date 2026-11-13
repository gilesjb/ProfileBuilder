// @ts-check
/**
 * Destination data: a stand-in for a real travel data API.
 *
 * This is the only source of destination facts in the app (DEST-6). The data
 * is illustrative, not authoritative — in particular, visa notes are
 * deliberately general.
 */

/** @typedef {'spring' | 'summer' | 'fall' | 'winter'} Season */

/**
 * The assignment's schema, extended with `country`, `dietaryNotes` and
 * `accessibilityNotes` so the assistant can relate destinations to the
 * profile's dietary and accessibility fields.
 * @typedef {{
 *   name: string,
 *   bestSeasons: Season[],
 *   knownFor: string[],
 *   averageDailyBudgetUSD: { budget: number, midRange: number, luxury: number },
 *   visaNotes?: string,
 *   country: string,
 *   dietaryNotes?: string,
 *   accessibilityNotes?: string,
 * }} DestinationInfo
 */

/** @type {Array<DestinationInfo & { aliases?: string[] }>} */
const DESTINATIONS = [
  {
    name: 'Lisbon',
    country: 'Portugal',
    aliases: ['Lisboa'],
    bestSeasons: ['spring', 'fall'],
    knownFor: ['food', 'architecture', 'nightlife', 'viewpoints', 'day trips to the coast'],
    averageDailyBudgetUSD: { budget: 60, midRange: 150, luxury: 400 },
    visaNotes: 'Part of the Schengen Area; many passport holders can visit visa-free for up to 90 days in any 180-day period.',
    dietaryNotes: 'Cuisine leans heavily on seafood and pork; vegetarian options are good in the city but limited in traditional tascas.',
    accessibilityNotes: 'Very hilly with steep cobbled streets and many stairs; trams and elevators help but some neighborhoods are hard going.',
  },
  {
    name: 'Kyoto',
    country: 'Japan',
    bestSeasons: ['spring', 'fall'],
    knownFor: ['temples', 'gardens', 'food', 'traditional culture', 'hiking'],
    averageDailyBudgetUSD: { budget: 70, midRange: 180, luxury: 500 },
    visaNotes: 'Many nationalities, including US, UK, EU and Canadian passport holders, can make short tourist visits visa-free.',
    dietaryNotes: 'Buddhist temple cuisine (shojin ryori) is fully vegetarian, but many everyday dishes use fish-based dashi.',
    accessibilityNotes: 'Mostly flat city center with good public transport; some temples involve long stone staircases.',
  },
  {
    name: 'Mexico City',
    country: 'Mexico',
    aliases: ['CDMX', 'Ciudad de México'],
    bestSeasons: ['spring', 'fall', 'winter'],
    knownFor: ['food', 'museums', 'architecture', 'markets', 'nightlife'],
    averageDailyBudgetUSD: { budget: 40, midRange: 110, luxury: 350 },
    visaNotes: 'Many nationalities, including US, Canadian, UK and EU passport holders, can visit visa-free for tourism.',
    dietaryNotes: 'Huge street food scene; vegetarian options are widely available, though lard is common in traditional cooking.',
    accessibilityNotes: 'Large and spread out; central neighborhoods are flat, but sidewalks are uneven and the metro has many stairs.',
  },
  {
    name: 'Marrakech',
    country: 'Morocco',
    bestSeasons: ['spring', 'fall'],
    knownFor: ['markets', 'architecture', 'food', 'gardens', 'desert excursions'],
    averageDailyBudgetUSD: { budget: 40, midRange: 110, luxury: 400 },
    visaNotes: 'Many nationalities, including US, UK, EU and Canadian passport holders, can visit visa-free for up to 90 days.',
    dietaryNotes: 'Tagines and couscous are often available in vegetable versions; alcohol is less widely served.',
    accessibilityNotes: 'The medina has narrow, crowded, uneven lanes that are difficult with limited mobility.',
  },
  {
    name: 'Reykjavik',
    country: 'Iceland',
    aliases: ['Reykjavík'],
    bestSeasons: ['summer', 'winter'],
    knownFor: ['hiking', 'hot springs', 'northern lights', 'nature', 'road trips'],
    averageDailyBudgetUSD: { budget: 110, midRange: 250, luxury: 600 },
    visaNotes: 'Part of the Schengen Area; many passport holders can visit visa-free for up to 90 days in any 180-day period.',
    dietaryNotes: 'Expensive dining; seafood and lamb dominate traditional menus, but the city has solid vegetarian options.',
    accessibilityNotes: 'The city is compact and accessible; many natural sites involve rough, unpaved trails.',
  },
  {
    name: 'Cape Town',
    country: 'South Africa',
    bestSeasons: ['spring', 'summer', 'fall'],
    knownFor: ['hiking', 'beaches', 'wine', 'food', 'wildlife'],
    averageDailyBudgetUSD: { budget: 45, midRange: 120, luxury: 400 },
    visaNotes: 'Many nationalities, including US, UK, EU and Canadian passport holders, can visit visa-free for up to 90 days.',
    dietaryNotes: 'Strong meat and braai culture, but a well-developed vegetarian and vegan restaurant scene.',
    accessibilityNotes: 'Waterfront and city center are accessible; Table Mountain has a cable car as an alternative to hiking.',
  },
];

/**
 * Looks up a destination by name, ignoring case, accents and extra whitespace.
 * Returns null for unknown destinations.
 * @param {string} name
 * @returns {Promise<DestinationInfo | null>}
 */
export async function getDestinationInfo(name) {
  const key = normalizeName(name);
  const match = DESTINATIONS.find((d) => [d.name, ...(d.aliases ?? [])].some((n) => normalizeName(n) === key));
  if (!match) return null;
  const { aliases: _aliases, ...info } = match;
  return structuredClone(info);
}

/** @returns {string[]} */
export function listDestinationNames() {
  return DESTINATIONS.map((d) => d.name);
}

/** @param {string} name */
function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}
