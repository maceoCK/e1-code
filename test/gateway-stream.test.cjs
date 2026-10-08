const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { relay } = require("../src/gateway-stream.cjs"),
  G = require("../src/gateway.cjs");
const wire = (e) => "data: " + JSON.stringify(e) + "\n\n";
test("Responses text reaches the desktop before the upstream completion", async () => {
  let controller,
    release,
    finished = false,
    output = "";
  const stream = new ReadableStream({ start: (c) => (controller = c) });
  const waiting = new Promise((r) => (release = r));
  const run = relay(new Response(stream), "responses", "alias", {
    write: (s) => {
      output += s;
      if (s.includes("text_delta")) release();
    },
    end: () => (finished = true),
  });
  controller.enqueue(
    Buffer.from(
      wire({
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "First words",
      }),
    ),
  );
  await waiting;
  assert.match(output, /First words/);
  assert.equal(finished, false);
  assert.doesNotMatch(output, /message_stop/);
  controller.enqueue(
    Buffer.from(
      wire({
        type: "response.completed",
        response: { usage: { input_tokens: 14, output_tokens: 2 } },
      }),
    ),
  );
  controller.close();
  const result = await run;
  assert.equal(finished, true);
  assert.equal(result.content[0].text, "First words");
  assert.equal(result.usage.input_tokens, 14);
});
test("streaming tool arguments remain valid across chunks and incomplete streams fail", async () => {
  const events = [
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: "function_call",
        call_id: "call_1",
        name: "Read",
        arguments: "",
      },
    },
    {
      type: "response.function_call_arguments.delta",
      output_index: 0,
      delta: '{"file_',
    },
    {
      type: "response.function_call_arguments.delta",
      output_index: 0,
      delta: 'path":"/tmp/test"}',
    },
    { type: "response.output_item.done", output_index: 0 },
    { type: "response.completed", response: { usage: {} } },
  ];
  let output = "";
  const r = await relay(
    new Response(events.map(wire).join("")),
    "responses",
    "alias",
    { write: (s) => (output += s), end: () => {} },
  );
  assert.equal(r.stop_reason, "tool_use");
  assert.deepEqual(r.content[0].input, { file_path: "/tmp/test" });
  assert.match(output, /input_json_delta/);
  await assert.rejects(
    relay(new Response(wire(events[0])), "responses", "alias", {
      write: () => {},
      end: () => {},
    }),
    /before completion/,
  );
});
test("screenshots and PDFs in tool results survive translation", () => {
  const body = {
    max_tokens: 512,
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "c1",
            name: "Read",
            input: { file_path: "test.png" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "c1",
            content: [
              { type: "text", text: "Screenshot" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "YQ==",
                },
              },
            ],
          },
        ],
      },
    ],
  };
  const route = { model: "gpt-5.4-mini", provider: "openai", meta: {} };
  const a = G.requestFor(
    body,
    { protocol: "responses", baseUrl: "https://api.openai.com/v1" },
    route,
  );
  assert.equal(
    a.body.input[1].output[1].image_url,
    "data:image/png;base64,YQ==",
  );
  const b = G.requestFor(
    body,
    { protocol: "chat", baseUrl: "https://example.test/v1" },
    route,
  );
  assert.equal(b.body.messages.at(-1).role, "user");
  assert.equal(
    b.body.messages.at(-1).content[1].image_url.url,
    "data:image/png;base64,YQ==",
  );
  body.messages[1].content[0].content = [
    {
      type: "document",
      title: "notes.pdf",
      source: { type: "base64", media_type: "application/pdf", data: "YQ==" },
    },
  ];
  const c = G.requestFor(
    body,
    { protocol: "responses", baseUrl: "https://api.openai.com/v1" },
    route,
  );
  assert.equal(
    c.body.input[1].output[0].file_data,
    "data:application/pdf;base64,YQ==",
  );
});
