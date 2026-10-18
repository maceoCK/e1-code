'use strict';

const PLACEHOLDER = 'DeferredToolPlaceholder';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isName = value => typeof value === 'string' && value.length > 0;

// Walk content blocks, not arbitrary JSON: tool inputs, schemas, text, and media
// sources may contain lookalike objects and must never activate a tool.
function visitContent(content, insideResult, visit) {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!isObject(block)) continue;
    visit(block, insideResult);
    if (block.type === 'tool_result') visitContent(block.content, true, visit);
  }
}

function translateContent(content, available) {
  if (!Array.isArray(content)) return content;
  return content.map(block => {
    if (!isObject(block)) return block;
    if (block.type === 'tool_reference') {
      const { type, tool_name, ...rest } = block;
      const name = isName(tool_name) ? JSON.stringify(tool_name) : '(unnamed tool)';
      return {
        ...rest,
        type: 'text',
        text: available.has(tool_name)
          ? `Tool ${name} is available. Use its current tool definition for the description and input schema.`
          : `Tool ${name} is not available in this request. Do not call it.`,
      };
    }
    if (block.type === 'tool_result' && Array.isArray(block.content)) {
      block.content = translateContent(block.content, available);
    }
    return block;
  });
}

/**
 * prepare(body) -> an independent clone of a JSON Messages request.
 *
 * For non-native providers (including the serialized claude-code adapter) only:
 * retain non-deferred tools, tools referenced in user tool_result content, prior
 * assistant tool_use names, and an explicitly forced tool. Names only select
 * definitions present in this request; history never supplies a schema. With no
 * defer_loading:true flags, all real definitions remain. Remove the placeholder
 * definition and defer_loading metadata, and translate structured tool_reference
 * blocks into text without flattening results or media. tool_choice is preserved;
 * an undeclared forced tool throws a 400/tool_not_declared error.
 *
 * Stateless: pass the original request on each turn. Native Anthropic requests
 * must bypass this helper to preserve their native deferred-tool protocol.
 */
function prepare(body) {
  const result = structuredClone(body);
  const definitions = Array.isArray(result.tools)
    ? result.tools.filter(tool => tool?.name !== PLACEHOLDER)
    : [];
  const declared = new Set(definitions.map(tool => tool?.name).filter(isName));
  const selected = new Set();

  for (const message of Array.isArray(result.messages) ? result.messages : []) {
    if (!isObject(message)) continue;
    visitContent(message.content, false, (block, insideResult) => {
      if (message.role === 'assistant' && !insideResult && block.type === 'tool_use') {
        if (declared.has(block.name)) selected.add(block.name);
      }
      if (message.role === 'user' && insideResult && block.type === 'tool_reference') {
        if (declared.has(block.tool_name)) selected.add(block.tool_name);
      }
    });
  }

  if (result.tool_choice?.type === 'tool') {
    const name = result.tool_choice.name;
    if (!declared.has(name)) {
      const error = new Error(`The requested tool ${isName(name) ? JSON.stringify(name) : '(unnamed tool)'} is not declared.`);
      error.status = 400;
      error.code = 'tool_not_declared';
      throw error;
    }
    selected.add(name);
  }

  if (Array.isArray(result.tools)) {
    result.tools = definitions.filter(tool => tool?.defer_loading !== true || selected.has(tool.name));
    for (const tool of result.tools) {
      if (isObject(tool)) delete tool.defer_loading;
    }
  }
  const available = new Set((Array.isArray(result.tools) ? result.tools : []).map(tool => tool?.name).filter(isName));
  for (const message of Array.isArray(result.messages) ? result.messages : []) {
    if (isObject(message) && Array.isArray(message.content)) {
      message.content = translateContent(message.content, available);
    }
  }
  return result;
}

module.exports = { prepare };
