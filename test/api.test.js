import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFytaClient,
  retryAfterSeconds,
  isFytaHost,
  imageType,
  MAX_IMAGE_BYTES,
  RENEW_BEFORE_MS,
} from '../src/fyta-api.js';
import { createFakeFyta, EMAIL, PASSWORD, PNG } from './helpers/fake-fyta.js';

const NOW = Date.parse('2026-10-25T10:00:00Z');

/**
 * @description A client on the fake FYTA.
 * @param {object} [options] - `{ fake, email, password, token, now }`.
 * @returns {object} `{ client, fake, kept }`.
 */
function setup({
  fake = createFakeFyta(),
  email = EMAIL,
  password = PASSWORD,
  token = null,
  now,
} = {}) {
  const kept = { token };
  const clock = { now: now ?? NOW };
  const client = createFytaClient({
    getCredentials: () => ({ email, password }),
    getToken: () => kept.token,
    setToken: (value) => {
      kept.token = value;
    },
    userAgent: 'gladys-fyta/test',
    fetch: fake.fetch,
    baseUrl: fake.baseUrl,
    spacingMs: 0,
    now: () => clock.now,
  });
  return { client, fake, kept, clock };
}

test('logs in with a JSON body, keeps the token and its expiry, then reads with the Bearer', async () => {
  const { client, fake, kept } = setup();
  const body = await client.plants();
  assert.equal(body.plants.length, 4);
  const [login] = fake.callsTo('/auth/login');
  assert.equal(login.method, 'POST');
  assert.deepEqual(JSON.parse(login.body), { email: EMAIL, password: PASSWORD });
  assert.equal(login.headers['content-type'], 'application/json');
  assert.equal(login.headers['user-agent'], 'gladys-fyta/test');
  assert.equal(kept.token.accessToken, 'not-a-real-fyta-access-token-1');
  assert.equal(kept.token.expiresAt, NOW + 5184000 * 1000);
  const [list] = fake.callsTo('/user-plant');
  assert.equal(list.headers.authorization, 'Bearer not-a-real-fyta-access-token-1');
  // The token is kept: no second login.
  await client.plant(101);
  assert.equal(fake.logins, 1);
});

test('a token kept in /data is used until a day before it expires', async () => {
  const fake = createFakeFyta();
  const first = setup({ fake });
  await first.client.plants();
  const second = setup({ fake, token: first.kept.token });
  await second.client.plants();
  assert.equal(fake.logins, 1, 'the kept token is reused');
  second.clock.now = first.kept.token.expiresAt - RENEW_BEFORE_MS + 1;
  await second.client.plants();
  assert.equal(fake.logins, 2, 'renewed one day before it expires');
});

test('login refusals: 404 is an unknown account, 401 a wrong password; no retry', async () => {
  const unknown = setup({ email: 'nobody@example.org' });
  await assert.rejects(unknown.client.plants(), { kind: 'auth', code: 'unknown_account' });
  assert.equal(unknown.fake.callsTo('/auth/login').length, 1);
  assert.equal(unknown.fake.callsTo('/user-plant').length, 0);
  const wrong = setup({ password: 'not-the-password' });
  await assert.rejects(wrong.client.login(), { kind: 'auth', code: 'wrong_password', status: 401 });
  const empty = setup({ password: '' });
  await assert.rejects(empty.client.plants(), { kind: 'auth', code: 'missing' });
  assert.equal(empty.fake.calls.length, 0);
});

test('a refused token (403 explicit deny) is dropped: one new login, then the request again', async () => {
  const { client, fake, kept } = setup();
  await client.plants();
  fake.revokeTokens();
  const body = await client.plant(101);
  assert.equal(body.plant.id, 101);
  assert.equal(fake.logins, 2);
  assert.equal(kept.token.accessToken, 'not-a-real-fyta-access-token-2');
});

test('a token refused twice is a `token` error; a malformed token (500 {"message":null}) is retried once', async () => {
  const stubborn = setup();
  stubborn.fake.failures['/user-plant'] = {
    status: 403,
    body: { Message: 'User is not authorized' },
    times: 2,
  };
  await assert.rejects(stubborn.client.plants(), { kind: 'token', status: 403 });
  assert.equal(stubborn.fake.logins, 2);
  assert.equal(stubborn.kept.token, null, 'the refused token is forgotten');

  const malformed = setup({ token: { accessToken: 'bad token', expiresAt: NOW + 3600e3 * 48 } });
  const body = await malformed.client.plants();
  assert.equal(body.plants.length, 4, 'the 500 led to a new login');
  assert.equal(malformed.fake.logins, 1);

  const broken = setup();
  broken.fake.failures['/user-plant'] = { status: 500, body: { message: null }, times: 2 };
  await assert.rejects(broken.client.plants(), { kind: 'server', status: 500 });
});

