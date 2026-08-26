import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const host = '127.0.0.1';
const port = 4175;
const url = `http://${host}:${port}`;
const outputDirectory = resolve(process.env.P959_RENDER_OUTPUT ?? 'render-tests');
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    '--host', host,
    '--port', String(port),
    '--strictPort',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

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
      // Vite is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`Vite did not start:\n${serverOutput.join('')}`);
}

const renderStates = [
  { name: 'rear-off', view: 'rear' },
  { name: 'rear-brakes', view: 'rear', brakes: true },
  { name: 'rear-reverse', view: 'rear', reverse: true },
  { name: 'rear-indicators', view: 'rear', indicators: true },
  {
    name: 'rear-all-lamps',
    view: 'rear',
    indicators: true,
    brakes: true,
    reverse: true,
  },
  { name: 'front-off', view: 'front' },
  { name: 'front-indicators', view: 'front', indicators: true },
  {
    name: 'front-indicators-close',
    camera: {
      position: [0.72, 0.54, 2.78],
      target: [0.57, 0.37, 1.98],
      fov: 24,
    },
    indicators: true,
  },
  {
    name: 'front-off-head-on-close',
    camera: {
      position: [0.574, 0.39, 2.65],
      target: [0.574, 0.366, 2.02],
      fov: 22,
    },
  },
  {
    name: 'front-indicators-head-on-close',
    camera: {
      position: [0.574, 0.39, 2.65],
      target: [0.574, 0.366, 2.02],
      fov: 22,
    },
    indicators: true,
  },
  {
    name: 'front-indicators-reflection-only-close',
    diagnostic: true,
    camera: {
      position: [0.574, 0.39, 2.65],
      target: [0.574, 0.366, 2.02],
      fov: 22,
    },
    indicators: true,
    indicatorComponents: { hotspots: false },
  },
  {
    name: 'front-indicators-hotspot-only-close',
    diagnostic: true,
    camera: {
      position: [0.574, 0.39, 2.65],
      target: [0.574, 0.366, 2.02],
      fov: 22,
    },
    indicators: true,
    indicatorComponents: { reflections: false },
  },
  {
    name: 'front-off-head-on-far',
    camera: {
      position: [0.574, 0.46, 4.5],
      target: [0.574, 0.366, 2.02],
      fov: 22,
    },
  },
  {
    name: 'front-indicators-head-on-far',
    camera: {
      position: [0.574, 0.46, 4.5],
      target: [0.574, 0.366, 2.02],
      fov: 22,
    },
    indicators: true,
  },
  { name: 'profile-indicators', view: 'profile', indicators: true },
  {
    name: 'rear-brakes-close',
    camera: {
      position: [1.08, 0.76, -3.02],
      target: [0.61, 0.58, -2.02],
      fov: 24,
    },
    brakes: true,
  },
  {
    name: 'rear-reverse-close',
    camera: {
      position: [1.08, 0.76, -3.02],
      target: [0.61, 0.58, -2.02],
      fov: 24,
    },
    reverse: true,
  },
  {
    name: 'rear-indicators-close',
    camera: {
      position: [1.08, 0.76, -3.02],
      target: [0.61, 0.58, -2.02],
      fov: 24,
    },
    indicators: true,
  },
  {
    name: 'rear-off-head-on-close',
    camera: {
      position: [0.744, 0.6, -2.65],
      target: [0.744, 0.584, -2.01],
      fov: 22,
    },
  },
  {
    name: 'rear-indicators-head-on-close',
    camera: {
      position: [0.744, 0.6, -2.65],
      target: [0.744, 0.584, -2.01],
      fov: 22,
    },
    indicators: true,
  },
  {
    name: 'rear-indicators-reflection-only-close',
    diagnostic: true,
    camera: {
      position: [0.744, 0.6, -2.65],
      target: [0.744, 0.584, -2.01],
      fov: 22,
    },
    indicators: true,
    indicatorComponents: { hotspots: false },
  },
  {
    name: 'rear-indicators-hotspot-only-close',
    diagnostic: true,
    camera: {
      position: [0.744, 0.6, -2.65],
      target: [0.744, 0.584, -2.01],
      fov: 22,
    },
    indicators: true,
    indicatorComponents: { reflections: false },
  },
  {
    name: 'rear-off-head-on-far',
    camera: {
      position: [0.744, 0.646, -4.5],
      target: [0.744, 0.584, -2.01],
      fov: 22,
    },
  },
  {
    name: 'rear-indicators-head-on-far',
    camera: {
      position: [0.744, 0.646, -4.5],
      target: [0.744, 0.584, -2.01],
      fov: 22,
    },
    indicators: true,
  },
  {
    name: 'rear-all-lamps-close',
    camera: {
      position: [1.08, 0.76, -3.02],
      target: [0.61, 0.58, -2.02],
      fov: 24,
    },
    indicators: true,
    brakes: true,
    reverse: true,
  },
];
const requestedStateNames = new Set(
  (process.env.P959_RENDER_STATES ?? '').split(',').filter(Boolean),
);
const defaultRenderStates = renderStates.filter((state) => !state.diagnostic);
const selectedRenderStates = requestedStateNames.size > 0
  ? renderStates.filter((state) => requestedStateNames.has(state.name))
  : defaultRenderStates;
