import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { REPO_ROOT, makeServerTree, runCli, tempDir } from './helpers.ts';

interface Case {
  name: string;
  /** Options to change or (when null) to leave out. */
  change: Record<string, string | null>;
  /** Text the error message must contain, so a human can tell what is wrong. */
  mentions: string[];
}

const cases: Case[] = [
  { name: 'a missing tree', change: { '--tree': null }, mentions: ['--tree'] },
  { name: 'a missing flavor name', change: { '--flavor': null }, mentions: ['--flavor'] },
  { name: 'an unknown flavor', change: { '--flavor': 'nope' }, mentions: ['nope', 'not found'] },
  { name: 'a tree that does not exist', change: { '--tree': '/does/not/exist' }, mentions: ['tree', '/does/not/exist'] },
  { name: 'a build number that is not a number', change: { '--build-number': 'abc' }, mentions: ['build number', 'abc'] },
  { name: 'a build number of zero', change: { '--build-number': '0' }, mentions: ['build number', '0'] },
  { name: 'an unknown build kind', change: { '--kind': 'nightly' }, mentions: ['kind', 'nightly'] },
  { name: 'a stable line that does not match the tree', change: { '--line': '34' }, mentions: ['34', '33.0.9'] },
];

for (const c of cases) {
  test(`build rejects ${c.name} with a clear message and writes no archive`, () => {
    const out = tempDir('out');
    const options: Record<string, string> = {
      '--flavors': REPO_ROOT,
      '--flavor': 'flavor1',
      '--tree': makeServerTree(),
      '--line': '33',
      '--kind': 'dev',
      '--build-number': '812',
      '--out': out,
    };
    const args = ['build'];
    for (const [key, value] of Object.entries({ ...options, ...c.change })) {
      if (value !== null) args.push(key, value);
    }
    const result = runCli(args);

    assert.notEqual(result.status, 0, 'must exit non-zero');
    for (const word of c.mentions) assert.ok(result.stderr.includes(word), `stderr should mention "${word}", got: ${result.stderr}`);
    assert.ok(!existsSync(out) || readdirSync(out).length === 0, `no archive may be written, found ${existsSync(out) ? readdirSync(out).join(',') : ''} in ${join(out)}`);
  });
}
