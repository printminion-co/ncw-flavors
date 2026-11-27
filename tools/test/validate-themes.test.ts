import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { build, makeFlavorsRoot, makeServerTree, readZip, runCli, tempDir } from './helpers.ts';

const THEME_FLAVORS = {
  'flavors/f/flavor.yaml': 'themes: [acme]\nenforce_theme: acme\napps:\n  files: always\n  dav: always\n  activity: default\n  firstrunwizard: removed\n  workflowengine: removed\n',
  'themes/acme/lib/Acme.php': '<?php\nnamespace OC\\Ncw\\Themes;\nclass Acme {}\n',
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

for (const bad of ['../x', 'a/b', 'UPPER']) {
  test(`an enforce_theme that is not a plain lowercase name (${bad}) is an input error`, () => {
    const root = makeFlavorsRoot({ ...THEME_FLAVORS, 'flavors/f/flavor.yaml': `themes: [acme]\nenforce_theme: "${bad}"\n` });
    const result = build({ flavorsRoot: root, flavor: 'f', tree: makeServerTree(), out: tempDir('out') });

    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /enforce_theme "[^"]*" must be lowercase letters/);
    assert.ok(result.stderr.includes(bad), result.stderr);
  });
}

const WITH_MAIL = { ...THEME_FLAVORS, 'themes/acme/mail/AcmeMail.php': '<?php\nnamespace OC\\Ncw\\Mail;\nclass AcmeMail {}\n' };

for (const path of ['lib/private/Ncw/Themes/Acme.php', 'lib/private/Ncw/Mail/AcmeMail.php', 'themes/acme/css/acme.css']) {
  test(`a file of the theme package that is missing from the artifact is reported (${path})`, () => {
    const { root, entries } = produced(WITH_MAIL, 'f');
    entries.delete(path);

    const result = validate(root, 'f', writeZip(entries));
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, new RegExp(`missing file ${path.replaceAll('/', '\\/').replaceAll('.', '\\.')} of theme acme`));
  });
}

test('a theme file of the artifact with other content than the package is reported', () => {
  const { root, entries } = produced(WITH_MAIL, 'f');
  entries.set('lib/private/Ncw/Mail/AcmeMail.php', strToU8('<?php\nclass Tampered {}\n'));

  const result = validate(root, 'f', writeZip(entries));
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /file lib\/private\/Ncw\/Mail\/AcmeMail\.php differs from theme acme/);
});

test('an artifact with the theme and mail files of the package validates', () => {
  const { root, entries } = produced(WITH_MAIL, 'f');
  const result = validate(root, 'f', writeZip(entries));
  assert.equal(result.status, 0, result.stderr);
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');
const IMAGE = 'themes/acme/assets/core/img/logo/logo.png';

/** The theme with a binary logo at the path the server looks it up, built as a release artifact. */
function producedWithLogo(): { root: string; entries: Map<string, Uint8Array> } {
  const root = makeFlavorsRoot(THEME_FLAVORS);
  mkdirSync(join(root, 'themes/acme/assets/core/img/logo'), { recursive: true });
  writeFileSync(join(root, IMAGE), PNG);
  const built = build({ flavorsRoot: root, flavor: 'f', kind: 'release', tree: makeServerTree(), out: tempDir('out') });
  assert.equal(built.status, 0, built.stderr);
  return { root, entries: readZip(built.stdout.trim()) };
}

test('a binary theme image is in the artifact at themes/<theme>/core/img/ and validates', () => {
  const { root, entries } = producedWithLogo();
  assert.deepEqual(entries.get('themes/acme/core/img/logo/logo.png'), new Uint8Array(PNG));

  const result = validate(root, 'f', writeZip(entries));
  assert.equal(result.status, 0, result.stderr);
});

test('a changed theme image is reported', () => {
  const { root, entries } = producedWithLogo();
  const changed = Buffer.from(PNG);
  changed.writeUInt8(changed.readUInt8(changed.length - 20) ^ 0xff, changed.length - 20);
  entries.set('themes/acme/core/img/logo/logo.png', new Uint8Array(changed));

  const result = validate(root, 'f', writeZip(entries));
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /file themes\/acme\/core\/img\/logo\/logo\.png differs from theme acme/);
});

test('a missing theme image is reported', () => {
  const { root, entries } = producedWithLogo();
  entries.delete('themes/acme/core/img/logo/logo.png');

  const result = validate(root, 'f', writeZip(entries));
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /missing file themes\/acme\/core\/img\/logo\/logo\.png of theme acme/);
});
