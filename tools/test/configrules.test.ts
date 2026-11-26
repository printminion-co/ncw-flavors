import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { build, configAsNextcloudSeesIt, hasPhp, makeFlavorsRoot, makeServerTree, readZip, tempDir } from './helpers.ts';

const configPhp = (body: string): string => `<?php\n$CONFIG = [\n${body}\n];\n`;

/** Builds flavor `f` (extending base `b`) from the given extra files and returns the CLI result and the out dir. */
function buildFlavorF(files: Record<string, string>, flavorYaml = 'extends: [b]\n', baseYaml = '') {
  const flavorsRoot = makeFlavorsRoot({ 'bases/b/flavor.yaml': baseYaml, 'flavors/f/flavor.yaml': flavorYaml, ...files });
  const out = tempDir('out');
  const result = build({ flavorsRoot, flavor: 'f', tree: makeServerTree(), out });
  return { result, out };
}

test('configs of bases and flavor are shipped so that a lexical load applies them in number order, later wins', { skip: !hasPhp && 'php is not installed' }, () => {
  const { result } = buildFlavorF({
    'bases/b/config/30-b.config.php': configPhp("'k' => 'base30', 'only_b' => 1,"),
    'bases/b/config/10-a.config.php': configPhp("'k' => 'base10', 'only_a' => 1,"),
    'flavors/f/config/60-f.config.php': configPhp("'k' => 'flavor60'"),
    'flavors/f/config/50-e.config.php': configPhp("'k' => 'flavor50', 'only_e' => 1,"),
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
  const { result, out } = buildFlavorF({
    'bases/b/config/20-mail.config.php': configPhp(''),
    'flavors/f/config/50-one.config.php': configPhp(''),
    'flavors/f/config/50-two.config.php': configPhp(''),
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /number 50/);
  assert.match(result.stderr, /50-one\.config\.php/);
  assert.match(result.stderr, /50-two\.config\.php/);
  assert.equal(existsSync(out) ? readdirSync(out).length : 0, 0, 'no artifact is written');
});

test('a duplicate number across two bases of one flavor is rejected too', () => {
  const { result } = buildFlavorF({
    'bases/c/flavor.yaml': '',
    'bases/c/config/20-mail.config.php': configPhp(''),
    'bases/b/config/20-other.config.php': configPhp(''),
  }, 'extends: [b]\n', 'extends: [c]\n');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /number 20/);
});

test('the same file name in a nearer base replaces the earlier one and is not a duplicate', () => {
  const { result } = buildFlavorF({
    'bases/c/flavor.yaml': '',
    'bases/c/config/20-x.config.php': configPhp(''),
    'bases/b/config/20-x.config.php': configPhp(''),
  }, 'extends: [b]\n', 'extends: [c]\n');
  assert.equal(result.status, 0, result.stderr);
});

test('a config name without a two digit number prefix is an input error', () => {
  for (const file of ['bases/b/config/unnumbered.config.php', 'flavors/f/config/5-short.config.php', 'flavors/f/config/50.config.php']) {
    const { result, out } = buildFlavorF({ [file]: configPhp('') });
    assert.equal(result.status, 2, file);
    assert.match(result.stderr, new RegExp(file.split('/').pop()!.replace(/\./g, '\\.')));
    assert.equal(existsSync(out) ? readdirSync(out).length : 0, 0, 'no artifact is written');
  }
});

test('numbers 00 to 09 are reserved for generated files, in a base and in a flavor', () => {
  for (const file of ['bases/b/config/05-low.config.php', 'flavors/f/config/00-mine.config.php', 'flavors/f/config/09-mine.config.php']) {
    const { result } = buildFlavorF({ [file]: configPhp('') });
    assert.equal(result.status, 2, file);
    assert.match(result.stderr, /reserved/);
    assert.ok(result.stderr.includes(file), result.stderr);
  }
});

test('a number outside the convention is only a warning and the build succeeds', () => {
  const { result } = buildFlavorF({
    'bases/b/config/50-high.config.php': configPhp(''),
    'flavors/f/config/49-low.config.php': configPhp(''),
    'flavors/f/config/90-late.config.php': configPhp(''),
    'flavors/f/config/99-last.config.php': configPhp(''),
  });
  assert.equal(result.status, 0, result.stderr);
  for (const file of ['bases/b/config/50-high.config.php', 'flavors/f/config/49-low.config.php', 'flavors/f/config/90-late.config.php', 'flavors/f/config/99-last.config.php']) {
    const number = file.split('/').pop()!.slice(0, 2);
    assert.ok(
      result.stderr.split('\n').includes(`warning: config file ${file} uses number ${number}, bases use 10-49 and flavors use 50-89`),
      `${file}: ${result.stderr}`,
    );
  }
});

test('numbers inside the convention give no warning', () => {
  const { result } = buildFlavorF({ 'bases/b/config/10-a.config.php': configPhp(''), 'bases/b/config/49-b.config.php': configPhp(''), 'flavors/f/config/50-c.config.php': configPhp(''), 'flavors/f/config/89-d.config.php': configPhp('') });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /warning: config file/);
});
