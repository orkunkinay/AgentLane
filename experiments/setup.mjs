// Test the real setup UI and bridge handshake without touching the user's Chrome profile.
import { chromium } from 'playwright';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const profile = await mkdtemp(join(tmpdir(), 'agentlane-setup-'));
const stateDir = join(profile, 'bridge');
const extension = resolve(process.env.AGENTLANE_TEST_EXTENSION || 'extension');
let context;
let client;
const fixture = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<h1>Disposable recovery fixture</h1><input aria-label="Note">');
});
try {
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: 'chromium',
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  let worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  let page = context.pages()[0];
  const url = `chrome-extension://${id}/setup.html`;
  await page.goto(url);
  const windows = () => worker.evaluate(() => chrome.windows.getAll());
  const originalWindows = await windows();
  const originalCount = originalWindows.length;
  await page.getByRole('button', { name: 'Create agent window', exact: true }).waitFor();
  assert.equal(await page.locator('#origins').inputValue(), 'https://www.google.com');
  assert.equal(
    await page.getByRole('radio', { name: 'Selected websites', exact: true }).isChecked(),
    true,
  );
  await page.locator('#origins').fill('');
  await page.locator('#prepare').click();
  await page
    .getByRole('alert')
    .getByText(/at least one/)
    .waitFor();
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
    .getByText(/Review and accept/)
    .waitFor();
  assert.equal((await windows()).length, originalCount, 'no connection/window before consent');
  const unconsented = await page.evaluate(() =>
    chrome.runtime.sendMessage({ op: 'prepare', origins: ['https://www.google.com'] }),
  );
  assert.match(unconsented.error, /Review and accept/);
  await page.locator('#consent').check();
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
    `#!/bin/sh\necho $$ > ${quote(join(profile, 'native.pid'))}\nAGENTLANE_STATE_DIR=${quote(stateDir)} exec ${quote(process.execPath)} ${quote(resolve('src/native-host.js'))} "$@"\n`,
    { mode: 0o700 },
  );
  await chmod(launcher, 0o700);
  await writeFile(
    join(hosts, 'org.agentlane.browser.json'),
    JSON.stringify({
      name: 'org.agentlane.browser',
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
  assert.equal(await page.locator('#access-consent').isVisible(), false, 'consent persists');
  await page.locator('#origins').fill('https://www.google.com\nhttps://example.com/path');
  await page.getByRole('button', { name: 'Save starting websites', exact: true }).click();
  await page.getByRole('button', { name: 'Websites saved', exact: true }).waitFor();
  assert.equal((await windows()).length, originalCount + 1, 'saving creates no new window');
  assert.equal(
    await page.locator('#origins').inputValue(),
    'https://www.google.com\nhttps://example.com',
  );

  const any = page.getByRole('radio', { name: 'Any website', exact: true });
  await page.getByRole('radio', { name: 'Selected websites', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await any.isChecked(), true, 'native keyboard selection');
  assert.equal(await page.locator('#origins').isVisible(), false);
  await page
    .getByText('Your agent can open any website using your existing logins.', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Save starting websites', exact: true }).click();
  await page.getByRole('button', { name: 'Websites saved', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Websites saved', exact: true }).waitFor();
  assert.equal(await any.isChecked(), true, 'mode survives reopening');
  assert.deepEqual(
    await worker.evaluate(
      async () => (await chrome.storage.local.get('startingPolicy')).startingPolicy,
    ),
    { mode: 'any', websites: [] },
  );
  await page.getByRole('radio', { name: 'Selected websites', exact: true }).check();
  await page.locator('#origins').fill('https://www.google.com\nhttps://example.com');
  await page.getByRole('button', { name: 'Save starting websites', exact: true }).click();
  await page.getByRole('button', { name: 'Websites saved', exact: true }).waitFor();

  const laneWindow = (await windows()).find(
    (w) => !originalWindows.some((original) => original.id === w.id),
  );
  // Simulated human focus changes in a disposable profile, never in the real browser.
  await worker.evaluate((id) => chrome.windows.update(id, { focused: true }), laneWindow.id);
  await page.reload();
  await page.locator('#connection-label').getByText('Paused', { exact: true }).waitFor();
  await page
    .locator('#ready-copy')
    .getByText(/Switch back/)
    .waitFor();
  // Headless Chrome may report both windows focused after synthetic focus changes.
  // Close/recreate the test lane instead of weakening the real focus guard.
  await worker.evaluate((id) => chrome.windows.remove(id), laneWindow.id);
  await page.reload();
  await page.getByRole('button', { name: 'Create agent window', exact: true }).click();
  await page.locator('#connection-label').getByText('Connected', { exact: true }).waitFor();
  assert.equal((await windows()).length, originalCount + 1);

  await page
    .locator('#origins')
    .fill('https://www.google.com\nhttps://example.com\n' + fixtureOrigin);
  await page.getByRole('button', { name: 'Save starting websites', exact: true }).click();
  await page.getByRole('button', { name: 'Websites saved', exact: true }).waitFor();
  const protocol = new Client({ name: 'setup-recovery-test', version: '1.0' });
  await protocol.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve('src/mcp.js')],
      env: { ...process.env, AGENTLANE_STATE_DIR: stateDir },
    }),
  );
  client = {
    call: async (op, args = {}) => {
      const result = await protocol.callTool({ name: 'lane_' + op, arguments: args });
      if (result.isError) throw Error(result.content[0].text);
      return JSON.parse(result.content[op === 'screenshot' ? 1 : 0].text);
    },
    close: () => protocol.close(),
  };
  await client.call('open', { url: fixtureOrigin });
  await page.waitForFunction(() => document.querySelector('#origins').disabled);
  await page.getByRole('button', { name: 'Take control', exact: true }).click();
  await page.getByRole('button', { name: 'Hand back to agent', exact: true }).waitFor();
  await page.locator('#sessions').screenshot({ path: 'artifacts/setup-handoff.png' });
  await assert.rejects(client.call('close'), /Human-controlled/);
  await page.getByRole('button', { name: 'Observe only', exact: true }).click();
  await page.getByRole('button', { name: 'Allow interaction', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Hand back to agent', exact: true }).click();
  await page.getByRole('button', { name: 'Take control', exact: true }).waitFor();
  await assert.rejects(
    client.call('navigate', { url: 'https://example.com/' }),
    /observation only/,
  );
  await page.getByRole('button', { name: 'Allow interaction', exact: true }).click();
  await page.getByRole('button', { name: 'Observe only', exact: true }).waitFor();

  // Avoid network dependence for input policy: the owned tab need only exist.
  const locked = await page.evaluate(() =>
    chrome.runtime.sendMessage({ op: 'prepare', origins: ['https://changed.example'] }),
  );
  assert.match(locked.error, /agent to finish/);
  await client.call('close');
  await page.waitForFunction(() => !document.querySelector('#origins').disabled);
  async function openFixture() {
    await client.call('open', { url: fixtureOrigin });
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
      target = context
        .pages()
        .filter((candidate) => candidate.url() === fixtureOrigin + '/')
        .at(-1);
      if (target) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert(target, 'recreated owned fixture is visible to the test harness');
    await target.waitForLoadState();
    await target.getByRole('heading', { name: 'Disposable recovery fixture' }).waitFor();
  }
  await openFixture();
  for (let round = 0; round < 3; round++) {
    const previous = await client.call('screenshot');
    const workspace = (await windows()).find(
      (w) => !originalWindows.some((original) => original.id === w.id),
    );
    await worker.evaluate((id) => chrome.windows.remove(id), workspace.id);
    await assert.rejects(client.call('screenshot'), /Prepare a lane|window is closed/);
    await page.reload();
    await page.getByRole('button', { name: 'Create agent window', exact: true }).click();
    await page.locator('#connection-label').getByText('Connected', { exact: true }).waitFor();
    await assert.rejects(client.call('screenshot'), /call lane_open/);
    await openFixture();
    await assert.rejects(client.call('click', { frame: previous.frame, x: 10, y: 10 }), /Stale/);
    const current = await client.call('screenshot');
    assert.notEqual(current.frame, previous.frame);
    assert.equal(
      (await windows()).length,
      originalCount + 1,
      'one replacement lane, original human window retained',
    );
  }
  // Kill only the disposable native host whose launcher wrote this test-only PID.
  const nativePid = Number((await readFile(join(profile, 'native.pid'), 'utf8')).trim());
  assert(Number.isSafeInteger(nativePid) && nativePid > 1);
  process.kill(nativePid, 'SIGTERM');
  await page.locator('#connection-label').getByText('Not connected', { exact: true }).waitFor();
  await assert.rejects(
    client.call('screenshot'),
    /Browser bridge unavailable|Browser bridge disconnected/,
  );
  await page.waitForFunction(() => !document.querySelector('#origins').disabled);
  await page.getByRole('button', { name: 'Connect browser', exact: true }).click();
  await page.locator('#connection-label').getByText('Connected', { exact: true }).waitFor();
  await assert.rejects(client.call('screenshot'), /call lane_open/);
  await openFixture();
  await client.call('screenshot');
  await client.call('close');
  await client.close();
  client = null;
  await page.waitForFunction(() => !document.querySelector('#origins').disabled);
  await page.locator('#origins').fill('https://www.google.com\nhttps://example.com');
  await page.getByRole('button', { name: 'Save starting websites', exact: true }).click();
  await page.getByRole('button', { name: 'Websites saved', exact: true }).waitFor();
  // A full browser restart preserves policy but must not adopt old tabs or capabilities.
  const restart = async () => {
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      channel: 'chromium',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    page = await context.newPage();
    await page.goto(url);
    await page.getByRole('button', { name: 'Create agent window', exact: true }).waitFor();
  };
  await restart();
  assert.equal(
    await page.locator('#origins').inputValue(),
    'https://www.google.com\nhttps://example.com',
  );
  assert.equal(
    await page.getByRole('radio', { name: 'Selected websites', exact: true }).isChecked(),
    true,
  );
  await page.getByRole('radio', { name: 'Any website', exact: true }).check();
  await page.locator('#prepare').click();
  await page.locator('#connection-label').getByText('Connected', { exact: true }).waitFor();
  await restart();
  assert.equal(
    await page.getByRole('radio', { name: 'Any website', exact: true }).isChecked(),
    true,
  );
  assert.equal(await page.locator('#origins').isVisible(), false);
  // Older stored lists are preserved, including empty lists that must fail closed.
  for (const websites of [['https://legacy.example'], []]) {
    await worker.evaluate(async (websites) => {
      await chrome.storage.local.remove('startingPolicy');
      await chrome.storage.local.set({ websites });
    }, websites);
    await restart();
    assert.equal(
      await page.getByRole('radio', { name: 'Selected websites', exact: true }).isChecked(),
      true,
    );
    assert.equal(await page.locator('#origins').inputValue(), websites.join('\n'));
  }
  console.log(
    JSON.stringify(
      {
        browser: context.browser().version(),
        invalidInputRejected: true,
        affirmativeDisclosureRequiredAndPersisted: true,
        missingBridgeReported: true,
        readyAfterHandshakeOnly: true,
        retryAndSaveReuseWindow: true,
        freshInstallGoogleDefault: true,
        nativeRadioKeyboardSupport: true,
        settingsSurvivePopupReopen: true,
        bothModesSurviveBrowserRestart: true,
        legacyWebsitesPreserved: true,
        legacyEmptyFailsClosed: true,
        activeSessionChangesRejected: true,
        focusedWindowShowsPaused: true,
        closedWindowRecreated: true,
        sameMcpSurvivesThreeWindowRecreations: true,
        staleFramesRejectedAfterRecreation: true,
        sameMcpSurvivesNativeHostRestart: true,
        readyPanelHeight: height,
      },
      null,
      2,
    ),
  );
} finally {
  await client?.close();
  await context?.close();
  await new Promise((resolve) => fixture.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
