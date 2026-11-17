// Validates the static website: local links, anchors, assets, repository file links,
// and that documented tool names match the MCP server.
import { readFile, access } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

const GH = 'https://github.com/orkunkinay/AgentLane/';
const PAGES = 'https://orkunkinay.github.io/AgentLane/';
const pages = ['index.html', 'docs/index.html'];
const html = Object.fromEntries(
  await Promise.all(pages.map(async (p) => [p, await readFile(p, 'utf8')])),
);
const ids = Object.fromEntries(
  pages.map((p) => [p, new Set([...html[p].matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]),
);
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );
const problems = [];

for (const page of pages) {
  const refs = [...html[page].matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (!ref || ref.startsWith('mailto:')) continue;
    if (ref.startsWith(GH + 'blob/main/') || ref.startsWith(GH + 'tree/main/')) {
      const path = ref.replace(/^.*\/(?:blob|tree)\/main\//, '').split('#')[0];
      if (!(await exists(path))) problems.push(`${page}: repo file missing for ${ref}`);
      continue;
    }
    if (ref === GH.slice(0, -1) || ref.startsWith(GH)) continue; // repo root, issues
    if (ref.startsWith(PAGES)) continue; // canonical/social metadata
    if (/^https?:/.test(ref)) {
      problems.push(`${page}: unexpected external link ${ref}`);
      continue;
    }
    const [path, hash] = ref.split('#');
    const target = path ? normalize(join(dirname(page), path)) : page;
    const file = (await exists(target)) && target.endsWith('/') ? target : target;
    const resolved = /\.[a-z0-9]+$/i.test(file) ? file : join(file, 'index.html');
    if (!(await exists(resolved))) {
      problems.push(`${page}: missing ${ref} (${resolved})`);
      continue;
    }
    if (hash && ids[resolved] && !ids[resolved].has(hash))
      problems.push(`${page}: no #${hash} in ${resolved}`);
  }
  const dup = [...html[page].matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  dup
    .filter((v, i) => dup.indexOf(v) !== i)
    .forEach((d) => problems.push(`${page}: duplicate id ${d}`));
  for (const tag of html[page].matchAll(/<img\b[^>]*>/g))
    if (!/\salt="/.test(tag[0])) problems.push(`${page}: image without alt ${tag[0].slice(0, 60)}`);
}

const mcp = await readFile('src/mcp.js', 'utf8');
const tools = [...mcp.matchAll(/tool\(\s*'(lane_[a-z]+)'/g)].map((m) => m[1]);
for (const t of tools)
  if (!html['docs/index.html'].includes(`<code>${t}</code>`))
    problems.push(`docs: tool ${t} undocumented`);
for (const m of html['docs/index.html'].matchAll(/<code>(lane_[a-z]+)<\/code>/g))
  if (!tools.includes(m[1])) problems.push(`docs: unknown tool ${m[1]}`);

for (const script of [
  'install-host.mjs',
  'install-skill.mjs',
  'demo-server.mjs',
  'concurrency-demo.mjs',
])
  if (!(await exists(join('scripts', script)))) problems.push(`scripts/${script} missing`);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Site OK: ${pages.length} pages, ${tools.length} tools match src/mcp.js.`);
