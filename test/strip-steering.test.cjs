'use strict';
// stripSteering() removes engine-built behavior steering for E1 routes while
// keeping operational guardrails. Fixtures are short excerpts of the Claude Code
// 2.1.286 / 2.1.304 prompt wording; long sections are abbreviated with filler
// between their stable start and end anchors.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripSteering, systemFor } = require('../src/gateway.cjs');

const KEEP = [
  'For actions that are hard to reverse or outward-facing, confirm first unless durably authorized or explicitly told to proceed without asking.',
  "Be extra-cautious about doing anything that's hard to undo, unless you have durable authorization or the user explicitly told you to proceed without asking.",
  'Carefully consider the reversibility and blast radius of actions.',
  'Never push to main/master, force-push, or merge.',
  'You have a persistent file-based memory at `/tmp/memory/`.',
  'Use `$CLAUDE_JOB_DIR/tmp` for any temporary files instead of `/tmp`.',
  '---\nname: <short-kebab-case-slug>\n---',
].join('\n\n');

test('2.1.286 wording (still shipped in 2.1.304) is removed; guardrails stay', () => {
  const steering = [
    'IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for X. Dual-use security tools require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.',
    'Refusals are only for requests that are genuinely harmful or clearly prohibited, not for ordinary work. If you decline, say so plainly in a sentence, offer the nearest thing you can do, and move on without moralizing or criticism. This applies to producing work products: it doesn\'t override necessary refusals or the need for confirmation.',
    'When you use a pronoun for someone, use they/them. A name doesn\'t tell you someone\'s pronouns. This applies to all user-visible text, including visible thinking.',
    'End-of-turn summary: one or two sentences. What changed and what\'s next. Nothing else.',
    '# Tone and style\n - Only use emojis if the user explicitly requests it. Avoid using emojis in all communication unless asked.\n - Your responses should be short and concise.',
    '# Environment\n - The most recent Claude models are the Claude 5 family. Model IDs: x. When building AI applications, default to the latest and most capable Claude models.\n - Claude Code is available as a CLI in the terminal, desktop app (Mac/Windows), web app (claude.ai/code), and IDE extensions (VS Code, JetBrains).\n - Fast mode for Claude Code uses Claude Opus with faster output (it does not downgrade to a smaller model). It can be toggled with /fast.\n',
    ' - If the user asks for help or wants to give feedback inform them of the following:\n  - /help: Get help with using Claude Code\n  - To give feedback, users should report the issue at https://github.com/anthropics/claude-code/issues\n',
    '# Background Session\n\nThis session runs as a background job. The user may be chatting with you live or may have stepped away to check results later — respond naturally either way, and don\'t refer to yourself as "a background agent."\n',
    "This iteration of Claude is Claude Fable 5.1, the newest model. Claude can direct them to https://www.anthropic.com/claude/fable for more information.",
    "You are an agent for Claude Code, Anthropic's official CLI for Claude. Given the user's message, use the tools.",
    'Notes:\n- For clear communication with the user the assistant MUST avoid using emojis.\n- Do not use a colon before tool calls. Text like "Let me read the file:" should end with a period.\n',
  ].join('\n\n');
  const out = stripSteering(steering + '\n\n' + KEEP);
  for (const gone of ['IMPORTANT: Assist', 'Refusals are only', 'If you decline', 'This applies to producing', 'pronoun',
    'End-of-turn summary', 'emojis', 'most recent Claude models', 'Claude Code is available', 'Fast mode for Claude Code',
    'give feedback', '/help', 'anthropics/claude-code', 'background agent', 'chatting with you live', 'iteration of Claude',
    'You are an agent for Claude Code', 'colon before tool calls'])
    assert.ok(!out.includes(gone), `still contains: ${gone}`);
  assert.ok(out.includes('# Tone and style\n - Your responses should be short and concise.'), 'kept bullet lost its marker');
  assert.doesNotMatch(out, /^[ \t]*-(?:[ \t]+-)*[ \t]*$/m, 'orphaned bullet marker');
  assert.ok(out.includes(KEEP), 'a kept category was altered');
});

