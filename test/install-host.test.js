import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, stat, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const run = promisify(execFile);
const ID = 'abcdefghijklmnopabcdefghijklmnop';
const install = (home, ...args) =>
  run(process.execPath, [resolve('scripts/install-host.mjs'), ...args], {
    cwd: resolve('.'),
    env: { ...process.env, HOME: home, AGENTLANE_STATE_DIR: join(home, 'state') },
  });

test('installer writes an owner-only launcher with a Node fallback, and a pinned manifest', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agentlane-install-'));
  try {
    const dir = join(home, 'Some Dir With Spaces', 'NativeMessagingHosts');
    await install(home, ID, dir);
    const manifest = JSON.parse(await readFile(join(dir, 'org.agentlane.browser.json'), 'utf8'));
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${ID}/`]);
    assert.equal((await stat(manifest.path)).mode & 0o777, 0o700);
    const launcher = await readFile(manifest.path, 'utf8');
    assert.match(launcher, /command -v node/);
    assert.match(launcher, /checkout moved/);
    // A second browser reuses the shared launcher instead of failing on it.
    await install(home, ID, join(home, 'second'));
    assert.equal((await stat(manifest.path)).mode & 0o777, 0o700);
    // The manifest itself is never silently replaced.
    await assert.rejects(install(home, ID, dir), /Manifest exists/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('installer rejects bad IDs and unknown browsers with a clear message', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agentlane-install-'));
  try {
    await assert.rejects(install(home, 'nope'), /Usage/);
    if (process.platform === 'darwin')
      await assert.rejects(install(home, ID, '--browser=netscape'), /Unknown browser/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('the launcher falls back to PATH when the recorded Node disappears', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agentlane-install-'));
  try {
    const dir = join(home, 'hosts');
    await install(home, ID, dir);
    const manifest = JSON.parse(await readFile(join(dir, 'org.agentlane.browser.json'), 'utf8'));
    const broken = (await readFile(manifest.path, 'utf8')).replace(
      /^NODE='.*'$/m,
      "NODE='/nonexistent/node'",
    );
    const copy = join(home, 'broken-launcher');
    await writeFile(copy, broken, { mode: 0o700 });
    const nodeDir = join(process.execPath, '..');
    const { stderr } = await run(copy, [], {
      env: {
        ...process.env,
        PATH: `${nodeDir}:/usr/bin:/bin`,
        AGENTLANE_STATE_DIR: join(home, 'x'),
      },
      timeout: 1500,
      killSignal: 'SIGKILL',
    }).catch((e) => e);
    assert.doesNotMatch(String(stderr), /Node\.js was not found/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('doctor reports a missing install and passes on a healthy one', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agentlane-doctor-'));
  const doctor = () =>
    run(process.execPath, [resolve('scripts/doctor.mjs')], {
      env: { ...process.env, HOME: home, AGENTLANE_STATE_DIR: join(home, 'state') },
    });
  try {
    const empty = await doctor().catch((e) => e);
    assert.equal(empty.code, 1);
    assert.match(empty.stdout, /no native host manifest found/);
    if (process.platform === 'darwin') {
      const dir = join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts');
      await mkdir(dir, { recursive: true });
      await install(home, ID, dir);
      const healthy = await doctor();
      assert.match(healthy.stdout, new RegExp(`allows only chrome-extension://${ID}/`));
      assert.doesNotMatch(healthy.stdout, /FAIL/);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
