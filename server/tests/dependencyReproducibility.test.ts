import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('npm dependency graph is locked and the code-complete gate installs it deterministically', () => {
  const manifest = JSON.parse(read('package.json')) as {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const lock = JSON.parse(read('package-lock.json')) as {
    name?: string;
    version?: string;
    lockfileVersion?: number;
    packages?: Record<string, {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>;
  };

  assert.equal(lock.name, manifest.name);
  assert.equal(lock.version, manifest.version);
  assert.ok((lock.lockfileVersion ?? 0) >= 3, 'npm lockfile v3 or newer is required');
  assert.deepEqual(lock.packages?.['']?.dependencies ?? {}, manifest.dependencies ?? {});
  assert.deepEqual(lock.packages?.['']?.devDependencies ?? {}, manifest.devDependencies ?? {});

  const gate = read('.github/workflows/code-complete-gate.yml');
  assert.match(gate, /npm ci --no-audit --no-fund/);
  assert.doesNotMatch(gate, /run:\s*npm install(?:\s|$)/);
});
