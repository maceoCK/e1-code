const { test } = require('node:test');
const assert = require('node:assert/strict');
const { responseFor } = require('../src/gateway.cjs');
const { relay } = require('../src/gateway-stream.cjs');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PATCHES, patchText } = require('../scripts/install-cua-operator.cjs');

const terminalData = (protocol, state, tool) => protocol === 'responses'
  ? { status: state, output: tool
    ? [{ type: 'function_call', call_id: 'step', name: 'E1CuaStep', arguments: '{}' }]
    : [{ type: 'message', content: [{ type: 'output_text', text: '{"action":"click"}' }] }] }
  : { choices: [{ finish_reason: state, message: tool
    ? { tool_calls: [{ id: 'step', function: { name: 'E1CuaStep', arguments: '{}' } }] }
    : { content: '{"action":"click"}' } }] };
const streamContent = (protocol, tool) => protocol === 'responses'
  ? tool
    ? { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'step', name: 'E1CuaStep', arguments: '{}' } }
    : { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '{"action":"click"}' }
  : { choices: [{ delta: tool
    ? { tool_calls: [{ index: 0, id: 'step', function: { name: 'E1CuaStep', arguments: '{}' } }] }
    : { content: '{"action":"click"}' } }] };
const streamRun = (protocol, events) => {
  const chunks = [];
  const result = relay(new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')),
    protocol, 'text-only', { write: c => chunks.push(c), end() {} });
  return { result, chunks };
};

for (const protocol of ['chat', 'ollama', 'responses']) {
  for (const tool of [false, true]) {
    test(`${protocol} JSON rejects filtered, cancelled, nonfinal and unknown ${tool ? 'E1CuaStep' : 'helper text'} completion`, () => {
      const invalid = ['content_filter', 'cancelled', 'canceled', 'queued', 'in_progress', 'failed', 'unexpected', '', null, undefined];
      for (const state of invalid)
        assert.throws(() => responseFor(terminalData(protocol, state, tool), protocol, 'text-only'),
          /unsupported completion state|content policy|Provider failed/, String(state));
    });
    test(`${protocol} SSE rejects non-completing ${tool ? 'E1CuaStep' : 'helper text'} terminal states`, async () => {
      const invalid = ['content_filter', 'cancelled', 'canceled', 'queued', 'in_progress', 'failed', 'unexpected', '', null, undefined];
      for (const state of invalid) {
        const end = protocol === 'responses'
          ? { type: `response.${state}`, response: { status: state, usage: {} } }
          : { choices: [{ finish_reason: state, delta: {} }] };
        const run = streamRun(protocol, [streamContent(protocol, tool), end]);
        await assert.rejects(run.result, /unsupported completion state|content policy|before completion|Provider stream failed/, String(state));
        assert.doesNotMatch(run.chunks.join(''), /event: message_stop|"stop_reason":"tool_use"/);
      }
    });
    test(`${protocol} valid text/tool and length completion remain aligned between JSON and SSE`, async () => {
      const valid = protocol === 'responses' ? ['completed', 'incomplete'] : ['stop', 'tool_calls', 'length'];
      for (const state of valid) {
        const expected = ['length', 'incomplete'].includes(state) ? 'max_tokens' : tool ? 'tool_use' : 'end_turn';
        assert.equal(responseFor(terminalData(protocol, state, tool), protocol, 'text-only').stop_reason, expected);
        const end = protocol === 'responses'
          ? { type: `response.${state}`, response: { status: state, usage: {} } }
          : { choices: [{ finish_reason: state, delta: {} }] };
        assert.equal((await streamRun(protocol, [streamContent(protocol, tool), end]).result).stop_reason, expected);
      }
    });
  }

  for (const truncated of [false, true]) {
    test(`${protocol} JSON preserves ${truncated ? 'truncated' : 'completed'} tool-call status`, () => {
      const data = protocol === 'responses'
        ? { status: truncated ? 'incomplete' : 'completed', output: [{ type: 'function_call', call_id: 'call-1', name: 'E1CuaStep', arguments: '{}' }] }
        : { choices: [{ finish_reason: truncated ? 'length' : 'tool_calls', message: { tool_calls: [{ id: 'call-1', function: { name: 'E1CuaStep', arguments: '{}' } }] } }] };
      const result = responseFor(data, protocol, 'text-only');
      assert.equal(result.stop_reason, truncated ? 'max_tokens' : 'tool_use');
    });
    test(`${protocol} SSE preserves ${truncated ? 'truncated' : 'completed'} tool-call status`, async () => {
      const events = protocol === 'responses'
        ? [
            { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'call-1', name: 'E1CuaStep', arguments: '{}' } },
            { type: truncated ? 'response.incomplete' : 'response.completed', response: { usage: {} } },
          ]
        : [
            { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'E1CuaStep', arguments: '{}' } }] } }] },
            { choices: [{ finish_reason: truncated ? 'length' : 'tool_calls', delta: {} }] },
          ];
      const upstream = new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
      const chunks = [];
      const result = await relay(upstream, protocol, 'text-only', { write: c => chunks.push(c), end() {} });
      assert.equal(result.stop_reason, truncated ? 'max_tokens' : 'tool_use');
      assert.match(chunks.join(''), new RegExp(`"stop_reason":"${result.stop_reason}"`));
    });
  }
}

for (const type of ['response.completed', 'response.incomplete']) {
  test(`${type} cannot disguise a filtered, cancelled, nonfinal, unknown or contradictory payload status`, async () => {
    for (const status of ['content_filter', 'cancelled', 'canceled', 'queued', 'in_progress', 'unexpected', '', null,
      type === 'response.completed' ? 'incomplete' : 'completed']) {
      const run = streamRun('responses', [streamContent('responses', true), { type, response: { status, usage: {} } }]);
      await assert.rejects(run.result, /unsupported completion state/, String(status));
      assert.doesNotMatch(run.chunks.join(''), /event: message_stop|"stop_reason":"tool_use"/);
    }
  });
}

test('explicit cancellation is not ignored before a later completion event', async () => {
  for (const type of ['response.cancelled', 'response.canceled']) {
    const run = streamRun('responses', [streamContent('responses', true), { type },
      { type: 'response.completed', response: { usage: {} } }]);
    await assert.rejects(run.result, /unsupported completion state/);
  }
});

test('queued and in-progress Responses events are allowed only before a valid terminal event', async () => {
  const events = [
    { type: 'response.created', response: { status: 'queued', usage: {} } },
    { type: 'response.in_progress', response: { status: 'in_progress' } },
    streamContent('responses', false),
    { type: 'response.completed', response: { status: 'completed', usage: {} } },
  ];
  assert.equal((await streamRun('responses', events).result).stop_reason, 'end_turn');
});

test('completion edits remain exactly reproducible from the reviewed installer anchors', () => {
  for (const name of ['gateway.cjs', 'gateway-stream.cjs']) {
    const source = readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
    let baseline = source;
    for (const [old, replacement] of PATCHES[name]) {
      assert.equal(source.split(replacement).length - 1, 1, `${name}: replacement drift`);
      baseline = baseline.replace(replacement, () => old);
    }
    assert.equal(patchText(baseline, name), source);
  }
});
