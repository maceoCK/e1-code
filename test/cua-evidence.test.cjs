'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/cua-evidence.cjs');
const { createCuaOperator } = require('../src/cua-operator.cjs');

// Captured with read-only `cua-driver describe <name>` on 2026-10-09.
// Only description/title/examples annotations are removed; every validation
// keyword, optional property, union, integer format and default is retained.
// Tests use these static fixtures and never launch the driver or a GUI.
const nativeSchemas = {
  get_window_state: {"additionalProperties":false,"properties":{"capture_mode":{"enum":["ax","vision"],"type":"string"},"include_accessibility_tree":{"type":"boolean"},"include_screenshot":{"type":"boolean"},"max_depth":{"minimum":1,"type":"integer"},"max_dimension":{"minimum":1,"type":"integer"},"max_elements":{"minimum":1,"type":"integer"},"max_image_dimension":{"minimum":0,"type":"integer"},"pid":{"type":"integer"},"query":{"type":"string"},"screenshot_out_file":{"type":"string"},"session":{"type":"string"},"timeout_ms":{"default":1000,"maximum":120000,"minimum":100,"type":"integer"},"window_id":{"type":"integer"}},"required":["pid","window_id"],"type":"object"},
  click: {"additionalProperties":false,"properties":{"action":{"type":"string"},"button":{"enum":["left","right","middle"],"type":"string"},"capture_id":{"type":"string"},"count":{"type":"integer"},"debug_image_out":{"type":"string"},"delivery_mode":{"enum":["background","foreground"],"type":"string"},"element_index":{"type":"integer"},"element_token":{"type":"string"},"from_zoom":{"type":"boolean"},"modifier":{"items":{"type":"string"},"type":"array"},"pid":{"type":"integer"},"scope":{"enum":["window","desktop"],"type":"string"},"session":{"type":"string"},"snapshot_id":{"pattern":"^s[0-9a-f]{8}$","type":"string"},"target":{"oneOf":[{"additionalProperties":true,"properties":{"kind":{"const":"window","type":"string"},"pid":{"format":"uint32","minimum":0,"type":"integer"},"window_id":{"format":"uint64","minimum":0,"type":"integer"}},"required":["kind","pid","window_id"],"type":"object"},{"additionalProperties":true,"properties":{"display_id":{"type":"string"},"kind":{"const":"desktop","type":"string"}},"required":["kind","display_id"],"type":"object"}]},"window_id":{"type":"integer"},"x":{"type":"number"},"y":{"type":"number"}},"required":[],"type":"object"},
  type_text: {"additionalProperties":false,"properties":{"delay_ms":{"maximum":200,"minimum":0,"type":"integer"},"delivery_mode":{"enum":["background","foreground"],"type":"string"},"element_index":{"type":"integer"},"element_token":{"type":"string"},"pid":{"type":"integer"},"scope":{"default":"window","enum":["window","desktop"],"type":"string"},"session":{"type":"string"},"snapshot_id":{"pattern":"^s[0-9a-f]{8}$","type":"string"},"target":{"anyOf":[{"oneOf":[{"additionalProperties":true,"properties":{"kind":{"const":"window","type":"string"},"pid":{"format":"uint32","minimum":0,"type":"integer"},"window_id":{"format":"uint64","minimum":0,"type":"integer"}},"required":["kind","pid","window_id"],"type":"object"},{"additionalProperties":true,"properties":{"display_id":{"type":"string"},"kind":{"const":"desktop","type":"string"}},"required":["kind","display_id"],"type":"object"}]},{"type":"null"}]},"text":{"type":"string"},"window_id":{"type":"integer"},"x":{"type":"number"},"y":{"type":"number"}},"required":["text"],"type":"object"},
  press_key: {"additionalProperties":false,"properties":{"delivery_mode":{"enum":["background","foreground"],"type":"string"},"element_index":{"type":"integer"},"element_token":{"type":"string"},"key":{"type":"string"},"modifiers":{"items":{"type":"string"},"type":"array"},"pid":{"type":"integer"},"scope":{"default":"window","enum":["window","desktop"],"type":"string"},"session":{"type":"string"},"snapshot_id":{"pattern":"^s[0-9a-f]{8}$","type":"string"},"target":{"anyOf":[{"oneOf":[{"additionalProperties":true,"properties":{"kind":{"const":"window","type":"string"},"pid":{"format":"uint32","minimum":0,"type":"integer"},"window_id":{"format":"uint64","minimum":0,"type":"integer"}},"required":["kind","pid","window_id"],"type":"object"},{"additionalProperties":true,"properties":{"display_id":{"type":"string"},"kind":{"const":"desktop","type":"string"}},"required":["kind","display_id"],"type":"object"}]},{"type":"null"}]},"window_id":{"type":"integer"},"x":{"type":"number"},"y":{"type":"number"}},"required":["key"],"type":"object"},
  hotkey: {"additionalProperties":false,"properties":{"delivery_mode":{"enum":["background","foreground"],"type":"string"},"element_index":{"type":"integer"},"element_token":{"type":"string"},"keys":{"items":{"type":"string"},"minItems":2,"type":"array"},"pid":{"type":"integer"},"scope":{"default":"window","enum":["window","desktop"],"type":"string"},"session":{"type":"string"},"snapshot_id":{"pattern":"^s[0-9a-f]{8}$","type":"string"},"target":{"anyOf":[{"oneOf":[{"additionalProperties":true,"properties":{"kind":{"const":"window","type":"string"},"pid":{"format":"uint32","minimum":0,"type":"integer"},"window_id":{"format":"uint64","minimum":0,"type":"integer"}},"required":["kind","pid","window_id"],"type":"object"},{"additionalProperties":true,"properties":{"display_id":{"type":"string"},"kind":{"const":"desktop","type":"string"}},"required":["kind","display_id"],"type":"object"}]},{"type":"null"}]},"window_id":{"type":"integer"},"x":{"type":"number"},"y":{"type":"number"}},"required":["keys"],"type":"object"},
  scroll: {"additionalProperties":false,"properties":{"amount":{"maximum":50,"minimum":1,"type":"integer"},"by":{"enum":["line","page"],"type":"string"},"delivery_mode":{"enum":["background","foreground"],"type":"string"},"direction":{"enum":["up","down","left","right"],"type":"string"},"element_index":{"type":"integer"},"element_token":{"type":"string"},"pid":{"type":"integer"},"scope":{"default":"window","enum":["window","desktop"],"type":"string"},"session":{"type":"string"},"snapshot_id":{"pattern":"^s[0-9a-f]{8}$","type":"string"},"target":{"anyOf":[{"oneOf":[{"additionalProperties":true,"properties":{"kind":{"const":"window","type":"string"},"pid":{"format":"uint32","minimum":0,"type":"integer"},"window_id":{"format":"uint64","minimum":0,"type":"integer"}},"required":["kind","pid","window_id"],"type":"object"},{"additionalProperties":true,"properties":{"display_id":{"type":"string"},"kind":{"const":"desktop","type":"string"}},"required":["kind","display_id"],"type":"object"}]},{"type":"null"}]},"window_id":{"type":"integer"},"x":{"type":"number"},"y":{"type":"number"}},"required":["direction"],"type":"object"},
};
const P = 'mcp__cua-driver__';
const tools = () => Object.entries(nativeSchemas).map(([name, input_schema]) => ({ name: P + name, input_schema: structuredClone(input_schema) }));
const target = { pid: 689, window_id: 49, session: 'native-schema-fixture' };
const extras = { click: {}, type_text: { text: '7' }, press_key: { key: 'return' }, hotkey: { keys: ['cmd', 'a'] }, scroll: { direction: 'down', amount: 1 } };
const customAction = 'Name:Remove from toolbar\nTarget:0x0\nSelector:(null)';
function capture(actions = ['AXRaise', customAction, 'Name:' + 'Long toolbar action label '.repeat(8) + '\nTarget:0x0\nSelector:(null)']) {
  const bytes = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bytes);
  bytes.writeUInt32BE(230, 16); bytes.writeUInt32BE(408, 20);
  const raw = { capture_id: 'capture-native-schema-fixture', ...target, snapshot_id: 's00000026', screenshot_width: 230, screenshot_height: 408,
    screenshot_frame_valid: true, screenshot_scale: 1, elements_complete: false, truncated: true,
    elements: [{ element_index: 0, element_token: 's00000026:0', role: 'AXWindow', label: 'Calculator', depth: 0,
      screenshot_frame: { x: 0, y: 0, w: 230, h: 408 }, actions },
      { element_index: 1, element_token: 's00000026:1', role: 'AXButton', label: '7', enabled: true, parent_index: 0, depth: 2,
        screenshot_frame: { x: 10, y: 183, w: 50, h: 50 }, actions: ['AXPress'] }] };
  return { messageIndex: 2, call: { type: 'tool_use', id: 'observe-native', name: E.CAPTURE, input: { ...target } },
    result: { type: 'tool_result', tool_use_id: 'observe-native', content: [{ type: 'text', text: JSON.stringify(raw) }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: bytes.toString('base64') } }] } };
}

