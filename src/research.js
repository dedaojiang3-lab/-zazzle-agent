import { deepseekChat, loadPrompt, loadConfig, log } from './utils.js';

/**
 * Trend research with seasonal awareness, celebrity/pop-culture trends,
 * and Zazzle bestseller analysis.
 */
export async function runResearch(customNiche = null) {
  log('Starting trend research...');

  const cfg = await loadConfig();
  const systemPrompt = await loadPrompt('research.txt');
  const now = new Date();
  const currentMonth = now.toLocaleString('en-US', { month: 'long' });
  const upcomingHolidays = getUpcomingHolidays(now);

  // Build seasonal context
  const seasonalContext = getSeasonalContext(now);
  const niches = customNiche ? [customNiche] : cfg.pipeline.defaultNiches;

  const userMessage = `Current date: ${now.toISOString().slice(0, 10)} (${currentMonth})
Upcoming holidays/events: ${upcomingHolidays.join(', ') || 'none imminent'}
Seasonal context: ${seasonalContext}
Default niches to consider: ${niches.join(', ')}

Include in your research:
1. Trending pop-culture themes (popular movies, TV shows, music artists, viral memes) that have large fandoms — think fan-art style designs that appeal to these audiences
2. Upcoming holidays and events within the next 60 days, with specific product recommendations
3. Evergreen niches that sell year-round (pets, motivation, hobbies, professions)
4. Gift-giving occasions that drive Zazzle traffic

For each niche, suggest specific design styles that would appeal to that audience. Focus on designs that PEOPLE ACTUALLY BUY.

Return 5 niches as a JSON array.`;

  const response = await deepseekChat(systemPrompt, userMessage, 0.8);

  let result;
  try {
    result = JSON.parse(response);
  } catch {
    const match = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) result = JSON.parse(match[1]);
    else throw new Error('Could not parse research response as JSON');
  }

  // Ensure array
  if (!Array.isArray(result)) result = [result];

  // Add seasonal metadata
  result.forEach(n => {
    n.season = getCurrentSeason(now);
    n.upcomingHolidays = upcomingHolidays;
  });

  log(`Research complete: ${result.length} niches found`);
  result.forEach((n, i) => log(`  ${i + 1}. ${n.niche} — ${n.reason}`));

  return result;
}

/**
 * Get seasonal context string for prompt enrichment
 */
function getSeasonalContext(now) {
  const month = now.getMonth();
  const seasons = {
    northern: [
      'Winter', 'Winter', 'Spring', 'Spring', 'Spring',
      'Summer', 'Summer', 'Summer', 'Fall', 'Fall', 'Fall', 'Winter'
    ],
    themes: [
      'New Year, winter sports, cozy indoor', 'Valentines, romance, winter blues',
      'Spring break, St Patricks, renewal', 'Easter, spring flowers, gardening',
      'Mothers Day prep, graduation prep, outdoor', 'Fathers Day, summer parties, beach',
      'Independence Day, summer travel, BBQ', 'Back to School prep, summer end',
      'Back to School, Labor Day, fall prep', 'Halloween, fall colors, cozy',
      'Thanksgiving, gratitude, autumn harvest', 'Christmas, holiday gifts, winter wonderland'
    ]
  };
  return `${seasons.northern[month]} — ${seasons.themes[month]}`;
}

function getCurrentSeason(now) {
  const m = now.getMonth();
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'fall';
  return 'winter';
}

function getUpcomingHolidays(now) {
  const month = now.getMonth();
  const day = now.getDate();
  const year = now.getFullYear();
  const holidays = [];

  // Static date holidays
  const upcoming = [
    { m: 0, d: 1, name: "New Year's Day", products: 'calendars, planners, resolution gifts' },
    { m: 1, d: 14, name: "Valentine's Day", products: 'cards, mugs, t-shirts, pillows' },
    { m: 2, d: 17, name: "St. Patrick's Day", products: 't-shirts, mugs, party decor' },
    { m: 3, d: 1, name: "April Fools Day", products: 'funny cards, gag gifts, t-shirts' },
    { m: 4, d: 11, name: "Mother's Day", products: 'mugs, cards, pillows, tote bags' },
    { m: 5, d: 15, name: "Father's Day", products: 'mugs, t-shirts, cards, grilling' },
    { m: 5, d: 21, name: "Summer Solstice", products: 'beach gear, summer party, outdoor' },
    { m: 6, d: 4, name: "Independence Day", products: 't-shirts, flags, party decor, tumblers' },
    { m: 7, d: 15, name: "Back to School", products: 'notebooks, backpacks, pencil cases' },
    { m: 8, d: 1, name: "Labor Day", products: 't-shirts, BBQ, party decor' },
    { m: 9, d: 31, name: "Halloween", products: 't-shirts, cards, party decor, mugs' },
    { m: 10, d: 27, name: "Thanksgiving", products: 'invitations, cards, table decor' },
    { m: 11, d: 25, name: "Christmas", products: 'cards, ornaments, mugs, stockings' },
    { m: 11, d: 31, name: "New Year's Eve", products: 'party decor, invitations, t-shirts' },
  ];

  // Calculate Easter (approximate)
  const easter = getEasterDate(year);

  for (const h of upcoming) {
    let hDate = new Date(year, h.m, h.d);
    if (hDate < now) hDate = new Date(year + 1, h.m, h.d);
    const diffDays = Math.ceil((hDate - now) / (1000 * 60 * 60 * 24));
    if (diffDays <= 90 && diffDays > 0) {
      holidays.push({
        name: h.name,
        daysUntil: diffDays,
        products: h.products,
      });
    }
  }

  // Add Easter
  const easterDiff = Math.ceil((easter - now) / (1000 * 60 * 60 * 24));
  if (easterDiff > 0 && easterDiff <= 90) {
    holidays.push({ name: 'Easter', daysUntil: easterDiff, products: 'cards, gifts, spring decor, egg hunt' });
  }

  return holidays;
}

function getEasterDate(year) {
  // Gauss's algorithm
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
