'use strict';
const crypto = require('node:crypto');
const PREFIX = 'mcp__cua-driver__';
const CAPTURE = PREFIX + 'get_window_state';
const ACTIONS = ['click', 'type_text', 'press_key', 'hotkey', 'scroll'].map(name => PREFIX + name);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const short = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max;
const positive = value => Number.isSafeInteger(value) && value > 0;
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const hash = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');

// A deliberately small JSON Schema interpreter. Unsupported assertions make a
// tool unavailable, rather than silently weakening its advertised contract.
const annotations = new Set(['title', 'description', 'default', 'examples', 'deprecated', '$schema', '$id', 'readOnly', 'writeOnly']);
const assertions = new Set(['type', 'format', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'anyOf', 'oneOf', 'allOf', 'not',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties']);
const types = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']);
// Actual driver schemas use these Rust integer formats inside target unions.
// uint64 is intentionally limited to lossless JSON/JS integers, not rounded IDs.
const integerFormats = { uint32: 0xffffffff, uint64: Number.MAX_SAFE_INTEGER };
function supportedSchema(schema, budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 2000 || depth > 24) return false;
  if (typeof schema === 'boolean') return true;
  if (!object(schema)) return false;
  for (const [key, value] of Object.entries(schema)) {
    if (annotations.has(key)) continue;
    if (!assertions.has(key)) return false;
    if (key === 'type' && !(Array.isArray(value) ? value.length && value.every(v => types.has(v)) : types.has(value))) return false;
    if (key === 'format' && (typeof value !== 'string' || !own(integerFormats, value) || schema.type !== 'integer')) return false;
    if (key === 'properties' && (!object(value) || Object.values(value).some(s => !supportedSchema(s, budget, depth + 1)))) return false;
    if (['items', 'additionalProperties', 'not'].includes(key) && !supportedSchema(value, budget, depth + 1)) return false;
    if (['anyOf', 'oneOf', 'allOf'].includes(key) && (!Array.isArray(value) || !value.length || value.some(s => !supportedSchema(s, budget, depth + 1)))) return false;
    if (key === 'required' && (!Array.isArray(value) || !value.every(v => typeof v === 'string') || new Set(value).size !== value.length)) return false;
    if (key === 'enum' && (!Array.isArray(value) || !value.length)) return false;
    if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'].includes(key) && !Number.isFinite(value)) return false;
    if (['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties'].includes(key) && (!Number.isSafeInteger(value) || value < 0)) return false;
    if (key === 'uniqueItems' && typeof value !== 'boolean') return false;
    if (key === 'pattern') {
      // Bound regex work as well as the containing provider prompt.
      if (typeof value !== 'string' || value.length > 256 || /[()|]|\\[1-9]/.test(value) || (value.match(/[*+?{]/g) || []).length > 1) return false;
      try { new RegExp(value, 'u'); } catch { return false; }
    }
  }
  return true;
}
function validate(schema, value) {
  if (typeof schema === 'boolean') return schema;
  const typeMatches = type => type === 'null' ? value === null : type === 'object' ? object(value) : type === 'array' ? Array.isArray(value)
    : type === 'integer' ? Number.isSafeInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type;
  if (schema.type && !(Array.isArray(schema.type) ? schema.type.some(typeMatches) : typeMatches(schema.type))) return false;
  if (schema.format !== undefined && (!own(integerFormats, schema.format) || schema.type !== 'integer' || !Number.isSafeInteger(value) || value < 0 || value > integerFormats[schema.format])) return false;
  if (schema.enum && !schema.enum.some(v => canonical(v) === canonical(value))) return false;
  if (own(schema, 'const') && canonical(schema.const) !== canonical(value)) return false;
  if (schema.anyOf && !schema.anyOf.some(s => validate(s, value))) return false;
  if (schema.oneOf && schema.oneOf.filter(s => validate(s, value)).length !== 1) return false;
  if (schema.allOf && !schema.allOf.every(s => validate(s, value))) return false;
  if (schema.not !== undefined && validate(schema.not, value)) return false;
  if (typeof value === 'number') {
    for (const [key, compare] of [['minimum', v => value >= v], ['maximum', v => value <= v], ['exclusiveMinimum', v => value > v], ['exclusiveMaximum', v => value < v]])
      if (own(schema, key) && !compare(schema[key])) return false;
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity)) return false;
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return false;
  }
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return false;
    if (schema.uniqueItems && new Set(value.map(canonical)).size !== value.length) return false;
    if (schema.items !== undefined && !value.every(v => validate(schema.items, v))) return false;
  }
  if (object(value)) {
    const keys = Object.keys(value);
    if (keys.some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) return false;
    if (keys.length < (schema.minProperties ?? 0) || keys.length > (schema.maxProperties ?? Infinity)) return false;
    if ((schema.required || []).some(k => !own(value, k))) return false;
    for (const key of keys) {
      if (own(schema.properties || {}, key)) { if (!validate(schema.properties[key], value[key])) return false; }
      else if (schema.additionalProperties === false || (object(schema.additionalProperties) && !validate(schema.additionalProperties, value[key]))) return false;
    }
  }
  return true;
}
function toolSchemas(body) {
  const tools = new Map(), counts = new Map();
  for (const tool of Array.isArray(body.tools) ? body.tools : []) {
    counts.set(tool.name, (counts.get(tool.name) || 0) + 1);
    if (![CAPTURE, ...ACTIONS].includes(tool.name)) continue;
    const schema = tool.input_schema;
    if (!object(schema) || schema.type !== 'object' || !object(schema.properties) || JSON.stringify(schema).length > 48000 || !supportedSchema(schema)) continue;
    if (!own(schema.properties, 'pid') || !own(schema.properties, 'window_id')) continue;
    if (tool.name === CAPTURE && !own(schema.properties, 'include_screenshot')) continue;
    tools.set(tool.name, schema);
  }
  for (const [name, count] of counts) if (count !== 1) tools.delete(name);
  return tools;
}

