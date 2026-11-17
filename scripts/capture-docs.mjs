// Generate real UI screenshots using only a disposable Chrome for Testing profile.
import { chromium } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const directory = resolve('docs/images');
await mkdir(directory, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'still-docs-'));
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const demo = spawn(process.execPath, ['scripts/demo-server.mjs'], {
  env: { ...process.env, STILL_DEMO_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let demoError = '';
demo.stderr.on('data', (chunk) => (demoError += chunk));
const origin = `http://127.0.0.1:${port}`;
let context;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (demo.exitCode !== null) throw Error(`Demo exited: ${demoError}`);
    try {
      const response = await fetch(origin);
      if ((await response.text()).includes('<title>Still agent demo</title>')) break;
    } catch {}
    if (attempt === 99) throw Error('Disposable demo server did not become ready');
    await delay(50);
  }
  const extension = resolve('extension');
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: 'chromium',
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const page = context.pages()[0];
  await page.goto('chrome://extensions');
  // Chrome may label the switch as either a button or a switch across releases.
  const toggle = page.locator('#devMode');
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await page.getByRole('button', { name: 'Load unpacked', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Still — visual browser lane', exact: true }).waitFor();
  // Let Chrome's developer-mode drawer finish its own transition for documentation.
  await delay(350);
  await page.screenshot({
    path: join(directory, 'chrome-extensions.png'),
    clip: { x: 0, y: 0, width: 1280, height: 460 },
    animations: 'disabled',
  });

  await page.goto(`chrome-extension://${extensionId}/setup.html`);
  await page.locator('#origins').fill('https://www.google.com\nhttp://127.0.0.1:8741');
  await page.locator('body').screenshot({ path: join(directory, 'lane-setup.png') });

  await page.goto(`chrome-extension://${extensionId}/anchor.html`);
  await page.screenshot({ path: join(directory, 'agent-window.png') });

  // Synthetic content only. These screenshots explain the demo, not a concurrency measurement.
  await page.goto(origin + '/seed');
  await page.locator('textarea').fill('I can keep typing in my own window while the agent works.');
  await page.screenshot({ path: join(directory, 'human-workspace.png') });
  const agent = await context.newPage();
  await agent.goto(origin + '/task');
  await agent.locator('#note').fill('independent visual input');
  await agent.getByRole('button', { name: 'Open actions', exact: true }).click();
  await agent.getByRole('button', { name: 'Save note', exact: true }).click();
  await agent.locator('#result').getByText('Saved: independent visual input').waitFor();
  await agent.screenshot({ path: join(directory, 'agent-workspace.png') });
  console.log(`Captured five disposable-profile screenshots in ${directory}`);
  console.log(`Browser: ${context.browser()?.version() || 'Chrome for Testing'}`);
} finally {
  await context?.close();
  demo.kill('SIGTERM');
  await rm(profile, { recursive: true, force: true });
}