test('2.1.304 rewrite-variant wording is removed; guardrails stay', () => {
  const rewrite = [
    '<pronouns>\nTry your best to refer to users, including those from external services, websites, or other coworkers, with generic pronouns such as they/them. [...] This applies to all of your user-facing text - anything which may be visible to the user, including visible thinking.\n</pronouns>',
    "<environment>\n# Environment\n - The most recent Claude models are as follows, with their model IDs: Fable 5.1: 'claude-fable-5-1'. When building AI applications, generally you want to use the latest and most capable Claude models by default.\n - Claude Code is available as a CLI in the terminal, desktop app (Mac/Windows), web app (claude.ai/code), and IDE extensions (VS Code, JetBrains).\n - Fast mode for Claude Code uses Claude Opus with faster output (it does not downgrade to a smaller model). It can be toggled with /fast.\n</environment>",
    '<bg_session>\n# Background Session\n\nThis session runs as a background job. The user may be chatting with you live or may have stepped away to check results later. Please respond naturally either way - there\'s no need to refer to yourself as a "background agent", or anything like that.\n\nUse `$CLAUDE_JOB_DIR/tmp` for scratch files.\n</bg_session>',
    "<delivering_work>\n# Delivering work\nYou also generally want to abide by the user's request. It's best to, in this case, state succinctly your declination, without moralizing or criticism.\n</delivering_work>",
    "<corrections>\n# Corrections\nSometimes you'll feel the need to correct yourself, or add an apology. [...]\n\nUsers themselves can be a little impatient. [...] It'll be all right! Thank you Claude.\n</corrections>",
  ].join('\n\n');
  const out = stripSteering(rewrite + '\n\n' + KEEP);
  for (const gone of ['Try your best to refer to users', 'pronouns such as', 'most recent Claude models', 'most capable Claude models',
    'Claude Code is available', 'Fast mode', 'background agent', 'chatting with you live', 'declination', 'moralizing',
    "you'll feel the need to correct", 'Thank you Claude'])
    assert.ok(!out.includes(gone), `still contains: ${gone}`);
  assert.ok(out.includes('Use `$CLAUDE_JOB_DIR/tmp` for scratch files.'), 'background job mechanics were removed');
  assert.ok(out.includes('# Delivering work\nYou also generally want to abide'), 'delivering-work scope text was removed');
  assert.match(out, /<environment>\n# Environment\n<\/environment>/);
  assert.ok(out.includes(KEEP), 'a kept category was altered');
});

test('stripSteering is idempotent and leaves prompts without steering unchanged', () => {
  assert.equal(stripSteering(KEEP), KEEP);
  assert.equal(stripSteering(''), '');
  assert.equal(stripSteering(undefined), undefined);
  const once = stripSteering('Refusals are only for requests that are genuinely harmful or clearly prohibited, x. ' + KEEP);
  assert.equal(stripSteering(once), once);
});

test('systemFor swaps both engine identity openers and strips steering', () => {
  const route = { model: 'test-model', provider: 'local', meta: {} };
  for (const opener of ["You are a Claude agent, built on Anthropic's Claude Agent SDK.", 'You are Claude Code, Anthropic\'s official CLI for Claude.']) {
    const out = systemFor({ system: opener + '\n\nOnly use emojis if the user explicitly requests it. Avoid using emojis in all communication unless asked.\n' + KEEP }, route, {});
    assert.ok(out.startsWith('You are E1 Code, using test-model.'), out.slice(0, 80));
    assert.ok(!out.includes('emojis'));
    assert.ok(out.includes(KEEP));
  }
});

// Optional: verbatim prompts captured from a local engine (one system prompt per
// *.sys/*.txt file), e.g. E1_PROMPT_CAPTURE_DIR=/tmp/e1-port-d/capture.
const captures = process.env.E1_PROMPT_CAPTURE_DIR;
test('captured engine prompts lose every steering marker and keep guardrails', { skip: !captures && 'set E1_PROMPT_CAPTURE_DIR' }, () => {
  const files = fs.readdirSync(captures).filter(f => /\.(?:sys|txt)$/.test(f));
  assert.ok(files.length, 'no captured prompts');
  const removed = ['IMPORTANT: Assist with authorized', 'Refusals are only for requests', 'If you decline, say so plainly',
    'Only use emojis if the user', 'When you use a pronoun for someone', 'Try your best to refer to users', 'End-of-turn summary: one or two',
    '- No em-dashes, no parentheticals', 'The most recent Claude models', 'Claude Code is available as a CLI', 'Fast mode for Claude Code uses',
    'anthropics/claude-code/issues', 'You are an agent for Claude Code', '- Do not use a colon before tool calls',
    'state succinctly your declination', 'Thank you Claude', 'background agent', 'When building AI applications'];
  const kept = ['Carefully consider the reversibility', 'Be extra-cautious about doing anything', 'For actions that are hard to reverse',
    'Before deleting or overwriting', 'Never push to main/master', 'file-based memory', 'Use `$CLAUDE_JOB_DIR', 'EnterWorktree'];
  for (const file of files) {
    const text = fs.readFileSync(path.join(captures, file), 'utf8'), out = stripSteering(text);
    for (const m of removed) assert.ok(!(text.includes(m) && out.includes(m)), `${file}: still contains ${m}`);
    for (const m of kept) assert.ok(!text.includes(m) || out.includes(m), `${file}: lost ${m}`);
    assert.equal((out.match(/^---$/gm) || []).length, (text.match(/^---$/gm) || []).length, `${file}: front matter changed`);
    assert.equal(stripSteering(out), out, `${file}: not idempotent`);
  }
});