function resultTexts(result) {
  return typeof result.content === 'string' ? [result.content] : (Array.isArray(result.content) ? result.content : [])
    .filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text);
}
function jsonBlocks(result) {
  const objects = [];
  if (object(result.structuredContent)) objects.push(result.structuredContent);
  for (const text of resultTexts(result)) {
    if (text.length > 512000) continue;
    try {
      const parsed = JSON.parse(text);
      if (object(parsed)) {
        objects.push(parsed);
        if (object(parsed.structuredContent)) objects.push(parsed.structuredContent);
      }
    } catch { /* Prose, markdown and embedded fragments are not evidence. */ }
  }
  return objects;
}
function failedResult(result) {
  if (result.is_error === true || result.isError === true) return true;
  const failure = /\b(?:refused|denied|cancelled|canceled|blocked|failed|error)\b/i;
  for (const value of [result, ...jsonBlocks(result)]) {
    if (value.is_error === true || value.isError === true || value.error || value.success === false || value.ok === false) return true;
    if ([value.status, value.effect, value.outcome, value.classification, value.code].some(v => typeof v === 'string' && failure.test(v))) return true;
  }
  // Denials sometimes arrive as ordinary MCP text, without structuredContent.
  // A parsed observation is data, not prose: application labels/tree text such
  // as "Error:" or "cancelled" cannot turn a successful capture into a denial.
  // Explicit failure fields on either the envelope or payload were checked above.
  const observation = value => object(value) && short(value.capture_id) && positive(value.pid) && positive(value.window_id) && Array.isArray(value.elements);
  return resultTexts(result).some(text => {
    if (text.length <= 512000) {
      try {
        const parsed = JSON.parse(text);
        if (observation(parsed) || (object(parsed) && observation(parsed.structuredContent))) return false;
      } catch { /* Only whole, parsed observations bypass the prose fallback. */ }
    }
    return /\b(?:permission denied|access denied|refused|cancelled|canceled|tool use denied|not authorized)\b|\berror:/i.test(text);
  });
}

