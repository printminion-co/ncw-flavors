import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build, defaultFlavorsRoot, makeServerTree, readZip, runCli, tempDir, text } from './helpers.ts';

const rejectedBuildNumbers: [string, string[], string][] = [
  ['missing', [], '--build-number'],
  ['negative', ['--build-number=-5'], '-5'],
  ['fractional', ['--build-number', '1.5'], '1.5'],
  ['with a plus sign', ['--build-number', '+3'], '+3'],
  ['with leading zeros', ['--build-number', '007'], '007'],
  ['empty', ['--build-number', ''], '--build-number'],
];
for (const [name, args, mention] of rejectedBuildNumbers) {
  test(`a ${name} build number is rejectedBuildNumbers before packaging`, () => {
    const out = tempDir('out');
    const result = runCli(['build', '--flavors', defaultFlavorsRoot(), '--flavor', 'flavor1', '--tree', makeServerTree(),
      '--line', '33', '--kind', 'dev', ...args, '--out', out]);

    assert.equal(result.status, 2, result.stderr);
    assert.ok(result.stderr.includes(mention), result.stderr);
    assert.ok(!existsSync(out) || readdirSync(out).length === 0, 'no artifact may be written');
  });
}

const SNIPPET_MARK = '$OC_Version[] = $buildId;';
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

test('packaging an already processed tree again does not append the version snippet twice', () => {
  const first = readZip(build({ tree: makeServerTree(), out: tempDir('out') }).stdout.trim());
  assert.equal(count(text(first, 'version.php'), SNIPPET_MARK), 1);

  const again = makeServerTree();
  writeFileSync(join(again, 'version.php'), text(first, 'version.php'));
  const second = readZip(build({ tree: again, out: tempDir('out'), buildNumber: '813' }).stdout.trim());

  assert.equal(count(text(second, 'version.php'), SNIPPET_MARK), 1);
  assert.equal(text(second, 'version.php'), text(first, 'version.php'));
  assert.equal(text(second, '.buildnumber'), '813\n');
});
