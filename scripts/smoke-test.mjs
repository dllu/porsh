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
  const useSoftwareRenderer = Boolean(process.env.CI);

  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--enable-webgl',
      '--disable-dev-shm-usage',
      ...(useSoftwareRenderer
        ? ['--use-angle=swiftshader']
        : ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-software-rasterizer']),
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const failures = [];
  const assetRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`page: ${error.message}`));
  page.on('requestfailed', (request) => failures.push(`request: ${request.url()} — ${request.failure()?.errorText}`));
  page.on('request', (request) => assetRequests.push(request.url()));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // The advanced WWC model is 2.19m triangles. Select balanced mode before shader compilation
  // so the software-rendered CI check remains practical; local smoke runs use the GPU.
  if (useSoftwareRenderer) {
    await page.evaluate(() => document.querySelector('[data-quality="balanced"]').click());
  }
  await page.waitForSelector('body.is-ready', { timeout: 240_000 });
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
  if (!assetRequests.some((requestUrl) => requestUrl.endsWith('.p9e'))) failures.push('protected model payload was not requested');
  if (assetRequests.some((requestUrl) => /\.(?:fbx|glb)(?:$|\?)/i.test(requestUrl))) failures.push('plaintext model geometry was requested');
  if (assetRequests.some((requestUrl) => /\.(?:jpe?g|png|ktx2)(?:$|\?)/i.test(requestUrl))) failures.push('standalone paid texture was requested');

  await page.waitForTimeout(600);
  await page.screenshot({ path: 'viewer-smoke.png', fullPage: true, timeout: 90_000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
  await page.locator('#capture-button').click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) failures.push('image capture did not produce a file');

  await page.locator('[data-camera="profile"]').click();
  await page.evaluate(() => window.__P959_DEBUG__.setView('profile'));
  await page.waitForTimeout(600);
  if ((await page.locator('#active-view-label').textContent()) !== 'PROFILE') failures.push('camera preset did not update');
  await page.screenshot({ path: 'viewer-profile-smoke.png', fullPage: true, timeout: 90_000 });

  await page.locator('#credits-button').click();
  const legalNotice = await page.locator('.credits-card__legal').textContent();
  if (!legalNotice?.includes('not associated or otherwise affiliated')) failures.push('trademark disclaimer is missing');
  const credits = await page.locator('#credits-card').textContent();
  if (!credits?.includes('Wire Wheels Club')) failures.push('WWC model attribution is missing');
  await page.locator('#credits-close').click();

  await page.locator('#settings-button').click();
  if (!(await page.locator('#settings-panel').getAttribute('class')).includes('is-open')) failures.push('settings panel did not open');
  await page.waitForSelector('#settings-panel.is-open', { state: 'visible' });
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

  await page.locator('#settings-button').click();
  await page.waitForSelector('#settings-panel.is-open', { state: 'visible' });
  await page.evaluate(() => {
    const panel = document.querySelector('#settings-panel');
    panel.scrollTop = panel.scrollHeight;
  });
  const mobileSettingsState = await page.evaluate(() => {
    const panel = document.querySelector('#settings-panel');
    const quality = document.querySelector('.quality-setting');
    const ultra = document.querySelector('[data-quality="ultra"]');
    const panelBounds = panel.getBoundingClientRect();
    const qualityBounds = quality.getBoundingClientRect();
    const ultraBounds = ultra.getBoundingClientRect();
    return {
      panelTop: panelBounds.top,
      panelBottom: panelBounds.bottom,
      qualityBottom: qualityBounds.bottom,
      cameraNavPointerEvents: getComputedStyle(document.querySelector('.camera-nav')).pointerEvents,
      ultraHitTarget: document.elementFromPoint(
        ultraBounds.left + ultraBounds.width / 2,
        ultraBounds.top + ultraBounds.height / 2,
      ) === ultra,
    };
  });
  if (mobileSettingsState.panelTop > 130) failures.push(`mobile settings panel starts too low (${mobileSettingsState.panelTop}px)`);
  if (mobileSettingsState.qualityBottom > mobileSettingsState.panelBottom) failures.push('mobile render quality controls are clipped');
  if (mobileSettingsState.cameraNavPointerEvents !== 'none') failures.push('mobile camera navigation intercepts settings input');
  if (!mobileSettingsState.ultraHitTarget) failures.push('mobile Ultra quality control is occluded');
  await page.locator('#settings-close').click();

  if (failures.length) {
    throw new Error(failures.join('\n'));
  }

  console.log(`Smoke test passed (${state.canvasWidth}x${state.canvasHeight}, WebGL 2, assets loaded).`);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