// Only an exact, current assistant-call / user-result pair is evidence. This
// intentionally excludes batched parallel actions and later user instructions.
function tailPair(body) {
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length < 2) return null;
  const mi = messages.length - 1, last = messages[mi], previous = messages[mi - 1];
  if (last.role !== 'user' || previous.role !== 'assistant' || !Array.isArray(last.content) || last.content.length !== 1) return null;
  const result = last.content[0];
  if (result?.type !== 'tool_result' || !short(result.tool_use_id)) return null;
  const calls = (Array.isArray(previous.content) ? previous.content : []).filter(b => b?.type === 'tool_use');
  if (calls.length !== 1 || calls[0].id !== result.tool_use_id || !object(calls[0].input)) return null;
  let uses = 0, results = 0;
  for (const message of messages) for (const block of Array.isArray(message.content) ? message.content : []) {
    if (block?.type === 'tool_use' && block.id === result.tool_use_id) uses++;
    if (block?.type === 'tool_result' && block.tool_use_id === result.tool_use_id) results++;
  }
  return uses === 1 && results === 1 ? { call: calls[0], result, messageIndex: mi } : null;
}
function pngSize(image) {
  const source = image?.source;
  if (image?.type !== 'image' || source?.type !== 'base64' || source.media_type !== 'image/png' || !short(source.data, 12 * 1024 * 1024)) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(source.data) || source.data.length % 4 !== 0) return null;
  const header = Buffer.from(source.data.slice(0, 48), 'base64');
  if (header.length < 33 || !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || header.readUInt32BE(8) !== 13 || header.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = header.readUInt32BE(16), height = header.readUInt32BE(20);
  return positive(width) && positive(height) && width <= 32768 && height <= 32768 ? { width, height } : null;
}
function targetOf(input) {
  if (!object(input) || !positive(input.pid) || !positive(input.window_id)) return null;
  if (input.scope && input.scope !== 'window') return null;
  if (input.delivery_mode && input.delivery_mode !== 'background') return null;
  if (input.session !== undefined && !short(input.session, 128)) return null;
  if (input.target !== undefined && (!object(input.target) || input.target.kind !== 'window' || input.target.pid !== input.pid || input.target.window_id !== input.window_id)) return null;
  return { pid: input.pid, window_id: input.window_id, ...(input.session !== undefined ? { session: input.session } : {}) };
}
// Native window snapshots also include independent app menu-bar trees. A
// snapshot token proves membership in the capture, NOT in the captured window.
// Keep containment internal; neither AX frames nor ancestry become coordinates
// in the helper prompt. Missing/ambiguous ancestry removes semantic eligibility
// without discarding the usable screenshot for a grounded pixel action.
function windowElementTokens(elements, size) {
  const tokens = new Set(), byIndex = new Map(elements.map(element => [element.element_index, element]));
  const roots = elements.filter(element => element.role === 'AXWindow' && element.depth === 0 && element.parent_index == null);
  if (roots.length !== 1) return tokens;
  const root = roots[0];
  const visibleFrame = element => {
    if (!own(element, 'screenshot_frame')) return true;
    const frame = element.screenshot_frame;
    // screenshot_frame is already in capture pixels. Do not read/convert frame
    // or window_bounds, which belong to a different coordinate space.
    return object(frame) && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(frame[key])) && frame.w > 0 && frame.h > 0
      && frame.x < size.width && frame.y < size.height && frame.x + frame.w > 0 && frame.y + frame.h > 0;
  };
  for (const element of elements) {
    const seen = new Set();
    let current = element;
    while (current && !seen.has(current.element_index)) {
      if (!Number.isSafeInteger(current.depth) || current.depth < 0 || !visibleFrame(current) || current.role === 'AXMenuBar') break;
      seen.add(current.element_index);
      if (current === root) { tokens.add(element.element_token); break; }
      if (current.role === 'AXWindow' || !Number.isSafeInteger(current.parent_index) || current.parent_index < 0) break;
      const parent = byIndex.get(current.parent_index);
      if (!parent || !Number.isSafeInteger(parent.depth) || parent.depth >= current.depth) break;
      current = parent;
    }
  }
  return tokens;
}
function captureEvidence(pair) {
  if (!pair || pair.call.name !== CAPTURE || failedResult(pair.result)) return null;
  const target = targetOf(pair.call.input);
  if (!target || pair.call.input.include_screenshot === false || pair.call.input.screenshot_out_file !== undefined) return null;
  const images = (Array.isArray(pair.result.content) ? pair.result.content : []).filter(b => b?.type === 'image');
  if (images.length !== 1) return null;
  const size = pngSize(images[0]);
  if (!size) return null;
  const candidates = jsonBlocks(pair.result).filter(v => own(v, 'capture_id'));
  if (!candidates.length || candidates.some(v => hash(v) !== hash(candidates[0]))) return null;
  const raw = candidates[0];
  if (!short(raw.capture_id) || raw.pid !== target.pid || raw.window_id !== target.window_id || (raw.session !== undefined && raw.session !== target.session)) return null;
  if (!/^s[0-9a-f]{8}$/.test(raw.snapshot_id || '') || raw.screenshot_width !== size.width || raw.screenshot_height !== size.height || raw.screenshot_frame_valid !== true) return null;
  if (!Array.isArray(raw.elements) || raw.elements.length > 2000) return null;
  const elements = [], indices = new Set();
  for (const element of raw.elements) {
    if (!object(element) || !Number.isSafeInteger(element.element_index) || element.element_index < 0 || indices.has(element.element_index)) return null;
    indices.add(element.element_index);
    if (element.element_token !== `${raw.snapshot_id}:${element.element_index}` || !short(element.role, 128)) return null;
    if (element.actions !== undefined && (!Array.isArray(element.actions) || element.actions.length > 128 || !element.actions.every(a => short(a, 4096)))) return null;
    // Native providers also return multiline custom-action diagnostics. They
    // are not named AX capabilities: omit them instead of rejecting unrelated
    // visible controls or extracting an AXPress substring from their prose.
    const actions = (element.actions || []).filter(a => /^AX[A-Za-z0-9_]{1,78}$/.test(a));
    elements.push({ element_index: element.element_index, element_token: element.element_token, role: element.role,
      ...(typeof element.enabled === 'boolean' ? { enabled: element.enabled } : {}),
      label: typeof element.label === 'string' ? element.label.slice(0, 2000) : '',
      ...(typeof element.value === 'string' ? { value: element.value.slice(0, 2000) } : {}), actions });
  }
  const windowTokens = windowElementTokens(raw.elements, size), contained = elements.filter(element => windowTokens.has(element.element_token));
  // Do not advertise app-menu or ambiguously parented tokens to the helper.
  // Window/AX frames stay internal and are never exposed or converted.
  const observation = { capture_id: raw.capture_id, snapshot_id: raw.snapshot_id, ...target, screenshot_width: size.width, screenshot_height: size.height,
    elements: contained, elements_complete: raw.elements_complete === true && contained.length === elements.length, truncated: raw.truncated === true };
  if (JSON.stringify(observation).length > 180000) return null;
  return { ...pair, target, observation, windowTokens, image: images[0], source: hash(raw.capture_id) };
}
function captureRecipe(target, schema) {
  if (!schema || Object.keys(target).some(k => !own(schema.properties, k))) return null;
  const input = { ...target, include_screenshot: true };
  if (own(schema.properties, 'include_accessibility_tree')) input.include_accessibility_tree = true;
  return validate(schema, input) ? input : null;
}

