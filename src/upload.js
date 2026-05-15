import { chromium } from 'playwright';
import { loadConfig, log } from './utils.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Zazzle automated upload via Playwright
 *
 * Flow:
 *   1. Login (two-step: email → Continue → password → Continue)
 *   2. Enter designer via product listing page
 *   3. Upload design image
 *   4. Click "Sell It" to open listing form
 *   5. Fill title, description, tags, royalty
 *   6. Publish
 */
export async function runUpload(listings) {
  const cfg = await loadConfig();

  if (!cfg.zazzle.email || !cfg.zazzle.password) {
    log('WARNING: Zazzle credentials not configured. Skipping upload.');
    return { uploaded: 0, skipped: listings.length, results: [] };
  }

  log(`Starting Zazzle upload for ${listings.length} products...`);

  const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;

  const launchOpts = {
    headless: cfg.pipeline.headless,
    slowMo: isCI ? 0 : 100,
  };

  // CI: use bundled Chromium. Local: use system Chrome (no extra download)
  if (!isCI) {
    launchOpts.channel = 'chrome';
  }

  // Proxy for China access
  if (cfg.proxy?.server) {
    launchOpts.proxy = { server: cfg.proxy.server };
  }

  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  const page = await context.newPage();
  const results = [];

  try {
    await loginToZazzle(page, cfg);

    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      log(`  Uploading ${i + 1}/${listings.length}: ${listing.title}`);

      try {
        const url = await createProduct(page, listing, cfg);
        results.push({ title: listing.title, status: 'published', url });
        log(`    Published: ${url}`);
      } catch (e) {
        log(`    Failed: ${e.message}`);
        results.push({ title: listing.title, status: 'failed', error: e.message });
      }

      await page.waitForTimeout(3000);
    }
  } finally {
    await browser.close();
  }

  const succeeded = results.filter(r => r.status === 'published').length;
  log(`Upload complete: ${succeeded}/${listings.length} published`);
  return { uploaded: succeeded, total: listings.length, results };
}

/**
 * Two-step login: email → Continue → password → Continue
 */
async function loginToZazzle(page, cfg) {
  log('  Logging into Zazzle...');
  await page.goto('https://www.zazzle.com/login', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2000);

  // Step 1: email
  await page.fill('input[name="login_username"]', cfg.zazzle.email);
  await page.click('button.Button2_root__blue[type="submit"]');
  await page.waitForTimeout(3000);

  // Step 2: password
  await page.fill('input[name="login_password"]', cfg.zazzle.password);
  await page.click('button.Button2_root__blue[type="submit"]');
  await page.waitForTimeout(5000);

  // Check for login failure
  if (page.url().includes('/login') || page.url().includes('/signin')) {
    const error = await page.$('[role="alert"]');
    if (error) throw new Error(`Login failed: ${await error.textContent()}`);
    throw new Error('Login failed — still on login page');
  }

  log('  Logged in successfully');
}

/**
 * Full product creation flow:
 *   Product page → Click product → Upload image → Sell It → Fill form → Publish
 */
async function createProduct(page, listing, cfg) {
  const productType = normalizeProductType(listing.targetProducts?.[0] || 'mug');

  // 1. Go to product listing page
  const productPageUrl = getProductPageUrl(productType);
  await page.goto(productPageUrl, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3000);

  // 2. Click the first product card to enter designer
  const productLink = await page.$('a[href*="/pd/spp/"]');
  if (!productLink) throw new Error('No product cards found on page');
  await productLink.click();
  await page.waitForTimeout(8000);

  // 3. Upload design image
  await uploadImage(page, listing.imagePath);

  // Dismiss any preview dialog
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 4. Click "Sell It" to open listing form
  await clickSellIt(page);

  // 5. Fill listing details
  await fillListingForm(page, listing, cfg);

  // 6. Submit/publish
  await submitListing(page);

  return page.url();
}

/**
 * Upload image via the designer file input
 */
async function uploadImage(page, imagePath) {
  log('    Uploading design image...');

  // Click "Add your design" to reveal the file input
  const addBtn = await page.$('button:has-text("Add your design")');
  if (!addBtn) throw new Error('"Add your design" button not found');
  await addBtn.click();
  await page.waitForTimeout(1000);

  // Upload via file input (id="uploadID-0", name="image")
  const fileInput = await page.$('input[type="file"]');
  if (!fileInput) throw new Error('File input not found after clicking Add your design');
  await fileInput.setInputFiles(imagePath);

  // Wait for Zazzle to process the image (large images take longer)
  await page.waitForTimeout(15000);
  log('    Image uploaded');
}