test('server errors, an HTML page, a missing plant and an unreachable FYTA', async () => {
  const { client, fake } = setup();
  fake.failures['/user-plant'] = { status: 502, body: { message: 'Bad Gateway' } };
  await assert.rejects(client.plants(), { kind: 'server', status: 502 });
  await assert.rejects(client.plant(999), { kind: 'not_found' });
  // fyta_cli: an HTML page instead of JSON is an error.
  const real = createFakeFyta();
  const htmlClient = createFytaClient({
    getCredentials: () => ({ email: EMAIL, password: PASSWORD }),
    getToken: () => null,
    setToken: () => {},
    userAgent: 'test',
    fetch: async (url, init) =>
      url.endsWith('/auth/login')
        ? real.fetch(url, init)
        : new Response('<html>Error</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
    baseUrl: real.baseUrl,
    spacingMs: 0,
  });
  await assert.rejects(htmlClient.plants(), { kind: 'failed' });
  const down = createFytaClient({
    getCredentials: () => ({ email: EMAIL, password: PASSWORD }),
    getToken: () => null,
    setToken: () => {},
    userAgent: 'test',
    fetch: async () => {
      throw new TypeError('fetch failed');
    },
    spacingMs: 0,
  });
  await assert.rejects(down.plants(), { kind: 'unreachable' });
});

test('a 429 pauses every request until its Retry-After (30 s at least)', async () => {
  const { client, fake, clock } = setup();
  await client.plants();
  fake.failures['/user-plant'] = {
    status: 429,
    body: { message: 'Too Many Requests' },
    headers: { 'retry-after': '5' },
  };
  await assert.rejects(client.plants(), { kind: 'rate_limit', retryAfter: 5 });
  assert.equal(client.pausedUntil(), NOW + 30 * 1000);
  const count = fake.calls.length;
  await assert.rejects(client.plant(101), { kind: 'rate_limit' });
  assert.equal(fake.calls.length, count, 'nothing sent while paused');
  clock.now += 31 * 1000;
  await client.plant(101);
  assert.equal(client.pausedUntil(), 0);
  assert.equal(retryAfterSeconds('Sun, 25 Oct 2026 10:01:00 GMT', NOW), 60);
  assert.equal(retryAfterSeconds(null, NOW), null);
});

test('one request at a time, one second apart by default', async () => {
  const fake = createFakeFyta();
  const waits = [];
  let clock = NOW;
  const client = createFytaClient({
    getCredentials: () => ({ email: EMAIL, password: PASSWORD }),
    getToken: () => null,
    setToken: () => {},
    userAgent: 'test',
    fetch: fake.fetch,
    baseUrl: fake.baseUrl,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  await Promise.all([client.login(), client.login()]);
  assert.deepEqual(waits, [1000]);
});

test('pictures: https only, the Bearer to fyta.de only, PNG / JPEG / WebP of 300 KB at most', async () => {
  const { client, fake } = setup();
  const own = 'https://web.fyta.de/storage/user-plants/101/thumb.jpg';
  const other = 'https://plants.example.org/species/monstera-thumb.jpg';
  fake.addImage(own);
  fake.addImage(other);
  const picture = await client.image(own);
  assert.equal(picture.type, 'png');
  assert.deepEqual(picture.bytes, PNG);
  assert.match(fake.callsTo(own)[0].headers.authorization, /^Bearer /);
  await client.image(other);
  assert.equal(fake.callsTo(other)[0].headers.authorization, undefined, 'no token to another host');
  await assert.rejects(client.image('http://web.fyta.de/x.png'), { kind: 'failed' });
  fake.addImage('https://web.fyta.de/big.jpg', { length: MAX_IMAGE_BYTES + 1 });
  await assert.rejects(client.image('https://web.fyta.de/big.jpg'), /300 KB/);
  fake.addImage('https://web.fyta.de/huge.jpg', {
    bytes: Buffer.alloc(MAX_IMAGE_BYTES + 10, 0xff),
  });
  await assert.rejects(client.image('https://web.fyta.de/huge.jpg'), /300 KB/);
  fake.addImage('https://web.fyta.de/page.jpg', { bytes: Buffer.from('<html></html>') });
  await assert.rejects(client.image('https://web.fyta.de/page.jpg'), /Not a picture/);
  await assert.rejects(client.image('https://web.fyta.de/missing.jpg'), {
    kind: 'http',
    status: 404,
  });
  assert.equal(isFytaHost('https://web.fyta.de/a'), true);
  assert.equal(isFytaHost('https://fyta.de.evil.example/a'), false);
  assert.equal(isFytaHost('http://web.fyta.de/a'), false);
  assert.equal(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(imageType(Buffer.from('RIFF0000WEBPVP8 ', 'latin1')), 'webp');
});

test('the password and the token never appear in an error message', async () => {
  const { client, fake } = setup({ password: 'not-the-password' });
  const err = await client.plants().catch((error) => error);
  assert.doesNotMatch(String(err.message), /not-the-password|not-a-real/);
  fake.password = 'not-the-password';
  await client.plants();
  fake.failures['/user-plant'] = { status: 403, body: {}, times: 2 };
  const refused = await client.plants().catch((error) => error);
  assert.doesNotMatch(JSON.stringify({ ...refused, message: refused.message }), /access-token/);
});
