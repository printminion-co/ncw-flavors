import assert from 'node:assert/strict';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { defaultFlavorsRoot, makeFlavorsRoot, makeServerTree, runCli, tempDir } from './helpers.ts';

interface Case {
  name: string;
  /** Options to change or (when null) to leave out. */
  change: Record<string, string | null>;
  /** Text the error message must contain, so a human can tell what is wrong. */
  mentions: string[];
  /** Files of a custom flavors root to use instead of the default fixture. */
  flavors?: Record<string, string>;
  /** Extra arguments to append. */
  extra?: string[];
  /** The exact exit code to expect; any non-zero code when omitted. */
  status?: number;
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
  { name: 'a stable line that is not a number', change: { '--line': 'x' }, mentions: ['--line', 'x'] },
  { name: 'a flavor name that breaks the naming rule', change: { '--flavor': '../x' }, mentions: ['flavor name', '../x'] },
  { name: 'an unknown option', change: {}, extra: ['--bogus', '1'], mentions: ['bogus'], status: 2 },
  {
    name: 'a flavor that extends a base that does not exist',
    change: { '--flavor': 'broken' },
    flavors: { 'flavors/broken/flavor.yaml': 'extends: [nobase]\n' },
    mentions: ['nobase', 'not found', 'broken'],
    status: 2,
  },
  {
    name: 'a flavor manifest that is not valid YAML',
    change: { '--flavor': 'broken' },
    flavors: { 'flavors/broken/flavor.yaml': 'apps: [unclosed\n' },
    mentions: ['flavor.yaml'],
    status: 2,
  },
  {
    name: 'an app with an unknown mode',
    change: { '--flavor': 'broken' },
    flavors: { 'flavors/broken/flavor.yaml': 'apps:\n  demo: sometimes\n' },
    mentions: ['demo', 'sometimes', 'always'],
    status: 2,
  },
  {
    name: 'extends given as a single name instead of a list',
    change: { '--flavor': 'broken' },
    flavors: { 'flavors/broken/flavor.yaml': 'extends: common\n' },
    mentions: ['flavor.yaml', 'extends', 'list'],
    status: 2,
  },
  {
    name: 'app_dirs given as a single name instead of a list',
    change: { '--flavor': 'broken' },
    flavors: { 'flavors/broken/flavor.yaml': 'app_dirs: apps-x\n' },
    mentions: ['flavor.yaml', 'app_dirs', 'list'],
    status: 2,
  },
  {
    name: 'themes given as a single name instead of a list',
    change: { '--flavor': 'broken' },
    flavors: { 'flavors/broken/flavor.yaml': 'themes: ionos\n' },
    mentions: ['flavor.yaml', 'themes', 'list'],
    status: 2,
  },
  {
    name: 'a list entry that is not a name',
    change: { '--flavor': 'broken' },
    flavors: { 'flavors/broken/flavor.yaml': 'extends: [[a], b]\n' },
    mentions: ['flavor.yaml', 'extends', 'list'],
    status: 2,
  },
];

for (const c of cases) {
  test(`build rejects ${c.name} with a clear message and writes no artifact`, () => {
    const out = tempDir('out');
    const options: Record<string, string> = {
      '--flavors': c.flavors ? makeFlavorsRoot(c.flavors) : defaultFlavorsRoot(),
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
    args.push(...(c.extra ?? []));
    const result = runCli(args);

    if (c.status === undefined) assert.notEqual(result.status, 0, 'must exit non-zero');
    else assert.equal(result.status, c.status, `exit code, stderr: ${result.stderr}`);
    for (const word of c.mentions) assert.ok(result.stderr.includes(word), `stderr should mention "${word}", got: ${result.stderr}`);
    assert.ok(!existsSync(out) || readdirSync(out).length === 0, `no artifact may be written, found ${existsSync(out) ? readdirSync(out).join(',') : ''} in ${join(out)}`);
  });
}

test('build rejects a tree without a shipped-apps list with a clear message', () => {
  const tree = makeServerTree();
  rmSync(join(tree, 'core/shipped.json'));
  const result = runCli(['build', '--flavors', defaultFlavorsRoot(), '--flavor', 'flavor1', '--tree', tree,
    '--line', '33', '--kind', 'dev', '--build-number', '812', '--out', tempDir('out')]);

  assert.equal(result.status, 2, result.stderr);
  assert.ok(result.stderr.includes('core/shipped.json'), result.stderr);
});
