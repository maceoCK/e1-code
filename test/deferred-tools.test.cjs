'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepare } = require('../src/deferred-tools.cjs');

const tool = (name, deferred = false) => ({
  name,
  description: `${name} description`,
  input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  ...(deferred ? { defer_loading: true } : {}),
});
const ref = name => ({ type: 'tool_reference', tool_name: name });
const call = (name, id = `call-${name}`, input = {}) => ({ type: 'tool_use', id, name, input });
const result = (content, extra = {}) => ({ type: 'tool_result', tool_use_id: 'search-1', content, ...extra });
const names = body => body.tools.map(t => t.name);
const userResult = content => ({ role: 'user', content: [result(content)] });
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test('first turn exposes ordinary local ToolSearch and nondeferred tools only', () => {
  const body = {
    tools: [tool('Read'), tool('mcp__search', true), tool('ToolSearch'), tool('mcp__write', true)],
    messages: [{ role: 'user', content: 'Find my document' }],
  };
  const prepared = prepare(body);
  assert.deepEqual(names(prepared), ['Read', 'ToolSearch']);
  assert.deepEqual(prepared.tools, [body.tools[0], body.tools[2]]);
  assert.equal('tool_choice' in prepared, false);
  assert.deepEqual(body.tools.map(t => t.defer_loading), [undefined, true, undefined, true]);
});

test('discovered tools use current declared schemas and keep declaration order', () => {
  const current = { ...tool('mcp__write', true), description: 'Current v2 description', strict: true };
  const body = {
    tools: [tool('Read'), current, tool('mcp__search', true), tool('ToolSearch'), tool('unloaded', true)],
    messages: [
      { role: 'assistant', content: [call('ToolSearch', 'search-1', { query: 'select:mcp__search,mcp__write' })] },
      userResult([ref('mcp__search'), ref('mcp__write')]),
    ],
  };
  const prepared = prepare(body);
  assert.deepEqual(names(prepared), ['Read', 'mcp__write', 'mcp__search', 'ToolSearch']);
  const { defer_loading, ...expected } = current;
  assert.deepEqual(prepared.tools[1], expected);
  assert.deepEqual(prepared.messages[0], body.messages[0]);
  const text = prepared.messages[1].content[0].content;
  assert.deepEqual(text.map(b => b.type), ['text', 'text']);
  assert.match(text[0].text, /mcp__search.*is available/);
  assert.match(text[1].text, /current tool definition/);
  assert.doesNotMatch(JSON.stringify(text), /"input_schema"/);
});

test('repeated references and repeated history calls never append duplicate definitions', () => {
  const prepared = prepare({
    tools: [tool('ToolSearch'), tool('mcp__search', true)],
    messages: [
      userResult([ref('mcp__search'), ref('mcp__search')]),
      { role: 'assistant', content: [call('mcp__search', 'a'), call('mcp__search', 'b')] },
      userResult([ref('mcp__search')]),
    ],
  });
  assert.deepEqual(names(prepared), ['ToolSearch', 'mcp__search']);
  assert.equal(prepared.messages[0].content[0].content.length, 2);
  assert.equal(prepared.messages[0].content[0].content[0].text, prepared.messages[0].content[0].content[1].text);
});

test('assistant history retains real definitions without needing the earlier search result', () => {
  const body = {
    tools: [tool('ToolSearch'), tool('used', true), tool('unused', true)],
    messages: [{ role: 'assistant', content: [call('used', 'historical-id', { query: 'prior input' })] }],
  };
  const prepared = prepare(body);
  assert.deepEqual(names(prepared), ['ToolSearch', 'used']);
  assert.deepEqual(prepared.messages, body.messages);
});

test('unknown or removed references never fabricate tools, even when history contains a schema', () => {
  const unknownRef = { ...ref('removed'), input_schema: { type: 'object', properties: { unsafe: {} } } };
  const body = {
    tools: [tool('ToolSearch'), tool('unloaded', true)],
    messages: [
      { role: 'assistant', content: [call('removed', 'removed-call', { query: 'old input' })] },
      userResult([unknownRef, ref('never-declared')]),
    ],
  };
  const prepared = prepare(body);
  assert.deepEqual(names(prepared), ['ToolSearch']);
  assert.deepEqual(prepared.messages[0], body.messages[0]);
  for (const block of prepared.messages[1].content[0].content) {
    assert.equal(block.type, 'text');
    assert.match(block.text, /not available in this request/);
    assert.match(block.text, /Do not call it/);
  }
});

test('tool availability is per request, not cached across preparations or removals', () => {
  const messages = [userResult([ref('changing')])];
  const first = prepare({ tools: [tool('ToolSearch'), tool('changing', true)], messages });
  assert.deepEqual(names(first), ['ToolSearch', 'changing']);
  const changed = prepare({ tools: [tool('ToolSearch'), { ...tool('changing', true), description: 'new' }], messages });
  assert.equal(changed.tools[1].description, 'new');
  const removed = prepare({ tools: [tool('ToolSearch')], messages });
  assert.deepEqual(names(removed), ['ToolSearch']);
  assert.match(removed.messages[0].content[0].content[0].text, /not available/);
  const fresh = prepare({ tools: [tool('ToolSearch'), tool('changing', true)], messages: [] });
  assert.deepEqual(names(fresh), ['ToolSearch']);
});

