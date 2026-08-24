import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { chromium } from 'playwright-core';

const host = '127.0.0.1';
const port = 4173;
const url = `http://${host}:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', host, '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

const serverOutput = [];
server.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()));
server.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()));

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Vite did not start:\n${serverOutput.join('')}`);
}

let browser;
try {
  await waitForServer();
  const chromePath = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find((candidate) => candidate && existsSync(candidate));
  if (!chromePath) throw new Error('Chrome was not found. Set CHROME_PATH to run the browser smoke test.');

  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-angle=swiftshader',
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const failures = [];
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`page: ${error.message}`));
  page.on('requestfailed', (request) => failures.push(`request: ${request.url()} — ${request.failure()?.errorText}`));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body.is-ready', { timeout: 60_000 });
  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => ({
    canvasWidth: document.querySelector('#scene').width,
    canvasHeight: document.querySelector('#scene').height,
    ready: document.body.classList.contains('is-ready'),
    activeView: document.querySelector('#active-view-label').textContent,
  }));

  if (state.canvasWidth < 1000 || state.canvasHeight < 600) failures.push(`canvas: unexpected dimensions ${state.canvasWidth}x${state.canvasHeight}`);
  if (!state.ready) failures.push('viewer did not reach its ready state');
  if (state.activeView !== 'HERO') failures.push(`view: expected HERO, got ${state.activeView}`);

  // SwiftShader is far slower than a real GPU; balanced mode keeps visual checks practical.
  await page.evaluate(() => document.querySelector('[data-quality="balanced"]').click());
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'viewer-smoke.png', fullPage: true, timeout: 90_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#capture-button').click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) failures.push('image capture did not produce a file');

  await page.locator('[data-camera="profile"]').click();
  await page.evaluate(() => window.__P959_DEBUG__.setView('profile'));
  await page.waitForTimeout(600);
  if ((await page.locator('#active-view-label').textContent()) !== 'PROFILE') failures.push('camera preset did not update');
  await page.screenshot({ path: 'viewer-profile-smoke.png', fullPage: true, timeout: 90_000 });

  await page.locator('#settings-button').click();
  if (!(await page.locator('#settings-panel').getAttribute('class')).includes('is-open')) failures.push('settings panel did not open');
  await page.locator('[data-paint="Night Blue"]').click();

  await page.locator('[data-paint="Guards Red"]').click();
  await page.locator('#settings-close').click();
  await page.locator('.camera-nav [data-camera="hero"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'viewer-mobile-smoke.png', fullPage: true, timeout: 90_000 });

  const mobileState = await page.evaluate(() => ({
    canvasWidth: document.querySelector('#scene').width,
    settingsVisible: getComputedStyle(document.querySelector('#settings-panel')).visibility,
    cameraNavWidth: document.querySelector('.camera-nav').getBoundingClientRect().width,
  }));
  if (mobileState.canvasWidth < 350) failures.push(`mobile canvas: unexpected width ${mobileState.canvasWidth}`);
  if (mobileState.settingsVisible !== 'hidden') failures.push('mobile settings panel did not close');
  if (mobileState.cameraNavWidth > 380) failures.push(`mobile camera navigation overflowed (${mobileState.cameraNavWidth}px)`);

  if (failures.length) {
    throw new Error(failures.join('\n'));
  }

  console.log(`Smoke test passed (${state.canvasWidth}x${state.canvasHeight}, WebGL 2, assets loaded).`);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
