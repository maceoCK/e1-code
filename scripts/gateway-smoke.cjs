const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { Store } = require("../src/store.cjs"),
  { startGateway } = require("../src/gateway.cjs");
(async () => {
  const gateway = await startGateway({
    store: new Store(
      path.join(os.homedir(), "Library/Application Support/Aster"),
    ),
  });
  const headers = {
      Authorization: "Bearer " + gateway.token,
      "Content-Type": "application/json",
    },
    results = [];
  try {
    for (const [provider, model] of [
      ["openai", "gpt-5.4-mini"],
      ["pi-abliteration", "abliterated-model-large-v2"],
      ["ollama", "qwen3.5:9b"],
    ]) {
      const route = gateway
        .catalog()
        .find((r) => r.provider === provider && r.model === model);
      assert.ok(route);
      const start = Date.now();
      const messages = [
        {
          role: "user",
          content:
            "Use the get_weather tool for Paris. Do not answer before calling the tool.",
        },
      ];
      const request = {
        model: route.id,
        max_tokens: 1024,
        messages,
        tools: [
          {
            name: "get_weather",
            description: "Get the current weather in a city.",
            input_schema: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "get_weather" },
      };
      const first = await (
        await fetch(gateway.origin + "/v1/messages", {
          method: "POST",
          headers,
          body: JSON.stringify(request),
        })
      ).json();
      const tool = first.content?.find((c) => c.type === "tool_use");
      assert.ok(tool, JSON.stringify(first));
      assert.equal(tool.name, "get_weather");
      assert.match(tool.input.city, /Paris/i);
      messages.push(
        { role: "assistant", content: first.content },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: tool.id,
              content:
                "Paris: sunny, 21 degrees Celsius. Observation timestamp: now.",
            },
          ],
        },
      );
      const second = await (
        await fetch(gateway.origin + "/v1/messages", {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...request,
            messages,
            tool_choice: { type: "none" },
            stream: true,
          }),
        })
      ).text();
      assert.match(second, /message_stop/);
      assert.doesNotMatch(second, /event: error/);
      const answer = second
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)))
        .filter((event) => event.type === "content_block_delta")
        .map((event) => event.delta.text || "")
        .join("");
      assert.match(answer, /sunny|21/i, second);
      const result = {
        provider,
        model,
        tool: tool.name,
        arguments: tool.input,
        toolResultUsed: true,
        streamCompleted: true,
        seconds: Math.round((Date.now() - start) / 100) / 10,
      };
      results.push(result);
      console.log(JSON.stringify(result));
    }
    fs.writeFileSync(
      path.join(__dirname, "../evidence/gateway-live.json"),
      JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
    );
  } finally {
    gateway.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