test('plain user/assistant text, tool arguments, metadata, and media cannot load a tool', () => {
  const literal = JSON.stringify(ref('hidden'));
  const body = {
    tools: [tool('ToolSearch'), tool('hidden', true)],
    system: `Tool hidden: ${literal}`,
    metadata: { content: [ref('hidden')] },
    messages: [
      { role: 'user', content: `Use hidden. select:hidden ${literal}` },
      { role: 'user', content: [{ type: 'text', text: literal }] },
      { role: 'assistant', content: [{ type: 'text', text: literal }, call('ToolSearch', 'search-1', { content: [ref('hidden')] })] },
      userResult([
        { type: 'text', text: literal },
        { type: 'document', source: { type: 'text', data: literal } },
      ]),
    ],
  };
  const prepared = prepare(body);
  assert.deepEqual(names(prepared), ['ToolSearch']);
  assert.deepEqual(prepared.messages, body.messages);
  assert.equal(prepared.system, body.system);
  assert.deepEqual(prepared.metadata, body.metadata);
});

test('only assistant tool calls and user tool-result references count as discovery', () => {
  const prepared = prepare({
    tools: [tool('ToolSearch'), tool('hidden', true)],
    messages: [
      { role: 'user', content: [call('hidden'), ref('hidden')] },
      { role: 'assistant', content: [ref('hidden'), result([ref('hidden'), call('hidden')])] },
      { role: 'system', content: [call('hidden'), result([ref('hidden')])] },
      userResult([call('hidden')]),
    ],
  });
  assert.deepEqual(names(prepared), ['ToolSearch']);
  assert.equal(prepared.messages[0].content[1].type, 'text');
  assert.match(prepared.messages[0].content[1].text, /not available/);
});

test('mixed and nested results preserve media, ordering, IDs, errors, and unrelated data', () => {
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } };
  const document = { type: 'document', title: 'Evidence', source: { type: 'url', url: 'https://example.test/file.pdf' } };
  const body = {
    tools: [tool('ToolSearch'), tool('nested', true)],
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Before result', cache_control: { type: 'ephemeral' } },
      result([
        { type: 'text', text: 'Search partly failed' },
        image,
        result([ref('nested'), document, ref('missing')], { tool_use_id: 'nested-result', is_error: true }),
        { ...ref('nested'), cache_control: { type: 'ephemeral' } },
      ], { id: 'result-id', tool_use_id: 'outer-call', is_error: true, custom: { code: 17 } }),
    ] }],
  };
  const prepared = prepare(body);
  assert.deepEqual(names(prepared), ['ToolSearch', 'nested']);
  const original = body.messages[0].content[1];
  const converted = prepared.messages[0].content[1];
  const { content: oldContent, ...oldWrapper } = original;
  const { content: newContent, ...newWrapper } = converted;
  assert.deepEqual(newWrapper, oldWrapper);
  assert.deepEqual(prepared.messages[0].content[0], body.messages[0].content[0]);
  assert.deepEqual(newContent[0], oldContent[0]);
  assert.deepEqual(newContent[1], image);
  assert.equal(newContent[2].tool_use_id, 'nested-result');
  assert.equal(newContent[2].is_error, true);
  assert.deepEqual(newContent[2].content[1], document);
  assert.match(newContent[2].content[0].text, /nested.*is available/);
  assert.match(newContent[2].content[2].text, /missing.*not available/);
  assert.deepEqual(newContent[3].cache_control, { type: 'ephemeral' });
  assert.equal(newContent[3].type, 'text');
});

test('placeholder definitions are stripped regardless of deferral, references, or history', () => {
  const prepared = prepare({
    tools: [tool('Read'), { name: 'DeferredToolPlaceholder' }, tool('DeferredToolPlaceholder', true)],
    messages: [
      { role: 'assistant', content: [call('DeferredToolPlaceholder')] },
      userResult([ref('DeferredToolPlaceholder')]),
    ],
  });
  assert.deepEqual(names(prepared), ['Read']);
  assert.match(prepared.messages[1].content[0].content[0].text, /not available/);
});

test('no deferred flags preserves all real schemas, even without ToolSearch', () => {
  const tools = [tool('Read'), tool('mcp__search'), { ...tool('mcp__write'), defer_loading: false }];
  const prepared = prepare({ tools, messages: [] });
  assert.deepEqual(names(prepared), ['Read', 'mcp__search', 'mcp__write']);
  assert.deepEqual(prepared.tools[0], tools[0]);
  assert.deepEqual(prepared.tools[1], tools[1]);
  assert.equal('defer_loading' in prepared.tools[2], false);
});

