import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

async function explore() {
  const browser = await chromium.launch({ channel: 'chrome', headless: false, slowMo: 50 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const cfg = JSON.parse(await fs.readFile(path.join(import.meta.dirname, '../config.json'), 'utf-8'));
  const outputDir = path.join(import.meta.dirname, '../output');
  const dirs = await fs.readdir(outputDir);
  dirs.sort().reverse();
  let testImage = null;
  for (const dir of dirs) {
    try {
      const files = await fs.readdir(path.join(outputDir, dir, 'designs'));
      if (files.length > 0) { testImage = path.join(outputDir, dir, 'designs', files[0]); break; }
    } catch {}
  }

  // Login
  console.log('=== LOGIN ===');
  await page.goto('https://www.zazzle.com/login', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.fill('input[name="login_username"]', cfg.zazzle.email);
  await page.click('button.Button2_root__blue[type="submit"]');
  await page.waitForTimeout(3000);
  await page.fill('input[name="login_password"]', cfg.zazzle.password);
  await page.click('button.Button2_root__blue[type="submit"]');
  await page.waitForTimeout(5000);

  // Upload
  console.log('=== UPLOAD ===');
  await page.goto('https://www.zazzle.com/custom/mugs', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.click('a[href*="/pd/spp/"]');
  await page.waitForTimeout(8000);
  await page.click('button:has-text("Add your design")');
  await page.waitForTimeout(1000);
  const fi = await page.$('input[type="file"]');
  if (fi) await fi.setInputFiles(testImage);
  await page.waitForTimeout(15000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Watch for new pages/tabs
  const newPagePromise = page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null);

  // Click "Sell It" and watch what happens
  console.log('\n=== CLICK "Sell It" + watch for navigation ===');
  const sellBtn = await page.$('button:has-text("Sell It")');
  if (sellBtn) {
    // Try JS click to bypass overlay
    await sellBtn.evaluate(el => el.click());
    await page.waitForTimeout(5000);
    console.log('Current URL after click:', page.url());

    const newPage = await newPagePromise;
    if (newPage) {
      console.log('NEW TAB OPENED!');
      await newPage.waitForLoadState();
      console.log('New tab URL:', newPage.url());
      console.log('New tab title:', await newPage.title());

      const state = await newPage.evaluate(() => ({
        inputs: Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="search"]), textarea, [contenteditable="true"], select'))
          .map(el => ({ tag: el.tagName, type: el.type, name: el.name, id: el.id, placeholder: el.placeholder })),
        buttons: Array.from(document.querySelectorAll('button, [role="button"]'))
          .filter(b => b.offsetParent !== null)
          .map(b => b.textContent?.trim().substring(0, 60))
          .filter(Boolean),
      }));
      console.log('New tab inputs:', JSON.stringify(state.inputs, null, 2));
      console.log('New tab buttons:', JSON.stringify(state.buttons, null, 2));
      await newPage.screenshot({ path: 'test/sell-it-new-tab.png', fullPage: false });

      // Continue through the publish flow on the new tab
      // Look for "Start Selling", "Create", "Publish", "List" etc.
    } else {
      console.log('No new tab. Checking for URL change or modal...');
      // Maybe it opened a full-page modal
      await page.screenshot({ path: 'test/sell-it-clicked.png', fullPage: false });

      const dump = await page.evaluate(() => ({
        url: location.href,
        modals: Array.from(document.querySelectorAll('[role="dialog"], [class*="Modal"], [class*="Overlay"], [class*="fullscreen"]'))
          .filter(m => m.offsetParent !== null)
          .map(m => ({
            className: m.className?.substring(0, 80),
            text: m.innerText?.substring(0, 500),
            inputs: Array.from(m.querySelectorAll('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea, [contenteditable], select'))
              .map(i => ({ tag: i.tagName, type: i.type, name: i.name, placeholder: i.placeholder })),
          })),
      }));
      console.log('Modals:', JSON.stringify(dump.modals, null, 2));
    }
  } else {
    console.log('"Sell It" button not found');
  }

  await browser.close();
  console.log('\nDone.');
}

explore().catch(e => { console.error(e); process.exit(1); });
