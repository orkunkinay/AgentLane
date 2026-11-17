// Native-picker focus probe. Uses only synthetic pages and a disposable Chrome profile.
import { chromium } from 'playwright';
import { mkdtemp, cp, appendFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const html = `<!doctype html><style>body{font:20px system-ui;margin:40px}select{font:inherit;width:300px;height:44px}</style><label for="api">Mail decision API</label><br><select id="api"><option>Google Gemini Decision 1</option><option>Jev / TypeSafe</option><option>DeepSeek</option></select><p id="result"></p><script>api.onchange=event=>{result.textContent=api.value;document.documentElement.dataset.trusted=String(event.isTrusted)}</script>`;
const server = createServer((req, res) => {
  if (req.url === '/csp')
    res.setHeader('Content-Security-Policy', "script-src 'none'; style-src 'none'");
  res.setHeader('Content-Type', 'text/html');
  res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'agentlane-dropdown-'));
let context, observer;
const events = [];
try {
  const extension = join(profile, 'extension');
  await cp(resolve('extension'), extension, { recursive: true });
  await appendFile(join(extension, 'worker.js'), '\nglobalThis.testLane=lane;\n');
  context = await chromium.launchPersistentContext(profile, {
    headless: !process.env.AGENTLANE_HEADED,
    channel: 'chromium',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const human = context.pages()[0];
  await human.setContent(
    '<label>Your work <input value="keep typing here"></label><select id="human-select"><option>First</option><option>Second</option></select>',
  );
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async (origin) => {
    const w = await chrome.windows.create({
      url: chrome.runtime.getURL('anchor.html'),
      focused: false,
      type: 'normal',
      width: 1100,
      height: 760,
    });
    testLane.configure(w.id, [origin]);
  }, origin);
  const call = (op, args = {}) =>
    worker.evaluate(({ op, args }) => testLane.run({ session: 'dropdown', op, args }), {
      op,
      args,
    });
  await call('open', { url: origin });
  let agent;
  for (let i = 0; i < 100; i++) {
    agent = context.pages().find((p) => p.url().startsWith(origin));
    if (agent) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert(agent);
  await agent.waitForLoadState();

  if (process.env.AGENTLANE_HEADED) await human.bringToFront(); // Disposable setup, before measurement.
  if (process.env.AGENTLANE_OBSERVER) {
    observer = spawn(resolve(process.env.AGENTLANE_OBSERVER), [], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let partial = '';
    observer.stdout.on('data', (chunk) => {
      partial += chunk;
      let n;
      while ((n = partial.indexOf('\n')) >= 0) {
        events.push(JSON.parse(partial.slice(0, n)));
        partial = partial.slice(n + 1);
      }
    });
    await new Promise((r) => observer.stdout.once('data', r));
  }
  const before = await worker.evaluate(() => chrome.windows.getAll());
  async function act(op, args) {
    const shot = await call('screenshot');
    return call(op, { frame: shot.frame, ...args });
  }
  async function click(locator) {
    const box = await locator.boundingBox();
    assert(box, 'fixture control is rendered');
    await act('click', { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  async function choose(select, expected) {
    await click(select);
    const shot = await call('screenshot');
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/dropdown-open.png', Buffer.from(shot.data, 'base64'));
    assert.equal(
      await select.evaluate((el) => el.matches(':open')),
      true,
      'picker opens in the renderer',
    );
    await click(select.locator('option').nth(1));
    assert.equal(await select.inputValue(), expected);
    assert.equal(await select.evaluate((el) => el.matches(':open')), false);
  }
  const select = agent.locator('#api');
  const humanAppearance = await human
    .locator('input')
    .evaluate((el) => getComputedStyle(el).appearance);
  await choose(select, 'Jev / TypeSafe');
  assert.equal(await agent.locator('#result').innerText(), 'Jev / TypeSafe');
  assert.equal(await agent.locator('html').getAttribute('data-trusted'), 'true');
  // Reopen, then keyboard selection must also remain in the page.
  await click(select);
  await act('key', { key: 'ArrowDown' });
  await act('key', { key: 'Enter' });
  assert.equal(await select.inputValue(), 'DeepSeek');
  assert.equal(await agent.locator('#result').innerText(), 'DeepSeek');
  await agent.evaluate(() => {
    const select = document.createElement('select');
    select.id = 'dynamic';
    select.innerHTML = '<option>First</option><option>Second</option>';
    document.body.append(select);
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<select id="shadow"><option>First</option><option>Second</option></select>';
    const list = document.createElement('select');
    list.id = 'list';
    list.size = 3;
    list.innerHTML = '<option>First</option><option>Second</option>';
    document.body.append(list);
  });
  await choose(agent.locator('#dynamic'), 'Second');
  await choose(agent.locator('#shadow'), 'Second');
  assert.notEqual(
    await agent.locator('#list').evaluate((el) => getComputedStyle(el).appearance),
    'base-select',
  );
  // Subframes receive the fixed bootstrap before their own document scripts.
  await agent.evaluate(
    (url) => {
      const frame = document.createElement('iframe');
      frame.src = url;
      frame.style.cssText = 'display:block;width:600px;height:300px';
      document.body.append(frame);
    },
    origin.replace('127.0.0.1', 'localhost'),
  );
  const frameSelect = agent.frameLocator('iframe').locator('#api');
  await frameSelect.waitFor();
  assert.equal(
    await frameSelect.evaluate((el) => getComputedStyle(el).appearance),
    'base-select',
    'cross-origin frame bootstrap',
  );
  await choose(frameSelect, 'Jev / TypeSafe');
  await call('navigate', { url: origin + '/next' });
  await agent.waitForURL(origin + '/next');
  await choose(agent.locator('#api'), 'Jev / TypeSafe');
  await call('navigate', { url: origin + '/csp' });
  await agent.waitForURL(origin + '/csp');
  await choose(agent.locator('#api'), 'Jev / TypeSafe');
  await call('navigate', { url: origin + '/conflict' });
  await agent.waitForURL(origin + '/conflict');
  // Conflicting page CSS must be rejected before a native picker can open.
  await agent.addStyleTag({ content: '#api::picker(select) {appearance: auto !important}' });
  await assert.rejects(click(agent.locator('#api')), /picker was blocked/);
  await new Promise((r) => setTimeout(r, 150));
  const after = await worker.evaluate(() => chrome.windows.getAll());
  assert.deepEqual(
    after.map((w) => [w.id, w.focused]),
    before.map((w) => [w.id, w.focused]),
  );
  assert.equal(await human.locator('input').inputValue(), 'keep typing here');
  assert.equal(
    await human.locator('input').evaluate((el) => getComputedStyle(el).appearance),
    humanAppearance,
  );
  if (observer) assert.equal(events.length, 1, 'No foreground, pointer, window or Space changes');
  await mkdir('artifacts', { recursive: true });
  const report = {
    nativeSelectMouseAndKeyboard: true,
    dynamicSelect: true,
    openShadowSelect: true,
    crossOriginFrameSelect: true,
    navigationReinstalls: true,
    strictCSPSelect: true,
    conflictingStylesBlocked: true,
    before,
    after,
    events,
  };
  await writeFile('artifacts/dropdown-probe.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  observer?.kill();
  await context?.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
