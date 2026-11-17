// Diagnostic, not a latency comparison. Synthetic session only; never records cookies.
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRig } from './rig.mjs';
const out = resolve(process.argv[2] ?? 'artifacts/benchmarks/auth-probe');
await mkdir(out, { recursive: true });
const requests = [];
const server = createServer((req, res) => {
  const route = new URL(req.url, 'http://fixture').pathname;
  if (route === '/seed') {
    res.writeHead(302, {
      'Set-Cookie': 'benchmark_session=synthetic; HttpOnly; SameSite=Strict; Path=/',
      Location: '/human',
    });
    res.end();
    return;
  }
  const authenticated = Boolean(req.headers.cookie?.includes('benchmark_session=synthetic'));
  if (['/agent', '/auth'].includes(route))
    requests.push({
      route,
      authenticated,
      fetchSite: req.headers['sec-fetch-site'] ?? null,
      fetchMode: req.headers['sec-fetch-mode'] ?? null,
    });
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-store');
  res.end(
    `<!doctype html><div id="auth">${authenticated ? 'recognized' : 'not recognized'}</div><a style="position:absolute;left:40px;top:80px;width:200px;height:50px;font:24px system-ui" href="/auth">Account</a>`,
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const result = {
  kind: 'synthetic-auth-diagnostic',
  observedAt: new Date().toISOString(),
  sameSite: 'Strict',
  nativeCodex: 'not tested',
  runs: [],
};
try {
  for (const backend of ['agentlane', 'cdp-control']) {
    let rig;
    try {
      requests.length = 0;
      rig = await createRig(origin, { backend, headed: false, timeout: 15000 });
      const observations = [];
      const observe = async (label, path) => {
        const p = await rig.ready(path);
        observations.push({
          label,
          visibleMarker: await p.locator('#auth').innerText(),
          request: requests.filter((r) => r.route === path).at(-1),
        });
      };
      await observe('initial owned-tab opening', '/agent');
      await rig.call('navigate', { url: origin + '/auth' });
      await observe('direct navigation', '/auth');
      await rig.call('navigate', { url: origin + '/agent' });
      await rig.ready();
      const shot = await rig.call('screenshot');
      await rig.call('click', { frame: shot.frame, x: 100, y: 100 });
      await observe('renderer link navigation', '/auth');
      result.runs.push({ backend, browser: rig.metadata.browserVersion.product, observations });
    } finally {
      await rig?.close();
    }
  }
  await writeFile(join(out, 'auth-probe.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await new Promise((r) => server.close(r));
}
