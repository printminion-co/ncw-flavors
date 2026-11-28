import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { REPO_ROOT, build, hasPhp, makeFlavorsRoot, makeServerTree, readZip, tempDir, text } from './helpers.ts';

// The source offer (06-branding.md): the theme overrides the personal development notice of the server. The template
// is read from the artifact the tool builds and rendered by php with stand-ins for the server helpers.

const TEMPLATE = 'themes/ionos/apps/settings/templates/settings/personal/development.notice.php';
const REPOSITORY = 'https://github.com/printminion-co/mk-nc-server';

function artifact(): Map<string, Uint8Array> {
  const root = makeFlavorsRoot({ 'flavors/f/flavor.yaml': 'extends: [common]\n' });
  cpSync(join(REPO_ROOT, 'bases/common'), join(root, 'bases/common'), { recursive: true });
  cpSync(join(REPO_ROOT, 'themes'), join(root, 'themes'), { recursive: true });
  const result = build({ flavorsRoot: root, flavor: 'f', tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
  return readZip(result.stdout.trim());
}

const HARNESS = `<?php
// stand-ins for what the server gives a template: OC::$SERVERROOT, p(), the l10n object with a German table
class OC { public static string $SERVERROOT = ''; }
function p($s) { print(htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8')); }
function print_unescaped($s) { print($s); }
$l = new class { public function t($s, $a = []) { return $s; } };
OC::$SERVERROOT = $argv[2];
include $argv[1];
`;

/** Renders the template of the artifact with the given version.json content (null: no file) and returns the HTML. */
function render(zip: Map<string, Uint8Array>, versionJson: string | null): string {
  const dir = tempDir('render');
  const root = join(dir, 'root');
  mkdirSync(root);
  const template = join(dir, 'development.notice.php');
  writeFileSync(template, text(zip, TEMPLATE));
  writeFileSync(join(dir, 'harness.php'), HARNESS);
  if (versionJson !== null) writeFileSync(join(root, 'version.json'), versionJson);
  const run = spawnSync('php', ['-d', 'display_errors=1', '-d', 'error_reporting=E_ALL', join(dir, 'harness.php'), template, root], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.doesNotMatch(run.stdout, /Warning|Notice|Deprecated|Fatal/, 'the template raises nothing');
  return run.stdout;
}

const links = (html: string): string[] => [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1] as string);
const SHA = 'a7505dc9f871b335102ddb5770604c8e2860b919';
const dev = (extra: Record<string, unknown> = {}): string => JSON.stringify({ kind: 'dev', base_release: '33.0.9', server_commit: SHA, ...extra });
const release = (extra: Record<string, unknown> = {}): string => JSON.stringify({ kind: 'release', base_release: '33.0.9', release_number: 3, ...extra });

test('the artifact carries the notice template in the theme folder, with the repository as a marked brand value', () => {
  const zip = artifact();
  const source = text(zip, TEMPLATE);
  assert.match(source, /BRAND VALUE[^\n]*\n\$ncwSourceRepository = 'https:\/\/github\.com\/printminion-co\/mk-nc-server';/);
  assert.equal([...source.matchAll(/https?:\/\/[^'"\s<]+/g)].map((m) => m[0]).filter((u) => !u.startsWith('https://www.gnu.org/licenses/') && u !== REPOSITORY && !u.includes('SPDX')).length, 0, 'no other URL is written into the template');
  assert.doesNotMatch(source, /print_unescaped|\becho\b|<\?=/, 'every output goes through p()');
});

test('the notice drops the upstream marketing: the PDF and the five social links', { skip: !hasPhp && 'php is not installed' }, () => {
  const html = render(artifact(), dev());
  for (const gone of ['facebook', 'bsky', 'mastodon', 'blog', 'newsletter', 'reasons', 'nextcloud.com', '<img']) assert.equal(html.toLowerCase().includes(gone), false, gone);
});

test('a dev build links the commit of version.json, exactly once, next to the AGPL link and the attribution', { skip: !hasPhp && 'php is not installed' }, () => {
  const html = render(artifact(), dev());
  assert.deepEqual(links(html), [`${REPOSITORY}/tree/${SHA}`, 'https://www.gnu.org/licenses/agpl-3.0.html']);
  assert.match(html, /This server is based on the Nextcloud server by the Nextcloud community and has been modified\./);
  assert.match(html, /The source code of the running version is available here\./);
});

test('a release build links the snapshot tag ncw-v<base release>-<release number>', { skip: !hasPhp && 'php is not installed' }, () => {
  assert.equal(links(render(artifact(), release()))[0], `${REPOSITORY}/tree/ncw-v33.0.9-3`);
});

test('without version.json, with broken JSON or with values that are not strict, the plain repository is linked and the page does not break', { skip: !hasPhp && 'php is not installed' }, () => {
  const zip = artifact();
  const cases: [string, string | null][] = [
    ['no file', null],
    ['empty file', ''],
    ['invalid JSON', '{"kind": "dev", '],
    ['not an object', '"dev"'],
    ['a list', '[1,2]'],
    ['unknown kind', JSON.stringify({ kind: 'nightly', server_commit: SHA })],
    ['dev without a commit', JSON.stringify({ kind: 'dev' })],
    ['short commit', dev({ server_commit: 'a7505dc' })],
    ['upper case commit', dev({ server_commit: SHA.toUpperCase() })],
    ['commit with a path', dev({ server_commit: `${'a'.repeat(30)}/../../x${'a'.repeat(5)}` })],
    ['commit not a string', dev({ server_commit: 12 })],
    ['release without a number', JSON.stringify({ kind: 'release', base_release: '33.0.9' })],
    ['release number zero', release({ release_number: 0 })],
    ['release number as a string', release({ release_number: '3' })],
    ['base release with a slash', release({ base_release: '33/../1' })],
    ['base release with a quote', release({ base_release: '33"><script>' })],
    ['base release not a string', release({ base_release: 33 })],
  ];
  for (const [name, content] of cases) {
    const html = render(zip, content);
    assert.equal(links(html)[0], REPOSITORY, name);
    assert.equal(html.includes('<script>'), false, name);
  }
});

test('the template escapes what it prints', { skip: !hasPhp && 'php is not installed' }, () => {
  // a tag that passes the strict pattern cannot hold markup; this proves the output side by the markup the pattern lets through
  const html = render(artifact(), release({ base_release: 'v33.0.9_x-y' }));
  assert.equal(links(html)[0], `${REPOSITORY}/tree/ncw-vv33.0.9_x-y-3`);
});

test('every string of the notice template has an English and a German entry in the settings l10n overrides of the theme', () => {
  const keys = [...text(artifact(), TEMPLATE).matchAll(/\$l->t\('((?:[^'\\]|\\.)*)'\)/g)].map((m) => (m[1] as string).replaceAll("\\'", "'"));
  assert.equal(keys.length, 3);
  const read = (lang: string): Record<string, string> => JSON.parse(readFileSync(join(REPO_ROOT, `themes/ionos/assets/apps/settings/l10n/${lang}.json`), 'utf8')).translations;
  const en = read('en');
  const de = read('de');
  for (const key of keys) {
    assert.equal(en[key], key, `English: ${key}`);
    assert.ok(de[key] && de[key] !== key, `German: ${key}`);
  }
  assert.equal('Reasons to use Nextcloud in your organization' in en || 'Reasons to use Nextcloud in your organization' in de, false, 'the PDF string is gone with the PDF link');
});
