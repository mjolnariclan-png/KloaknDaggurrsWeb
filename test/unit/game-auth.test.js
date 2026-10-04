'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');

const gameAuthSource = readFileSync(require.resolve('../../game/game-auth.js'), 'utf8');

function loadGameAuth(supabase) {
  const window = {
    supabase,
    KD_CONFIG: {
      supabaseUrl: 'https://example.supabase.co',
      supabasePublishableKey: 'test-key',
    },
  };
  runInNewContext(gameAuthSource, { window, console });
  return window;
}

test('game auth initializes a client from the Supabase CDN library', async () => {
  const session = { user: { id: 'user-1' } };
  let createClientCalls = 0;
  const client = {
    auth: {
      async getSession() {
        return { data: { session }, error: null };
      },
    },
  };
  const supabaseLibrary = {
    createClient(url, key, options) {
      createClientCalls += 1;
      assert.equal(url, 'https://example.supabase.co');
      assert.equal(key, 'test-key');
      assert.equal(options.auth.persistSession, true);
      return client;
    },
  };

  const window = loadGameAuth(supabaseLibrary);

  assert.equal(createClientCalls, 1);
  assert.equal(window.supabase, client);
  assert.equal(await window.GameAuth.getSession(), session);
});

test('game auth reuses an already-initialized Supabase client', async () => {
  const session = { user: { id: 'user-2' } };
  const client = {
    auth: {
      async getSession() {
        return { data: { session }, error: null };
      },
    },
    createClient() {
      assert.fail('An initialized client must not be initialized again');
    },
  };

  const window = loadGameAuth(client);

  assert.equal(window.supabase, client);
  assert.equal(await window.GameAuth.getSession(), session);
});
