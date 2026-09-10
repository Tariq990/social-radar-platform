import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('deleteRule keeps the PostgreSQL id binding', () => {
  const source = fs.readFileSync('server/db/database.ts', 'utf8');
  assert.match(
    source,
    /async deleteRule\(id: string\)[\s\S]*?pool\.query\('DELETE FROM rules WHERE id = \$1', \[id\]\)/,
    'deleteRule must bind id to the $1 placeholder'
  );
});