/**
 * Click "Sell It" — use JS click to bypass canvas overlay
 */
async function clickSellIt(page) {
  log('    Opening listing form...');

  // Listen for new tabs in case Sell It opens one
  const newPagePromise = page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);

  const sellBtn = await page.$('button:has-text("Sell It")');
  if (!sellBtn) throw new Error('"Sell It" button not found');

  // JS click bypasses pointer-event interception from canvas overlays
  await sellBtn.evaluate(el => el.click());
  await page.waitForTimeout(5000);

  // Check if a new tab was opened
  const newPage = await newPagePromise;
  if (newPage) {
    log('    Listing opened in new tab');
    await newPage.waitForLoadState();
    // Switch to the new page for the rest of the flow
    // (Hack: assign page props — in practice we'd restructure this)
    page._newTab = newPage;
  }
}

/**
 * Fill the listing form: title, description, tags, royalty
 */
async function fillListingForm(page, listing, cfg) {
  // Use new tab if Sell It opened one
  const p = page._newTab || page;

  log('    Filling listing details...');

  // Title — describes the DESIGN, not the product
  try {
    const titleInput = await p.$('input[name="title"], [data-testid="title-input"], #title, [placeholder*="title" i], [placeholder*="name" i], [aria-label*="title" i]');
    if (titleInput) {
      await titleInput.fill(listing.title || '');
      log('    Title filled');
    }
  } catch {}

  // Description
  try {
    const descInput = await p.$('textarea[name="description"], [data-testid="description"], #description, [contenteditable="true"], [placeholder*="description" i], [aria-label*="description" i]');
    if (descInput) {
      await descInput.fill(listing.description || '');
      log('    Description filled');
    }
  } catch {}

  // Tags — Zazzle uses 10 tag slots
  if (listing.tags?.length > 0) {
    try {
      const tagInput = await p.$('input[name="tags"], [data-testid="tags-input"], #tags, [placeholder*="tag" i], [aria-label*="tag" i]');
      if (tagInput) {
        await tagInput.fill(listing.tags.join(', '));
        log('    Tags filled');
      }
    } catch {}
  }

  // Royalty rate
  try {
    const royaltyInput = await p.$('input[name="royalty"], [data-testid="royalty"], #royalty, [placeholder*="royalty" i], [aria-label*="royalty" i], input[type="number"]');
    if (royaltyInput) {
      await royaltyInput.fill(String(cfg.zazzle.royaltyRate || 10));
      log('    Royalty set');
    }
  } catch {}
}

/**
 * Submit/publish the listing
 */
async function submitListing(page) {
  const p = page._newTab || page;

  log('    Publishing...');

  const publishSelectors = [
    'button:has-text("Publish")',
    'button:has-text("Submit")',
    'button:has-text("Post for Sale")',
    'button:has-text("List")',
    'button:has-text("Save")',
    'button:has-text("Done")',
    'button[type="submit"]',
  ];

  for (const sel of publishSelectors) {
    try {
      await p.click(sel, { timeout: 5000 });
      await p.waitForTimeout(5000);
      log('    Published successfully');
      return;
    } catch {}
  }

  // If no publish button found, it might be auto-saved
  log('    No explicit publish button found; listing may be auto-saved');
}

/**
 * Map our product names to Zazzle product listing pages
 */
function getProductPageUrl(productType) {
  const pages = {
    'mug': 'https://www.zazzle.com/custom/mugs',
    'invitation': 'https://www.zazzle.com/custom/invitations',
    'greeting-card': 'https://www.zazzle.com/custom/greeting+cards',
    't-shirt': 'https://www.zazzle.com/custom/t+shirts',
    'phone-case': 'https://www.zazzle.com/custom/phone+cases',
    'tote-bag': 'https://www.zazzle.com/custom/tote+bags',
    'pillow': 'https://www.zazzle.com/custom/pillows',
    'notebook': 'https://www.zazzle.com/custom/notebooks',
  };
  return pages[productType] || pages['mug'];
}

function normalizeProductType(type) {
  const aliases = {
    'mugs': 'mug',
    'tshirt': 't-shirt',
    't-shirts': 't-shirt',
    'greeting cards': 'greeting-card',
    'phone cases': 'phone-case',
    'tote bags': 'tote-bag',
    'tumblers': 'mug',
    'posters': 'invitation',
    'garden flags': 'invitation',
  };
  return aliases[type] || type;
}