for (const [name, schema] of Object.entries(nativeSchemas)) test(`actual ${name} schema is fully supported and advertised`, () => {
  assert.equal(E.supportedSchema(schema), true);
  assert.ok(E.toolSchemas({ tools: tools() }).has(P + name));
});

test('uint32 and uint64 formats are bounded lossless integers, not ignored annotations', () => {
  for (const [format, max] of [['uint32', 0xffffffff], ['uint64', Number.MAX_SAFE_INTEGER]]) {
    const schema = { type: 'integer', format, minimum: 0 };
    assert.equal(E.supportedSchema(schema), true);
    for (const value of [0, 1, max]) assert.equal(E.validate(schema, value), true, `${format} ${value}`);
    for (const value of [-1, 0.5, max + 1, '1', null, Infinity, NaN]) assert.equal(E.validate(schema, value), false, `${format} ${value}`);
  }
});

test('unknown formats and format/type mismatches keep native tools unavailable', () => {
  for (const format of ['uint128', 'int64', 'hostname', 'uuid', 'arbitrary', 'constructor']) {
    const declarations = tools(), click = declarations.find(t => t.name === P + 'click');
    click.input_schema.properties.target.oneOf[0].properties.pid.format = format;
    assert.equal(E.supportedSchema(click.input_schema), false, format);
    assert.equal(E.toolSchemas({ tools: declarations }).has(click.name), false, format);
    assert.equal(E.validate({ type: 'integer', format }, 1), false, format);
  }
  for (const type of ['string', 'number', ['integer', 'null']]) assert.equal(E.supportedSchema({ type, format: 'uint32' }), false);
});

