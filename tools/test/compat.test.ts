import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { build, makeServerTree, runCli, defaultFlavorsRoot, tempDir, type CliResult } from './helpers.ts';

function checkCompat(tree: string): CliResult {
  return runCli(['check-compat', '--flavors', defaultFlavorsRoot(), '--flavor', 'flavor1', '--tree', tree]);
}

test('check-compat accepts a tree whose apps all accept the server version', () => {
  const result = checkCompat(makeServerTree());
  assert.equal(result.status, 0, result.stderr);
});

test('check-compat names the app, both bounds and the server version of an app that is too new for the server', () => {
  const tree = makeServerTree({ files: { min: '34', max: '35' } });
  const result = checkCompat(tree);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /app "files": min-version "34", max-version "35" do not accept server version 33\.0\.9/);
  assert.ok(
    result.stderr.includes(`::error file=${tree}/apps/files/appinfo/info.xml,title=App version compatibility::`),
    result.stderr,
  );
  assert.match(result.stderr, /::error [^\n]*::app "files": min-version "34", max-version "35"[^\n]*33\.0\.9/);
});

test('check-compat rejects an app whose max-version is older than the server, and names both bounds', () => {
  const result = checkCompat(makeServerTree({ dav: { min: '31', max: '32' } }));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /app "dav": min-version "31", max-version "32" do not accept server version 33\.0\.9/);
});

test('check-compat accepts short bounds: a bound is compared only as far as it is written', () => {
  const tree = makeServerTree({
    files: { min: '33.0', max: '33' },
    dav: { min: '32', max: '33.0.9' },
    activity: { min: '33.0.9', max: '33.1' },
  });
  const result = checkCompat(tree);
  assert.equal(result.status, 0, result.stderr);
});

test('check-compat rejects a bound that is more specific than the server version', () => {
  const below = checkCompat(makeServerTree({ files: { min: '33.0.10', max: '33' } }));
  assert.equal(below.status, 2);
  assert.match(below.stderr, /app "files": min-version "33\.0\.10", max-version "33" do not accept server version 33\.0\.9/);

  const above = checkCompat(makeServerTree({ files: { min: '32', max: '33.0.8' } }));
  assert.equal(above.status, 2);
  assert.match(above.stderr, /app "files": min-version "32", max-version "33\.0\.8" do not accept server version 33\.0\.9/);
});

test('check-compat treats a missing bound as an error', () => {
  const noMax = checkCompat(makeServerTree({ files: { max: null } }));
  assert.equal(noMax.status, 2);
  assert.match(noMax.stderr, /app "files": min-version "33", max-version \(missing\) do not accept server version 33\.0\.9/);

  const noMin = checkCompat(makeServerTree({ files: { min: null } }));
  assert.equal(noMin.status, 2);
  assert.match(noMin.stderr, /app "files": min-version \(missing\), max-version "33" do not accept server version 33\.0\.9/);
});

test('check-compat reports every offending app, including apps in active app folders', () => {
  const result = checkCompat(makeServerTree({ files: { min: '34' }, demo: { max: '32' } }));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /file=[^,]*\/apps\/files\/appinfo\/info\.xml,/);
  assert.match(result.stderr, /file=[^,]*\/apps-flavor1\/demo\/appinfo\/info\.xml,/);
});

test('check-compat skips removed apps and apps in inactive app folders', () => {
  const tree = makeServerTree({
    workflowengine: { min: '1', max: '2' },
    firstrunwizard: { min: null, max: null },
    other: { min: '1', max: '2' },
  });
  const result = checkCompat(tree);
  assert.equal(result.status, 0, result.stderr);
});

test('check-compat fails on a malformed bound instead of passing it', () => {
  const result = checkCompat(makeServerTree({ files: { max: 'latest' } }));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /app "files": min-version "33", max-version "latest" do not accept server version 33\.0\.9/);
});

for (const kind of ['dev', 'release']) {
  test(`a ${kind} build fails on an incompatible app and writes no artifact`, () => {
    const out = tempDir('out');
    const tree = makeServerTree({ activity: { min: '34', max: '34' } });
    const result = build({ tree, out, kind });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /app "activity": min-version "34", max-version "34" do not accept server version 33\.0\.9/);
    assert.ok(result.stderr.includes(`::error file=${tree}/apps/activity/appinfo/info.xml,title=App version compatibility::`));
    assert.deepEqual(readdirSync(out), []);
  });
}

test('a build ignores the bounds of a removed app', () => {
  const tree = makeServerTree({ workflowengine: { min: null, max: '2' } });
  const result = build({ tree, out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
});
