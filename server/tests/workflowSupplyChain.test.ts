import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');
const SHA_ACTION = /^\s*uses:\s*[^\s#]+@[0-9a-f]{40}(?:\s+#.*)?$/i;

const PERMANENT_VALIDATION_GATES = [
  '.github/workflows/code-complete-gate.yml',
  '.github/workflows/verify-real-session.yml',
  '.github/workflows/android-physical-adb-final-gate.yml',
] as const;

test('permanent validation gates pin third-party actions to immutable commit SHAs', () => {
  for (const workflowPath of PERMANENT_VALIDATION_GATES) {
    const workflow = read(workflowPath);
    const usesLines = workflow.split(/\r?\n/).filter((line) => /^\s*uses:\s*/.test(line));
    assert.ok(usesLines.length > 0, `${workflowPath} must declare at least one action dependency`);
    for (const line of usesLines) {
      assert.match(line, SHA_ACTION, `${workflowPath} contains a mutable action reference: ${line.trim()}`);
    }
    assert.doesNotMatch(workflow, /\bpull_request_target\s*:/);
    assert.doesNotMatch(workflow, /^\s*(?:contents|actions|checks|deployments|issues|packages|pages|pull-requests|repository-projects|security-events|statuses|id-token):\s*write\s*$/m);
  }
});

test('permanent npm validation gates consume the committed lockfile with npm ci', () => {
  for (const workflowPath of PERMANENT_VALIDATION_GATES) {
    const workflow = read(workflowPath);
    assert.match(workflow, /npm ci --no-audit --no-fund/);
    assert.doesNotMatch(workflow, /npm install --no-audit --no-fund/);
  }

  const verify = read('.github/workflows/verify-real-session.yml');
  assert.match(verify, /cache-dependency-path:\s*package-lock\.json/);
});

test('physical acceptance is manual-only so a workflow edit cannot repeat blocked device probes', () => {
  const physical = read('.github/workflows/android-physical-adb-final-gate.yml');
  assert.match(physical, /\bon:\s*\n\s+workflow_dispatch:/);
  assert.doesNotMatch(physical, /^\s+push:\s*$/m);
  assert.match(physical, /install -r/);
  assert.doesNotMatch(physical, /\bpm clear\b|\buninstall\b|--wipe-data|avdmanager\s+delete/i);
});