test('actual schemas compile all five supported background native actions', () => {
  const schemas = E.toolSchemas({ tools: tools() }), evidence = E.captureEvidence(capture());
  assert.equal(schemas.size, 6); assert.ok(evidence);
  assert.deepEqual(E.captureRecipe(target, schemas.get(E.CAPTURE)), { ...target, include_screenshot: true, include_accessibility_tree: true });
  for (const [name, extra] of Object.entries(extras)) {
    const compiled = E.compileAction({ tool_name: P + name, input: { element_token: 's00000026:1', ...extra } }, evidence, schemas);
    assert.ok(compiled, name); assert.equal(E.validate(nativeSchemas[name], compiled.input), true, name);
    assert.equal(compiled.input.delivery_mode, 'background'); assert.equal(compiled.input.pid, target.pid); assert.equal(compiled.input.window_id, target.window_id);
    assert.equal(compiled.input.capture_id, undefined);
  }
});

test('actual target unions enforce numeric format ranges and preserve exact window scoping', () => {
  const schemas = E.toolSchemas({ tools: tools() });
  const evidence = E.captureEvidence(capture());
  const proposal = { tool_name: P + 'click', input: { element_token: 's00000026:1', target: { kind: 'window', pid: target.pid, window_id: target.window_id } } };
  assert.ok(E.compileAction(proposal, evidence, schemas));
  for (const bad of [{ kind: 'desktop', display_id: 'primary' }, { kind: 'window', pid: 0x100000000, window_id: 49 }, { kind: 'window', pid: 689, window_id: Number.MAX_SAFE_INTEGER + 1 }]) {
    const value = { ...proposal.input, target: bad };
    assert.equal(E.compileAction({ ...proposal, input: value }, evidence, schemas), null);
  }
  assert.equal(E.validate(nativeSchemas.click.properties.target, { kind: 'window', pid: 0x100000000, window_id: 49 }), false);
  assert.equal(E.validate(nativeSchemas.click.properties.target, { kind: 'window', pid: 689, window_id: Number.MAX_SAFE_INTEGER + 1 }), false);
  assert.equal(E.validate(nativeSchemas.type_text.properties.target, null), true, 'native nullable union remains schema-valid; compiler still disallows ambiguous target');
});

