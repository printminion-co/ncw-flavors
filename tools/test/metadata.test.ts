import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build, makeServerTree, readZip, tempDir, text } from './helpers.ts';

const SERVER = 'a'.repeat(40);
const FLAVORS = 'b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9';

function jsonFile(content: unknown): string {
  const path = join(tempDir('input'), 'input.json');
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

/** Builds with extra options; returns the CLI result and the metadata file text (when an artifact was made). */
function run(extra: string[], kind = 'release') {
  const out = tempDir('out');
  const result = build({ tree: makeServerTree(), out, kind, extra });
  const artifact = result.stdout.trim();
  return { result, out, meta: result.status === 0 ? text(readZip(artifact), 'version.json') : '' };
}

const RELEASE = ['--snapshot-branch', 'snapshot/33.0.9', '--release-number', '3', '--scope', 'Calendar fixes'];

test('a release build writes every field of the build metadata', () => {
  const apps = jsonFile({ calendar: { commit: 'c'.repeat(40), describe: 'v5.0.1-3-gabcdef0' }, activity: { commit: 'd'.repeat(40), describe: 'v4.1.0' } });
  const cache = jsonFile({ calendar: { key: 'calendar-5.0.1-k1', checksum: 'sha256:11' } });
  const { result, meta } = run([...RELEASE, '--server-commit', SERVER, '--flavors-commit', FLAVORS, '--app-pins', apps, '--cache-keys', cache]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(meta), {
    flavor: 'flavor1',
    base_release: '33.0.9',
    build_number: 812,
    kind: 'release',
    snapshot_branch: 'snapshot/33.0.9',
    release_number: 3,
    scope: 'Calendar fixes',
    server_commit: SERVER,
    flavors_commit: FLAVORS,
    apps: {
      activity: { commit: 'd'.repeat(40), describe: 'v4.1.0' },
      calendar: { commit: 'c'.repeat(40), describe: 'v5.0.1-3-gabcdef0' },
    },
    cached_builds: { calendar: { key: 'calendar-5.0.1-k1', checksum: 'sha256:11' } },
  });
});

test('the metadata file is pretty JSON with sorted keys and a final newline, equal for equal inputs', () => {
  const apps = jsonFile({ zeta: { describe: 'v1', commit: 'c'.repeat(40) }, alpha: { commit: 'd'.repeat(40), describe: 'v2' } });
  const first = run([...RELEASE, '--app-pins', apps]).meta;
  const second = run([...RELEASE, '--app-pins', apps]).meta;

  assert.equal(first, second);
  assert.equal(first, `{
  "apps": {
    "alpha": {
      "commit": "${'d'.repeat(40)}",
      "describe": "v2"
    },
    "zeta": {
      "commit": "${'c'.repeat(40)}",
      "describe": "v1"
    }
  },
  "base_release": "33.0.9",
  "build_number": 812,
  "cached_builds": {},
  "flavor": "flavor1",
  "kind": "release",
  "release_number": 3,
  "scope": "Calendar fixes",
  "snapshot_branch": "snapshot/33.0.9"
}
`);
});

test('a dev build needs no snapshot branch, release number or scope and leaves them out', () => {
  const { result, meta } = run([], 'dev');

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(meta), { flavor: 'flavor1', base_release: '33.0.9', build_number: 812, kind: 'dev', apps: {}, cached_builds: {} });
});

test('the build number given with --build-number is recorded as an integer', () => {
  const out = tempDir('out');
  const result = build({ tree: makeServerTree(), out, buildNumber: '77' });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(text(readZip(result.stdout.trim()), 'version.json')).build_number, 77);
});

test('a dev build records the snapshot inputs when they are given', () => {
  const { meta } = run(['--release-number', '2'], 'dev');
  assert.equal(JSON.parse(meta).release_number, 2);
});

for (const missing of ['--snapshot-branch', '--release-number', '--scope']) {
  test(`a release build without ${missing} is rejected, naming the option`, () => {
    const args = [...RELEASE];
    args.splice(args.indexOf(missing), 2);
    const { result, out } = run(args);

    assert.equal(result.status, 2);
    assert.ok(result.stderr.includes(missing), result.stderr);
    assert.equal(result.stdout, '');
    assert.ok(!existsSync(out) || readdirSync(out).length === 0, 'no artifact may be written');
  });
}

const bad: [string, string[], string[]][] = [
  ['a release number of zero', ['--release-number', '0'], ['--release-number', '0']],
  ['a release number that is not a number', ['--release-number', 'x1'], ['--release-number', 'x1']],
  ['a negative release number', ['--release-number=-2'], ['--release-number', '-2']],
  ['an empty scope', ['--scope', ' '], ['--scope']],
  ['a server commit that is not a hex sha', ['--server-commit', 'main'], ['--server-commit', 'main']],
  ['a flavors commit that is too short', ['--flavors-commit', 'abc'], ['--flavors-commit', 'abc']],
  ['app pins that are not JSON', ['--app-pins', jsonFile('{nope')], ['--app-pins']],
  ['an app pin without a describe', ['--app-pins', jsonFile({ calendar: { commit: 'c'.repeat(40) } })], ['calendar', 'describe']],
  ['an app pin with a bad commit', ['--app-pins', jsonFile({ calendar: { commit: 'zz', describe: 'v1' } })], ['calendar', 'commit']],
  ['an app pin with an unknown field', ['--app-pins', jsonFile({ calendar: { commit: 'c'.repeat(40), describe: 'v1', extra: 1 } })], ['calendar', 'extra']],
  ['app pins that are a list', ['--app-pins', jsonFile([])], ['--app-pins']],
  ['app pins file that does not exist', ['--app-pins', '/does/not/exist.json'], ['/does/not/exist.json']],
  ['a cache entry without a checksum', ['--cache-keys', jsonFile({ calendar: { key: 'k' } })], ['calendar', 'checksum']],
  ['a cache entry with an empty key', ['--cache-keys', jsonFile({ calendar: { key: '', checksum: 'c' } })], ['calendar', 'key']],
];
for (const [name, extra, mentions] of bad) {
  test(`build rejects ${name} before packaging`, () => {
    const base = [...RELEASE];
    const at = base.indexOf(extra[0] as string);
    if (at >= 0) base.splice(at, 2);
    const { result, out } = run([...base, ...extra]);
    assert.ok(!existsSync(out) || readdirSync(out).length === 0, 'no artifact may be written');

    assert.equal(result.status, 2, result.stderr);
    for (const word of mentions) assert.ok(result.stderr.includes(word), `stderr should mention ${word}: ${result.stderr}`);
    assert.equal(result.stdout, '');
  });
}
