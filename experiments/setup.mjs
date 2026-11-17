// Test the real setup UI and bridge handshake without touching the user's Chrome profile.
import { chromium } from 'playwright';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const profile = await mkdtemp(join(tmpdir(), 'still-setup-'));
const stateDir = join(profile, 'bridge');
const extension = resolve('extension');
let context;
let client;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: 'chromium',
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const page = context.pages()[0];
  const url = `chrome-extension://${id}/setup.html`;
  await page.goto(url);
  const windows = () => worker.evaluate(() => chrome.windows.getAll());
  const originalWindows = await windows();
  const originalCount = originalWindows.length;
  await page.getByRole('button', { name: 'Create agent window', exact: true }).waitFor();
  await page.locator('#origins').fill('file:///private');
  await page.locator('#prepare').click();
  await page
    .getByRole('alert')
    .getByText(/Use http/)
    .waitFor();
  assert.equal((await windows()).length, originalCount, 'invalid input creates no window');

  await page.locator('#origins').fill('www.google.com');
  await page.locator('#prepare').click();
  await page
    .getByRole('alert')
    .getByText(/could not connect/)
    .waitFor();
  assert.equal((await windows()).length, originalCount + 1);
  assert.equal(await page.locator('#connection-label').innerText(), 'Not connected');
  assert.equal(await page.locator('#ready-note').isVisible(), false, 'no false ready state');
  await mkdir('artifacts', { recursive: true });
  await page.locator('body').screenshot({ path: 'artifacts/setup-offline.png' });

  // Register only in the disposable Chrome profile; then retry the existing window.
  const hosts = join(profile, 'NativeMessagingHosts');
  await mkdir(hosts, { recursive: true });
  const launcher = join(profile, 'native-host');
  const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
  await writeFile(
    launcher,
    `#!/bin/sh\nSTILL_STATE_DIR=${quote(stateDir)} exec ${quote(process.execPath)} ${quote(resolve('src/native-host.js'))} "$@"\n`,
    { mode: 0o700 },
  );
  await chmod(launcher, 0o700);
  await writeFile(
    join(hosts, 'org.still.browser.json'),
    JSON.stringify({
      name: 'org.still.browser',
      description: 'Disposable UI test',
      path: launcher,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${id}/`],
    }),
  );
  await page.getByRole('button', { name: 'Connect browser', exact: true }).click();
  await page.locator('#connection-label').getByText('Connected', { exact: true }).waitFor();
  assert.equal((await windows()).length, originalCount + 1, 'retry reuses existing window');
  assert.equal(await page.locator('#ready-note').isVisible(), true);
  await page.locator('body').screenshot({ path: 'artifacts/setup-ready.png' });
  const height = await page.locator('body').evaluate((el) => el.getBoundingClientRect().height);
  assert(height <= 600, `ready panel should fit a compact popup, got ${height}`);

  await page.reload();
  await page.locator('#connection-label').getByText('Connected', { exact: true }).waitFor();
  assert.equal(await page.locator('#origins').inputValue(), 'https://www.google.com');
  await page.locator('#origins').fill('https://www.google.com\nhttps://example.com/path');
  await page.getByRole('button', { name: 'Save starting websites', exact: true }).click();
  await page.getByRole('button', { name: 'Websites saved', exact: true }).waitFor();
  assert.equal((await windows()).length, originalCount + 1, 'saving creates no new window');
  assert.equal(
    await page.locator('#origins').inputValue(),
    'https://www.google.com\nhttps://example.com',
  );

  const laneWindow = (await windows()).find(
    (w) => !originalWindows.some((original) => original.id === w.id),
  );
  // Simulated human focus changes in a disposable profile, never in the real browser.
  await worker.evaluate((id) => chrome.windows.update(id, { focused: true }), laneWindow.id);
  await page.locator('#connection-label').getByText('Paused', { exact: true }).waitFor();
  await page
    .locator('#ready-copy')
    .getByText(/Switch back/)
    .waitFor();
  await worker.evaluate(
    (id) => chrome.windows.update(id, { focused: true }),
    originalWindows[0].id,
  );
  await page.locator('#connection-label').getByText('Connected', { exact: true }).waitFor();

  process.env.STILL_STATE_DIR = stateDir;
  const { BrowserClient } = await import('../src/client.js');
  client = new BrowserClient();
  await client.connect();
  await client.call('open', { url: 'https://example.com/' });
  await page.waitForFunction(() => document.querySelector('#origins').disabled);
  // Avoid network dependence for input policy: the owned tab need only exist.
  const locked = await page.evaluate(() =>
    chrome.runtime.sendMessage({ op: 'prepare', origins: ['https://changed.example'] }),
  );
  assert.match(locked.error, /agent to finish/);
  await client.call('close');
  client.close();
  client = null;
  console.log(
    JSON.stringify(
      {
        browser: context.browser().version(),
        invalidInputRejected: true,
        missingBridgeReported: true,
        readyAfterHandshakeOnly: true,
        retryAndSaveReuseWindow: true,
        settingsSurvivePopupReopen: true,
        activeSessionChangesRejected: true,
        focusedWindowShowsPaused: true,
        readyPanelHeight: height,
      },
      null,
      2,
    ),
  );
} finally {
  client?.close();
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
