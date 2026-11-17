// Re-points canonical and social URLs after a repo rename or custom domain.
// Usage: node scripts/set-site-url.mjs https://example.com/agentlane/
import { readFile, writeFile } from 'node:fs/promises';

const next = process.argv[2];
if (!/^https:\/\/[^\s/]+(\/[^\s]*)?\/$/.test(next || ''))
  throw Error(
    'Usage: node scripts/set-site-url.mjs https://your.domain/path/ (https, trailing slash)',
  );
const checker = await readFile('scripts/check-site.mjs', 'utf8');
const current = checker.match(/const PAGES = '([^']+)'/)?.[1];
if (!current) throw Error('Could not find the current site URL in scripts/check-site.mjs');
let changed = 0;
for (const file of [
  'index.html',
  'docs/index.html',
  'privacy/index.html',
  'scripts/check-site.mjs',
]) {
  const text = await readFile(file, 'utf8');
  if (!text.includes(current)) continue;
  await writeFile(file, text.replaceAll(current, next));
  changed++;
}
console.log(`Replaced ${current} with ${next} in ${changed} files. Run npm run check:site.`);
