'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toGeminiBody, listModels } = require('../backend/providers/gemini');

test('images become inlineData parts', () => {
  const body = toGeminiBody({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    }],
  });
  assert.deepEqual(body.contents[0].parts, [
    { text: 'what is this?' },
    { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
  ]);
});

test('empty messages are dropped and no generationConfig is sent by default', () => {
  const body = toGeminiBody({ messages: [{ role: 'user', content: '' }, { role: 'user', content: 'hi' }] });
  assert.equal(body.contents.length, 1);
  assert.equal(body.generationConfig, undefined);
});

test('every listed model is free and multimodal', () => {
  for (const m of listModels()) {
    assert.equal(m.free, true);
    assert.equal(m.vision, true);
  }
});
