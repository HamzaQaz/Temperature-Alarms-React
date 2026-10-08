import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import express from 'express';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { createBroadcaster } from '../src/sse';
import { exitOnSignals, shutDown, type ExitOptions } from '../src/shutdown';
import { createTestPool } from './helpers/database';
import { createGate, settlesWithin } from './helpers/gate';
import { testConfig } from './helpers/server';
import { subscribe } from './helpers/sse';

describe('shutDown', () => {
  test('with a dashboard stream open and a pass in flight: ends the stream with a 2 s retry, waits for the pass, stops listening, closes the pool', async () => {
    const pool = createTestPool();
    const sse = createBroadcaster();
    let stopping = false;
    const app = createApp({ config: testConfig(), pool, sse, stopping: () => stopping });
    const server: Server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;

    const stream = await subscribe(`${url}/api/dashboard/stream`);
    assert.equal((await stream.next()).kind, 'comment');
    // Answered on a keep-alive connection, which then sits idle: it must not hold the server open.
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
    const gate = createGate();
    const job = { stop: () => gate.wait() };

    const started = Date.now();
    stopping = true;
    const done = shutDown({ server, sse, jobs: [job], pool });
    try {
      assert.equal(server.listening, false, 'no new connections');
      assert.deepEqual(await stream.next(), { kind: 'retry', ms: 2000 }, 'browsers come back in 2 s');
      await stream.ended;
      await gate.reached;
      assert.equal(await settlesWithin(done, 150), false, 'the shutdown waits for the pass in flight');
      await pool.query('SELECT 1'); // The pass in flight still has the pool.
    } finally {
      gate.open();
    }
    await done;
    assert.ok(Date.now() - started < 1000, `stopped in ${Date.now() - started} ms`);
    await assert.rejects(pool.query('SELECT 1'), /closed/i, 'the pool is closed');
  });

  test('a request in flight on a keep-alive connection is answered, and its connection does not hold the stop for the 5 s keep-alive', async () => {
    const pool = createTestPool();
    const sse = createBroadcaster();
    const gate = createGate();
    const app = createApp({ config: testConfig(), pool, sse });
    // A slow route in front of the app: the request is in flight when the stop begins.
    const slow = express();
    slow.get('/slow', async (_req, res) => {
      await gate.wait();
      res.json({ ok: true });
    });
    slow.use(app);
    const server: Server = await new Promise((resolve) => {
      const s = slow.listen(0, '127.0.0.1', () => resolve(s));
    });
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');

    const answer = fetch(`http://127.0.0.1:${address.port}/slow`);
    await gate.reached;
    const started = Date.now();
    const done = shutDown({ server, sse, jobs: [], pool });
    try {
      assert.equal(await settlesWithin(done, 100), false, 'waits for the request');
    } finally {
      gate.open();
    }
    const response = await answer;
    assert.deepEqual(await response.json(), { ok: true });
    await done;
    assert.ok(Date.now() - started < 1000, `stopped in ${Date.now() - started} ms`);
  });
});

describe('exitOnSignals', () => {
  /** A stand-in for the process: signals to raise, and the exit codes asked for. */
  const fakeProcess = () => {
    const signals = new EventEmitter();
    const codes: number[] = [];
    let exited!: () => void;
    const exitedOnce = new Promise<void>((resolve) => (exited = resolve));
    const options: ExitOptions = {
      signals,
      exit: (code) => {
        codes.push(code);
        exited();
      },
      log: () => {},
    };
    return { signals, codes, exited: exitedOnce, options };
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    test(`${signal} runs the stop once and exits 0 when it finishes`, async () => {
      const proc = fakeProcess();
      let stops = 0;
      exitOnSignals(async () => {
        stops++;
      }, proc.options);
      proc.signals.emit(signal, signal);
      await proc.exited;
      assert.deepEqual(proc.codes, [0]);
      assert.equal(stops, 1);
    });
  }

  test('a second signal while stopping exits 1 at once', async () => {
    const proc = fakeProcess();
    const gate = createGate();
    let stops = 0;
    exitOnSignals(() => {
      stops++;
      return gate.wait();
    }, proc.options);
    proc.signals.emit('SIGTERM', 'SIGTERM');
    await gate.reached;
    proc.signals.emit('SIGINT', 'SIGINT');
    assert.deepEqual(proc.codes, [1]);
    assert.equal(stops, 1, 'the second signal does not start another stop');
    // Lets the first stop finish, which clears its deadline; a real process is gone by now.
    gate.open();
  });

  test('a stop still running at the deadline exits 1', async () => {
    const proc = fakeProcess();
    const started = Date.now();
    exitOnSignals(() => new Promise<void>(() => {}), { ...proc.options, deadlineMs: 100 });
    proc.signals.emit('SIGTERM', 'SIGTERM');
    await proc.exited;
    assert.deepEqual(proc.codes, [1]);
    assert.ok(Date.now() - started >= 90);
  });

  test('a stop that fails exits 1', async () => {
    const proc = fakeProcess();
    exitOnSignals(async () => {
      throw new Error('the pool would not close');
    }, { ...proc.options, logError: () => {} });
    proc.signals.emit('SIGTERM', 'SIGTERM');
    await proc.exited;
    assert.deepEqual(proc.codes, [1]);
  });
});
