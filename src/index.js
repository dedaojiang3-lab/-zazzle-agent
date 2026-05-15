#!/usr/bin/env node
import { runResearch } from './research.js';
import { runDesign } from './design.js';
import { runListing } from './listing.js';
import { runUpload } from './upload.js';
import { createRunDir, log, loadConfig } from './utils.js';
import fs from 'fs/promises';
import path from 'path';

const USAGE = `
Zazzle Agent - AI-powered design & listing automation

Usage:
  node src/index.js                    Full pipeline (research → design → listing → upload)
  node src/index.js --research-only    Only research trends
  node src/index.js --design-only      Only generate designs (requires prior research)
  node src/index.js --listing-only     Only generate listings (requires prior designs)
  node src/index.js --upload-only      Only upload to Zazzle (requires prior listings)
  node src/index.js --niche "wedding"  Focus on a specific niche
  node src/index.js --no-upload        Full pipeline but skip upload
  node src/index.js --help             Show this help

Config: edit config.json to set API keys, Zazzle credentials, etc.
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

  const researchOnly = args.includes('--research-only');
  const designOnly = args.includes('--design-only');
  const listingOnly = args.includes('--listing-only');
  const uploadOnly = args.includes('--upload-only');
  const noUpload = args.includes('--no-upload');

  const nicheArg = args.find((a, i) => a === '--niche' && i + 1 < args.length);
  const customNiche = nicheArg ? args[args.indexOf('--niche') + 1] : null;

  const cfg = await loadConfig();

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  Zazzle Agent v1.0');
  console.log(`  Time: ${new Date().toLocaleString('zh-CN')}`);
  console.log('═══════════════════════════════════════════');
  console.log('');

  // Create output directory for this run
  const runDir = await createRunDir();
  log(`Output: ${runDir}`);

  let niches, designs, listings, uploadResult;

  // --- Research ---
  if (!designOnly && !listingOnly && !uploadOnly) {
    log('════════ STEP 1: Trend Research ════════');
    niches = await runResearch(customNiche);
    await fs.writeFile(
      path.join(runDir, 'research.json'),
      JSON.stringify(niches, null, 2)
    );
    log('Research saved to research.json');
  }

  if (researchOnly) {
    log('Done (research-only mode)');
    return;
  }

  // --- Design ---
  if (!listingOnly && !uploadOnly) {
    log('════════ STEP 2: AI Design Generation ════════');
    // Load research if not already done
    if (!niches) {
      const researchFile = await findLatestFile('research.json');
      if (researchFile) {
        niches = JSON.parse(await fs.readFile(researchFile, 'utf-8'));
        log(`Loaded ${niches.length} niches from previous research`);
      } else {
        log('No research found. Running research first...');
        niches = await runResearch(customNiche);
      }
    }

    designs = await runDesign(niches, runDir);
    await fs.writeFile(
      path.join(runDir, 'designs.json'),
      JSON.stringify(designs, null, 2)
    );
    log('Designs saved to designs.json');
  }

  if (designOnly) {
    log('Done (design-only mode)');
    printSummary(runDir, designs, null, null);
    return;
  }

  // --- Listing ---
  if (!uploadOnly) {
    log('════════ STEP 3: SEO Listing Generation ════════');
    if (!designs) {
      const designsFile = await findLatestFile('designs.json');
      if (designsFile) {
        designs = JSON.parse(await fs.readFile(designsFile, 'utf-8'));
        log(`Loaded ${designs.length} designs from previous run`);
      } else {
        log('ERROR: No designs found. Run with --design-only first.');
        return;
      }
    }

    const listings = await runListing(designs);

    // Add placeholder URLs
    const listingsWithUrls = listings.map(l => ({
      ...l,
      zazzleUrl: null,
      status: 'pending',
    }));

    await fs.writeFile(
      path.join(runDir, 'listings.json'),
      JSON.stringify(listingsWithUrls, null, 2)
    );
    log('Listings saved to listings.json');
  }

  if (listingOnly) {
    log('Done (listing-only mode)');
    return;
  }

  // --- Upload ---
  if (!noUpload) {
    log('════════ STEP 4: Zazzle Upload ════════');

    let listings;
    const listingsFile = path.join(runDir, 'listings.json');
    try {
      listings = JSON.parse(await fs.readFile(listingsFile, 'utf-8'));
    } catch {
      const prev = await findLatestFile('listings.json');
      if (prev) {
        listings = JSON.parse(await fs.readFile(prev, 'utf-8'));
      }
    }

    if (!listings || listings.length === 0) {
      log('ERROR: No listings found to upload.');
      return;
    }

    uploadResult = await runUpload(listings);

    // Save results
    await fs.writeFile(
      path.join(runDir, 'result.json'),
      JSON.stringify(uploadResult, null, 2)
    );
  }

  if (uploadOnly) {
    log('Done (upload-only mode)');
    return;
  }

  // --- Summary ---
  printSummary(runDir, designs, listings || null, uploadResult);
}

function printSummary(runDir, designs, listings, uploadResult) {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  Pipeline Complete!');
  console.log('═══════════════════════════════════════════');
  console.log(`  Output: ${runDir}`);
  if (designs) console.log(`  Designs: ${designs.length}`);
  if (uploadResult) {
    console.log(`  Published: ${uploadResult.uploaded}/${uploadResult.total}`);
    if (uploadResult.results) {
      uploadResult.results
        .filter(r => r.status === 'published')
        .forEach(r => console.log(`    ${r.url}`));
    }
  }
  console.log('');
}

async function findLatestFile(filename) {
  const outputDir = path.join(process.cwd(), 'output');
  try {
    const dirs = await fs.readdir(outputDir);
    // Sort by name (which includes date), newest first
    dirs.sort().reverse();
    for (const dir of dirs) {
      const filePath = path.join(outputDir, dir, filename);
      try {
        await fs.access(filePath);
        return filePath;
      } catch {}
    }
  } catch {}
  return null;
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
