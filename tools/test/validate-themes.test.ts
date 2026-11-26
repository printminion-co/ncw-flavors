import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { build, makeFlavorsRoot, makeServerTree, readZip, runCli, tempDir } from './helpers.ts';

const THEME_FLAVORS = {
  'flavors/f/flavor.yaml': 'themes: [acme]\nenforce_theme: acme\napps:\n  files: always\n  dav: always\n  activity: default\n  firstrunwizard: removed\n  workflowengine: removed\n',
  'themes/acme/lib/Acme.php': '<?php\nnamespace OCA\\Theming\\Themes;\nclass Acme {}\n',
  'themes/acme/assets/css/acme.css': 'a {}\n',
};

function validate(flavorsRoot: string, flavor: string, artifact: string) {
  return runCli(['validate', '--flavors', flavorsRoot, '--flavor', flavor, '--artifact', artifact]);
}

/** Builds a release artifact of the flavor and returns its entries and the flavors root. */
function produced(files: Record<string, string>, flavor: string): { root: string; entries: Map<string, Uint8Array> } {
  const root = makeFlavorsRoot(files);
  const built = build({ flavorsRoot: root, flavor, kind: 'release', tree: makeServerTree(), out: tempDir('out') });
  assert.equal(built.status, 0, built.stderr);
  return { root, entries: readZip(built.stdout.trim()) };
}

function writeZip(entries: Map<string, Uint8Array>): string {
  const path = join(tempDir('zip'), 'artifact.zip');
  writeFileSync(path, zipSync(Object.fromEntries(entries)));
  return path;
}

test('an artifact of a flavor with a theme validates, the generated themes config included', () => {
  const { root, entries } = produced(THEME_FLAVORS, 'f');

  const result = validate(root, 'f', writeZip(entries));
  assert.equal(result.status, 0, result.stderr);
});

test('a missing themes config is reported for a flavor that has a theme', () => {
  const { root, entries } = produced(THEME_FLAVORS, 'f');
  entries.delete('config/01-themes.config.php');

  const result = validate(root, 'f', writeZip(entries));
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /01-themes\.config\.php/);
});

test('a themes config in the artifact of a flavor without a theme is reported', () => {
  const { root, entries } = produced({ ...THEME_FLAVORS, 'flavors/plain/flavor.yaml': 'apps:\n  files: always\n  dav: always\n  activity: default\n  firstrunwizard: removed\n  workflowengine: removed\n' }, 'plain');
  entries.set('config/01-themes.config.php', strToU8('<?php\n$CONFIG = [];\n'));

  const result = validate(root, 'plain', writeZip(entries));
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /01-themes\.config\.php/);
});

for (const bad of ['../x', 'a/b', '.hidden', 'UPPER']) {
  test(`a theme name that is not a plain lowercase name (${bad}) is an input error`, () => {
    const root = makeFlavorsRoot({ 'flavors/f/flavor.yaml': `themes: ["${bad}"]\n` });
    mkdirSync(join(root, 'themes'), { recursive: true });
    const result = build({ flavorsRoot: root, flavor: 'f', tree: makeServerTree(), out: tempDir('out') });

    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /theme name/);
    assert.ok(result.stderr.includes(bad), result.stderr);
  });
}

test('a base name that is a path is an input error', () => {
  const root = makeFlavorsRoot({ 'flavors/f/flavor.yaml': 'extends: ["../x"]\n' });
  const result = build({ flavorsRoot: root, flavor: 'f', tree: makeServerTree(), out: tempDir('out') });

  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /base name "\.\.\/x"/);
});
