const { execFileSync } = require("node:child_process");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
let transport = (...args) => fetch(...args);
function setTransport(fn) {
  transport = fn;
}
const PRESETS = [
  {
    id: "openai",
    name: "OpenAI",
    protocol: "responses",
    baseUrl: "https://api.openai.com/v1",
    credential: "openai",
    models: [],
  },
  {
    id: "ollama",
    name: "Ollama",
    protocol: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    models: [],
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    protocol: "chat",
    baseUrl: "http://127.0.0.1:1234/v1",
    models: [],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    credential: "anthropic",
    models: [],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "chat",
    baseUrl: "https://openrouter.ai/api/v1",
    credential: "openrouter",
    models: [],
  },
  {
    id: "custom",
    name: "Custom endpoint",
    protocol: "chat",
    baseUrl: "http://127.0.0.1:8080/v1",
    models: [],
  },
];
const PROFILES = {
  auto: {
    name: "Automatic",
    hint: "Choose instructions from the model family.",
  },
  general: {
    name: "General",
    hint: "Clear instructions and an explicit answer format.",
    prompt:
      "Follow the requested format and constraints. Be precise, practical, and concise. Include concrete examples when useful.",
  },
  reasoning: {
    name: "Reasoning",
    hint: "Short goals; no step-by-step reasoning prompts.",
    prompt:
      "Prioritize the requested outcome and constraints. Return the answer with a concise explanation and relevant evidence. Ask a question only when a missing detail is essential.",
  },
  qwen: {
    name: "Qwen / local",
    hint: "Compact instructions for locally served chat models.",
    prompt:
      "Answer the current request directly. Use clear Markdown where helpful. Do not emit chat-template tokens or simulated user turns. Follow the latest user request when filenames or requirements differ from earlier messages. For tool work, copy paths and identifiers exactly from the current request or tool results; never substitute an earlier filename or reconstruct or guess directories. Use working-directory-relative paths when accepted. Read the requested source before writing a derived file. The Read tool can prefix each displayed line with a line number and separator; these prefixes are display metadata, not file contents. Remove display line numbers when copying file contents, preserving the original text and newlines. After a tool error, correct its specific cause before continuing. Only claim a file was saved or a test passed after a successful tool result.",
  },
  abliterated: {
    name: "Abliterated",
    hint: "Direct, neutral task instructions; no Claude-specific identity.",
    prompt:
      "Respond directly to the user's task in the requested format. Be specific and distinguish established facts from assumptions. Do not invent tool execution, citations, or capabilities.",
  },
};
function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function piFiles() {
  let base = path.join(os.homedir(), ".pi", "agent");
  return {
    models: readJSON(path.join(base, "models.json"), {}).providers || {},
    auth: readJSON(path.join(base, "auth.json"), {}),
  };
}
function initialProviders() {
  const ps = structuredClone(PRESETS);
  for (const [id, p] of Object.entries(piFiles().models)) {
    if (!p.baseUrl) continue;
    const models = (p.models || []).map((m) => ({
      id: m.id,
      name: m.name || m.id,
      reasoning: !!m.reasoning,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      compat: m.compat || {},
    }));
    ps.splice(1, 0, {
      id: `pi-${id}`,
      name: id === "abliteration" ? "Abliteration" : id,
      protocol:
        p.api === "anthropic-messages"
          ? "anthropic"
          : p.api === "openai-responses"
            ? "responses"
            : "chat",
      baseUrl: p.baseUrl,
      credential: `pi:${id}`,
      credentialBase: p.baseUrl,
      models,
    });
  }
  return ps;
}
function resolveCredential(value) {
  if (!value) return "";
  if (value.startsWith("!")) {
    try {
      return execFileSync("/bin/sh", ["-c", value.slice(1)], {
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 65536,
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch {
      throw Error("Pi credential resolver failed. Check the provider in Pi.");
    }
  }
  return process.env[value] || value;
}
function resolveKey(p, stored) {
  if (stored) return stored;
  if (p.credential === "openai" && p.baseUrl === "https://api.openai.com/v1")
    return (
      process.env.OPENAI_API_KEY ||
      resolveCredential(piFiles().auth.openai?.key)
    );
  if (
    p.credential === "anthropic" &&
    p.baseUrl === "https://api.anthropic.com/v1"
  )
    return process.env.ANTHROPIC_API_KEY || "";
  if (
    p.credential === "openrouter" &&
    p.baseUrl === "https://openrouter.ai/api/v1"
  )
    return process.env.OPENROUTER_API_KEY || "";
  if (p.credential?.startsWith("pi:")) {
    const id = p.credential.slice(3),
      pi = piFiles(),
      config = pi.models[id];
    if (!config || p.baseUrl !== config.baseUrl) return "";
    const value = pi.auth[id]?.key || config.apiKey || "";
    return resolveCredential(value);
  }
  return "";
}
function normalizeProvider(p) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(p.id)) throw Error("Invalid provider ID.");
  if (!["responses", "chat", "ollama", "anthropic"].includes(p.protocol))
    throw Error("Choose a supported API protocol.");
  let u;
  try {
    u = new URL(p.baseUrl);
  } catch {
    throw Error("Enter a valid endpoint URL.");
  }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local))
    throw Error("Use HTTPS, or HTTP for a local server.");
  if (u.username || u.password || u.search || u.hash)
    throw Error(
      "Keep credentials and query parameters out of the endpoint URL.",
    );
  return {
    ...p,
    name: String(p.name || p.id).slice(0, 80),
    baseUrl: u.href.replace(/\/$/, ""),
    models: Array.isArray(p.models) ? p.models : [],
  };
}
function profileFor(model, profile = "auto") {
  if (profile !== "auto" && PROFILES[profile]) return profile;
  // Fine-tuned model IDs retain their base model after the ft: prefix.
  // Route with the full ID, but infer prompt defaults from the base model.
  if (model.startsWith("ft:")) model = model.split(":")[1] || model;
  if (/abliter|dolphin|uncensored/i.test(model)) return "abliterated";
  if (/qwen|llama|mistral|gemma/i.test(model)) return "qwen";
  if (/(^|\/)(o[134](?:-|$)|gpt-[56])|deepseek.*r1|reason/i.test(model))
    return "reasoning";
  return "general";
}
function promptFor(model, opts = {}) {
  const selected = profileFor(model, opts.profile);
  return {
    profile: selected,
    text: `You are E1 Code, a helpful assistant in a multi-model desktop workspace. The selected model is ${model}. You have access only to the conversation and any text the user attaches. Be honest about uncertainty and about actions you have not performed.\n${PROFILES[selected].prompt}${opts.instructions ? "\nUser preferences:\n" + opts.instructions : ""}`,
  };
}
function requestFor(p, model, messages, opts = {}) {
  const meta = p.models.find((m) => m.id === model) || {},
    prompt = promptFor(model, opts),
    cap = Math.min(Number(opts.maxTokens) || 2048, meta.maxTokens || 32768);
  const history = messages
    .filter((m) => ["user", "assistant"].includes(m.role))
    .map(({ role, content }) => ({ role, content }));
  const reasoning = meta.reasoning || profileFor(model) === "reasoning",
    headers = { "Content-Type": "application/json" };
  let route, body;
  if (p.protocol === "responses") {
    route = "/responses";
    body = {
      model,
      instructions: prompt.text,
      input: history,
      stream: true,
      store: false,
      max_output_tokens: cap,
    };
    if (reasoning && opts.effort && opts.effort !== "default")
      body.reasoning = { effort: opts.effort };
  } else if (p.protocol === "anthropic") {
    route = "/messages";
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model,
      system: prompt.text,
      messages: history,
      max_tokens: cap,
      stream: true,
    };
  } else if (p.protocol === "ollama") {
    route = "/api/chat";
    body = {
      model,
      messages: [{ role: "system", content: prompt.text }, ...history],
      stream: true,
      options: { num_predict: cap },
    };
    if (/qwen3|deepseek-r1/i.test(model)) body.think = opts.think === true;
  } else {
    route = "/chat/completions";
    const role =
      meta.compat?.supportsDeveloperRole === true ? "developer" : "system";
    body = {
      model,
      messages: [{ role, content: prompt.text }, ...history],
      stream: true,
    };
    body[meta.compat?.maxTokensField || "max_tokens"] = cap;
    if (
      meta.compat?.supportsReasoningEffort === true &&
      opts.effort &&
      opts.effort !== "default"
    )
      body.reasoning_effort = opts.effort;
  }
  if (!reasoning && opts.temperature !== undefined && opts.temperature !== "") {
    if (p.protocol === "ollama")
      body.options.temperature = Number(opts.temperature);
    else body.temperature = Number(opts.temperature);
  }
  return { url: p.baseUrl + route, headers, body, profile: prompt.profile };
}
async function* lines(stream) {
  let pending = "";
  const dec = new TextDecoder();
  for await (const chunk of stream) {
    pending += dec.decode(chunk, { stream: true });
    let i;
    while ((i = pending.indexOf("\n")) !== -1) {
      yield pending.slice(0, i).replace(/\r$/, "");
      pending = pending.slice(i + 1);
    }
  }
  pending += dec.decode();
  if (pending) yield pending;
}
async function* events(stream, ndjson = false) {
  let data = [];
  for await (const line of lines(stream)) {
    if (ndjson) {
      if (line.trim()) yield JSON.parse(line);
      continue;
    }
    if (line === "") {
      if (data.length) {
        const s = data.join("\n");
        data = [];
        if (s === "[DONE]") {
          yield { type: "done" };
          continue;
        }
        yield JSON.parse(s);
      }
    } else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length) {
    const s = data.join("\n");
    yield s === "[DONE]" ? { type: "done" } : JSON.parse(s);
  }
}
async function apiError(response, key) {
  let message = "";
  try {
    const s = await response.text();
    const d = JSON.parse(s);
    message = d.error?.message || d.message || d.error || s;
  } catch {}
  message = String(message).slice(0, 400);
  if (key) message = message.split(key).join("[redacted]");
  return Error(
    `Provider returned ${response.status}${message ? ": " + message : ". Check the endpoint, API key, and model ID."}`,
  );
}
async function models(p, key) {
  const route = p.protocol === "ollama" ? "/api/tags" : "/models",
    headers = {};
  if (key)
    headers[p.protocol === "anthropic" ? "x-api-key" : "Authorization"] =
      p.protocol === "anthropic" ? key : `Bearer ${key}`;
  if (p.protocol === "anthropic") headers["anthropic-version"] = "2023-06-01";
  let r;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      r = await transport(p.baseUrl + route, {
        headers,
        signal: AbortSignal.timeout(15000),
        redirect: "error",
        credentials: "omit",
      });
      break;
    } catch (e) {
      if (attempt === 1)
        throw Error(
          "Cannot reach " +
            new URL(p.baseUrl).hostname +
            " (" +
            (e.cause?.code || e.code || e.message) +
            "). Check the server and network connection.",
        );
    }
  }
  if (!r.ok) throw await apiError(r, key);
  const d = await r.json();
  return (d.data || d.models || [])
    .map((m) => ({
      id: m.id || m.name,
      name: m.display_name || m.name || m.id,
    }))
    .filter((m) => m.id);
}
async function* generate(p, key, model, messages, opts = {}, signal) {
  const req = requestFor(p, model, messages, opts);
  if (key)
    req.headers[p.protocol === "anthropic" ? "x-api-key" : "Authorization"] =
      p.protocol === "anthropic" ? key : `Bearer ${key}`;
  const r = await transport(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify(req.body),
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.any([
      signal || new AbortController().signal,
      AbortSignal.timeout(300000),
    ]),
  });
  if (!r.ok) throw await apiError(r, key);
  let complete = false,
    hasText = false;
  yield { type: "profile", profile: req.profile };
  for await (const e of events(r.body, p.protocol === "ollama")) {
    if (e.error || e.type === "error" || e.type === "response.failed")
      throw Error(
        String(
          e.error?.message ||
            e.response?.error?.message ||
            e.message ||
            e.error ||
            "Provider stream failed.",
        ).replaceAll(key || "\0", "[redacted]"),
      );
    let text = "";
    if (p.protocol === "responses") {
      if (
        e.type === "response.output_text.delta" ||
        e.type === "response.refusal.delta"
      )
        text = e.delta;
      if (e.type === "response.completed") complete = true;
      if (e.type === "response.incomplete")
        throw Error(
          "Response reached a limit. Increase the output token limit and retry.",
        );
    } else if (p.protocol === "anthropic") {
      if (e.type === "content_block_delta" && e.delta?.type === "text_delta")
        text = e.delta.text;
      if (e.type === "message_delta" && e.delta?.stop_reason === "max_tokens")
        throw Error("Response reached the output token limit.");
      if (e.type === "message_stop") complete = true;
    } else if (p.protocol === "ollama") {
      text = e.message?.content || "";
      if (e.done) {
        if (e.done_reason === "length")
          throw Error("Response reached the output token limit.");
        complete = true;
      }
    } else {
      text = e.choices?.[0]?.delta?.content || "";
      const finish = e.choices?.[0]?.finish_reason;
      if (finish === "length")
        throw Error("Response reached the output token limit.");
      if (finish === "content_filter")
        throw Error("The provider filtered this response.");
      if (finish === "tool_calls")
        throw Error(
          "This chat model requested tools that are not enabled in this workspace.",
        );
      if (finish === "stop" || e.type === "done") complete = true;
    }
    if (text) {
      hasText = true;
      yield { type: "delta", text };
    }
  }
  if (!complete)
    throw Error(
      "The provider stream ended before completion. Retry the response.",
    );
  if (!hasText)
    throw Error(
      "The provider returned no answer text. Try a larger output limit or another model.",
    );
  yield { type: "done" };
}
module.exports = {
  setTransport,
  PRESETS,
  PROFILES,
  initialProviders,
  resolveKey,
  normalizeProvider,
  profileFor,
  promptFor,
  requestFor,
  events,
  generate,
  models,
};
