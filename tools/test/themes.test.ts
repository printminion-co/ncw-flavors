import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build, configAsNextcloudSeesIt, hasPhp, makeFlavorsRoot, makeServerTree, readZip, resolveCli, resolveReport, tempDir, text } from './helpers.ts';

const ACME_CLASS = '<?php\nnamespace OC\\Ncw\\Themes;\nclass Acme {}\n';

const ACME_PACKAGE = {
  'themes/acme/lib/Acme.php': ACME_CLASS,
  'themes/acme/assets/css/acme.css': 'body { color: red; }\n',
  'themes/acme/assets/img/logo.svg': '<svg/>\n',
};

function buildF(files: Record<string, string>) {
  const flavorsRoot = makeFlavorsRoot({ 'flavors/f/flavor.yaml': '', ...files });
  const result = build({ flavorsRoot, flavor: 'f', tree: makeServerTree(), out: tempDir('out') });
  return { result, flavorsRoot };
}

test('a flavor without themes gets neither theme files nor a themes config', () => {
  const { result } = buildF({});
  assert.equal(result.status, 0, result.stderr);
  const entries = [...readZip(result.stdout.trim()).keys()];
  assert.deepEqual(entries.filter((e) => e.includes('theme') || e.startsWith('config/01-')), []);
});

test('a theme of the flavor: class and assets are in the tree and the config registers the class', { skip: !hasPhp && 'php is not installed' }, () => {
  const { result } = buildF({ 'flavors/f/flavor.yaml': 'themes: [acme]\n', ...ACME_PACKAGE });
  assert.equal(result.status, 0, result.stderr);
  const zip = readZip(result.stdout.trim());
  assert.equal(text(zip, 'lib/private/Ncw/Themes/Acme.php'), ACME_CLASS);
  assert.equal(text(zip, 'themes/acme/css/acme.css'), 'body { color: red; }\n');
  assert.equal(text(zip, 'themes/acme/img/logo.svg'), '<svg/>\n');
  assert.equal(zip.has('themes/acme/lib/Acme.php'), false);
  assert.equal(configAsNextcloudSeesIt(zip, 'config/01-themes.config.php'), '{"ncw.themes":["OC\\\\Ncw\\\\Themes\\\\Acme"]}');
});

test('a theme inherited from a base is built like one of the flavor, and the config lists inherited themes first', { skip: !hasPhp && 'php is not installed' }, () => {
  const { result } = buildF({
    'bases/b/flavor.yaml': 'themes: [acme]\n',
    'flavors/f/flavor.yaml': 'extends: [b]\nthemes: [zeta]\n',
    ...ACME_PACKAGE,
    'themes/zeta/lib/Zeta.php': '<?php // zeta\n',
  });
  assert.equal(result.status, 0, result.stderr);
  const zip = readZip(result.stdout.trim());
  assert.equal(text(zip, 'lib/private/Ncw/Themes/Acme.php'), ACME_CLASS);
  assert.equal(text(zip, 'lib/private/Ncw/Themes/Zeta.php'), '<?php // zeta\n');
  assert.equal(text(zip, 'themes/acme/css/acme.css'), 'body { color: red; }\n');
  assert.equal(
    configAsNextcloudSeesIt(zip, 'config/01-themes.config.php'),
    '{"ncw.themes":["OC\\\\Ncw\\\\Themes\\\\Acme","OC\\\\Ncw\\\\Themes\\\\Zeta"]}',
  );
});

test('a theme without a package folder in the flavors root is an input error that names it', () => {
  const { result } = buildF({ 'flavors/f/flavor.yaml': 'themes: [ghost]\n' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /theme "ghost"/);
  assert.match(result.stderr, /themes\/ghost/);
});

test('an enforced theme is added to the config as enforce_theme', { skip: !hasPhp && 'php is not installed' }, () => {
  const { result } = buildF({ 'flavors/f/flavor.yaml': 'themes: [acme]\nenforce_theme: acme\n', ...ACME_PACKAGE });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    configAsNextcloudSeesIt(readZip(result.stdout.trim()), 'config/01-themes.config.php'),
    '{"ncw.themes":["OC\\\\Ncw\\\\Themes\\\\Acme"],"enforce_theme":"acme"}',
  );
});

