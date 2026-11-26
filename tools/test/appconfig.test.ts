import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { build, makeFlavorsRoot, makeServerTree, readZip, tempDir, text } from './helpers.ts';

function buildF(files: Record<string, string>, flavorYaml = 'extends: [b]\n') {
  const flavorsRoot = makeFlavorsRoot({ 'bases/b/flavor.yaml': '', 'flavors/f/flavor.yaml': flavorYaml, ...files });
  const out = tempDir('out');
  const result = build({ flavorsRoot, flavor: 'f', tree: makeServerTree(), out });
  return { result, out };
}
const json = (value: unknown): string => JSON.stringify(value);

test('without any app-config source the artifact has an empty template, an empty special list and the removed apps', () => {
  const { result } = buildF({}, 'extends: [b]\napps:\n  workflowengine: removed\n  firstrunwizard: removed\n  ghost: removed\n  files: always\n');
  assert.equal(result.status, 0, result.stderr);
  const zip = readZip(result.stdout.trim());
  assert.deepEqual(JSON.parse(text(zip, 'app-config.json')), { apps: {} });
  assert.deepEqual(JSON.parse(text(zip, 'app-config-special.json')), []);
  // sorted, and only apps the server tree ships: "ghost" is not one
  assert.equal(text(zip, 'removed-apps.json'), '[\n  "firstrunwizard",\n  "workflowengine"\n]\n');
});

test('the template is assembled from bases and the flavor, later wins per app and key, null stays to delete a key', () => {
  const { result } = buildF({
    'bases/b/app-config.json': json({ apps: { files: { max_chunk: 10, shared: 'base' }, theming: { color: '#000' } } }),
    'flavors/f/app-config.json': json({ apps: { files: { shared: 'flavor', old: null }, activity: { retention: 30 } } }),
  });
  assert.equal(result.status, 0, result.stderr);
  const template = JSON.parse(text(readZip(result.stdout.trim()), 'app-config.json'));
  assert.deepEqual(template, {
    apps: {
      activity: { retention: 30 },
      files: { max_chunk: 10, old: null, shared: 'flavor' },
      theming: { color: '#000' },
    },
  });
  assert.deepEqual(Object.keys(template.apps), ['activity', 'files', 'theming']);
  assert.ok(!('system' in template));
});

test('sensitive, lazy and typed settings are listed separately, merged by app and key, sorted', () => {
  const { result } = buildF({
    'bases/b/app-config.json': json({ special: [
      { app: 'ldap', key: 'bind', value: '${LDAP_PASSWORD}', sensitive: true },
      { app: 'files', key: 'limit', value: '5', type: 'integer' },
    ] }),
    'flavors/f/app-config.json': json({ special: [
      { app: 'files', key: 'limit', value: '9', type: 'integer', lazy: true },
    ] }),
  }, 'extends: [b]\nenv:\n  - name: LDAP_PASSWORD\n    required: true\n');
  assert.equal(result.status, 0, result.stderr);
  const zip = readZip(result.stdout.trim());
  assert.deepEqual(JSON.parse(text(zip, 'app-config-special.json')), [
    { app: 'files', key: 'limit', value: '9', type: 'integer', lazy: true },
    { app: 'ldap', key: 'bind', value: '${LDAP_PASSWORD}', sensitive: true },
  ]);
  assert.deepEqual(JSON.parse(text(zip, 'app-config.json')), { apps: {} }, 'special settings are not in the import template');
});

test('a sensitive value that is a literal is an input error and the literal never reaches the output', () => {
  const { result, out } = buildF({
    'bases/b/app-config.json': json({ special: [{ app: 'ldap', key: 'bind', value: 'hunter2', sensitive: true }] }),
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /ldap.*bind.*sensitive.*\$\{VAR\}/);
  assert.doesNotMatch(result.stderr, /hunter2/);
  assert.equal(existsSync(out) ? readdirSync(out).length : 0, 0);
});

test('a placeholder in the template that is not declared is an input error, a declared one is kept as a placeholder', () => {
  const files = { 'flavors/f/app-config.json': json({ apps: { mail: { host: '${MAIL_HOST}' } } }) };
  const bad = buildF(files);
  assert.equal(bad.result.status, 2);
  assert.match(bad.result.stderr, /MAIL_HOST.*not declared/);

  const good = buildF(files, 'extends: [b]\nenv:\n  - name: MAIL_HOST\n    default: secret-looking-default\n');
  assert.equal(good.result.status, 0, good.result.stderr);
  const zip = readZip(good.result.stdout.trim());
  assert.equal(text(zip, 'app-config.json').includes('${MAIL_HOST}'), true);
  assert.doesNotMatch(text(zip, 'app-config.json'), /secret-looking-default/);
  assert.doesNotMatch(good.result.stderr, /warning: environment variable/, 'a variable used in the template counts as used');
});

test('a malformed app-config source is an input error that names the file', () => {
  for (const content of ['{', json({ apps: { files: { k: true } } }), json({ apps: [] }), json({ special: [{ app: 'a', key: 'k', value: '1', type: 'weird' }] }), json({ system: {} })]) {
    const { result } = buildF({ 'flavors/f/app-config.json': content });
    assert.equal(result.status, 2, content);
    assert.match(result.stderr, /flavors\/f\/app-config\.json/);
  }
});

test('the same app and key in both apps and special is an input error', () => {
  const { result } = buildF({
    'bases/b/app-config.json': json({ apps: { files: { limit: 1 } } }),
    'flavors/f/app-config.json': json({ special: [{ app: 'files', key: 'limit', value: '2', lazy: true }] }),
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /files.*limit/);
});
