import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REPO_ROOT, build, makeServerTree, readZip, tempDir, text } from './helpers.ts';

test("the example flavor committed on this branch builds into an artifact", () => {
  const result = build({ flavorsRoot: REPO_ROOT, tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);

  const zip = readZip(result.stdout.trim());
  assert.ok(result.stdout.trim().endsWith('ncw-flavor1-v33.0.9.812.zip'));
  assert.deepEqual(JSON.parse(text(zip, 'core/shipped.json')).alwaysEnabled, ['dav', 'demo', 'files']);
  assert.ok(zip.has('config/10-core.config.php') && zip.has('config/50-flavor.config.php'));
});
