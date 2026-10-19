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
const { parseHTML } = require(process.argv[2] || path.join(require('os').tmpdir(), 'promptera-qa/node_modules/linkedom'));
const root = path.resolve(__dirname, '..');
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

async function app(initialHash = '', width = 1280, bundleOnly = false) {
  const dom = parseHTML(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  const document = dom.document;
  const handlers = {};
  const storage = new Map();
  let hash = initialHash;
  const win = {
    innerWidth: width, scrollTo() {}, open() {},
    addEventListener(type, callback) { (handlers[type] ||= []).push(callback); }
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
    window: win, document, location, URLSearchParams, console,
    history: { replaceState(a, b, url) { hash = url.slice(url.indexOf('#')); } },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    navigator: { clipboard: { async writeText(text) { context.copied = text; } } },
    fetch: async url => {
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
  if (bundleOnly) vm.runInContext(fs.readFileSync(path.join(root, 'data/data.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context);
  await tick();
  const get = selector => { const e = document.querySelector(selector); assert.ok(e, '요소 누락: ' + selector); return e; };
  const click = async selector => { get(selector).dispatchEvent(new dom.Event('click', { bubbles: true })); await tick(); };
  const input = async (selector, value, type = 'input') => { const e = get(selector); e.value = value; e.dispatchEvent(new dom.Event(type, { bubbles: true })); await tick(); };
  const visible = id => assert.equal(get('#view-' + id).hidden, false, id + ' 화면이 보여야 합니다');
  return { document, get, click, input, visible, location, win, handlers, context };
}

(async () => {
  const a = await app();
  a.visible('home');
  assert.equal(a.document.querySelectorAll('#home-easy .card').length, 6);
  assert.match(a.get('#home-stat').textContent, /340개/);
  await a.click('[data-go="all"]'); a.visible('list');
  assert.match(a.location.hash, /cat=all/);
  assert.equal(a.document.querySelectorAll('#cards .card').length, 340);
  await a.click('[data-mega="cat"]');
  await a.input('#category-search', '공부');
  assert.equal(a.document.querySelectorAll('#mega-cat-body [data-cat="study"]').length, 1);
  assert.equal(a.document.querySelectorAll('#mega-cat-body [data-cat="travel"]').length, 0);
  await a.click('#mega-cat-body [data-cat="study"]'); a.visible('list');
  assert.equal(a.document.querySelectorAll('#cards .card').length, 10);
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
  for (const tool of ['ape', 'fw', 'question', 'tech']) {
    await a.click('#home');
    await a.click('#home-tools [data-tool="' + tool + '"]'); a.visible(tool);
    if (tool === 'ape') {
      await a.input('#ape-form textarea', '독서 모임 안내문 작성');
      assert.match(a.get('#ape-preview').textContent, /독서 모임 안내문 작성/);
    } else if (tool === 'fw') {
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
  await a.click('#home'); await a.input('#search', '돈 관리');
  assert.equal(a.document.querySelectorAll('#cards .card').length, 10);
  await a.click('[data-clear-filters]');
  await a.input('#group-filter', 'learn', 'change');
  assert.equal(a.document.querySelectorAll('#cards .card').length, 40);
  await a.input('#category-filter', 'study', 'change');
  assert.equal(a.document.querySelectorAll('#cards .card').length, 10);
  const restored = await app(a.location.hash); restored.visible('list');
  assert.equal(restored.document.querySelectorAll('#cards .card').length, 10);
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
  console.log('DOM 회귀 검사 통과: 홈·카테고리 검색·340개 목록·예시 채우기·복사·추천 카드·즐겨찾기·병합/체인·API 패널 이동·도구 4개·필터 주소 복원·메뉴 폭 전환·빈 카트·file:// 데이터');
})().catch(error => { console.error(error); process.exitCode = 1; });
