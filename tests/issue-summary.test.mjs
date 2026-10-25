import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('issue summary shell passes generated text literally without executing it', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'geological-summary-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  const marker = join(directory, 'injected');
  const output = join(directory, 'captured.json');
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const body = fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({ args, body }));
`,
    { mode: 0o755 }
  );
  const workflow = readFileSync('.github/workflows/summary.yml', 'utf8');
  const command = workflow.split('        run: |\n')[1].split('        env:\n')[0];
  const response = `It's a summary.\n'; touch ${marker}; #\n$(touch ${marker})\n\`touch ${marker}\`\n"quoted"`;
  const result = spawnSync('bash', ['-e', '-c', command], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: directory,
      CAPTURE_PATH: output,
      RESPONSE: response,
      ISSUE_NUMBER: '123',
      GH_REPO: 'example/repo',
      GH_TOKEN: 'unused-local-test-token'
    }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(marker), false);
  const captured = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(captured.body, response);
  assert.deepEqual(captured.args, [
    'issue',
    'comment',
    '123',
    '--repo',
    'example/repo',
    '--body-file',
    join(directory, 'issue-summary.md')
  ]);
});