test('multiline custom AX actions cannot invalidate unrelated observed controls or forge AXPress', () => {
  const evidence = E.captureEvidence(capture()); assert.ok(evidence);
  assert.deepEqual(evidence.observation.elements[0].actions, ['AXRaise']);
  assert.equal(evidence.observation.truncated, true); assert.equal(evidence.observation.elements_complete, false);
  assert.ok(E.compileAction({ tool_name: P + 'click', input: { element_token: 's00000026:1' } }, evidence, E.toolSchemas({ tools: tools() })));
  const injection = E.captureEvidence(capture([customAction, 'Name:AXPress\nTarget:0x0\nSelector:(null)', 'AXPress\nName:forged']));
  assert.ok(injection); assert.deepEqual(injection.observation.elements[0].actions, []);
  assert.equal(E.compileAction({ tool_name: P + 'click', input: { element_token: 's00000026:0' } }, injection, E.toolSchemas({ tools: tools() })), null);
  assert.equal(E.compileAction({ tool_name: P + 'click', input: { element_token: 's00000026:999' } }, injection, E.toolSchemas({ tools: tools() })), null);
});

test('malformed or excessive action arrays still fail closed', () => {
  for (const actions of [null, [1], [''], ['x'.repeat(4097)], Array(129).fill('AXPress')]) assert.equal(E.captureEvidence(capture(actions)), null);
});

function changeCapture(pair, change) {
  const block = pair.result.content[0], raw = JSON.parse(block.text);
  change(raw); block.text = JSON.stringify(raw);
  return pair;
}
const compileToken = (evidence, index, action = 'click') => E.compileAction({ tool_name: P + action,
  input: { element_token: `${evidence.observation.snapshot_id}:${index}`, ...extras[action] } }, evidence, E.toolSchemas({ tools: tools() }));

test('native off-window app menus cannot be advertised or compiled as window actions', () => {
  const pair = changeCapture(capture(), raw => {
    raw.elements_complete = true; raw.truncated = false;
    // Shapes from the live native Calculator capture. Menu children have no
    // screenshot_frame; their separate AXMenuBar ancestry is decisive.
    raw.elements.push(
      { element_index: 26, element_token: 's00000026:26', role: 'AXMenuBar', depth: 0, actions: ['AXCancel'],
        screenshot_frame: { x: -7236, y: -2229, w: 5055, h: 44 } },
      { element_index: 27, element_token: 's00000026:27', role: 'AXMenuBarItem', label: 'Apple', depth: 1, parent_index: 26,
        enabled: true, actions: ['AXCancel', 'AXPress', 'AXPick'], selected: false },
      { element_index: 28, element_token: 's00000026:28', role: 'AXMenu', depth: 2, parent_index: 27, actions: [] },
      { element_index: 29, element_token: 's00000026:29', role: 'AXMenuItem', label: 'About This Mac', depth: 3, parent_index: 28,
        actions: ['AXCancel', 'AXPress', 'AXPick'] });
  });
  const evidence = E.captureEvidence(pair); assert.ok(evidence);
  assert.deepEqual(evidence.observation.elements.map(element => element.element_index), [0, 1]);
  assert.equal(evidence.observation.elements_complete, false, 'filtered metadata must not claim completeness');
  assert.ok(compileToken(evidence, 1));
  for (const index of [26, 27, 28, 29]) for (const action of Object.keys(extras)) assert.equal(compileToken(evidence, index, action), null, `${index} ${action}`);
  assert.equal(E.compileAction({ tool_name: P + 'click', input: { element_index: 29, snapshot_id: 's00000026' } }, evidence, E.toolSchemas({ tools: tools() })), null);
  assert.equal(JSON.stringify(evidence.observation).includes('screenshot_frame'), false);
  assert.equal(JSON.stringify(evidence.observation).includes('parent_index'), false);
});

