import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build, makeFlavorsRoot, makeServerTree, tempDir } from './helpers.ts';

const cfg = (body: string): string => `<?php\n$CONFIG = [\n${body}\n];\n`;

function buildF(files: Record<string, string>, flavorYaml = '') {
  const flavorsRoot = makeFlavorsRoot({ 'flavors/f/flavor.yaml': flavorYaml, ...files });
  return build({ flavorsRoot, flavor: 'f', tree: makeServerTree(), out: tempDir('out') });
}

test('a flavor config that sets a deployment key is rejected, naming the file and the key', () => {
  for (const key of ['dbtype', 'dbpassword', 'dbtableprefix', 'objectstore', 'trusted_domains', 'instanceid', 'passwordsalt', 'secret', 'mail_smtphost', 'mail_smtppassword', 'mail_sendmailmode', 'datadirectory']) {
    const result = buildF({ 'flavors/f/config/50-x.config.php': cfg(`'${key}' => 'x',`) });
    assert.equal(result.status, 2, key);
    assert.match(result.stderr, new RegExp(`50-x\\.config\\.php.*"${key}"`), key);
  }
});

test('a config that sets a key Nextcloud writes itself is rejected', () => {
  for (const key of ['version', 'installed']) {
    const result = buildF({ 'flavors/f/config/50-x.config.php': cfg(`'${key}' => 'x',`) });
    assert.equal(result.status, 2, key);
    assert.match(result.stderr, new RegExp(`"${key}"`));
  }
});

test('a config that sets apps_paths is rejected because the tool generates it', () => {
  const result = buildF({ 'flavors/f/config/50-x.config.php': cfg("'apps_paths' => [],") });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /"apps_paths".*generated/);
});

test('the keys are evaluated, so a computed key is caught and an allowed key passes', () => {
  const caught = buildF({ 'flavors/f/config/50-x.config.php': cfg("'db' . 'type' => 'mysql',") });
  assert.equal(caught.status, 2);
  assert.match(caught.stderr, /"dbtype"/);
  const fine = buildF({ 'flavors/f/config/50-x.config.php': cfg("'loglevel' => 2, 'mail_domain' => 'example.org',") });
  assert.equal(fine.status, 0, fine.stderr);
});

test('a reference to an undeclared environment variable in a partial config is an input error', () => {
  for (const call of [`getenv('SMTP_HOST')`, `getenv("SMTP_HOST")`]) {
    const result = buildF({ 'flavors/f/config/50-x.config.php': cfg(`'overwritehost' => ${call},`) });
    assert.equal(result.status, 2, call);
    assert.match(result.stderr, /50-x\.config\.php.*SMTP_HOST.*not declared/);
  }
});

test('a declared and used environment variable builds without warnings', () => {
  const result = buildF(
    { 'flavors/f/config/50-x.config.php': cfg("'overwritehost' => getenv('PUBLIC_HOST'),") },
    'env:\n  - name: PUBLIC_HOST\n    required: true\n',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /warning: environment variable/);
});

test('a declared but unused environment variable is a warning on stderr, not an error', () => {
  const result = buildF({}, 'env:\n  - name: UNUSED_VAR\n    required: false\n    default: x\n');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning: environment variable UNUSED_VAR is declared but not used/);
});

test('an environment variable declared in a base counts as declared for the flavor', () => {
  const result = buildF(
    { 'bases/b/flavor.yaml': 'env:\n  - name: PUBLIC_HOST\n', 'flavors/f/config/50-x.config.php': cfg("'overwritehost' => getenv('PUBLIC_HOST'),") },
    'extends: [b]\n',
  );
  assert.equal(result.status, 0, result.stderr);
});
