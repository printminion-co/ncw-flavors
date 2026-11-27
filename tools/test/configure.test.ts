import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { build, hasPhp, makeFlavorsRoot, makeServerTree, readZip, resolveCli, resolveReport, runCli, tempDir, text } from './helpers.ts';

const SPECIAL_ENTRIES = [
  { app: 'mail', key: 'smtp_pass', value: '${SMTP_PASSWORD}', sensitive: true },
  { app: 'demo', key: 'count', value: '3', type: 'integer', lazy: true },
];

/** A flavor with one app that cannot be enabled by the installer: `demo` is `available`, and enabled after the install. */
const FLAVOR: Record<string, string> = {
  'flavors/f/flavor.yaml': [
    'app_dirs: [apps-flavor1]',
    'apps:',
    '  demo: available',
    '  activity: default',
    'enable_after_install: [demo]',
    'env:',
    '  - { name: BASE_URL, required: true }',
    '  - { name: SMTP_PASSWORD, required: true }',
    '  - { name: PHONE_REGION, required: false, default: DE }',
    '',
  ].join('\n'),
  'flavors/f/app-config.json': JSON.stringify({
    apps: { theming: { name: 'Acme', url: '${BASE_URL}/x' }, regional: { region: '${PHONE_REGION}' } },
    special: SPECIAL_ENTRIES,
  }),
};

// ---------------------------------------------------------------- the manifest field

test('resolve prints enable_after_install: an ordered union over the bases, the flavor last, no duplicates', () => {
  const root = makeFlavorsRoot({
    'bases/b/flavor.yaml': 'apps:\n  one: available\n  two: available\nenable_after_install: [one, two]\n',
    'flavors/f/flavor.yaml': 'extends: [b]\napps:\n  three: available\nenable_after_install: [three, one]\n',
  });
  assert.deepEqual(resolveReport(root, 'f').enable_after_install, ['one', 'two', 'three']);
});

test('a flavor without enable_after_install resolves to an empty list', () => {
  assert.deepEqual(resolveReport(makeFlavorsRoot({ 'flavors/f/flavor.yaml': 'apps:\n  one: available\n' }), 'f').enable_after_install, []);
});

for (const [mode, message] of [
  ['default', /app demo has mode default.*already enabled by the installer/],
  ['always', /app demo has mode always.*already enabled by the installer/],
  ['removed', /app demo has mode removed/],
] as const) {
  test(`an enable_after_install app with mode ${mode} is rejected by resolve and by build`, () => {
    const root = makeFlavorsRoot({ 'flavors/f/flavor.yaml': `apps:\n  demo: ${mode}\nenable_after_install: [demo]\n` });
    const resolved = resolveCli(root, 'f');
    assert.equal(resolved.status, 2);
    assert.match(resolved.stderr, message);
    const built = build({ flavorsRoot: root, flavor: 'f', tree: makeServerTree(), out: tempDir('out') });
    assert.equal(built.status, 2);
    assert.match(built.stderr, message);
  });
}

test('an enable_after_install app that is not in the flavor is rejected and named', () => {
  const root = makeFlavorsRoot({ 'flavors/f/flavor.yaml': 'enable_after_install: [ghost]\n' });
  const result = resolveCli(root, 'f');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /app ghost is not in the flavor/);
});

test('enable_after_install must be a list of app ids', () => {
  for (const value of ['demo', '[Bad-Id]', '[1, 2]', '["a b"]']) {
    const result = resolveCli(makeFlavorsRoot({ 'flavors/f/flavor.yaml': `enable_after_install: ${value}\n` }), 'f');
    assert.equal(result.status, 2, value);
    assert.match(result.stderr, /enable_after_install/, value);
  }
});

// ---------------------------------------------------------------- the artifact

function buildF(files: Record<string, string> = FLAVOR) {
  const root = makeFlavorsRoot(files);
  const result = build({ flavorsRoot: root, flavor: 'f', tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
  return { root, zipPath: result.stdout.trim(), zip: readZip(result.stdout.trim()) };
}

function validate(root: string, artifact: string) {
  return runCli(['validate', '--flavors', root, '--flavor', 'f', '--artifact', artifact]);
}

test('the artifact holds ncw-configure.sh at its root and validate accepts it', () => {
  const { root, zipPath, zip } = buildF();
  assert.ok(zip.has('ncw-configure.sh'));
  assert.match(text(zip, 'ncw-configure.sh'), /^#!\/usr\/bin\/env bash\n/);
  const result = validate(root, zipPath);
  assert.equal(result.status, 0, result.stderr);
});

test('validate fails when ncw-configure.sh is missing, or is not the script of the flavor', () => {
  const { root, zip } = buildF();
  const without = new Map(zip); without.delete('ncw-configure.sh');
  const missingZip = join(tempDir('t'), 'a.zip');
  writeFileSync(missingZip, zipSync(Object.fromEntries(without)));
  const missing = validate(root, missingZip);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /missing ncw-configure\.sh/);

  const edited = new Map(zip); edited.set('ncw-configure.sh', strToU8(text(zip, 'ncw-configure.sh') + '\necho tampered\n'));
  const editedZip = join(tempDir('t'), 'a.zip');
  writeFileSync(editedZip, zipSync(Object.fromEntries(edited)));
  const result = validate(root, editedZip);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /ncw-configure\.sh is not the script generated for flavor f/);
});

test('validate fails when the flavor lists an app to enable that the artifact script does not enable', () => {
  const { zipPath } = buildF();
  const other = makeFlavorsRoot({ ...FLAVOR, 'flavors/f/flavor.yaml': FLAVOR['flavors/f/flavor.yaml']!.replace('enable_after_install: [demo]', 'enable_after_install: []') });
  const result = validate(other, zipPath);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /ncw-configure\.sh is not the script generated for flavor f/);
});