test('ambiguous, orphaned, cyclic and off-screen semantic targets fail closed', () => {
  for (const change of [
    raw => { delete raw.elements[0].depth; },
    raw => { raw.elements[0].parent_index = 1; },
    raw => { raw.elements[0].role = 'AXApplication'; },
    raw => { raw.elements.push({ ...raw.elements[0], element_index: 2, element_token: 's00000026:2' }); },
    raw => { delete raw.elements[1].parent_index; },
    raw => { raw.elements[1].parent_index = null; },
    raw => { raw.elements[1].parent_index = 99; },
    raw => { raw.elements[1].parent_index = '0'; },
    raw => { raw.elements[1].parent_index = 1; },
    raw => { delete raw.elements[1].depth; },
    raw => { raw.elements[1].depth = 0; },
    raw => { raw.elements[1].depth = 1.5; },
    raw => { raw.elements[1].screenshot_frame = { x: 231, y: 0, w: 20, h: 20 }; },
    raw => { raw.elements[1].screenshot_frame = { x: -21, y: 0, w: 20, h: 20 }; },
    raw => { raw.elements[1].screenshot_frame = { x: 0, y: 409, w: 20, h: 20 }; },
    raw => { raw.elements[1].screenshot_frame = { x: 0, y: 0, w: 0, h: 20 }; },
    raw => { raw.elements[1].screenshot_frame = null; },
    raw => {
      raw.elements[1].parent_index = 2;
      raw.elements.push({ element_index: 2, element_token: 's00000026:2', role: 'AXGroup', depth: 1, parent_index: 1 });
    },
    raw => {
      raw.elements[1].parent_index = 2;
      raw.elements.push({ element_index: 2, element_token: 's00000026:2', role: 'AXWindow', depth: 1, parent_index: 0 });
    },
    raw => {
      raw.elements[1].parent_index = 2;
      raw.elements.push({ element_index: 2, element_token: 's00000026:2', role: 'AXMenuBar', depth: 1, parent_index: 0 });
    },
  ]) {
    const evidence = E.captureEvidence(changeCapture(capture(), change)); assert.ok(evidence, change.toString());
    for (const action of Object.keys(extras)) assert.equal(compileToken(evidence, 1, action), null, `${action}: ${change}`);
    assert.ok(E.compileAction({ tool_name: P + 'click', input: { x: 15, y: 190 } }, evidence, E.toolSchemas({ tools: tools() })), 'fresh screenshot still supports grounded pixel actions');
  }
});

test('native nearest-actionable-parent depth gaps work without deriving pixels from AX frames', () => {
  const pair = changeCapture(capture(), raw => {
    raw.elements[0].parent_index = null;
    raw.elements[1].parent_index = 2; raw.elements[1].depth = 5;
    delete raw.elements[1].screenshot_frame;
    raw.elements[1].frame = { x: -9999, y: -9999, w: 50, h: 50 };
    raw.elements.push({ element_index: 2, element_token: 's00000026:2', role: 'AXGroup', depth: 2, parent_index: 0 });
  });
  const evidence = E.captureEvidence(pair); assert.ok(evidence);
  assert.ok(compileToken(evidence, 1));
  assert.equal(JSON.stringify(evidence.observation).includes('frame'), false);
  assert.equal(compileToken(evidence, 1).input.x, undefined);
});

