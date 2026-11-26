import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build, makeFlavorsRoot, makeServerTree, tempDir } from './helpers.ts';

const configPhp = (body: string): string => `<?php\n$CONFIG = [\n${body}\n];\n`;

function buildFlavorF(files: Record<string, string>, flavorYaml = '') {
  const flavorsRoot = makeFlavorsRoot({ 'flavors/f/flavor.yaml': flavorYaml, ...files });
  return build({ flavorsRoot, flavor: 'f', tree: makeServerTree(), out: tempDir('out') });
}

test('a flavor config that sets a deployment key is rejected, naming the file and the key', () => {
  for (const key of ['dbtype', 'dbpassword', 'dbtableprefix', 'objectstore', 'trusted_domains', 'instanceid', 'passwordsalt', 'secret', 'mail_smtphost', 'mail_smtppassword', 'mail_sendmailmode', 'datadirectory']) {
    const result = buildFlavorF({ 'flavors/f/config/50-x.config.php': configPhp(`'${key}' => 'x',`) });
    assert.equal(result.status, 2, key);
    assert.match(result.stderr, new RegExp(`50-x\\.config\\.php.*"${key}"`), key);
  }
});

test('a config that sets a key Nextcloud writes itself is rejected', () => {
  for (const key of ['version', 'installed']) {
    const result = buildFlavorF({ 'flavors/f/config/50-x.config.php': configPhp(`'${key}' => 'x',`) });
    assert.equal(result.status, 2, key);
    assert.match(result.stderr, new RegExp(`"${key}"`));
  }
});

test('a config that sets apps_paths is rejected because the tool generates it', () => {
  const result = buildFlavorF({ 'flavors/f/config/50-x.config.php': configPhp("'apps_paths' => [],") });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /"apps_paths".*generated/);
});

test('the keys are evaluated, so a computed key is caught and an allowed key passes', () => {
  const caught = buildFlavorF({ 'flavors/f/config/50-x.config.php': configPhp("'db' . 'type' => 'mysql',") });
  assert.equal(caught.status, 2);
  assert.match(caught.stderr, /"dbtype"/);
  const fine = buildFlavorF({ 'flavors/f/config/50-x.config.php': configPhp("'loglevel' => 2, 'mail_domain' => 'example.org',") });
  assert.equal(fine.status, 0, fine.stderr);
});

test('a reference to an undeclared environment variable in a partial config is an input error', () => {
  for (const call of [`getenv('SMTP_HOST')`, `getenv("SMTP_HOST")`]) {
    const result = buildFlavorF({ 'flavors/f/config/50-x.config.php': configPhp(`'overwritehost' => ${call},`) });
    assert.equal(result.status, 2, call);
    assert.match(result.stderr, /50-x\.config\.php.*SMTP_HOST.*not declared/);
  }
});

test('a declared and used environment variable builds without warnings', () => {
  const result = buildFlavorF(
    { 'flavors/f/config/50-x.config.php': configPhp("'overwritehost' => getenv('PUBLIC_HOST'),") },
    'env:\n  - name: PUBLIC_HOST\n    required: true\n',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /warning: environment variable/);
});

test('a declared but unused environment variable is a warning on stderr, not an error', () => {
  const result = buildFlavorF({}, 'env:\n  - name: UNUSED_VAR\n    required: false\n    default: x\n');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning: environment variable UNUSED_VAR is declared but not used/);
});

test('an environment variable declared in a base counts as declared for the flavor', () => {
  const result = buildFlavorF(
    { 'bases/b/flavor.yaml': 'env:\n  - name: PUBLIC_HOST\n', 'flavors/f/config/50-x.config.php': configPhp("'overwritehost' => getenv('PUBLIC_HOST'),") },
    'extends: [b]\n',
  );
  assert.equal(result.status, 0, result.stderr);
});

test('all warnings go to stderr in one stable order: config numbers, environment variables, unclassified apps', () => {
  const result = buildFlavorF(
    { 'flavors/f/config/95-late.config.php': configPhp('') },
    'env:\n  - name: UNUSED_VAR\n    required: false\n',
  );
  assert.equal(result.status, 0, result.stderr);
  const warnings = result.stderr.split('\n').filter((line) => line.startsWith('warning: '));
  assert.deepEqual(warnings.slice(0, 3), [
    'warning: config file flavors/f/config/95-late.config.php uses number 95, bases use 10-49 and flavors use 50-89',
    'warning: environment variable UNUSED_VAR is declared but not used',
    'warning: app activity has no mode',
  ]);
});