if (selectedRenderStates.length !== (requestedStateNames.size || defaultRenderStates.length)) {
  const availableStates = renderStates.map((state) => state.name).join(', ');
  throw new Error(`Unknown render state. Available states: ${availableStates}`);
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
  if (!chromePath) throw new Error('Chrome was not found. Set CHROME_PATH to run the render harness.');

  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-angle=swiftshader',
      '--disable-dev-shm-usage',
    ],
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const failures = [];
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`page: ${error.message}`));
  page.on('requestfailed', (request) => {
    failures.push(`request: ${request.url()} — ${request.failure()?.errorText}`);
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.querySelector('[data-quality="balanced"]').click());
  await page.waitForSelector('body.is-ready', { timeout: 240_000 });
  const reflectionCalibration = await page.evaluate(
    () => window.__P959_DEBUG__.getIndicatorReflectionCalibration(),
  );
  if (!reflectionCalibration || reflectionCalibration.syntheticPeakMultiplier < 2) {
    throw new Error('Indicator reflection map is not calibrated against the studio HDRI peak.');
  }
  console.log(
    `Indicator reflection: studio peak ${reflectionCalibration.studioPeakLuminance.toFixed(2)}, `
      + `synthetic peak ${reflectionCalibration.syntheticPeakLuminance.toFixed(2)} `
      + `(${reflectionCalibration.syntheticPeakMultiplier.toFixed(1)}x).`,
  );
  const blinkClockResult = await page.evaluate(async () => {
    const toggle = document.querySelector('#indicators-toggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    const waitForRender = () => new Promise((resolveFrame) => {
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
    });
    const blockMainThread = (duration) => {
      const startedAt = performance.now();
      while (performance.now() - startedAt < duration) {
        // Deliberately skip animation frames to verify phase is not accumulated per frame.
      }
    };

    blockMainThread(420);
    await waitForRender();
    const offAfterFirstStall = !window.__P959_DEBUG__.getLightState().indicatorLit;
    blockMainThread(300);
    await waitForRender();
    const onAfterSecondStall = window.__P959_DEBUG__.getLightState().indicatorLit;

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    return { offAfterFirstStall, onAfterSecondStall };
  });
  if (!blinkClockResult.offAfterFirstStall || !blinkClockResult.onAfterSecondStall) {
    throw new Error('Indicator blink phase is coupled to rendered frame count.');
  }
  console.log('Indicator wall-clock blink passed across stalled frames.');
  mkdirSync(outputDirectory, { recursive: true });

  // Leave the controls in the DOM so the production event handlers remain the
  // source of truth, but strip every visible layer except the WebGL canvas.
  await page.evaluate(() => {
    const canvas = document.querySelector('#scene');
    for (const element of document.body.querySelectorAll('*')) {
      if (element === canvas || element.contains(canvas)) continue;
      element.style.setProperty('display', 'none', 'important');
    }
  });

  for (const state of selectedRenderStates) {
    await page.evaluate((nextState) => {
      if (window.__P959_RENDER_INDICATOR_HOLD__) {
        window.clearInterval(window.__P959_RENDER_INDICATOR_HOLD__);
        window.__P959_RENDER_INDICATOR_HOLD__ = null;
      }

      window.__P959_DEBUG__.setIndicatorComponents(nextState.indicatorComponents);

      const lightToggles = {
        headlights: false,
        indicators: Boolean(nextState.indicators),
        brakes: Boolean(nextState.brakes),
        reverse: Boolean(nextState.reverse),
      };
      for (const [light, enabled] of Object.entries(lightToggles)) {
        const toggle = document.querySelector(`#${light}-toggle`);
        toggle.checked = enabled;
        toggle.dispatchEvent(new Event('change'));
      }

      if (lightToggles.indicators) {
        // Reset the blink clock frequently enough that every indicator capture
        // is deterministic and always represents the illuminated phase.
        window.__P959_RENDER_INDICATOR_HOLD__ = window.setInterval(() => {
          document.querySelector('#indicators-toggle').dispatchEvent(new Event('change'));
        }, 100);
      }
      if (nextState.camera) {
        window.__P959_DEBUG__.setCamera(
          nextState.camera.position,
          nextState.camera.target,
          nextState.camera.fov,
        );
      } else {
        window.__P959_DEBUG__.setView(nextState.view);
      }
    }, state);

    await page.waitForTimeout(500);
    const outputPath = resolve(outputDirectory, `${state.name}.png`);
    // The canvas is the only visible body layer. Capturing the viewport avoids
    // Playwright waiting for a continuously rendered WebGL element to become
    // "stable", which can otherwise time out even though the frame is ready.
    await page.screenshot({ path: outputPath, timeout: 90_000 });
    console.log(`Rendered ${outputPath}`);
  }

  if (failures.length) throw new Error(failures.join('\n'));
  console.log(`UI-free render harness passed (${selectedRenderStates.length} comparison frames).`);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
