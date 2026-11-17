import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../scripts/install-skill.mjs', import.meta.url).pathname;
const run = (home, ...args) =>
  spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home },
  });

test('skill installs for Codex by default and for Claude Code on request, never overwriting', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agentlane-skill-'));
  try {
    assert.equal(run(home).status, 0);
    const codex = join(home, '.codex/skills/agentlane-browser/SKILL.md');
    assert.match(await readFile(codex, 'utf8'), /^---\nname: agentlane-browser/);

    const claude = run(home, '--target', 'claude');
    assert.equal(claude.status, 0);
    assert.match(claude.stdout, /\/agentlane-browser/);
    await readFile(join(home, '.claude/skills/agentlane-browser/SKILL.md'), 'utf8');

    const again = run(home, '--target=claude');
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /already exists/);
    assert.notEqual(run(home, '--target', 'other').status, 0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
