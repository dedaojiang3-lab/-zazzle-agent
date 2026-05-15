import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

async function explore() {
  const browser = await chromium.launch({ channel: 'chrome', headless: false, slowMo: 50 });
  const context = browser.contexts()[0];
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
  console.log('Test image:', testImage);

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
  console.log('Login URL:', page.url());

  // Enter designer
  console.log('\n=== DESIGNER ===');
  await page.goto('https://www.zazzle.com/custom/mugs', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.click('a[href*="/pd/spp/"]');
  await page.waitForTimeout(8000);
  console.log('Designer URL:', page.url());
  console.log('Title:', await page.title());

  // Check initial state
  let hasAddDesign = await page.$('button:has-text("Add your design")');
  let hasFileInput = await page.$('input[type="file"]');
  console.log(`Add your design: ${!!hasAddDesign}, File input: ${!!hasFileInput}`);

  // Click "Add your design" to trigger file dialog
  console.log('\n=== CLICK "Add your design" + WAIT FOR FILE CHOOSER ===');
  let fileChooserOpened = false;

  if (hasAddDesign) {
    // Set up file chooser listener BEFORE clicking
    const fcPromise = page.waitForEvent('filechooser', { timeout: 10000 }).then(async (fc) => {
      console.log('File chooser event received!');
      console.log('File chooser mode:', fc.isMultiple() ? 'multiple' : 'single');
      await fc.setFiles(testImage);
      console.log('Files set via file chooser');
      return true;
    }).catch(() => false);

    // Click Add your design
    await hasAddDesign.click();
    fileChooserOpened = await fcPromise;
  }

  if (!fileChooserOpened) {
    // Check if file input appeared after clicking
    console.log('File chooser not triggered, looking for file input...');
    await page.waitForTimeout(2000);
    const fi = await page.$('input[type="file"]');
    if (fi) {
      console.log('Found file input, using setInputFiles directly');
      await fi.setInputFiles(testImage);
      console.log('setInputFiles done');
    } else {
      // Maybe there's an "Uploads" button
      console.log('No file input. Trying Uploads button...');
       const uploadsBtn = await page.$('button:has-text("Uploads")');
       if (uploadsBtn) {
         await uploadsBtn.click();
         await page.waitForTimeout(2000);
         const fi2 = await page.$('input[type="file"]');
         if (fi2) {
           await fi2.setInputFiles(testImage);
           console.log('setInputFiles via Uploads tab done');
         }
       }
    }
  }

  // Wait for processing
  console.log('Waiting for upload to process...');
  await page.waitForTimeout(15000);
  await page.screenshot({ path: 'test/after-upload-wait.png', fullPage: false });

  // Check state after upload
  const state = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    const btnTexts = buttons.filter(b => b.offsetParent !== null).map(b => b.textContent?.trim().substring(0, 80)).filter(Boolean);
    return {
      url: location.href,
      title: document.title,
      hasSellIt: buttons.some(b => b.textContent?.includes('Sell It')),
      hasSellingOpts: buttons.some(b => b.textContent?.includes('Selling Options')),
      hasNextOptions: buttons.some(b => b.textContent?.includes('Next: Options')),
      designerButtons: btnTexts.filter(t => /sell|publish|save|done|next|list|design|option|review|preview|image|upload|add/i.test(t)),
    };
  });
  console.log('\nPost-upload state:');
  console.log('URL:', state.url);
  console.log('Has Sell It:', state.hasSellIt);
  console.log('Has Selling Options:', state.hasSellingOpts);
  console.log('Has Next: Options:', state.hasNextOptions);
  console.log('Designer buttons:', JSON.stringify(state.designerButtons, null, 2));

  await browser.close();
  console.log('\nDone. Screenshot at test/after-upload-wait.png');
}

explore().catch(e => { console.error(e); process.exit(1); });