test('the last declaration of enforce_theme wins, so a flavor can enforce another theme than its base', { skip: !hasPhp && 'php is not installed' }, () => {
  const { result } = buildF({
    'bases/b/flavor.yaml': 'themes: [acme]\nenforce_theme: acme\n',
    'flavors/f/flavor.yaml': 'extends: [b]\nthemes: [zeta]\nenforce_theme: zeta\n',
    ...ACME_PACKAGE,
    'themes/zeta/lib/Zeta.php': '<?php // zeta\n',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(configAsNextcloudSeesIt(readZip(result.stdout.trim()), 'config/01-themes.config.php'), /"enforce_theme":"zeta"\}$/);
});

test('an enforced theme that is not one of the flavor themes is an input error', () => {
  const { result } = buildF({ 'flavors/f/flavor.yaml': 'themes: [acme]\nenforce_theme: zeta\n', ...ACME_PACKAGE });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /enforce_theme "zeta"/);
});

test('resolve shows the enforced theme next to the themes, and leaves it out when there is none', () => {
  const root = makeFlavorsRoot({
    'flavors/f/flavor.yaml': 'themes: [acme]\nenforce_theme: acme\n',
    'flavors/g/flavor.yaml': 'themes: [acme]\n',
  });
  assert.deepEqual([resolveReport(root, 'f').themes, resolveReport(root, 'f').enforce_theme], [['acme'], 'acme']);
  assert.equal(resolveCli(root, 'g').stdout.includes('enforce_theme'), false);
});

test('a flavor config cannot set the keys the tool generates for themes', () => {
  const { result } = buildF({ 'flavors/f/config/50-x.config.php': "<?php\n$CONFIG = ['ncw.themes' => []];\n" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /"ncw\.themes".*generated by the tool/);
});

for (const nested of ['themes/acme/lib/Sub/Inner.php', 'themes/acme/lib/Sub/readme.txt']) {
  test(`a theme with ${nested} below lib/ is an input error naming it`, () => {
    const { result } = buildF({ 'flavors/f/flavor.yaml': 'themes: [acme]\n', ...ACME_PACKAGE, [nested]: '<?php\n' });
    assert.equal(result.status, 2, result.stderr);
    assert.ok(result.stderr.includes(nested.slice('themes/acme/'.length)), result.stderr);
    assert.match(result.stderr, /theme "acme"/);
  });
}

test('the mail classes of a theme go to the server namespace folder and are not registered as themes', { skip: !hasPhp && 'php is not installed' }, () => {
  const { result } = buildF({
    'flavors/f/flavor.yaml': 'themes: [acme]\n',
    ...ACME_PACKAGE,
    'themes/acme/mail/AcmeMail.php': '<?php\nnamespace OC\\Ncw\\Mail;\nclass AcmeMail {}\n',
  });
  assert.equal(result.status, 0, result.stderr);
  const zip = readZip(result.stdout.trim());
  assert.equal(text(zip, 'lib/private/Ncw/Mail/AcmeMail.php'), '<?php\nnamespace OC\\Ncw\\Mail;\nclass AcmeMail {}\n');
  assert.equal(zip.has('themes/acme/mail/AcmeMail.php'), false);
  assert.equal(configAsNextcloudSeesIt(zip, 'config/01-themes.config.php'), '{"ncw.themes":["OC\\\\Ncw\\\\Themes\\\\Acme"]}');
});

test('a theme with a mail class and nothing else registers no theme class', () => {
  const { result } = buildF({ 'flavors/f/flavor.yaml': 'themes: [mailonly]\n', 'themes/mailonly/mail/M.php': '<?php // m\n' });
  assert.equal(result.status, 0, result.stderr);
  const zip = readZip(result.stdout.trim());
  assert.equal(text(zip, 'lib/private/Ncw/Mail/M.php'), '<?php // m\n');
});

test('a theme with a file below mail/ is an input error naming it', () => {
  const { result } = buildF({ 'flavors/f/flavor.yaml': 'themes: [acme]\n', ...ACME_PACKAGE, 'themes/acme/mail/Sub/Inner.php': '<?php\n' });
  assert.equal(result.status, 2, result.stderr);
  assert.ok(result.stderr.includes('mail/Sub'), result.stderr);
});
