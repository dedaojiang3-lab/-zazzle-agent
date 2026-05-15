import { chromium } from 'playwright';

async function explore() {
  const browser = await chromium.launch({ channel: 'chrome', headless: false, slowMo: 50 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // 1. Login page
  console.log('=== LOGIN PAGE ===');
  await page.goto('https://www.zazzle.com/login', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test/login-page.png', fullPage: false });

  // Get form HTML
  const loginHtml = await page.evaluate(() => {
    const forms = document.querySelectorAll('form, [role="form"]');
    return Array.from(forms).map(f => f.outerHTML.substring(0, 2000)).join('\n---\n');
  });
  console.log('Forms found:', loginHtml.substring(0, 3000));

  // Get all inputs
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input')).map(el => ({
      type: el.type, name: el.name, id: el.id,
      placeholder: el.placeholder, className: el.className,
      ariaLabel: el.getAttribute('aria-label'),
      dataTestid: el.getAttribute('data-testid'),
    }));
  });
  console.log('Inputs:', JSON.stringify(inputs, null, 2));

  // Get all buttons
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="button"]')).map(el => ({
      text: el.textContent?.trim().substring(0, 50),
      type: el.type, id: el.id, className: el.className,
    }));
  });
  console.log('Buttons:', JSON.stringify(buttons, null, 2));

  await page.waitForTimeout(2000);
  await browser.close();
}

explore().catch(e => { console.error(e); process.exit(1); });
