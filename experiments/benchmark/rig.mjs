import { chromium } from 'playwright';
import { mkdtemp, cp, appendFile, mkdir, writeFile, chmod, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root = resolve(import.meta.dirname, '../..');
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
export async function createRig(origin, options) {
  const profile = await mkdtemp(join(tmpdir(), 'al-bench-'));
  let context, protocol, cdp, agent, transport;
  try {
    const extension = join(profile, 'extension');
    await cp(join(root, 'extension'), extension, { recursive: true });
    await appendFile(
      join(extension, 'worker.js'),
      '\nglobalThis.benchLane=lane; globalThis.benchConnect=connect;\n',
    );
    context = await chromium.launchPersistentContext(profile, {
      headless: !options.headed,
      channel: 'chromium',
      viewport: { width: 1100, height: 760 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    context.setDefaultTimeout(options.timeout);
    const human = context.pages()[0];
    await human.goto(origin + '/seed');
    const human2 = await context.newPage();
    await human2.goto(origin + '/human-two');
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    const { windowId, humanWindow } = await worker.evaluate(async (origin) => {
      const humanWindow = (await chrome.tabs.query({}))[0].windowId;
      const w = await chrome.windows.create({
        url: chrome.runtime.getURL('anchor.html'),
        focused: false,
        type: 'normal',
        state: 'normal',
        width: 1100,
        height: 760,
      });
      globalThis.benchLane.configure(w.id, [origin]);
      return { windowId: w.id, humanWindow };
    }, origin);
    let call;
    if (options.backend === 'agentlane') {
      const state = join(profile, 'bridge'),
        hosts = join(profile, 'NativeMessagingHosts'),
        launcher = join(profile, 'host');
      await mkdir(hosts, { recursive: true });
      await writeFile(
        launcher,
        `#!/bin/sh\nAGENTLANE_STATE_DIR=${quote(state)} exec ${quote(process.execPath)} ${quote(join(root, 'src/native-host.js'))} "$@"\n`,
        { mode: 0o700 },
      );
      await chmod(launcher, 0o700);
      await writeFile(
        join(hosts, 'org.agentlane.browser.json'),
        JSON.stringify({
          name: 'org.agentlane.browser',
          description: 'Disposable benchmark',
          path: launcher,
          type: 'stdio',
          allowed_origins: [`chrome-extension://${new URL(worker.url()).host}/`],
        }),
      );
      await worker.evaluate(() => globalThis.benchConnect());
      await stat(join(state, 'browser.sock'));
      protocol = new Client({ name: 'agentlane-benchmark', version: '1.0.0' });
      transport = new StdioClientTransport({
        command: process.execPath,
        args: [join(root, 'src/mcp.js')],
        env: { ...process.env, AGENTLANE_STATE_DIR: state },
        stderr: 'pipe',
      });
      await protocol.connect(transport);
      call = async (op, args = {}) => {
        const r = await protocol.callTool({ name: 'lane_' + op, arguments: args }, undefined, {
          timeout: options.timeout,
        });
        if (r.isError) {
          const text = r.content?.[0]?.text ?? '';
          throw Error(
            /timeout|timed out/i.test(text)
              ? 'Tool timeout'
              : /owns|session/i.test(text)
                ? 'Ownership/session refused'
                : /stale/i.test(text)
                  ? 'Stale frame'
                  : /focus|minimiz/i.test(text)
                    ? 'Focus guard refused'
                    : 'AgentLane tool failure',
          );
        }
        return op === 'screenshot'
          ? { ...JSON.parse(r.content[1].text), data: r.content[0].data }
          : JSON.parse(r.content[0].text);
      };
    } else {
      // Diagnostic only. Deliberately no MCP/ownership checks: never call this Codex.
      call = async (op, args = {}) => {
        if (op === 'open') {
          agent = await context.newPage();
          cdp = await context.newCDPSession(agent);
          return cdp.send('Page.navigate', { url: args.url });
        }
        if (op === 'close') {
          await agent.close();
          agent = null;
          return {};
        }
        if (op === 'navigate') return cdp.send('Page.navigate', { url: args.url });
        if (op === 'screenshot')
          return cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
        if (op === 'click') {
          for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
            await cdp.send('Input.dispatchMouseEvent', {
              type,
              x: args.x,
              y: args.y,
              button: type === 'mouseMoved' ? 'none' : 'left',
              clickCount: type === 'mouseMoved' ? 0 : 1,
            });
          return {};
        }
        if (op === 'type') return cdp.send('Input.insertText', { text: args.text });
        if (op === 'scroll')
          return cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: args.x,
            y: args.y,
            deltaX: args.deltaX,
            deltaY: args.deltaY,
          });
        throw Error('Unsupported diagnostic operation');
      };
    }
    let ownsTab = false;
    const rawCall = call;
    call = async (op, args = {}) => {
      const result = await rawCall(op, args);
      if (op === 'open') ownsTab = true;
      if (op === 'close') ownsTab = false;
      return result;
    };
    const browserSession = await context.browser().newBrowserCDPSession();
    const info = await browserSession.send('SystemInfo.getProcessInfo').catch(() => null);
    const browserPid = info?.processInfo.find((p) => p.type === 'browser')?.id ?? null;
    const rig = {
      call,
      context,
      human,
      human2,
      worker,
      origin,
      browserPid,
      mcpPid: transport?.pid ?? null,
      metadata: {
        browserVersion: await browserSession.send('Browser.getVersion'),
        windowId,
        humanWindow,
        browserPid,
        viewport: { width: 1100, height: 760 },
      },
      async page() {
        if (options.backend !== 'agentlane') return agent;
        for (const p of context.pages()) {
          if (
            p !== human &&
            p !== human2 &&
            !p.isClosed() &&
            ['/agent', '/next', '/auth'].includes(new URL(p.url()).pathname) &&
            p.url().startsWith(origin)
          )
            return p;
        }
        throw Error('Owned fixture not ready');
      },
      async ready(path = '/agent') {
        const deadline = performance.now() + options.timeout;
        let p;
        while (!p) {
          try {
            p = await rig.page();
          } catch (e) {
            if (performance.now() > deadline) throw e;
            await new Promise((r) => setTimeout(r, 10));
          }
        }
        await p.waitForURL(origin + path);
        await p.waitForLoadState('load');
        return p;
      },
      async reset() {
        if (ownsTab) await call('close');
        await call('open', { url: origin + '/agent' });
        return rig.ready();
      },
      async close() {
        await protocol?.close();
        await context.close();
        await rm(profile, { recursive: true, force: true });
      },
    };
    await call('open', { url: origin + '/agent' });
    await rig.ready();
    return rig;
  } catch (e) {
    await protocol?.close().catch(() => {});
    await context?.close().catch(() => {});
    await rm(profile, { recursive: true, force: true });
    throw e;
  }
}