test('successful observation JSON labels and tree text are never classified as tool failures', () => {
  for (const word of ['Error: calculation', 'request refused', 'cancelled', 'canceled', 'Permission denied', 'not authorized']) {
    const pair = changeCapture(capture(), raw => {
      raw.elements[1].label = word; raw.elements[1].value = word; raw.tree_markdown = `AXButton ${word}`;
    });
    assert.equal(E.failedResult(pair.result), false, word);
    const evidence = E.captureEvidence(pair); assert.ok(evidence, word); assert.ok(compileToken(evidence, 1), word);
    const raw = JSON.parse(pair.result.content[0].text);
    assert.equal(E.failedResult({ content: JSON.stringify(raw) }), false, 'string JSON also uses explicit status fields');
    pair.result.content[0].text = JSON.stringify({ structuredContent: raw });
    assert.equal(E.failedResult(pair.result), false); assert.ok(E.captureEvidence(pair));
    pair.result.structuredContent = raw; pair.result.content.shift();
    assert.equal(E.failedResult(pair.result), false); assert.ok(E.captureEvidence(pair));
  }
});

test('explicit failure fields and separate denial prose still reject observation-shaped payloads', () => {
  for (const fields of [{ is_error: true }, { isError: true }, { error: 'fixture' }, { success: false }, { ok: false },
    { status: 'refused' }, { effect: 'denied' }, { outcome: 'cancelled' }, { classification: 'blocked' }, { code: 'error' }]) {
    const pair = changeCapture(capture(), raw => Object.assign(raw, fields));
    assert.equal(E.failedResult(pair.result), true, JSON.stringify(fields)); assert.equal(E.captureEvidence(pair), null);
    const raw = JSON.parse(pair.result.content[0].text);
    assert.equal(E.failedResult({ content: JSON.stringify(raw) }), true);
    pair.result.content[0].text = JSON.stringify({ structuredContent: raw });
    assert.equal(E.failedResult(pair.result), true);
    const envelope = capture(); Object.assign(envelope.result, fields);
    assert.equal(E.failedResult(envelope.result), true, 'explicit native envelope failure');
  }
  for (const text of ['Permission denied.', 'Tool use cancelled by user.', 'Action refused.', 'Error: request failed.']) {
    const pair = capture(); pair.result.content.push({ type: 'text', text });
    assert.equal(E.failedResult(pair.result), true, text); assert.equal(E.captureEvidence(pair), null);
  }
});

test('operator prepares and compiles each action using actual native declarations', async () => {
  for (const [name, extra] of Object.entries(extras)) {
    const pair = capture(), body = { model: 'planner-route', tools: tools(), messages: [
      { role: 'user', content: 'Operate the observed calculator.' }, { role: 'assistant', content: [pair.call] }, { role: 'user', content: [pair.result] },
    ] };
    const primary = { id: 'planner-route', provider: 'primary', model: 'abliterated', meta: { vision: false } };
    const luna = { id: 'luna-route', provider: 'luna', model: 'gpt-6-luna', meta: { vision: true } };
    const providers = [{ id: 'primary', protocol: 'chat', baseUrl: 'https://primary.example.test' }, { id: 'luna', protocol: 'responses', baseUrl: 'https://api.openai.com/v1' }];
    const operator = createCuaOperator({ store: { data: { routing: { allowApiFallback: true } }, provider: id => providers.find(p => p.id === id), key: async () => 'fixture' },
      transport: async () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ outcome: 'action', tool_name: P + name, input: { ...extra, element_token: 's00000026:1' } }) }] })),
      requestFor: body => ({ url: 'https://fixture.example.test', body }), responseFor: result => result, relay: () => { throw Error('unexpected stream'); } });
    const prepared = await operator.prepare(body, primary, [luna], new AbortController().signal);
    assert.equal(prepared.buffer, true, name); assert.ok(prepared.body.tools.some(t => t.name === 'E1CuaStep'), name);
    const result = await prepared.resolve({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'E1CuaStep', id: 'virtual', input: { goal: 'Use one observed control.', observation_tool_use_id: pair.call.id, expected_outcome: 'The control visibly changes.' } }] });
    assert.equal(result.content[0].type, 'tool_use', JSON.stringify(result)); assert.equal(result.content[0].name, P + name);
  }
});
