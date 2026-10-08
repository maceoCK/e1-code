const { events } = require("./providers.cjs");
const { randomUUID } = require("node:crypto");
async function relay(upstream, protocol, model, res) {
  const began = Date.now();
  let firstDeltaMs = null,
    complete = false,
    started = false,
    stop = "end_turn";
  const result = {
    id: "msg_" + randomUUID(),
    type: "message",
    role: "assistant",
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  const blocks = new Map(),
    chatTools = new Map();
  const emit = (type, data = {}) => {
    if (res.destroyed) throw Error("Client disconnected");
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  };
  const start = () => {
    if (!started) {
      started = true;
      emit("message_start", { message: { ...result, content: [] } });
    }
  };
  const open = (key, block) => {
    if (blocks.has(key)) return blocks.get(key);
    start();
    const item = {
      index: result.content.length,
      block,
      closed: false,
      args: "",
    };
    blocks.set(key, item);
    result.content.push(block);
    emit("content_block_start", {
      index: item.index,
      content_block:
        block.type === "text"
          ? { type: "text", text: "" }
          : { ...block, input: {} },
    });
    return item;
  };
  const delta = (item, text) => {
    firstDeltaMs ??= Date.now() - began;
    if (item.closed)
      throw Error("Provider sent content after completing the block");
    if (item.block.type === "text") {
      item.block.text += text;
      emit("content_block_delta", {
        index: item.index,
        delta: { type: "text_delta", text },
      });
    } else {
      item.args += text;
      emit("content_block_delta", {
        index: item.index,
        delta: { type: "input_json_delta", partial_json: text },
      });
    }
  };
  const close = (item) => {
    if (item.closed) return;
    if (item.block.type === "tool_use")
      item.block.input = JSON.parse(item.args || "{}");
    emit("content_block_stop", { index: item.index });
    item.closed = true;
  };
  for await (const e of events(upstream.body)) {
    if(e.service_tier || e.response?.service_tier) result.service_tier=e.service_tier || e.response.service_tier;
    if (e.error || e.type === "error" || e.type === "response.failed") {
      const error = Error(
        e.error?.message ||
          e.response?.error?.message ||
          "Provider stream failed",
      );
      error.code = e.error?.code || e.response?.error?.code;
      error.param = e.error?.param || e.response?.error?.param;
      throw error;
    }
    if (protocol === "anthropic") {
      if (e.type === "message_start") {
        result.id = e.message.id;
        result.usage = e.message.usage;
        emit(e.type, { message: { ...e.message, model } });
        started = true;
      } else {
        if (e.type === "content_block_start")
          result.content[e.index] = e.content_block;
        if (e.type === "content_block_delta")
          firstDeltaMs ??= Date.now() - began;
        if (e.type === "message_delta") {
          stop = e.delta.stop_reason;
          result.usage = { ...result.usage, ...e.usage };
        }
        if (e.type === "message_stop") complete = true;
        emit(
          e.type,
          Object.fromEntries(Object.entries(e).filter(([k]) => k !== "type")),
        );
      }
      continue;
    }
    if (protocol === "responses") {
      if (e.type === "response.created") {
        result.usage.input_tokens = e.response.usage?.input_tokens || 0;
        start();
      }
      if (
        e.type === "response.output_item.added" &&
        e.item.type === "function_call"
      ) {
        const item = open("tool:" + e.output_index, {
          type: "tool_use",
          id: e.item.call_id,
          name: e.item.name,
          input: {},
        });
        if (e.item.arguments) delta(item, e.item.arguments);
      }
      if (e.type === "response.function_call_arguments.delta") {
        const item = blocks.get("tool:" + e.output_index);
        if (!item)
          throw Error("Provider sent tool arguments before its declaration");
        delta(item, e.delta);
      }
      if (
        e.type === "response.output_text.delta" ||
        e.type === "response.refusal.delta"
      )
        delta(
          open(`text:${e.output_index}:${e.content_index}`, {
            type: "text",
            text: "",
          }),
          e.delta,
        );
      if (e.type === "response.output_item.done")
        for (const [key, item] of blocks)
          if (
            key === "tool:" + e.output_index ||
            key.startsWith(`text:${e.output_index}:`)
          )
            close(item);
      if (e.type === "response.completed" || e.type === "response.incomplete") {
        result.usage = {
          input_tokens: e.response.usage?.input_tokens || 0,
          output_tokens: e.response.usage?.output_tokens || 0,
        };
        stop = e.type === "response.incomplete" ? "max_tokens" : "end_turn";
        complete = true;
      }
    } else {
      if (e.usage)
        result.usage = {
          input_tokens: e.usage.prompt_tokens || 0,
          output_tokens: e.usage.completion_tokens || 0,
        };
      const c = e.choices?.[0];
      if (!c) continue;
      start();
      if (c.delta?.content)
        delta(open("text", { type: "text", text: "" }), c.delta.content);
      for (const call of c.delta?.tool_calls || []) {
        const state = chatTools.get(call.index) || {
          id: null,
          name: "",
          arguments: "",
          item: null,
        };
        chatTools.set(call.index, state);
        state.id ||= call.id;
        state.name += call.function?.name || "";
        if (call.function?.arguments) {
          state.arguments += call.function.arguments;
          state.item ||= open("tool:" + call.index, {
            type: "tool_use",
            id: state.id || "toolu_" + randomUUID(),
            name: state.name,
            input: {},
          });
          delta(state.item, call.function.arguments);
        }
      }
      if (c.finish_reason) {
        if (c.finish_reason === "content_filter")
          throw Error(
            "The provider stopped the response because of its content policy",
          );
        for (const [index, state] of chatTools)
          if (!state.item)
            state.item = open("tool:" + index, {
              type: "tool_use",
              id: state.id || "toolu_" + randomUUID(),
              name: state.name,
              input: {},
            });
        stop = c.finish_reason === "length" ? "max_tokens" : "end_turn";
        complete = true;
      }
    }
  }
  if (!complete) throw Error("The provider stream ended before completion");
  if (protocol !== "anthropic") {
    if (!result.content.length)
      throw Error("The provider returned no text or tool calls");
    for (const item of blocks.values()) close(item);
    if (result.content.some((b) => b.type === "tool_use")) stop = "tool_use";
    emit("message_delta", {
      delta: { stop_reason: stop, stop_sequence: null },
      usage: result.usage,
    });
    emit("message_stop");
  }
  result.stop_reason = stop;
  res.end();
  return { ...result, firstDeltaMs };
}
module.exports = { relay };
