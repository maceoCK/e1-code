const test = require("node:test"),
  assert = require("node:assert/strict"),
  http = require("node:http");
const P = require("../src/providers.cjs");
const local = async (handler) => {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
};
test("model profiles and API fields honor Pi compatibility", () => {
  const p = {
    protocol: "chat",
    baseUrl: "https://example.com/v1",
    models: [
      {
        id: "abliterated-model-large-v2",
        reasoning: true,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          maxTokensField: "max_tokens",
        },
      },
    ],
  };
  const r = P.requestFor(
    p,
    p.models[0].id,
    [{ role: "user", content: "Test" }],
    { effort: "high", temperature: 0.5 },
  );
  assert.equal(r.body.messages[0].role, "system");
  assert.equal(r.profile, "abliterated");
  assert.ok(!("reasoning_effort" in r.body));
  assert.ok(!("temperature" in r.body));
  assert.ok("max_tokens" in r.body);
  const q = P.requestFor(
    { ...p, protocol: "responses" },
    "gpt-5-mini",
    [{ role: "user", content: "Test" }],
    { effort: "low" },
  );
  assert.equal(q.body.reasoning.effort, "low");
  assert.equal(q.body.store, false);
  assert.ok(!q.body.instructions.includes("think step by step"));
  assert.equal(P.profileFor("qwen3.5:9b"), "qwen");
  assert.equal(P.profileFor("fine-tuned-model", "abliterated"), "abliterated");
  assert.equal(P.profileFor("ft:gpt-5-mini:personal:assistant:abc"), "reasoning");
});
test("SSE parser retains UTF-8 across chunks, multiline frames and DONE", async () => {
  const bytes = new TextEncoder().encode(
    'data: {"text":"é"}\r\n\r\ndata: [DONE]\n\n',
  );
  const stream = new ReadableStream({
    start(c) {
      for (const b of bytes) c.enqueue(Uint8Array.of(b));
      c.close();
    },
  });
  const arr = [];
  for await (const e of P.events(stream)) arr.push(e);
  assert.deepEqual(arr, [{ text: "é" }, { type: "done" }]);
});
test("actual Responses request uses instructions and streams content", async () => {
  let body, auth;
  const server = await local(async (req, res) => {
    auth = req.headers.authorization;
    let text = "";
    for await (const b of req) text += b;
    body = JSON.parse(text);
    res.setHeader("Content-Type", "text/event-stream");
    res.end(
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\ndata: {"type":"response.completed"}\n\n',
    );
  });
  try {
    const arr = [];
    for await (const e of P.generate(
      { protocol: "responses", baseUrl: server.url, models: [] },
      "test-key",
      "gpt-5-mini",
      [{ role: "user", content: "Hello" }],
      { effort: "low" },
    ))
      arr.push(e);
    assert.equal(auth, "Bearer test-key");
    assert.equal(body.input[0].content, "Hello");
    assert.ok(body.instructions.includes("E1 Code"));
    assert.equal(arr.find((e) => e.type === "delta").text, "Hello");
    assert.equal(arr.at(-1).type, "done");
  } finally {
    await server.close();
  }
});
test("truncated and explicit error streams cannot report success", async () => {
  for (const data of [
    'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n',
    'data: {"type":"error","error":{"message":"broken"}}\n\n',
  ]) {
    const server = await local((req, res) => res.end(data));
    try {
      await assert.rejects(async () => {
        for await (const e of P.generate(
          { protocol: "chat", baseUrl: server.url, models: [] },
          "",
          "custom",
          [],
          {},
        )) {
        }
      }, /ended before completion|broken/);
    } finally {
      await server.close();
    }
  }
});
test("non-local HTTP and embedded URL credentials are rejected", () => {
  for (const baseUrl of [
    "http://example.com",
    "https://key:secret@example.com",
    "https://example.com?api_key=x",
  ])
    assert.throws(() =>
      P.normalizeProvider({
        id: "test",
        name: "test",
        protocol: "chat",
        baseUrl,
      }),
    );
  assert.equal(
    P.normalizeProvider({
      id: "test",
      protocol: "chat",
      baseUrl: "http://localhost:11434/",
    }).baseUrl,
    "http://localhost:11434",
  );
});
