const { test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/gateway.cjs');
const V = require('../src/vision-fallback.cjs');

test('discovered compatibility metadata preserves explicit vision support and other compatibility fields', () => {
  for (const supportsVision of [true, false]) {
    const meta = V.modalityMetadata({ compat: { supportsVision, maxTokensField: 'max_completion_tokens' } });
    assert.equal(V.supportsImages({ model: 'abliterated-model', meta }), supportsVision);
    assert.equal(meta.compat.maxTokensField, 'max_completion_tokens');
  }
});
for (const limit of ['max_tokens', 'character_limit']) test(`${limit} descriptions are labeled partial and never cached`, async () => {
  const provider = { id: 'openai', protocol: 'responses', baseUrl: 'https://api.openai.com/v1' };
  const store = { data: { routing: { allowApiFallback: true } }, provider: () => provider, key: async () => 'fixture-key' };
  let calls = 0;
  const prepare = V.createVisionFallback({ store, requestFor: G.requestFor, responseFor: G.responseFor,
    transport: async () => {
      calls++;
      return Response.json({ status: limit === 'max_tokens' ? 'incomplete' : 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: limit === 'character_limit' ? 'a'.repeat(32001) : 'Partial image text' }] }] });
    },
  });
  const body = { messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'fixture' } }] }] };
  const primary = { model: 'abliterated-model' };
  const routes = [{ id: 'vision', provider: 'openai', model: 'gpt-6-luna', meta: {} }];
  for (let i = 0; i < 2; i++) {
    const result = await prepare(body, primary, routes, new AbortController().signal);
    assert.match(result.messages[0].content[0].text, /Partial description: output was truncated/);
  }
  assert.equal(calls, 2);
});