test('the script is the same for the same inputs (deterministic)', () => {
  assert.equal(text(buildF().zip, 'ncw-configure.sh'), text(buildF().zip, 'ncw-configure.sh'));
});

// ---------------------------------------------------------------- running the generated script

/**
 * A stub for `php occ`: records every call as one line (arguments joined by the unit separator), copies the file given
 * to config:import, keeps the enabled apps in a state file, and fails on the command named in STUB_FAIL.
 */
const OCC_STUB = `#!/usr/bin/env bash
printf '%s\\x1f' "$@" >> "$STUB_DIR/calls.log"; echo >> "$STUB_DIR/calls.log"
[ "\${STUB_FAIL:-}" != "$1" ] || { echo "occ: $1 failed" >&2; exit 1; }
case "$1" in
  config:import) cp "$2" "$STUB_DIR/import-$(wc -l < "$STUB_DIR/calls.log" | tr -d ' ').json" ;;
  app:list)
    printf '{"enabled":{"files":"1.0"'
    while read -r a; do [ -z "$a" ] || printf ',"%s":"1.0"' "$a"; done < "$STUB_DIR/enabled.txt"
    printf '},"disabled":{"demo":"1.0"}}\\n' ;;
  app:enable) echo "$2" >> "$STUB_DIR/enabled.txt" ;;
esac
`;

interface World { dir: string; stub: string; script: string }

function world(files: Record<string, string> = FLAVOR): World {
  const { zip } = buildF(files);
  const dir = tempDir('run');
  const tree = join(dir, 'tree');
  mkdirSync(tree);
  for (const name of ['ncw-configure.sh', 'app-config.json', 'app-config-special.json']) writeFileSync(join(tree, name), zip.get(name) ?? '');
  const stub = join(dir, 'occ-stub');
  writeFileSync(stub, OCC_STUB);
  chmodSync(stub, 0o755);
  writeFileSync(join(dir, 'enabled.txt'), '');
  return { dir, stub, script: join(tree, 'ncw-configure.sh') };
}

function runScript(w: World, env: Record<string, string> = {}, unset: string[] = []) {
  const clean = { ...process.env };
  for (const name of ['BASE_URL', 'SMTP_PASSWORD', 'PHONE_REGION', ...unset]) delete clean[name];
  const result = spawnSync('bash', [w.script], { encoding: 'utf8', cwd: w.dir, env: { ...clean, OCC: w.stub, STUB_DIR: w.dir, ...env } });
  return result;
}

const calls = (w: World): string[][] => {
  const log = join(w.dir, 'calls.log');
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\x1f').slice(0, -1)) : [];
};
const imported = (w: World, n: number): unknown => JSON.parse(readFileSync(join(w.dir, `import-${n}.json`), 'utf8'));

const ENV = { BASE_URL: 'https://cloud.example', SMTP_PASSWORD: 's3cret' };
const skip = { skip: !hasPhp && 'php is not installed' };

test('the script does, in order: import the filled app config, set the special settings (sorted by app and key), enable the app', skip, () => {
  const w = world();
  const result = runScript(w, ENV);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const log = calls(w);
  assert.equal(log[0]?.[0], 'config:import');
  assert.deepEqual(log.slice(1), [
    ['config:app:set', 'demo', 'count', '--value=3', '--type=integer', '--lazy'],
    ['config:app:set', 'mail', 'smtp_pass', '--value=s3cret', '--sensitive'],
    ['app:list', '--output=json'],
    ['app:enable', 'demo'],
  ]);
  assert.equal(log[0]?.length, 2);
  assert.deepEqual(imported(w, 1), { apps: { theming: { name: 'Acme', url: 'https://cloud.example/x' }, regional: { region: 'DE' } } });
});

test('a declared default fills an optional variable only when it is unset, and the environment of occ is not changed', skip, () => {
  const w = world();
  assert.equal(runScript(w, { ...ENV, PHONE_REGION: 'FR' }).status, 0);
  assert.deepEqual(imported(w, 1), { apps: { theming: { name: 'Acme', url: 'https://cloud.example/x' }, regional: { region: 'FR' } } });
});

