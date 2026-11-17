import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { aggregate, csv } from './statistics.mjs';
export async function report(dir) {
  const raw = (await readFile(join(dir, 'observations.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse);
  const metadata = JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf8'));
  const summary = aggregate(raw, metadata.seed);
  const data = { metadata, summary, raw };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'results.json'), JSON.stringify(data, null, 2) + '\n');
  await writeFile(join(dir, 'observations.csv'), csv(raw));
  await writeFile(join(dir, 'summary.csv'), csv(summary));
  const template = await readFile(new URL('./dashboard.html', import.meta.url), 'utf8');
  await writeFile(
    join(dir, 'dashboard.html'),
    template.replace('/*BENCHMARK_DATA*/', JSON.stringify(data).replaceAll('<', '\\u003c')),
  );
  return { summary, raw, metadata };
}