function compileAction(proposal, evidence, schemas) {
  if (!object(proposal) || !ACTIONS.includes(proposal.tool_name) || !object(proposal.input)) return null;
  const schema = schemas.get(proposal.tool_name);
  if (!schema) return null;
  const input = { ...proposal.input }, action = proposal.tool_name.slice(PREFIX.length);
  const keys = {
    click: ['action', 'button', 'count'], type_text: ['text', 'delay_ms'], press_key: ['key'], hotkey: ['keys'], scroll: ['direction', 'amount', 'by'],
  }[action];
  const allowed = new Set([...keys, 'pid', 'window_id', 'session', 'delivery_mode', 'scope', 'target', 'element_token', 'element_index', 'snapshot_id', 'x', 'y', 'capture_id']);
  if (Object.keys(input).some(k => !allowed.has(k) || !own(schema.properties, k))) return null;
  for (const [key, value] of Object.entries(evidence.target)) {
    if (!own(schema.properties, key) || (own(input, key) && input[key] !== value)) return null;
    input[key] = value;
  }
  if (evidence.target.session === undefined && own(input, 'session')) return null;
  if (input.scope !== undefined && input.scope !== 'window') return null;
  if (input.delivery_mode !== undefined && input.delivery_mode !== 'background') return null;
  if (own(schema.properties, 'delivery_mode')) input.delivery_mode = 'background';
  if (input.target !== undefined && (!object(input.target) || Object.keys(input.target).some(k => !['kind', 'pid', 'window_id'].includes(k)) || input.target.kind !== 'window' || input.target.pid !== input.pid || input.target.window_id !== input.window_id)) return null;
  if (input.capture_id !== undefined && input.capture_id !== evidence.observation.capture_id) return null;
  const semantic = input.element_token !== undefined || input.element_index !== undefined || input.snapshot_id !== undefined;
  const pixel = input.x !== undefined || input.y !== undefined;
  if (semantic === pixel) return null; // One exact target, never an implicit focused field.
  if (semantic) {
    // capture_id is a pixel dispatch capability; AX token/index paths reject
    // it even when the id is current. Identity was checked above; omit it.
    delete input.capture_id;
    let element;
    if (input.element_token !== undefined) element = evidence.observation.elements.find(e => e.element_token === input.element_token);
    else if (input.snapshot_id === evidence.observation.snapshot_id) element = evidence.observation.elements.find(e => e.element_index === input.element_index);
    if (!element || !evidence.windowTokens?.has(element.element_token) || element.enabled === false || (input.element_index !== undefined && input.element_index !== element.element_index) || (input.snapshot_id !== undefined && input.snapshot_id !== evidence.observation.snapshot_id)) return null;
    if (action === 'click' && !element.actions.includes('AXPress')) return null;
    if (own(schema.properties, 'element_token')) { input.element_token = element.element_token; delete input.element_index; delete input.snapshot_id; }
    else { input.element_index = element.element_index; input.snapshot_id = evidence.observation.snapshot_id; }
  } else {
    if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.y < 0 || input.x >= evidence.observation.screenshot_width || input.y >= evidence.observation.screenshot_height) return null;
    if (own(schema.properties, 'capture_id')) input.capture_id = evidence.observation.capture_id;
  }
  if (action === 'click' && ((input.action !== undefined && input.action !== 'press') || (input.button !== undefined && input.button !== 'left') || (input.count !== undefined && input.count !== 1))) return null;
  if (action === 'type_text' && (!short(input.text, 8000) || (input.delay_ms !== undefined && (!Number.isInteger(input.delay_ms) || input.delay_ms < 0 || input.delay_ms > 200)))) return null;
  const key = value => typeof value === 'string' && /^(?:[a-z0-9]|return|tab|escape|up|down|left|right|space|delete|home|end|pageup|pagedown|f(?:[1-9]|1[0-2]))$/i.test(value);
  if (action === 'press_key' && !key(input.key)) return null;
  if (action === 'hotkey') {
    if (!Array.isArray(input.keys) || input.keys.length < 2 || input.keys.length > 4 || !key(input.keys.at(-1)) || !input.keys.slice(0, -1).every(k => ['cmd', 'command', 'ctrl', 'control', 'shift', 'alt', 'option'].includes(k))) return null;
    // Clipboard interaction and desktop/window-management shortcuts are not a
    // background one-window operator capability.
    const chord = input.keys.map(k => k.toLowerCase());
    if (chord.some(k => ['cmd', 'command', 'ctrl', 'control'].includes(k)) && ['c', 'v', 'x', 'q', 'w', 'tab', 'space'].includes(chord.at(-1))) return null;
  }
  if (action === 'scroll' && (!['up', 'down', 'left', 'right'].includes(input.direction) || (input.amount !== undefined && (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > 50)) || (input.by !== undefined && !['line', 'page'].includes(input.by)))) return null;
  return validate(schema, input) ? { name: proposal.tool_name, input } : null;
}
module.exports = { CAPTURE, ACTIONS, object, own, short, hash, supportedSchema, validate, toolSchemas, jsonBlocks, failedResult, tailPair, captureEvidence, captureRecipe, compileAction };
