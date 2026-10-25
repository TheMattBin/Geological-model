import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkBudget, measureBundle } from '../scripts/check-bundle.mjs';

test('bundle budgets aggregate chunks by type and reject excess compressed bytes', () => {
  const assets = [
    { name: 'main.js', gzipBytes: 70 },
    { name: 'lazy.js', gzipBytes: 31 },
    { name: 'main.css', gzipBytes: 10 }
  ];
  const results = checkBudget(assets, { javascriptGzipBytes: 100, stylesheetGzipBytes: 10 });
  assert.deepEqual(
    results.map(({ passed }) => passed),
    [false, true]
  );
  assert.throws(() => checkBudget(assets, { javascriptGzipBytes: 0 }), /Invalid/);
});

test('measurement uses gzip, includes nested chunks, and fails on missing build output', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'geological-bundle-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => measureBundle(directory));
  mkdirSync(join(directory, 'assets', 'chunks'), { recursive: true });
  assert.throws(() => measureBundle(directory), /No JavaScript/);
  writeFileSync(join(directory, 'assets', 'chunks', 'main.js'), 'const repeated = 1;\n'.repeat(100));
  writeFileSync(join(directory, 'assets', 'main.js.map'), 'ignored');
  const assets = measureBundle(directory);
  assert.equal(assets.length, 1);
  assert.ok(assets[0].gzipBytes < assets[0].bytes / 2);
});
