// Build a reproducible upload ZIP containing only the extension, never the native host or checkout.
import { readFile, writeFile, mkdir, mkdtemp, copyFile, chmod, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve('extension');
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.manifest_version !== 3 || manifest.version !== pkg.version)
  throw Error('Manifest/package release versions must match and use Manifest V3');
if (manifest.minimum_chrome_version !== '134' || manifest.description.length > 132)
  throw Error('Check minimum Chrome support and store description length');
if (
  JSON.stringify([...manifest.permissions].sort()) !==
  JSON.stringify(['debugger', 'nativeMessaging', 'storage'])
)
  throw Error('Review unexpected permission changes before packaging');
const files = [
  'manifest.json',
  'worker.js',
  'lane.js',
  'select-picker.js',
  'starting-websites.js',
  'setup.html',
  'setup.css',
  'setup.js',
  'anchor.html',
  'anchor.css',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
  'icons/logo.png',
].sort();
const output = resolve('artifacts/chrome-store');
await mkdir(output, { recursive: true });
const archive = join(output, `agentlane-${manifest.version}.zip`);
const staging = await mkdtemp(join(tmpdir(), 'agentlane-package-'));
try {
  const epoch = new Date('2026-01-01T00:00:00Z');
  for (const file of files) {
    const target = join(staging, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, file), target);
    await chmod(target, 0o644);
    await utimes(target, epoch, epoch);
    if (/\.js$/.test(file)) {
      const source = await readFile(target, 'utf8');
      for (const [, path] of source.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g))
        if (!files.includes(path)) throw Error(`Packaged import missing: ${file} -> ${path}`);
    }
  }
  // ZIP updates existing archives, so remove the generated output first to prevent stale members.
  await rm(archive, { force: true });
  execFileSync('zip', ['-X', '-q', archive, ...files], { cwd: staging });
  const members = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .sort();
  if (JSON.stringify(members) !== JSON.stringify(files))
    throw Error('Archive contains unexpected members');
  const bytes = await readFile(archive);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(archive + '.sha256', `${sha256}  agentlane-${manifest.version}.zip\n`);
  await writeFile(
    join(output, 'build-info.json'),
    JSON.stringify(
      {
        version: manifest.version,
        sha256,
        bytes: bytes.length,
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        files,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`${archive}\n${bytes.length} bytes; ${files.length} files\nSHA-256 ${sha256}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
