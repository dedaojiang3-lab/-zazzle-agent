import fs from 'fs/promises';
import path from 'path';
import { deepseekChat, loadPrompt, loadConfig, log } from './utils.js';

/**
 * Generate SEO-optimized listing copy for each design
 * Returns: array of listing objects ready for Zazzle upload
 */
export async function runListing(designs) {
  const cfg = await loadConfig();
  log(`Generating SEO listings for ${designs.length} designs...`);

  const systemPrompt = await loadPrompt('seo-listing.txt');

  // Process in batches of 3 to keep API calls manageable
  const results = [];
  const batchSize = 3;

  for (let i = 0; i < designs.length; i += batchSize) {
    const batch = designs.slice(i, i + batchSize);
    const batchResults = await processBatch(batch, systemPrompt, cfg);
    results.push(...batchResults);
  }

  log(`Listing generation complete: ${results.length} listings`);
  return results;
}

async function processBatch(designs, systemPrompt, cfg) {
  const designInfo = designs.map((d, i) => ({
    index: i,
    title: d.title,
    niche: d.niche,
    designDescription: d.prompt.slice(0, 200),
    targetProducts: d.targetProducts,
    royaltyRate: cfg.zazzle.royaltyRate,
  }));

  const userMessage = `Generate Zazzle SEO-optimized listings for these designs:

${JSON.stringify(designInfo, null, 2)}

For EACH design, provide title, description, tags, and category. Output as JSON array.`;

  const response = await deepseekChat(systemPrompt, userMessage, 0.7);

  let listings;
  try {
    listings = JSON.parse(response);
  } catch {
    const match = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) listings = JSON.parse(match[1]);
    else throw new Error('Could not parse listing response');
  }

  if (!Array.isArray(listings)) listings = [listings];

  // Merge with design data
  return listings.map((l, i) => ({
    ...l,
    imagePath: designs[i]?.imagePath,
    niche: designs[i]?.niche,
    targetProducts: designs[i]?.targetProducts || ['mug'],
    royaltyRate: cfg.zazzle.royaltyRate,
  }));
}
