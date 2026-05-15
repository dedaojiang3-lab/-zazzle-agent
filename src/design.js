import fs from 'fs/promises';
import path from 'path';
import { deepseekChat, loadPrompt, loadConfig, downloadImage, sanitize, log } from './utils.js';

/**
 * AI design generation with seasonal awareness and trending-style prompts.
 * Uses DeepSeek for prompt engineering → Pollinations.ai for image generation.
 */
export async function runDesign(niches, runDir) {
  const cfg = await loadConfig();
  const count = cfg.pipeline.designsPerRun;

  // Enrich niches with seasonal product-targeting intelligence
  const enrichedNiches = enrichNiches(niches);

  // Spread designs across niches. Use all niches, max 3 per niche.
  const nicheCount = Math.min(enrichedNiches.length, count);
  const designsPerNiche = Math.min(3, Math.ceil(count / nicheCount));
  const selectedNiches = enrichedNiches.slice(0, nicheCount);

  log(`Generating ${count} designs across ${selectedNiches.length} niches (${designsPerNiche}/niche)...`);

  const allDesigns = [];

  for (const niche of selectedNiches) {
    if (allDesigns.length >= count) break;
    try {
      const remaining = count - allDesigns.length;
      const batchSize = Math.min(designsPerNiche, remaining);
      const designs = await generateForNiche(niche, batchSize, runDir, cfg);
      allDesigns.push(...designs);
    } catch (e) {
      log(`  Error generating for niche ${niche.niche}: ${e.message}`);
    }
  }

  log(`Design generation complete: ${allDesigns.length} designs created`);
  return allDesigns;
}

/**
 * Enrich niche data with seasonal trends and audience targeting
 */
function enrichNiches(niches) {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();

  // Pop-culture and trending audience themes by season
  const trendingAudiences = {
    spring: ['graduation seniors', 'new moms', 'gardeners', 'spring breakers', 'Easter celebrators'],
    summer: ['dads/grill masters', 'patriotic Americans', 'beach lovers', 'summer brides', 'campers'],
    fall: ['college students', 'horror/Halloween fans', 'football fans', 'teachers', 'pumpkin spice lovers'],
    winter: ['Christmas shoppers', 'New Year resolution makers', 'winter sport enthusiasts', 'cozy homebodies'],
  };

  const season = month >= 2 && month <= 4 ? 'spring' :
                 month >= 5 && month <= 7 ? 'summer' :
                 month >= 8 && month <= 10 ? 'fall' : 'winter';

  // Design styles that are currently trending (as of 2026)
  const trendingStyles = [
    'minimalist line art',
    'retro vintage 90s',
    'bold typography',
    'cottagecore aesthetic',
    'dark academia',
    'y2k nostalgia',
    'abstract watercolor',
    'scandinavian flat design',
    'streetwear graphics',
    'nature photography inspired',
  ];

  return niches.map(n => ({
    ...n,
    season,
    year,
    trendingAudiences: trendingAudiences[season] || [],
    trendingStyles: trendingStyles.sort(() => Math.random() - 0.5).slice(0, 5),
    // Prioritize holiday products when relevant
    isHolidayNiche: /christmas|halloween|valentine|thanksgiving|easter|independence|mother|father|graduation|new year/i.test(n.niche),
  }));
}

async function generateForNiche(niche, count, runDir, cfg) {
  const systemPrompt = await loadPrompt('design-prompt.txt');
  const themeStr = (niche.designThemes || []).join(', ');
  const colorStr = (niche.colorPalette || []).join(', ');

  // Build a rich prompt context
  const contextParts = [];
  if (niche.isHolidayNiche) {
    contextParts.push('HOLIDAY/EVENT NICHE — prioritize gift-giving appeal and seasonal urgency');
  }
  if (niche.trendingAudiences?.length) {
    contextParts.push(`Target audiences: ${niche.trendingAudiences.join(', ')}`);
  }
  if (niche.trendingStyles?.length) {
    contextParts.push(`Trending design styles to incorporate: ${niche.trendingStyles.join(', ')}`);
  }
  contextParts.push(`Year: ${niche.year}, Season: ${niche.season}`);

  const userMessage = `Niche: ${niche.niche}
Design themes: ${themeStr}
Color palette: ${colorStr}
Target products: ${(niche.targetProducts || ['mug', 'card']).join(', ')}
${contextParts.join('\n')}

IMPORTANT GUIDELINES:
- Each prompt must produce a FLAT, center-focused design suitable for printing on products
- Use seamless/repeating patterns when generating pattern-based designs
- Avoid text in images (Zazzle products can add text separately)
- For fan-art style designs: use unmistakable visual references WITHOUT using trademarked characters or logos
- Each design should work on multiple product types (mug, t-shirt, phone case)

Generate ${count} design prompts as a JSON array with: title, prompt, negativePrompt, style.`;

  const response = await deepseekChat(systemPrompt, userMessage, 0.9);

  let prompts;
  try {
    prompts = JSON.parse(response);
  } catch {
    const match = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) prompts = JSON.parse(match[1]);
    else throw new Error('Could not parse design prompts');
  }

  if (!Array.isArray(prompts)) prompts = [prompts];
  if (prompts.length > count) prompts = prompts.slice(0, count);

  const designs = [];

  for (let i = 0; i < prompts.length; i++) {
    const dp = prompts[i];
    const title = dp.title || `${niche.niche}-design-${i}`;
    log(`  Generating image ${i + 1}/${prompts.length}: ${title}`);

    try {
      const imagePath = await generateImage(dp.prompt, title, i, niche, runDir, cfg);
      designs.push({
        niche: niche.niche,
        title,
        prompt: dp.prompt,
        negativePrompt: dp.negativePrompt || 'low quality, blurry, pixelated, text, watermark, ugly, deformed',
        style: dp.style || '',
        targetProducts: niche.targetProducts || ['mug'],
        imagePath,
        season: niche.season,
      });
    } catch (e) {
      log(`    Image generation failed: ${e.message}`);
    }
  }

  return designs;
}

async function generateImage(prompt, title, index, niche, runDir, cfg) {
  if (cfg.imageGen.provider === 'pollinations') {
    return generateWithPollinations(prompt, title, index, niche, runDir, cfg);
  }
  throw new Error(`Unknown image provider: ${cfg.imageGen.provider}`);
}

async function generateWithPollinations(prompt, title, index, niche, runDir, cfg) {
  // Pollinations.ai free API with FLUX model
  // Quality settings: higher width/height for print-ready images
  const encodedPrompt = encodeURIComponent(prompt.slice(0, 600));
  const width = cfg.imageGen.width || 2048;
  const height = cfg.imageGen.height || 2048;
  const seed = Math.floor(Math.random() * 100000);

  // Use flux model for best quality, add enhance flag for better results
  const url = `${cfg.imageGen.pollinationsUrl}/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux&enhance=true`;

  log(`    Pollinating: ${url.slice(0, 120)}...`);

  const imageBuffer = await downloadImage(url);

  // Ensure designs directory exists
  const designsDir = path.join(runDir, 'designs');
  await fs.mkdir(designsDir, { recursive: true });

  const name = sanitize(title || `design-${index}`);
  const fileName = `${niche.niche}-${name}-${seed}.png`;
  const filePath = path.join(designsDir, fileName);
  await fs.writeFile(filePath, imageBuffer);
  log(`    Saved: ${fileName}`);

  return filePath;
}
