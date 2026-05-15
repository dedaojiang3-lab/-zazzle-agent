import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

async function explore() {
  const browser = await chromium.launch({ channel: 'chrome', headless: false, slowMo: 50 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // Login first
  console.log('=== LOGGING IN ===');
  await page.goto('https://www.zazzle.com/login', { waitUntil: 'load', timeout: 60000 });

  const cfg = JSON.parse(await fs.readFile(path.join(import.meta.dirname, '../config.json'), 'utf-8'));
  // Two-step login: email → Continue → password → Continue
  await page.fill('input[name="login_username"]', cfg.zazzle.email);
  await page.click('button.Button2_root__blue[type="submit"]');
  await page.waitForTimeout(2000);

  // Password field should now be visible
  await page.fill('input[name="login_password"]', cfg.zazzle.password);
  await page.click('button.Button2_root__blue[type="submit"]');
  await page.waitForTimeout(5000);

  const currentUrl = page.url();
  console.log('After login URL:', currentUrl);
  console.log('Login success:', !currentUrl.includes('/login'));

  // Explore product creation pages
  const testUrls = [
    'https://www.zazzle.com/custom/mugs',
    'https://www.zazzle.com/create_your_own_mug-168256724740998735',
    'https://www.zazzle.com/designer/create-your-own-mug',
    'https://www.zazzle.com/create/designer?productType=mug',
    'https://www.zazzle.com/designer',
  ];

  for (const url of testUrls) {
    console.log(`\n=== Trying: ${url} ===`);
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 20000 });
      await page.waitForTimeout(2000);

      // Check if this is a designer page
      const fileInputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input[type="file"]')).map(el => ({
          className: el.className,
          accept: el.accept,
          visible: el.offsetParent !== null,
        }));
      });

      const keyButtons = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button, [role="button"]')).map(el => ({
          text: el.textContent?.trim().substring(0, 60),
          className: el.className?.substring(0, 80),
          visible: el.offsetParent !== null,
        })).filter(b =>
          b.text && (
            b.text.includes('Upload') ||
            b.text.includes('Add Image') ||
            b.text.includes('Design') ||
            b.text.includes('Create') ||
            b.text.includes('Publish') ||
            b.text.includes('Done') ||
            b.text.includes('Continue') ||
            b.text.includes('Customize') ||
            b.text.includes('Personalize')
          )
        );
      });

      console.log('File inputs:', JSON.stringify(fileInputs, null, 2));
      console.log('Key buttons:', JSON.stringify(keyButtons, null, 2));
      console.log('Page title:', await page.title());
      console.log('Current URL:', page.url());

      if (fileInputs.length > 0) {
        console.log('>>> FOUND file input!');
        break;
      }
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
  }

  await page.screenshot({ path: 'test/product-page.png', fullPage: false });
  await page.waitForTimeout(2000);
  await browser.close();
  console.log('\nDone. Screenshot saved.');
}

explore().catch(e => { console.error(e); process.exit(1); });
