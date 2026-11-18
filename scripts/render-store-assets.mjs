// Store artwork composed from real, disposable-profile UI captures. No personal screenshots.
import { chromium } from 'playwright';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const output = resolve('artifacts/chrome-store');
await mkdir(output, { recursive: true });
const data = async (path) => 'data:image/png;base64,' + (await readFile(path)).toString('base64');
const [logo, setup, human, agent, anchor] = await Promise.all([
  data('extension/icons/logo.png'),
  data('docs/images/lane-setup.png'),
  data('docs/images/human-workspace.png'),
  data('docs/images/agent-workspace.png'),
  data('docs/images/agent-window.png'),
]);
const css = `*{box-sizing:border-box}body{margin:0;background:#f3eee5;color:#242422;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.brand{display:flex;align-items:center;gap:12px;font-size:28px;font-weight:700;letter-spacing:-1px}.brand img{width:48px;height:48px}.tag{color:#b45018;font:600 12px monospace;letter-spacing:2px;margin:0 0 22px}h1{font:normal 68px/1.03 Georgia,serif;letter-spacing:-2px;margin:0 0 24px}p{font-size:20px;line-height:1.5;color:#62615b;margin:0}.footer{position:absolute;bottom:30px;left:52px;right:52px;font:12px/1.5 monospace;color:#77756d;border-top:1px solid #d7d1c6;padding-top:15px}.card{background:#fff;border:1px solid #d5cfc3;border-radius:16px;overflow:hidden;box-shadow:0 18px 50px #27262110}.label{font:600 13px monospace;letter-spacing:1px;margin:0 0 12px}.pill{display:inline-block;margin:24px 0 0;padding:9px 12px;background:#e8e3d8;border-radius:6px;font-size:14px;color:#505046}`;
const brand = `<div class="brand"><img src="${logo}" alt="">AgentLane</div>`;
const footer =
  '<div class="footer">Experimental beta · macOS + Chrome 134+ · Separate local bridge, Node.js 22.13+ and MCP client required</div>';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  async function render(name, body, width = 1280, height = 800) {
    await page.setViewportSize({ width, height });
    await page.setContent(`<!doctype html><style>${css}</style>${body}`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    await page.screenshot({ path: join(output, name), animations: 'disabled' });
  }
  await render(
    '01-configure.png',
    `<div style="padding:42px 52px">${brand}</div><section style="position:absolute;left:70px;top:190px;width:570px"><div class="tag">YOUR LOGGED-IN CHROME, ANOTHER LANE</div><h1>Give your agent<br>a place to work.</h1><p>Choose selected starting websites<br>or explicitly allow any HTTP(S) website.</p><p class="pill">Screenshots and clicks. Your existing logins.</p><p style="font-size:15px;margin-top:24px;max-width:510px">Selected websites checks direct opening and navigation.<br>Links and redirects can lead elsewhere.</p></section><div class="card" style="position:absolute;left:790px;top:96px;width:386px"><img src="${setup}" style="display:block;width:384px" alt="Real AgentLane setup"></div>${footer}`,
  );
  await render(
    '02-two-workspaces.png',
    `<div style="padding:36px 52px">${brand}</div><div style="padding:4px 52px"><div class="tag">SEPARATE INPUT, SHARED BROWSER PROFILE</div><h1 style="font-size:52px;margin-bottom:30px">Keep your work moving.</h1><div style="display:grid;grid-template-columns:1fr 1fr;gap:26px"><div><div class="label">YOUR WORKSPACE</div><div class="card"><img src="${human}" style="display:block;width:100%" alt="Synthetic human workspace"></div></div><div><div class="label">AGENT WORKSPACE</div><div class="card"><img src="${agent}" style="display:block;width:100%" alt="Synthetic agent workspace"></div></div></div><p style="font-size:17px;margin-top:25px">The agent uses screenshots, clicks, typing and scrolling in its owned tab.</p><p style="font-size:13px;margin-top:10px">Real synthetic demo pages. These captures are not a simultaneous-use recording.</p></div>${footer}`,
  );
  await render(
    '03-owned-workspace.png',
    `<div style="padding:36px 52px">${brand}</div><div style="padding:4px 52px"><div class="tag">A RESTORED, UNFOCUSED AGENT WINDOW</div><h1 style="font-size:52px;margin-bottom:28px">One clear place for agent work.</h1><div class="card" style="width:760px;margin:auto"><img src="${anchor}" style="display:block;width:100%" alt="Real empty AgentLane workspace"></div></div>${footer}`,
  );
  await render(
    'small-promo-440x280.png',
    `<div style="padding:30px 32px">${brand}<h1 style="font-size:39px;letter-spacing:-1px;margin-top:23px;margin-bottom:14px">Your Chrome.<br>Their own lane.</h1><p style="font-size:14px">Visual browser work through MCP.</p><p style="font-size:11px;margin-top:15px">Beta · Local bridge required · macOS</p></div>`,
    440,
    280,
  );
  await copyFile('extension/icons/icon-128.png', join(output, 'store-icon-128.png'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(pathToFileURL(resolve('privacy/index.html')).href);
  await page.screenshot({ path: join(output, 'privacy-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, 'privacy-mobile.png'), fullPage: true });
  console.log(`Generated three 1280x800 screenshots, promo tile, icon and privacy QA in ${output}`);
} finally {
  await browser.close();
}
