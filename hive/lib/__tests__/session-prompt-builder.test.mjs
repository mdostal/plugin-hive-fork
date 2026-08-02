import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

import { buildPrompt } from '../session-prompt-builder.js';

async function withRecallServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const previousUrl = process.env.MNEMOSYNE_URL;
  const previousRecall = process.env.MNEMOSYNE_RECALL;
  const previousHiveScope = process.env.HIVE_MEMORY_SCOPE;
  const previousSwarmScope = process.env.SWARM_MEMORY_SCOPE;
  process.env.MNEMOSYNE_URL = `http://127.0.0.1:${port}`;
  process.env.MNEMOSYNE_RECALL = '1';
  delete process.env.HIVE_MEMORY_SCOPE;
  delete process.env.SWARM_MEMORY_SCOPE;

  try {
    await run();
  } finally {
    if (previousUrl === undefined) delete process.env.MNEMOSYNE_URL;
    else process.env.MNEMOSYNE_URL = previousUrl;
    if (previousRecall === undefined) delete process.env.MNEMOSYNE_RECALL;
    else process.env.MNEMOSYNE_RECALL = previousRecall;
    if (previousHiveScope === undefined) delete process.env.HIVE_MEMORY_SCOPE;
    else process.env.HIVE_MEMORY_SCOPE = previousHiveScope;
    if (previousSwarmScope === undefined) delete process.env.SWARM_MEMORY_SCOPE;
    else process.env.SWARM_MEMORY_SCOPE = previousSwarmScope;
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test('buildPrompt injects recalled memory bundle text after story context', async () => {
  const requests = [];
  const storyContext = [
    'target_repo: mdostal/plugin-hive-fork',
    'Build checkout memory into non-Claude session prompts.',
  ].join('\n');

  await withRecallServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ url: req.url, body: JSON.parse(body) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        bundle: {
          text: '- Use session-prompt-builder for non-Claude dispatch memory.',
        },
      }));
    });
  }, async () => {
    const prompt = await buildPrompt({ story_context: storyContext });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/recall');
    assert.match(requests[0].body.query, /Build checkout memory/);
    assert.equal(requests[0].body.scope, 'mdostal/plugin-hive-fork');
    assert.equal(requests[0].body.hits, 3);
    assert.equal(prompt.indexOf(storyContext), 0);
    assert.match(prompt, /\n\n## Recalled Memory\n- Use session-prompt-builder/);
    assert.ok(prompt.indexOf('## Recalled Memory') > prompt.indexOf(storyContext));
  });
});

test('buildPrompt is unchanged and does not throw when recall misses', async () => {
  const storyContext = 'Run the story without memory hits.';
  const specialist = {
    name: 'Tester',
    trigger_reason: 'coverage',
    persona_path: '/personas/tester.md',
  };
  const expected = [
    storyContext,
    '',
    '## Specialists Available',
    'The following specialists are available for delegation on this step:',
    '- Tester: Flagged by trigger rule "coverage" \u2014 persona at /personas/tester.md',
  ].join('\n');

  await withRecallServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ bundle: { text: '' } }));
  }, async () => {
    const prompt = await buildPrompt({
      story_context: storyContext,
      matched_specialists: [specialist],
    });

    assert.equal(prompt, expected);
  });
});
