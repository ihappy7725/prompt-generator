#!/usr/bin/env node
/* DOM 회귀 검사 (실제 브라우저의 배치·색·크기는 검사하지 않습니다).
 * 임시 의존성: npm.cmd install --prefix "$env:TEMP/promptera-qa" linkedom --ignore-scripts --no-audit --no-fund
 * 실행: node tools/check-ui.js [linkedom 모듈 경로]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const domModule = process.argv[2] || path.join(require('os').tmpdir(), 'promptera-qa/node_modules/linkedom');
const { parseHTML } = require(domModule);
const { parse: parseCSS } = require(require.resolve('cssom', { paths: [path.dirname(require.resolve(domModule))] }));
const root = path.resolve(__dirname, '..');
for (const file of ['style.css', 'home.css']) {
  assert.ok(parseCSS(fs.readFileSync(path.join(root, file), 'utf8')).cssRules.length > 0, file + ' 스타일 규칙 누락');
}
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

async function app(initialHash = '', width = 1280, bundleOnly = false, options = {}) {
  const dom = parseHTML(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  const document = dom.document;
  document.querySelectorAll('[src], link[href]').forEach(node => {
    const ref = node.getAttribute('src') || node.getAttribute('href');
    if (!/^(https?:|#)/.test(ref)) assert.ok(fs.existsSync(path.join(root, ref)), '정적 파일 누락: ' + ref);
  });
  const handlers = {};
  const storage = new Map();
  if (options.motionOff) storage.set('promptera.motion', 'off');
  const media = { matches: !!options.reduced, addEventListener(type, fn) { this.onChange = fn; } };
  const observers = [];
  let hash = initialHash;
  const win = {
    innerWidth: width, scrollTo() {}, open() {}, matchMedia() { return media; },
    addEventListener(type, callback) { (handlers[type] ||= []).push(callback); }
  };
  if (options.observer) win.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.nodes = new Set(); observers.push(this); }
    observe(node) { this.nodes.add(node); }
    unobserve(node) { this.nodes.delete(node); }
    disconnect() { this.nodes.clear(); }
    fire(node, isIntersecting) { this.callback([{ target: node, isIntersecting }]); }
  };
  const location = {
    get href() { return 'http://localhost:8765/' + hash; },
    get hash() { return hash; },
    set hash(v) {
      const next = v && !v.startsWith('#') ? '#' + v : v;
      if (next !== hash) {
        hash = next;
        setImmediate(() => (handlers.hashchange || []).forEach(fn => fn()));
      }
    }
  };
  const context = vm.createContext({
    window: win, document, location, URLSearchParams, AbortController, DOMException, console,
    history: { replaceState(a, b, url) { hash = url.slice(url.indexOf('#')); } },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    navigator: { clipboard: { async writeText(text) { context.copied = text; } } },
    fetch: async (url, init) => {
      if (url.startsWith('https://')) {
        if (!options.apiResponder) throw new Error('테스트에서 실제 API 호출은 허용하지 않습니다');
        return options.apiResponder(url, init);
      }
      if (bundleOnly) throw new Error('file protocol simulation');
      const p = path.join(root, url);
      return { ok: fs.existsSync(p), status: 404, async json() { return JSON.parse(fs.readFileSync(p, 'utf8')); } };
    },
    setTimeout: fn => { fn(); return 0; }, clearTimeout() {}, prompt: () => '테스트 조합'
  });
  // linkedom은 레이아웃 엔진이 없고 select.value 쓰기를 구현하지 않습니다.
  Object.defineProperty(dom.HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() { return this.querySelector('option[selected]')?.value || this.querySelector('option')?.value || ''; },
    set(value) { this.querySelectorAll('option').forEach(o => o.toggleAttribute('selected', o.value === String(value))); }
  });
  for (const file of ['compose.js', 'api.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  context.PC = win.PC; context.PAPI = win.PAPI;
  const dialog = document.getElementById('english-dialog');
  Object.defineProperty(dialog, 'open', { get() { return this.hasAttribute('open'); } });
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = () => { dialog.removeAttribute('open'); dialog.dispatchEvent(new dom.Event('close')); };
  vm.runInContext(fs.readFileSync(path.join(root, 'english.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'motion.js'), 'utf8'), context);
  if (bundleOnly) vm.runInContext(fs.readFileSync(path.join(root, 'data/data.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context);
  await tick();
  const get = selector => { const e = document.querySelector(selector); assert.ok(e, '요소 누락: ' + selector); return e; };
  const click = async selector => { get(selector).dispatchEvent(new dom.Event('click', { bubbles: true })); await tick(); };
  const input = async (selector, value, type = 'input') => { const e = get(selector); e.value = value; e.dispatchEvent(new dom.Event(type, { bubbles: true })); await tick(); };
  const visible = id => assert.equal(get('#view-' + id).hidden, false, id + ' 화면이 보여야 합니다');
  return { document, get, click, input, visible, location, win, handlers, context, media, storage, observers };
}

(async () => {
  const a = await app();
  a.visible('home');
  assert.equal(a.document.querySelectorAll('#home-easy .card').length, 6);
  assert.match(a.get('#home-stat').textContent, /3400개/);
  assert.equal(a.document.querySelectorAll('#mega-tool-body [data-tool="ape"]').length, 0);
  assert.equal(a.document.querySelectorAll('#home-tools [data-tool="ape"]').length, 0);
  // 추천 결과는 선택한 분야·목적·키워드를 충족해야 합니다.
  await a.input('#finder-group', 'work', 'change');
  await a.input('#finder-goal', 'write', 'change');
  await a.input('#finder-query', '메일');
  a.get('#finder-form').dispatchEvent(new a.document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(a.get('#finder-output').hidden, false);
  assert.equal(a.document.querySelectorAll('#finder-results .card').length, 3);
  a.document.querySelectorAll('#finder-results [data-open]').forEach(b => assert.match(b.dataset.open, /^email-/));
  await a.click('#finder-results [data-fav]');
  assert.equal(a.document.querySelectorAll('#finder-results .star.on').length, 1);
  await a.click('#finder-results [data-fav]');
  await a.click('#finder-results [data-quick]');
  assert.match(a.context.copied, /#역할/);
  await a.click('#finder-results [data-open]'); a.visible('detail');
  await a.click('#home');
  await a.input('#finder-query', '<img src=x onerror=alert(1)>');
  a.get('#finder-form').dispatchEvent(new a.document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(a.document.querySelectorAll('#finder-results .card').length, 0);
  assert.equal(a.document.querySelectorAll('#finder-status img').length, 0);
  assert.match(a.get('#finder-status').textContent, /찾지 못했어요/);
  await a.click('[data-finder-reset]');
  assert.equal(a.get('#finder-group').value, 'all');
  assert.equal(a.get('#finder-query').value, '');
  assert.equal(a.get('#finder-output').hidden, true);
  assert.equal(a.document.documentElement.dataset.motion, 'on');
  await a.click('#motion-toggle');
  assert.equal(a.document.documentElement.dataset.motion, 'off');
  assert.equal(a.get('.hero-art').classList.contains('motion-active'), false);
  assert.equal(a.storage.get('promptera.motion'), 'off');
  await a.click('[data-go="all"]'); a.visible('list');
  assert.match(a.location.hash, /cat=all/);
  assert.equal(a.document.querySelectorAll('#cards .card').length, 36);
  assert.match(a.get('#count').textContent, /3400개/);
  const firstPageId = a.get('#cards [data-open]').dataset.open;
  await a.click('#page-next');
  assert.match(a.location.hash, /page=2/);
  assert.notEqual(a.get('#cards [data-open]').dataset.open, firstPageId);
  const pageTwoFirstId = a.get('#cards [data-open]').dataset.open;
  await a.click('#cards [data-fav]');
  assert.equal(a.get('#cards [data-open]').dataset.open, pageTwoFirstId);
  assert.match(a.get('#page-status').textContent, /^2 \//);
  await a.click('#cards [data-fav]');
  const pageTwo = await app(a.location.hash); pageTwo.visible('list');
  assert.equal(pageTwo.get('#cards [data-open]').dataset.open, a.get('#cards [data-open]').dataset.open);
  await a.click('#page-prev');
  assert.equal(a.get('#cards [data-open]').dataset.open, firstPageId);
  await a.click('[data-mega="cat"]');
  await a.input('#category-search', '공부');
  assert.equal(a.document.querySelectorAll('#mega-cat-body [data-cat="study"]').length, 1);
  assert.equal(a.document.querySelectorAll('#mega-cat-body [data-cat="travel"]').length, 0);
  await a.click('#mega-cat-body [data-cat="study"]'); a.visible('list');
  assert.equal(a.document.querySelectorAll('#cards .card').length, 36);
  assert.match(a.get('#count').textContent, /100개/);
  assert.equal(a.get('#page-prev').disabled, true);
  await a.click('[data-open="study-006"]'); a.visible('detail');
  await a.click('#view-detail [data-act="fill-example"]');
  assert.equal(a.document.querySelectorAll('#d-preview .slot').length, 0);
  await a.click('#view-detail [data-act="copy"]');
  assert.match(a.context.copied, /암기/);
  await a.click('#view-detail [data-act="cart"]');
  await a.click('#view-detail [data-act="back"]'); a.visible('list');
  await a.click('[data-add="study-007"]');
  await a.click('#cart-btn'); a.visible('cart');
  assert.equal(a.document.querySelectorAll('#c-items li').length, 2);
  assert.match(a.get('#c-result').textContent, /STEP 2/);
  await a.click('#c-result [data-english-source="cart"]');
  assert.match(a.get('#english-original').value, /STEP 2/);
  await a.click('#english-close');
  await a.click('#c-result [data-act="toggle-api"]');
  assert.ok(a.get('#api-panel-cart').contains(a.get('#api-panel')));
  await a.click('[data-mode="chain"]');
  assert.equal(a.document.querySelectorAll('#c-result .step').length, 2);
  assert.match(a.location.hash, /m=chain/);
  await a.click('#view-cart [data-act="back"]');
  await a.click('[data-open="study-006"]');
  assert.ok(a.get('#detail-api-host').contains(a.get('#api-panel')));
  await a.click('#home'); a.visible('home');
  await a.click('#home-easy [data-open]'); a.visible('detail');
  await a.click('#home');
  await a.click('#home-easy [data-fav]');
  assert.equal(a.document.querySelectorAll('#home-easy .star.on').length, 1);
  await a.click('#home');
  await a.click('#home-generator [data-generator-example]');
  assert.match(a.get('#home-generator-task').value, /고객 불만/);
  a.get('#home-generator-form').dispatchEvent(new a.document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await tick(); a.visible('ape');
  assert.match(a.get('#ape-form textarea').value, /고객 불만/);
  await a.click('#home'); await a.click('#generator-nav'); a.visible('ape');
  assert.equal(a.get('#generator-nav').getAttribute('aria-current'), 'page');
  for (const tool of ['fw', 'question', 'tech']) {
    await a.click('#home');
    await a.click('#home-tools [data-tool="' + tool + '"]'); a.visible(tool);
    if (tool === 'fw') {
      const field = a.get('#fw-form textarea');
      await a.input('#fw-form textarea', '초보 학습자를 위한 안내');
      assert.match(a.get('#fw-preview').textContent, /초보 학습자를 위한 안내/);
      assert.equal(a.get('#fw-form textarea'), field, '입력 중 폼을 다시 만들면 초점이 끊깁니다');
    } else if (tool === 'question') {
      await a.input('#q-text', '매일 15분 공부 계획을 어떻게 세울까요?');
      assert.match(a.get('#q-preview').textContent, /매일 15분/);
    }
  }
  await a.click('#tech-body [data-tech-go="persona"]'); a.visible('list');
  assert.notEqual(a.location.hash, '');
  const techniqueIds = JSON.parse(fs.readFileSync(path.join(root, 'data/taxonomy.json'), 'utf8')).techniques.map(t => t.id);
  for (const id of techniqueIds) {
    await a.click('[data-mega="tech"]');
    await a.click('#mega-tech-body [data-tech="' + id + '"]');
    a.visible('list');
    assert.ok(a.document.querySelectorAll('#cards .card').length > 0, id + ' 기법 목록이 비어 있습니다');
    assert.match(a.location.hash, new RegExp('tech=' + id));
  }
  const lastPage = await app('#cat=all&page=99999');
  assert.equal(lastPage.get('#page-next').disabled, true);
  assert.equal(lastPage.document.querySelectorAll('#cards .card').length, 16);
  await a.click('#home'); await a.input('#search', '돈 관리');
  assert.equal(a.document.querySelectorAll('#cards .card').length, 36);
  assert.match(a.get('#count').textContent, /100개/);
  await a.click('[data-clear-filters]');
  await a.input('#group-filter', 'learn', 'change');
  assert.equal(a.document.querySelectorAll('#cards .card').length, 36);
  assert.match(a.get('#count').textContent, /400개/);
  await a.input('#category-filter', 'study', 'change');
  assert.equal(a.document.querySelectorAll('#cards .card').length, 36);
  const restored = await app(a.location.hash); restored.visible('list');
  assert.equal(restored.document.querySelectorAll('#cards .card').length, 36);
  const mobile = await app('', 390); mobile.visible('home');
  assert.equal(mobile.get('#gnb').hidden, true);
  await mobile.click('#nav-toggle');
  assert.equal(mobile.get('#gnb').hidden, false);
  await mobile.click('#nav-toggle');
  mobile.win.innerWidth = 1280; mobile.handlers.resize.forEach(fn => fn());
  assert.equal(mobile.get('#gnb').hidden, false);
  const emptyCart = await app('#c=&m=merge'); emptyCart.visible('cart');
  const safeCart = await app('#c=missing,study-006,study-006&m=invalid'); safeCart.visible('cart');
  assert.equal(safeCart.document.querySelectorAll('#c-items li').length, 1);
  const file = await app('', 1280, true); file.visible('home');
  await file.click('[data-go="all"]'); await file.click('[data-open="ai-010"]'); file.visible('detail');
  const generatedText = '# 역할\n고객 응대 담당자입니다.\n# 요청\n메일을 작성해 주세요. <img src=x onerror=alert(1)>';
  const calls = [];
  let replyStatus = 200;
  const generator = await app('#t=ape', 1280, false, { apiResponder: async (url, init) => {
    calls.push({ url, init });
    return { ok: replyStatus === 200, status: replyStatus, async text() { return replyStatus === 200 ? JSON.stringify({ choices: [{ message: { content: '```markdown\n' + generatedText + '\n```' }, finish_reason: 'stop' }] }) : 'unauthorized'; } };
  } });
  generator.visible('ape');
  assert.match(generator.get('#view-ape h1').textContent, /프롬프트 생성기/);
  await generator.click('[data-act="gen-generate"]');
  assert.match(generator.get('#gen-status').textContent, /작업을 먼저/);
  assert.equal(calls.length, 0);
  await generator.input('#ape-form textarea', '고객 불만 메일에 답장 쓰기');
  await generator.click('[data-act="gen-generate"]');
  assert.match(generator.get('#gen-status').textContent, /API 키/);
  assert.equal(calls.length, 0);
  await generator.input('#gen-key', 'test-key-not-real');
  assert.equal(calls.length, 0, '입력만으로 유료 요청을 보내면 안 됩니다');
  await generator.click('[data-act="gen-generate"]');
  assert.equal(calls.length, 1);
  assert.equal(generator.get('#gen-result').value, generatedText);
  assert.equal(generator.document.querySelectorAll('#view-ape img').length, 0);
  assert.equal(generator.get('#gen-copy').disabled, false);
  assert.equal(generator.get('#gen-submit').disabled, false);
  assert.match(JSON.parse(calls[0].init.body).messages[0].content, /완성된.*프롬프트 하나/);
  assert.ok(![...generator.storage.values()].join('').includes('test-key-not-real'), '생성기 API 키를 저장하면 안 됩니다');
  await generator.input('#gen-result', generatedText + '\n수정한 조건');
  await generator.click('[data-act="gen-copy"]');
  assert.match(generator.context.copied, /수정한 조건$/);
  await generator.click('#gen-english');
  assert.equal(generator.get('#english-original').value, generatedText + '\n수정한 조건');
  assert.equal(generator.get('#english-key').value, 'test-key-not-real');
  await generator.click('#english-close');
  await generator.input('#ape-form textarea', '여행 일정 정리');
  assert.match(generator.get('#gen-status').textContent, /이전 생성 결과/);
  replyStatus = 401;
  await generator.click('[data-act="gen-generate"]');
  assert.match(generator.get('#gen-status').textContent, /API 키가 맞지/);
  assert.match(generator.get('#gen-result').value, /수정한 조건$/);
  assert.equal(generator.get('#gen-submit').disabled, false);
  await generator.input('#gen-provider', 'gemini', 'change');
  assert.equal(generator.get('#gen-key').value, '');
  assert.equal(generator.get('#gen-model').value, 'gemini-3.8-flash');
  await generator.input('#gen-key', 'another-test-key');
  await generator.click('[data-act="gen-forget"]');
  assert.equal(generator.get('#gen-key').value, '');
  let inflight = 0;
  let settle;
  const pendingGenerator = await app('#t=ape', 390, false, { apiResponder: (url, init) => {
    inflight++;
    return new Promise(resolve => { settle = () => resolve({ ok: true, async text() { return JSON.stringify({ choices: [{ message: { content: '취소 후 도착한 오래된 결과' } }] }); } }); });
  } });
  await pendingGenerator.input('#ape-form textarea', '면접 준비');
  await pendingGenerator.input('#gen-key', 'test-only');
  await pendingGenerator.click('[data-act="gen-generate"]');
  assert.equal(pendingGenerator.get('#gen-submit').disabled, true);
  await pendingGenerator.click('[data-act="gen-generate"]');
  assert.equal(inflight, 1, '중복 생성은 요청 하나만 보내야 합니다');
  await pendingGenerator.click('[data-act="gen-cancel"]');
  assert.match(pendingGenerator.get('#gen-status').textContent, /취소/);
  assert.equal(pendingGenerator.get('#gen-submit').disabled, false);
  settle(); await tick();
  assert.equal(pendingGenerator.get('#gen-result').value, '', '취소된 요청 결과를 표시하면 안 됩니다');
  await pendingGenerator.click('[data-act="gen-generate"]');
  await pendingGenerator.click('#home');
  assert.equal(pendingGenerator.get('#gen-submit').disabled, false);
  settle(); await tick();
  assert.equal(pendingGenerator.get('#gen-result').value, '');
  console.log('생성기 검사 통과: 입력 검증·명시적 생성·결과 수정/복사·키 미저장/지우기·제공사 전환·실패 복구·중복 방지·취소·늦게 도착한 응답 무시');
  const translationCalls = [];
  let translationStatus = 200;
  let dropProtectedToken = false;
  const english = await app('#p=study-001', 390, false, { apiResponder: async (url, init) => {
    const prompt = JSON.parse(init.body).messages[0].content;
    translationCalls.push(prompt);
    const masked = JSON.parse(prompt.split('\n').pop()).prompt_to_translate;
    let answer = '# English instructions\n' + masked;
    if (dropProtectedToken) answer = answer.replace(/__PROMPTERA_KEEP_0__/, 'missing');
    return { ok: translationStatus === 200, status: translationStatus, async text() { return JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }); } };
  } });
  const koreanOriginal = english.get('#d-preview').textContent;
  await english.click('[data-english-source="detail"]');
  assert.equal(english.get('#english-dialog').open, true);
  assert.equal(english.get('#english-original').value, koreanOriginal);
  assert.equal(english.get('#english-language').value, 'ko');
  assert.equal(translationCalls.length, 0, '창을 열기만 해서는 API를 호출하면 안 됩니다');
  await english.click('#english-run');
  assert.match(english.get('#english-status').textContent, /API 키/);
  assert.equal(translationCalls.length, 0);
  await english.input('#english-key', 'translation-test-key');
  await english.click('#english-run');
  assert.equal(translationCalls.length, 1);
  assert.match(translationCalls[0], /Korean explanations/);
  assert.match(english.get('#english-result').value, /\{과목\}/);
  assert.equal(english.get('#d-preview').textContent, koreanOriginal, '변환이 원문을 바꾸면 안 됩니다');
  await english.input('#english-result', english.get('#english-result').value + '\nEdited English. <img src=x>');
  assert.equal(english.document.querySelectorAll('#english-dialog img').length, 0);
  await english.click('#english-copy');
  assert.match(english.context.copied, /Edited English/);
  assert.match(english.get('#english-status').textContent, /복사했습니다/);
  assert.ok(![...english.storage.values()].join('').includes('translation-test-key'));
  await english.input('#english-language', 'en', 'change');
  assert.equal(english.get('#english-copy').disabled, true);
  await english.click('#english-run');
  assert.match(translationCalls[1], /English explanations/);
  const goodTranslation = english.get('#english-result').value;
  dropProtectedToken = true;
  await english.click('#english-run');
  assert.match(english.get('#english-status').textContent, /보존을 확인하지 못/);
  assert.equal(english.get('#english-result').value, goodTranslation);
  dropProtectedToken = false; translationStatus = 401;
  await english.click('#english-run');
  assert.match(english.get('#english-status').textContent, /API 키가 맞지/);
  assert.equal(english.get('#english-run').disabled, false);
  const paidCalls = translationCalls.length;
  await english.click('#english-close');
  await english.click('[data-english-source="detail"]');
  assert.equal(translationCalls.length, paidCalls, '같은 원문을 다시 열 때 자동 재변환하면 안 됩니다');
  assert.equal(english.get('#english-result').value, goodTranslation);
  await english.input('#english-provider', 'gemini', 'change');
  assert.equal(english.get('#english-key').value, '');
  await english.input('#english-key', 'temporary-translation-key');
  await english.click('#english-forget');
  assert.equal(english.get('#english-key').value, '');
  await english.click('#english-close');
  english.location.hash = '#p=study-006'; await tick();
  await english.click('[data-english-source="detail"]');
  assert.equal(english.get('#english-result').value, '', '다른 원문에 이전 번역을 표시하면 안 됩니다');
  let pendingTranslation;
  let translationRequests = 0;
  const cancelEnglish = await app('#p=study-001', 1280, false, { apiResponder: (url, init) => {
    translationRequests++;
    const prompt = JSON.parse(init.body).messages[0].content;
    const masked = JSON.parse(prompt.split('\n').pop()).prompt_to_translate;
    return new Promise(resolve => { pendingTranslation = () => resolve({ ok: true, async text() { return JSON.stringify({ choices: [{ message: { content: masked } }] }); } }); });
  } });
  await cancelEnglish.click('[data-english-source="detail"]');
  await cancelEnglish.input('#english-key', 'test-cancel');
  await cancelEnglish.click('#english-run');
  await cancelEnglish.click('#english-run');
  assert.equal(translationRequests, 1);
  await cancelEnglish.click('#english-cancel');
  pendingTranslation(); await tick();
  assert.equal(cancelEnglish.get('#english-result').value, '');
  assert.equal(cancelEnglish.get('#english-run').disabled, false);
  await cancelEnglish.click('#english-run');
  await cancelEnglish.click('#english-close');
  pendingTranslation(); await tick();
  assert.equal(cancelEnglish.get('#english-result').value, '');
  console.log('영문 변환 검사 통과: 원문/생성 결과/카트 연결·한국어/영어 답변 선택·보호값 검증·편집/복사·캐시·키 미저장·실패·중복·취소');
  const reduced = await app('', 390, false, { reduced: true, observer: true });
  assert.equal(reduced.document.documentElement.dataset.motion, 'off');
  assert.equal(reduced.get('#motion-toggle').disabled, true);
  assert.equal(reduced.document.documentElement.classList.contains('motion-ready'), false);
  const paused = await app('', 1280, false, { motionOff: true });
  assert.equal(paused.document.documentElement.dataset.motion, 'off');
  const animated = await app('', 1280, false, { observer: true });
  const observer = animated.observers[0];
  const art = animated.get('.hero-art');
  assert.ok(observer.nodes.has(art));
  observer.fire(art, true);
  assert.equal(art.classList.contains('motion-active'), true);
  observer.fire(art, false);
  assert.equal(art.classList.contains('motion-active'), false);
  observer.fire(animated.get('[data-reveal]'), true);
  assert.equal(animated.get('[data-reveal]').classList.contains('is-visible'), true);
  observer.fire(art, true);
  await animated.click('[data-go="all"]');
  assert.equal(art.classList.contains('motion-active'), false);
  assert.equal(observer.nodes.has(art), false);
  animated.media.matches = true; animated.media.onChange();
  assert.equal(animated.document.documentElement.dataset.motion, 'off');
  assert.equal(animated.document.documentElement.classList.contains('motion-ready'), false);
  console.log('추가 검사 통과: 추천 분야·목적·키워드·빈 결과·초기화·복사·즐겨찾기·상세 연결, 모션 토글·저장·기기 설정·화면 밖 정지·섹션 등장');
  console.log('DOM 회귀 검사 통과: 홈 생성기 진입·도구 분리·3,400개 목록의 36개 페이지·페이지/필터 복원·카테고리 검색·상세·복사·추천·카트·기기 폭 전환·file:// 데이터');
})().catch(error => { console.error(error); process.exitCode = 1; });