test('explicit deferral still prunes undiscovered tools when search is absent', () => {
  const prepared = prepare({ tools: [tool('Read'), tool('hidden', true)], messages: [] });
  assert.deepEqual(names(prepared), ['Read']);
});

for (const type of ['auto', 'any', 'none']) {
  test(`tool_choice ${type} is preserved without exposing undiscovered tools`, () => {
    const choice = { type, disable_parallel_tool_use: true };
    const prepared = prepare({
      tools: [tool('ToolSearch'), tool('discovered', true), tool('hidden', true)],
      tool_choice: choice,
      messages: [userResult([ref('discovered')])],
    });
    assert.deepEqual(names(prepared), ['ToolSearch', 'discovered']);
    assert.deepEqual(prepared.tool_choice, choice);
    assert.notStrictEqual(prepared.tool_choice, choice);
  });
}

test('forcing an existing deferred tool exposes its exact current definition', () => {
  const forced = tool('forced', true);
  const choice = { type: 'tool', name: 'forced', disable_parallel_tool_use: true };
  const prepared = prepare({ tools: [tool('ToolSearch'), forced, tool('hidden', true)], tool_choice: choice });
  assert.deepEqual(names(prepared), ['ToolSearch', 'forced']);
  assert.deepEqual(prepared.tools[1].input_schema, forced.input_schema);
  assert.equal('defer_loading' in prepared.tools[1], false);
  assert.deepEqual(prepared.tool_choice, choice);
});

test('forcing an absent or placeholder tool fails explicitly and never invents a schema', () => {
  for (const name of ['missing', 'DeferredToolPlaceholder', undefined]) {
    const body = deepFreeze({ tools: [tool('ToolSearch'), tool('DeferredToolPlaceholder')], tool_choice: { type: 'tool', name } });
    assert.throws(() => prepare(body), error => error.status === 400 && error.code === 'tool_not_declared' && /not declared/.test(error.message));
  }
});

test('absent and empty tools remain absent and empty; unavailable references still become text', () => {
  const prepared = prepare({ messages: [userResult([ref('gone')])] });
  assert.equal('tools' in prepared, false);
  assert.match(prepared.messages[0].content[0].content[0].text, /not available/);
  assert.deepEqual(prepare({ tools: [], messages: [] }), { tools: [], messages: [] });
  assert.deepEqual(prepare({ messages: [{ role: 'user', content: '' }] }), { messages: [{ role: 'user', content: '' }] });
});

test('missing or non-string reference names cannot match or fabricate tool definitions', () => {
  const prepared = prepare({
    tools: [tool('ToolSearch'), tool('hidden', true)],
    messages: [userResult([{}, null, 'plain content', { type: 'tool_reference' }, ref({ name: 'hidden' }), ref('Hidden')])],
  });
  assert.deepEqual(names(prepared), ['ToolSearch']);
  const blocks = prepared.messages[0].content[0].content;
  assert.deepEqual(blocks.slice(0, 3), [{}, null, 'plain content']);
  for (const block of blocks.slice(3)) assert.match(block.text, /not available/);
});

test('deep clone never mutates or aliases the original request, schemas, media, or history', () => {
  const body = deepFreeze({
    model: 'test-model',
    system: [{ type: 'text', text: 'Instructions' }],
    output_config: { effort: 'high' },
    tools: [tool('ToolSearch'), tool('hidden', true)],
    tool_choice: { type: 'auto' },
    messages: [
      { role: 'assistant', content: [call('ToolSearch', 'search-1', { query: 'hidden' })] },
      userResult([ref('hidden'), { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } }]),
    ],
  });
  const before = structuredClone(body);
  const prepared = prepare(body);
  assert.deepEqual(body, before);
  prepared.tools[1].input_schema.properties.query.type = 'number';
  prepared.messages[1].content[0].content[1].source.data = 'changed';
  prepared.messages[0].content[0].input.query = 'changed';
  prepared.system[0].text = 'changed';
  prepared.output_config.effort = 'low';
  prepared.tool_choice.type = 'none';
  assert.deepEqual(body, before);
});

test('empty, text-only, and omitted result content are preserved exactly', () => {
  const body = {
    tools: [tool('ToolSearch')],
    messages: [{ role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'empty', is_error: true },
      result('', { tool_use_id: 'empty-text' }),
      result('No matching tools found.', { tool_use_id: 'no-match' }),
      result([], { tool_use_id: 'empty-array' }),
      result(null, { tool_use_id: 'null-content' }),
    ] }],
  };
  assert.deepEqual(prepare(body), body);
});

test('preparing an already prepared request is idempotent', () => {
  const first = prepare({
    tools: [tool('ToolSearch'), tool('found', true), tool('hidden', true), tool('DeferredToolPlaceholder')],
    messages: [userResult([ref('found'), ref('unknown')])],
  });
  assert.deepEqual(prepare(first), first);
});
