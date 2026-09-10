import assert from 'node:assert/strict';
import test from 'node:test';
import { postgresSsl } from '../db/pgSsl';

test('postgresSsl derives TLS policy from the parsed host and explicit verification controls', () => {
  const previous = process.env.PG_SSL_REJECT_UNAUTHORIZED;
  delete process.env.PG_SSL_REJECT_UNAUTHORIZED;

  try {
    assert.equal(postgresSsl('postgresql://user:pass@localhost/app'), false);
    assert.equal(postgresSsl('postgresql://user:pass@127.0.0.1/app'), false);
    assert.equal(postgresSsl('postgresql://user:pass@[::1]/app'), false);

    // Credential/path text must never make a remote host look local.
    assert.deepEqual(
      postgresSsl('postgresql://localhost_user:localhost_pass@db.example.com/localhost_db'),
      { rejectUnauthorized: false }
    );

    assert.equal(postgresSsl('postgresql://user:pass@db.example.com/app?sslmode=disable'), false);
    assert.deepEqual(
      postgresSsl('postgresql://user:pass@db.example.com/app?sslmode=verify-ca'),
      { rejectUnauthorized: true }
    );
    assert.deepEqual(
      postgresSsl('postgresql://user:pass@db.example.com/app?sslmode=verify-full'),
      { rejectUnauthorized: true }
    );

    process.env.PG_SSL_REJECT_UNAUTHORIZED = 'true';
    assert.deepEqual(
      postgresSsl('postgresql://user:pass@db.example.com/app?sslmode=require'),
      { rejectUnauthorized: true }
    );
  } finally {
    if (previous === undefined) delete process.env.PG_SSL_REJECT_UNAUTHORIZED;
    else process.env.PG_SSL_REJECT_UNAUTHORIZED = previous;
  }
});