test('one line per step on stdout', skip, () => {
  const result = runScript(world(), ENV);
  const lines = result.stdout.split('\n').filter(Boolean);
  assert.deepEqual(lines.map((l) => l.replace(/ \(.*/, '')), [
    'ncw-configure: importing app-config.json',
    'ncw-configure: setting demo count',
    'ncw-configure: setting mail smtp_pass',
    'ncw-configure: enabling app demo',
  ]);
  assert.doesNotMatch(result.stdout + result.stderr, /s3cret/);
});

test('values with quotes, dollars, backslashes and spaces arrive unchanged', skip, () => {
  const w = world();
  const odd = 'p"a$s\'w\\o rd ${NOT_A_VAR}';
  assert.equal(runScript(w, { ...ENV, SMTP_PASSWORD: odd }).status, 0);
  assert.equal(calls(w)[2]?.[3], `--value=${odd}`); // special settings are applied in the order of app and key
});

test('an unset required variable fails before any occ call and every missing variable is named', skip, () => {
  const w = world();
  const result = runScript(w, {});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BASE_URL/);
  assert.match(result.stderr, /SMTP_PASSWORD/);
  assert.doesNotMatch(result.stderr, /PHONE_REGION/);
  assert.deepEqual(calls(w), []);
  const empty = runScript(w, { BASE_URL: '', SMTP_PASSWORD: 'x' });
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /BASE_URL/);
  assert.doesNotMatch(empty.stderr, /SMTP_PASSWORD/);
});

test('a second run does not enable the app again; the settings are set again (they are idempotent)', skip, () => {
  const w = world();
  assert.equal(runScript(w, ENV).status, 0);
  assert.equal(runScript(w, ENV).status, 0);
  const names = calls(w).map((c) => c[0]);
  assert.deepEqual(names, ['config:import', 'config:app:set', 'config:app:set', 'app:list', 'app:enable', 'config:import', 'config:app:set', 'config:app:set', 'app:list']);
  assert.match(runScript(w, ENV).stdout, /app demo is already enabled/);
});

test('the first failing occ call stops the script with a non-zero status and no later call is made', skip, () => {
  for (const [failing, expected] of [
    ['config:import', ['config:import']],
    ['config:app:set', ['config:import', 'config:app:set']],
    ['app:list', ['config:import', 'config:app:set', 'config:app:set', 'app:list']],
    ['app:enable', ['config:import', 'config:app:set', 'config:app:set', 'app:list', 'app:enable']],
  ] as const) {
    const w = world();
    const result = runScript(w, { ...ENV, STUB_FAIL: failing });
    assert.notEqual(result.status, 0, failing);
    assert.deepEqual(calls(w).map((c) => c[0]), expected, failing);
    assert.match(result.stderr, new RegExp(failing), failing);
  }
});

test('an app config with no settings imports an empty apps object, and a flavor without apps to enable makes no app call', skip, () => {
  const w = world({ 'flavors/f/flavor.yaml': 'apps:\n  demo: available\n' });
  const result = runScript(w, {});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls(w).map((c) => c[0]), ['config:import']);
  assert.equal(readFileSync(join(w.dir, 'import-1.json'), 'utf8').replace(/\s/g, ''), '{"apps":{}}');
});

test('the default OCC is php occ in the folder of the script', skip, () => {
  const w = world();
  const fake = join(w.dir, 'bin');
  mkdirSync(fake);
  writeFileSync(join(fake, 'php'), '#!/usr/bin/env bash\nif [ "$1" = -r ]; then exec "$REAL_PHP" "$@"; fi\necho "$@" >> "$STUB_DIR/php.log"\n');
  chmodSync(join(fake, 'php'), 0o755);
  const real = spawnSync('bash', ['-c', 'command -v php'], { encoding: 'utf8' }).stdout.trim();
  const clean = { ...process.env, ...ENV, STUB_DIR: w.dir, REAL_PHP: real, PATH: `${fake}:${process.env.PATH}` };
  delete (clean as Record<string, unknown>).OCC;
  const result = spawnSync('bash', [w.script], { encoding: 'utf8', env: clean });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(join(w.dir, 'php.log'), 'utf8'), new RegExp(`^${join(w.dir, 'tree', 'occ')} config:import `, 'm'));
});

test('a placeholder of an undeclared variable (an app-config.json edited after the build) fails with a message naming it', skip, () => {
  const w = world();
  writeFileSync(join(w.script, '..', 'app-config.json'), JSON.stringify({ apps: { theming: { url: '${NOT_DECLARED}/x' } } }));
  const result = runScript(w, ENV);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /the settings use \$\{NOT_DECLARED\} but the environment has no NOT_DECLARED/);
  assert.deepEqual(calls(w), []);
});
