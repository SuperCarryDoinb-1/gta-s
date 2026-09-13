import { chromium } from 'file:///C:/Users/17920/AppData/Local/npm-cache/_npx/c61c9351a0dbcfa7/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'warning') console.log(msg.text()); });
  async function ready() {
    await page.goto('http://127.0.0.1:5175/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !document.querySelector('#start-btn').disabled);
    if (!await page.locator('.drift-stage').count()) throw new Error('Intro failed to preload');
  }
  await ready();
  await page.screenshot({ path: 'scratchpad/intro-menu.png' });
  await page.locator('#start-btn').click();
  await page.waitForFunction(() => document.querySelector('#menu').dataset.introPhase === 'arrival');
  await page.waitForTimeout(550);
  await page.screenshot({ path: 'scratchpad/intro-arrival.png' });
  await page.waitForFunction(() => document.querySelector('#menu').dataset.introPhase === 'drift');
  await page.waitForTimeout(450);
  await page.screenshot({ path: 'scratchpad/intro-drift.png' });
  await page.waitForFunction(() => document.querySelector('#menu').dataset.introPhase === 'settled');
  await page.screenshot({ path: 'scratchpad/intro-settled.png' });
  await page.waitForFunction(() => document.querySelector('#menu').style.display === 'none');
  await page.waitForTimeout(800);
  if (await page.locator('.drift-stage').count()) throw new Error('Intro GPU canvas not removed');
  await ready();
  await page.locator('#start-btn').click();
  await page.locator('#intro-skip').click();
  await page.waitForFunction(() => document.querySelector('#menu').style.display === 'none');
  await ready();
  await page.locator('#motion-btn').click();
  await page.locator('#start-btn').click();
  await page.waitForFunction(() => document.querySelector('#menu').style.display === 'none');
  await page.setViewportSize({ width: 390, height: 844 });
  await ready();
  await page.locator('#start-btn').click();
  await page.waitForFunction(() => document.querySelector('#menu').dataset.introPhase === 'settled');
  await page.screenshot({ path: 'scratchpad/intro-mobile.png' });
  await page.waitForFunction(() => document.querySelector('#menu').style.display === 'none');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/models/intro/concept-car.glb', route => route.abort());
  await page.goto('http://127.0.0.1:5175/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('#start-btn').disabled);
  await page.locator('#start-btn').click();
  await page.waitForFunction(() => document.querySelector('#menu').style.display === 'none');
  console.log(JSON.stringify({ result: 'PASS: arrival, drift, settled, game transition, skip, motion-off, mobile, missing-asset fallback', errors }));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
