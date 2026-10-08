import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { routeStreamMessage, type StreamHandlers } from './streamMessage.ts';

/** Handlers that record which was called, with what. */
const recording = (only?: Array<keyof StreamHandlers>) => {
  const calls: Array<[string, unknown]> = [];
  const all: StreamHandlers = {
    onReading: (event) => calls.push(['reading', event]),
    onFault: (event) => calls.push(['fault', event]),
    onIncident: (event) => calls.push(['incident', event]),
    onFirmware: (event) => calls.push(['firmware', event]),
  };
  const handlers = only === undefined ? all : Object.fromEntries(only.map((name) => [name, all[name]]));
  return { calls, handlers };
};

describe('a stream message goes to the handler for its type', () => {
  it('a `firmware` event reaches only onFirmware', () => {
    const { calls, handlers } = recording();
    routeStreamMessage('{"type":"firmware"}', handlers);
    assert.deepEqual(calls, [['firmware', { type: 'firmware' }]]);
  });

  it('the dashboard pages, which pass no onFirmware, ignore it without an error', () => {
    const { calls, handlers } = recording(['onReading', 'onFault', 'onIncident']);
    assert.doesNotThrow(() => routeStreamMessage('{"type":"firmware"}', handlers));
    assert.deepEqual(calls, []);
  });

  it('a Reading, a fault report, and an incident reach their own handlers, as before', () => {
    const { calls, handlers } = recording();
    routeStreamMessage('{"type":"reading","device":"ESP_A1B2C3"}', handlers);
    routeStreamMessage('{"type":"fault","device":"ESP_A1B2C3"}', handlers);
    routeStreamMessage('{"type":"incident","change":"opened"}', handlers);
    assert.deepEqual(
      calls.map(([name]) => name),
      ['reading', 'fault', 'incident'],
    );
  });

  it('a type no page knows, or a message that is not a JSON object, is dropped', () => {
    const { calls, handlers } = recording();
    for (const data of ['{"type":"something-newer"}', 'not json', 'null', '42', '"firmware"', '[]']) {
      assert.doesNotThrow(() => routeStreamMessage(data, handlers), data);
    }
    assert.deepEqual(calls, []);
  });
});
