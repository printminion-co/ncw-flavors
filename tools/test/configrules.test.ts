import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { build, configAsNextcloudSeesIt, hasPhp, makeFlavorsRoot, makeServerTree, readZip, tempDir } from './helpers.ts';

const cfg = (body: string): string => `<?php\n$CONFIG = [\n${body}\n];\n`;

/** Builds flavor `f` (extending base `b`) from the given extra files and returns the CLI result and the out dir. */
function buildF(files: Record<string, string>, flavorYaml = 'extends: [b]\n', baseYaml = '') {
  const flavorsRoot = makeFlavorsRoot({ 'bases/b/flavor.yaml': baseYaml, 'flavors/f/flavor.yaml': flavorYaml, ...files });
  const out = tempDir('out');
  const result = build({ flavorsRoot, flavor: 'f', tree: makeServerTree(), out });
  return { result, out };
}

test('configs of bases and flavor are shipped so that a lexical load applies them in number order, later wins', { skip: !hasPhp && 'php is not installed' }, () => {
  const { result } = buildF({
    'bases/b/config/30-b.config.php': cfg("'k' => 'base30', 'only_b' => 1,"),
    'bases/b/config/10-a.config.php': cfg("'k' => 'base10', 'only_a' => 1,"),
    'flavors/f/config/60-f.config.php': cfg("'k' => 'flavor60'"),
    'flavors/f/config/50-e.config.php': cfg("'k' => 'flavor50', 'only_e' => 1,"),
  });
  assert.equal(result.status, 0, result.stderr);
  const zip = readZip(result.stdout.trim());
  const files = [...zip.keys()].filter((e) => /^config\/\d\d-/.test(e)).sort();
  assert.deepEqual(files, ['config/00-apps-paths.config.php', 'config/10-a.config.php', 'config/30-b.config.php', 'config/50-e.config.php', 'config/60-f.config.php']);
  const merged = Object.assign({}, ...files.map((f) => JSON.parse(configAsNextcloudSeesIt(zip, f))));
  assert.equal(merged.k, 'flavor60');
  assert.equal(merged.only_a, 1);
});

test('two config files with the same number in one resolved flavor are rejected and the message names both', () => {
  const { result, out } = buildF({
    'bases/b/config/20-mail.config.php': cfg(''),
    'flavors/f/config/50-one.config.php': cfg(''),
    'flavors/f/config/50-two.config.php': cfg(''),
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /number 50/);
  assert.match(result.stderr, /50-one\.config\.php/);
  assert.match(result.stderr, /50-two\.config\.php/);
  assert.equal(existsSync(out) ? readdirSync(out).length : 0, 0, 'no artifact is written');
});

test('a duplicate number across two bases of one flavor is rejected too', () => {
  const { result } = buildF({
    'bases/c/flavor.yaml': '',
    'bases/c/config/20-mail.config.php': cfg(''),
    'bases/b/config/20-other.config.php': cfg(''),
  }, 'extends: [b]\n', 'extends: [c]\n');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /number 20/);
});

test('the same file name in a nearer base replaces the earlier one and is not a duplicate', () => {
  const { result } = buildF({
    'bases/c/flavor.yaml': '',
    'bases/c/config/20-x.config.php': cfg(''),
    'bases/b/config/20-x.config.php': cfg(''),
  }, 'extends: [b]\n', 'extends: [c]\n');
  assert.equal(result.status, 0, result.stderr);
});

test('a base config outside 10 to 49 and a flavor config outside 50 to 89 are rejected', () => {
  for (const [file, expected] of [
    ['bases/b/config/05-low.config.php', /05-low\.config\.php/],
    ['bases/b/config/50-high.config.php', /50-high\.config\.php/],
    ['flavors/f/config/49-low.config.php', /49-low\.config\.php/],
    ['flavors/f/config/90-high.config.php', /90-high\.config\.php/],
    ['flavors/f/config/unnumbered.config.php', /unnumbered\.config\.php/],
  ] as const) {
    const { result } = buildF({ [file]: cfg('') });
    assert.equal(result.status, 2, file);
    assert.match(result.stderr, expected);
  }
});
