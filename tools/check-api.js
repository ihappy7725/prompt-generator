#!/usr/bin/env node
/* 실제 API 키나 네트워크 없이 제공사별 요청·응답·취소를 검사합니다. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');

function client(response, status = 200, reject) {
  const requests = [];
  const sandbox = { window: {}, fetch: async (url, init) => {
    requests.push({ url, init });
    if (reject) throw reject;
    return { ok: status >= 200 && status < 300, status, async text() { return typeof response === 'string' ? response : JSON.stringify(response); } };
  } };
  vm.runInNewContext(source, sandbox);
  return { run: sandbox.window.PAPI.run, requests };
}
const base = { key: 'test-key-never-real', model: 'test-model', prompt: '작업에 맞는 프롬프트를 만들어 주세요.', maxTokens: 4000 };

(async () => {
  const openai = client({ choices: [{ message: { content: '완성된 프롬프트' }, finish_reason: 'stop' }] });
  assert.equal(await openai.run({ ...base, provider: 'openai' }), '완성된 프롬프트');
  const request = openai.requests[0];
  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(request.init.headers.authorization, 'Bearer ' + base.key);
  assert.equal(JSON.parse(request.init.body).max_completion_tokens, 4000);

  const anthropic = client({ content: [{ type: 'thinking', thinking: '출력하지 않을 내용' }, { type: 'text', text: 'Claude 프롬프트' }], stop_reason: 'end_turn' });
  assert.equal(await anthropic.run({ ...base, provider: 'anthropic' }), 'Claude 프롬프트');
  const a = anthropic.requests[0];
  assert.equal(a.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(a.init.headers['x-api-key'], base.key);
  assert.equal(a.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(JSON.parse(a.init.body).max_tokens, 4000);

  const gemini = client({ candidates: [{ content: { parts: [{ thought: true, text: '숨긴 생각' }, { text: 'Gemini 프롬프트' }] }, finishReason: 'STOP' }] });
  assert.equal(await gemini.run({ ...base, provider: 'gemini' }), 'Gemini 프롬프트');
  const g = gemini.requests[0];
  assert.equal(g.init.headers['x-goog-api-key'], base.key);
  assert.ok(!g.url.includes(base.key));
  assert.equal(JSON.parse(g.init.body).generationConfig.maxOutputTokens, 4000);

  for (const [provider, response] of [
    ['openai', { choices: [{ message: { content: '미완성' }, finish_reason: 'length' }] }],
    ['anthropic', { content: [{ type: 'text', text: '미완성' }], stop_reason: 'max_tokens' }],
    ['gemini', { candidates: [{ content: { parts: [{ text: '미완성' }] }, finishReason: 'MAX_TOKENS' }] }]
  ]) await assert.rejects(client(response).run({ ...base, provider }), /길이 한도/);

  await assert.rejects(client({ choices: [] }).run({ ...base, provider: 'openai' }), /텍스트 결과/);
  await assert.rejects(client('<html>bad gateway</html>').run({ ...base, provider: 'openai' }), /응답을 읽지 못/);
  await assert.rejects(client({ error: base.key }, 401).run({ ...base, provider: 'openai' }), /API 키가 맞지/);
  await assert.rejects(client({}, 429).run({ ...base, provider: 'openai' }), /사용량 한도/);
  await assert.rejects(client({}, 404).run({ ...base, provider: 'openai' }), /모델 이름/);
  try { await client({ error: base.key }, 400).run({ ...base, provider: 'openai' }); }
  catch (error) { assert.ok(!error.message.includes(base.key), '오류 안내에 API 키를 노출하면 안 됩니다'); }

  const invalid = client({});
  await assert.rejects(invalid.run({ ...base, key: '', provider: 'openai' }), /API 키/);
  await assert.rejects(invalid.run({ ...base, prompt: ' ', provider: 'openai' }), /프롬프트가 비어/);
  assert.equal(invalid.requests.length, 0);
  const controller = new AbortController();
  controller.abort();
  const abort = new DOMException('Aborted', 'AbortError');
  await assert.rejects(client({}, 200, abort).run({ ...base, provider: 'openai', signal: controller.signal }), { name: 'AbortError' });

  const pure = {};
  new Function('window', fs.readFileSync(path.join(__dirname, '..', 'compose.js'), 'utf8'))(pure);
  const prompt = pure.PC.buildGenerator({ task: '고객 불만 답장', want: '300자', avoid: '근거 없는 보상 약속', count: 3, strategies: ['role'] });
  assert.match(prompt, /고객 불만 답장/);
  assert.match(prompt, /300자/);
  assert.match(prompt, /근거 없는 보상 약속/);
  assert.match(prompt, /금지·제약 조건/);
  assert.match(prompt, /완성된 프롬프트 본문만/);
  assert.match(prompt, /작업을 직접 수행하지 말고/);
  const original = '#역할\n{이름}에게 3문장, 2026-10-19까지 10,000원 이하. /종료를 입력하면 끝. https://example.com/a?q=2\n`const n = 42`\n```js\nconst secret = "원문";\n```';
  const conversion = pure.PC.prepareEnglishConversion(original, 'ko');
  assert.match(conversion.prompt, /Korean explanations/);
  assert.match(conversion.prompt, /Do not perform the task/);
  assert.equal(conversion.restore(conversion.masked), original);
  assert.match(pure.PC.prepareEnglishConversion(original, 'en').prompt, /English explanations/);
  assert.match(pure.PC.prepareEnglishConversion(original, 'preserve').prompt, /Preserve every response-language instruction/);
  assert.throws(() => conversion.restore(conversion.masked.replace(/__PROMPTERA_KEEP_0__/, 'changed')), /保존|보존/);
  assert.throws(() => conversion.restore(conversion.masked + ' __PROMPTERA_KEEP_0__'), /보존/);
  assert.throws(() => conversion.restore(conversion.masked + ' __PROMPTERA_KEEP_X__'), /보호 토큰/);
  assert.throws(() => conversion.restore(''), /비어/);
  const collision = pure.PC.prepareEnglishConversion('기존 __PROMPTERA_KEEP_0__ 표기와 {입력} 5개', 'ko');
  assert.equal(collision.restore(collision.masked), '기존 __PROMPTERA_KEEP_0__ 표기와 {입력} 5개');
  console.log('API·생성 요청 검사 통과: 제공사 3종 인증/출력 한도·응답 추출·잘림/빈 응답/오류·키 비노출·취소·생성 지시');
})().catch(error => { console.error(error); process.exitCode = 1; });
