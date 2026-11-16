import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
let checked = 0;
for (const dir of ['src', 'extension', 'scripts', 'experiments', 'test']) {
  for (const file of await readdir(dir)) {
    if (!/\.(mjs|js)$/.test(file)) continue;
    const path = join(dir, file);
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (result.status !== 0) {
      process.stderr.write(result.stderr);
      process.exit(1);
    }
    checked++;
  }
}
for (const path of ['package.json', 'extension/manifest.json', '.prettierrc.json']) {
  JSON.parse(await readFile(path, 'utf8'));
}
console.log(`Syntax checked ${checked} JavaScript files and 3 JSON files.`);
