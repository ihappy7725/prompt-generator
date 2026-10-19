/* PROMPTERA 화면 로직
 * - 목록/검색/필터
 * - 상세: 빈칸 채우기 + 기법 덧붙이기 + 실시간 조립 + 복사 + AI 실행
 * - 조립 카트: 여러 프롬프트를 병합 또는 체인으로 결합
 */
(function () {
  'use strict';

  const LEVELS = ['쉬움', '보통', '전문'];
  const PAGE_SIZE = 36;
  const LS = {
    values: 'promptera.values',
    recipes: 'promptera.recipes',
    api: 'promptera.api',
    favs: 'promptera.favs',
    tools: 'promptera.tools'
  };

  const state = {
    categories: [], taxonomy: null, index: [], full: {}, catLoaded: {},
    catId: 'all', level: 'all', tech: 'all', group: 'all', query: '', page: 1,
    view: 'home', current: null, mega: null,
    values: {}, mods: [], style: 'markdown', fw: '',
    cart: [], cartMode: 'merge', cartOpts: { roleIndex: 0, multiRole: false, keepIntermediate: false },
    api: { provider: 'anthropic', model: '', key: '', remember: false },
    favs: [],
    ape: { task: '', want: '', avoid: '', strategies: [], count: 5, runToo: false },
    generator: { provider: 'openai', model: '', key: '', result: '', busy: false, controller: null },
    fwb: { id: 'costar', values: {}, task: '' },
    q: { text: '', checks: {} }
  };

  const el = {};
  ['search', 'tech-filter', 'group-filter', 'category-filter', 'category-search', 'category-search-status', 'levels', 'cart-btn', 'cart-n', 'nav-toggle', 'gnb',
    'fav-btn', 'fav-n', 'cat-title', 'cat-desc', 'count', 'cards', 'empty',
    'mega-cat', 'mega-tech', 'mega-tool', 'mega-cat-body', 'mega-tech-body', 'mega-tool-body',
    'mega-cat-count', 'mega-tech-count',
    'view-home', 'home-stat', 'home-groups', 'home-tools', 'home-easy',
    'finder-form', 'finder-group', 'finder-goal', 'finder-query', 'finder-output', 'finder-status', 'finder-results',
    'generator-nav', 'home-generator-form', 'home-generator-task', 'list-pagination', 'page-prev', 'page-next', 'page-status',
    'view-list', 'view-detail', 'view-cart', 'toast', 'home',
    'd-title', 'd-summary', 'd-meta', 'd-form', 'd-mods', 'd-style', 'd-fw', 'd-preview',
    'd-left', 'd-score', 'd-expect', 'd-follow', 'api-panel',
    'c-items', 'c-empty', 'c-mode', 'c-opts', 'c-form', 'c-result', 'c-warn', 'c-suggest', 'c-saved',
    'view-ape', 'view-fw', 'view-question', 'view-tech',
    'ape-form', 'ape-strategies', 'ape-count', 'ape-preview',
    'gen-provider', 'gen-model', 'gen-key', 'gen-key-help', 'gen-submit', 'gen-cancel', 'gen-status', 'gen-result', 'gen-copy', 'gen-open',
    'fw-picker', 'fw-use', 'fw-form', 'fw-task', 'fw-preview', 'fw-left',
    'q-text', 'q-checks', 'q-score', 'q-preview', 'tech-body', 'tech-count'
  ].forEach(id => { el[id] = document.getElementById(id); });

  const VIEWS = ['home', 'list', 'detail', 'cart', 'ape', 'fw', 'question', 'tech'];

  const TOOLS = [
    { id: 'ape', cmd: '/ape', name: 'AI 프롬프트 생성기', desc: '내 API 키로, 원하는 작업에 맞는 완성된 프롬프트를 생성합니다' },
    { id: 'fw', cmd: '/fw', name: '프레임워크 빌더', desc: '정해진 칸을 채워 빠뜨리는 것 없이' },
    { id: 'question', cmd: '/ask', name: '질문 다듬기', desc: '묻기 전에 질문부터 점검합니다' },
    { id: 'tech', cmd: '/tech', name: '기법 사전', desc: '수업에서 배운 기법 24개를 한곳에' }
  ];

  /* ---------- 유틸 ---------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function markSlots(text) {
    return esc(text).replace(/\{[^{}]*\}/g, m => '<span class="slot">' + m + '</span>');
  }

  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1800);
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast((label || '복사했습니다') + ' · ' + text.length.toLocaleString() + '자');
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('복사했습니다'); } catch (e2) { toast('복사가 막혔습니다. 직접 선택해 복사해 주세요'); }
      document.body.removeChild(ta);
      return false;
    }
  }

  function store(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 저장이 막힌 환경 */ }
  }
  function restore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  /* ---------- 데이터 ---------- */

  function loadBundleScript() {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'data/data.js';
      s.onload = () => resolve(window.PROMPTERA_DATA);
      s.onerror = () => reject(new Error('data/data.js 를 읽지 못했습니다'));
      document.head.appendChild(s);
    });
  }

  async function loadData() {
    try {
      const [cats, idx] = await Promise.all([
        fetch('data/categories.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
        fetch('data/index.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      ]);
      state.categories = cats.categories;
      state.taxonomy = cats.taxonomy;
      state.index = idx.items;
      return 'fetch';
    } catch (e) {
      const bundle = window.PROMPTERA_DATA || await loadBundleScript();
      state.categories = bundle.categories;
      state.taxonomy = bundle.taxonomy;
      state.index = bundle.prompts.map(p => ({
        id: p.id, c: p.categoryId, t: p.title, s: p.summary,
        l: p.level, g: p.tags, k: p.techniques, y: p.type, n: (p.placeholders || []).length, h: p.scenarioId || p.id
      }));
      bundle.prompts.forEach(p => { state.full[p.id] = p; });
      state.categories.forEach(c => { state.catLoaded[c.id] = true; });
      return 'bundle';
    }
  }

  async function ensureCategory(catId) {
    if (state.catLoaded[catId]) return;
    const res = await fetch('data/prompts/' + catId + '.json');
    if (!res.ok) throw new Error(catId + ' 데이터를 읽지 못했습니다');
    const o = await res.json();
    o.prompts.forEach(p => { state.full[p.id] = p; });
    state.catLoaded[catId] = true;
  }

  async function ensureFull(id) {
    if (state.full[id]) return state.full[id];
    const row = state.index.filter(r => r.id === id)[0];
    if (!row) return null;
    await ensureCategory(row.c);
    return state.full[id] || null;
  }

  function catById(id) { return state.categories.filter(c => c.id === id)[0]; }
  function techById(id) { return (state.taxonomy.techniques || []).filter(t => t.id === id)[0]; }
  function fwById(id) { return (state.taxonomy.frameworks || []).filter(f => f.id === id)[0]; }

  /* ---------- 사이드바 / 필터 ---------- */

  function groups() { return (state.taxonomy && state.taxonomy.groups) || []; }

  function groupOf(catId) {
    return groups().filter(g => g.categories.indexOf(catId) >= 0)[0] || null;
  }

  /** 카테고리 메가 메뉴: 대분류로 묶어서 보여 준다 */
  function renderCategories() {
    const query = el['category-search'].value.trim().toLowerCase();
    let matches = 0;
    el['fav-n'].textContent = String(state.favs.length);
    el['mega-cat-count'].textContent = '카테고리 ' + state.categories.length + '개 · 프롬프트 ' + state.index.length + '개';
    el['mega-cat-body'].innerHTML = groups().filter(g => g.categories.some(id => {
      const c = catById(id);
      return c && (g.name + ' ' + c.name + ' ' + c.description + ' ' + c.command).toLowerCase().includes(query);
    })).map(g =>
      '<div class="group"><h3><span class="no">' + esc(g.no) + '</span> ' + esc(g.name) + '</h3><ul>' +
      g.categories.map(id => {
        const c = catById(id);
        if (!c || !(g.name + ' ' + c.name + ' ' + c.description + ' ' + c.command).toLowerCase().includes(query)) return '';
        matches++;
        return '<li><button type="button" data-cat="' + esc(c.id) + '">' +
          '<span class="cmd">' + esc(c.command) + '</span>' + esc(c.name) +
          '<span class="n">' + (c.count || 0) + '</span></button></li>';
      }).join('') + '</ul></div>'
    ).join('') +
    '<div class="group"><h3><span class="no">08</span> 모아 보기</h3><ul>' +
      '<li><button type="button" data-cat="all"><span class="cmd">/all</span>전체<span class="n">' + state.index.length + '</span></button></li>' +
      '<li><button type="button" data-cat="fav"><span class="cmd">/fav</span>즐겨찾기<span class="n">' + state.favs.length + '</span></button></li>' +
    '</ul></div>';
    el['category-search-status'].textContent = query ? (matches ? matches + '개 카테고리를 찾았습니다' : '찾은 카테고리가 없습니다. 다른 검색어를 입력해 주세요.') : '상황이나 카테고리 이름으로 찾아보세요';
  }

  /** 기법 메가 메뉴: 수업 일차별로 */
  function renderTechList() {
    const counts = {};
    state.index.forEach(r => (r.k || []).forEach(k => { counts[k] = (counts[k] || 0) + 1; }));
    el['mega-tech-count'].textContent = '기법 ' + state.taxonomy.techniques.length + '개';
    const dayName = { 1: 'DAY 1 · 기본기', 2: 'DAY 2 · 패턴', 3: 'DAY 3 · 고급' };
    el['mega-tech-body'].innerHTML = [1, 2, 3].map(d =>
      '<div class="tech-col"><h3>' + dayName[d] + '</h3><ul>' +
      state.taxonomy.techniques.filter(t => t.day === d).map(t =>
        '<li><button type="button" data-tech="' + esc(t.id) + '" title="' + esc(t.oneLine) + '">' +
        esc(t.name) + '<span class="n">' + (counts[t.id] || 0) + '</span></button></li>'
      ).join('') + '</ul></div>'
    ).join('') +
    '<div class="tech-col"><h3>사전</h3><ul>' +
      '<li><button type="button" data-tool="tech">기법 사전 전체 보기</button></li>' +
      '<li><button type="button" data-tech="all">기법 필터 끄기</button></li>' +
    '</ul></div>';
  }

  function renderToolMenu() {
    const html = TOOLS.filter(t => t.id !== 'ape').map(t =>
      '<button class="tool-card" type="button" data-tool="' + esc(t.id) + '">' +
      '<span class="cmd">' + esc(t.cmd) + '</span>' +
      '<strong>' + esc(t.name) + '</strong>' +
      '<span>' + esc(t.desc) + '</span></button>'
    ).join('');
    el['mega-tool-body'].innerHTML = html;
    el['home-tools'].innerHTML = html;
  }

  /* ---------- 홈 ---------- */

  function renderHome() {
    const slots = state.index.reduce((a, r) => a + (r.n || 0), 0);
    el['home-stat'].innerHTML = [
      ['프롬프트', state.index.length + '개'],
      ['카테고리', state.categories.length + '개'],
      ['기법', state.taxonomy.techniques.length + '개'],
      ['채울 빈칸', slots + '개']
    ].map(x => '<div><b>' + esc(x[1]) + '</b><span>' + esc(x[0]) + '</span></div>').join('');

    el['home-groups'].innerHTML = groups().map(g => {
      const n = g.categories.reduce((a, id) => a + ((catById(id) || {}).count || 0), 0);
      return '<article class="group-card">' +
        '<span class="group-symbol" aria-hidden="true">' + ['◒', '✳', '✦', '↗', '◎', '⌘', '◓'][groups().indexOf(g)] + '</span>' +
        '<span class="no">' + esc(g.no) + '</span>' +
        '<h3>' + esc(g.name) + '</h3>' +
        '<p class="desc">' + esc(g.desc) + ' · ' + n + '개</p>' +
        '<div class="chips">' + g.categories.map(id => {
          const c = catById(id);
          return c ? '<button class="chip" type="button" data-cat="' + esc(c.id) + '">' + esc(c.name) + '</button>' : '';
        }).join('') + '</div>' +
      '</article>';
    }).join('');

    const easy = state.index
      .filter(r => r.l === '쉬움')
      .sort((a, b) => (a.n || 0) - (b.n || 0))
      .slice(0, 6);
    el['home-easy'].innerHTML = easy.map(cardHtml).join('');

    if (!el['finder-group'].dataset.ready) {
      el['finder-group'].innerHTML = '<option value="all">모든 분야</option>' + groups().map(g =>
        '<option value="' + esc(g.id) + '">' + esc(g.name) + '</option>'
      ).join('');
      el['finder-group'].dataset.ready = 'true';
    }
  }

  /* 분야와 목적에 맞는 항목을 색인의 제목·설명·태그로 추천합니다. */
  const FINDER_GOALS = {
    write: { name: '글·메시지 작성', words: ['작성', '쓰기', '문구', '메시지', '대본', '소개', '메일', '답변', '글쓰기'] },
    organize: { name: '정리·요약', words: ['정리', '요약', '분류', '기록', '목록', '묶기', '핵심'] },
    plan: { name: '계획·준비', words: ['계획', '준비', '일정', '설계', '루틴', '순서', '목표', '체크'] },
    decide: { name: '비교·선택', words: ['비교', '선택', '결정', '판단', '장단점', '우선순위', '고르기', '합의'] },
    review: { name: '검토·개선', words: ['점검', '검토', '개선', '오류', '검수', '회고', '수정', '고치기', '다듬기'] },
    learn: { name: '배우기·연습', words: ['연습', '배우', '공부', '학습', '이해', '설명', '암기', '복습', '문제'] }
  };

  function recommendPrompts() {
    const group = groups().find(g => g.id === el['finder-group'].value);
    const goal = FINDER_GOALS[el['finder-goal'].value];
    const query = el['finder-query'].value.trim();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const candidates = state.index.map(r => {
      if (group && !group.categories.includes(r.c)) return null;
      const category = catById(r.c);
      const title = r.t.toLowerCase();
      const text = (r.t + ' ' + r.s + ' ' + r.g.join(' ') + ' ' + (category ? category.name : '')).toLowerCase();
      if (terms.some(term => !text.includes(term))) return null;
      const goalHits = goal ? goal.words.filter(word => text.includes(word)) : [];
      if (goal && !goalHits.length) return null;
      let score = (r.l === '쉬움' ? 4 : 0) + Math.max(0, 6 - r.n);
      terms.forEach(term => { score += title.includes(term) ? 15 : 6; });
      goalHits.forEach(word => { score += title.includes(word) ? 8 : 2; });
      return { row: r, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
    const top = [];
    const usedScenarios = new Set();
    for (const candidate of candidates) {
      const key = candidate.row.h || candidate.row.id;
      if (usedScenarios.has(key)) continue;
      top.push(candidate); usedScenarios.add(key);
      if (top.length === 3) break;
    }
    const selected = [group ? group.name : '모든 분야', goal ? goal.name : '모든 작업', query ? '“' + query + '”' : ''].filter(Boolean).join(' · ');
    el['finder-output'].hidden = false;
    el['finder-status'].textContent = top.length ? selected + ' — 조건에 맞는 ' + candidates.length + '개 중 ' + top.length + '개를 골랐어요.' : selected + ' — 맞는 프롬프트를 찾지 못했어요. 키워드를 줄이거나 분야·목적을 바꿔 보세요.';
    el['finder-results'].innerHTML = top.map(({ row }) => {
      const c = catById(row.c);
      const reason = (c ? c.name : '') + (goal ? ' · ' + goal.name : '') + ' · 빈칸 ' + row.n + '개';
      return cardHtml(row).replace('<article class="card">', '<article class="card"><p class="finder-reason">' + esc(reason) + '</p>');
    }).join('');
  }

  function renderFilters() {
    el.levels.innerHTML = ['all'].concat(LEVELS).map(l =>
      '<button type="button" data-level="' + l + '" aria-pressed="' + (state.level === l) + '">' +
      (l === 'all' ? '전체' : l) + '</button>'
    ).join('');

    el['tech-filter'].innerHTML = '<option value="all">기법 전체</option>' +
      state.taxonomy.techniques.map(t =>
        '<option value="' + esc(t.id) + '"' + (state.tech === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'
      ).join('');

    el['group-filter'].innerHTML = '<option value="all">분류 전체</option>' +
      groups().map(g =>
        '<option value="' + esc(g.id) + '"' + (state.group === g.id ? ' selected' : '') + '>' + esc(g.no) + ' ' + esc(g.name) + '</option>'
      ).join('');

    el['category-filter'].innerHTML = '<option value="all">카테고리 전체</option>' +
      (state.catId === 'fav' ? '<option value="fav" selected>즐겨찾기</option>' : '') +
      groups().filter(g => state.group === 'all' || g.id === state.group).map(g =>
        '<optgroup label="' + esc(g.name) + '">' + g.categories.map(id => {
          const c = catById(id);
          return c ? '<option value="' + esc(id) + '"' + (state.catId === id ? ' selected' : '') + '>' + esc(c.name) + '</option>' : '';
        }).join('') + '</optgroup>'
      ).join('');

    el['d-fw'].innerHTML = '<option value="">프레임워크 없음</option>' +
      state.taxonomy.frameworks.map(f =>
        '<option value="' + esc(f.id) + '">' + esc(f.name) + ' · ' + esc(f.use) + '</option>'
      ).join('');
  }

  /* ---------- 목록 ---------- */

  function filtered() {
    const q = state.query.trim().toLowerCase();
    return state.index.filter(r => {
      if (state.catId === 'fav') { if (!isFav(r.id)) return false; }
      else if (state.catId !== 'all' && r.c !== state.catId) return false;
      if (state.group !== 'all') {
        const g = groupOf(r.c);
        if (!g || g.id !== state.group) return false;
      }
      if (state.level !== 'all' && r.l !== state.level) return false;
      if (state.tech !== 'all' && (r.k || []).indexOf(state.tech) < 0) return false;
      if (!q) return true;
      const c = catById(r.c);
      const g = groupOf(r.c);
      return (r.t + ' ' + r.s + ' ' + (r.g || []).join(' ') + ' ' + (c ? c.name + ' ' + c.command : '') + ' ' + (g ? g.name : '')).toLowerCase().indexOf(q) >= 0;
    });
  }

  function levelClass(l) { const i = LEVELS.indexOf(l); return 'lv' + (i < 0 ? 0 : i + 1); }

  function cardHtml(r) {
    const c = catById(r.c);
    const fav = isFav(r.id);
    const techs = (r.k || []).slice(0, 3).map(k => {
      const tt = techById(k);
      return tt ? '<li title="' + esc(tt.oneLine) + '">' + esc(tt.name) + '</li>' : '';
    }).join('');
    return '<article class="card">' +
      '<div class="card-top">' +
        '<h2>' + esc(r.t) + '</h2>' +
        '<span class="level ' + levelClass(r.l) + '">' + esc(r.l) + '</span>' +
        '<button class="star' + (fav ? ' on' : '') + '" type="button" data-fav="' + esc(r.id) + '"' +
        ' aria-pressed="' + fav + '" aria-label="즐겨찾기">' + (fav ? '★' : '☆') + '</button>' +
      '</div>' +
      '<p class="summary">' + esc(r.s) + '</p>' +
      '<p class="cmd-line">' + esc(c ? c.command : '') + ' · 빈칸 ' + r.n + '개</p>' +
      '<ul class="tags">' + techs + '</ul>' +
      '<div class="card-actions">' +
        '<button class="btn btn-copy" type="button" data-open="' + esc(r.id) + '">빈칸 채우기</button>' +
        '<button class="btn" type="button" data-quick="' + esc(r.id) + '">바로 복사</button>' +
        '<button class="btn" type="button" data-add="' + esc(r.id) + '">담기</button>' +
      '</div>' +
    '</article>';
  }

  function renderList(keepPage) {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = keepPage === true ? Math.min(pages, Math.max(1, state.page)) : 1;
    const start = (state.page - 1) * PAGE_SIZE;
    const cat = (state.catId === 'all' || state.catId === 'fav') ? null : catById(state.catId);
    const t = techById(state.tech);
    const g = groups().filter(x => x.id === state.group)[0];
    const favView = state.catId === 'fav';

    el['cat-title'].textContent = favView ? '즐겨찾기'
      : (cat ? cat.name : (g ? g.name : (t ? t.name + ' 기법' : '전체 프롬프트')));
    el['cat-desc'].textContent = favView ? '별을 눌러 담아 둔 프롬프트입니다. 이 브라우저에만 저장됩니다.'
      : (cat ? cat.description : (g ? g.desc : (t ? t.oneLine : '상황에 맞는 프롬프트를 고르고 빈칸만 채우세요.')));
    el.count.textContent = rows.length + '개' + (state.query ? ' · 검색: ' + state.query : '') +
      (t ? ' · 기법: ' + t.name : '') + (state.level !== 'all' ? ' · ' + state.level : '');

    el.cards.innerHTML = rows.slice(start, start + PAGE_SIZE).map(cardHtml).join('');
    el['list-pagination'].hidden = rows.length <= PAGE_SIZE;
    el['page-prev'].disabled = state.page <= 1;
    el['page-next'].disabled = state.page >= pages;
    el['page-status'].textContent = state.page + ' / ' + pages + ' 페이지 · ' + (rows.length ? start + 1 : 0) + '–' + Math.min(start + PAGE_SIZE, rows.length) + ' / ' + rows.length + '개';

    el.empty.hidden = rows.length > 0;
    if (!rows.length) {
      const narrowed = state.catId !== 'all' || state.tech !== 'all' || state.level !== 'all' || state.group !== 'all';
      el.empty.innerHTML = narrowed
        ? '이 조건에서는 찾은 것이 없습니다. <button class="btn btn-mini" type="button" data-reset="1">전체에서 다시 찾기</button>'
        : '검색어에 맞는 프롬프트가 없습니다. 다른 낱말로 찾아 보세요.';
    }
  }

  /* ---------- 보기 전환 ---------- */

  function show(view) {
    if (view !== 'ape' && state.generator.busy) cancelGeneration();
    state.view = view;
    el['generator-nav'].toggleAttribute('aria-current', view === 'ape');
    if (view === 'ape') el['generator-nav'].setAttribute('aria-current', 'page');
    VIEWS.forEach(v => { el['view-' + v].hidden = v !== view; });
    const section = el['view-' + view];
    section.classList.remove('view-enter');
    // 레이아웃은 한 번만 읽어 CSS 진입 모션을 다시 시작합니다.
    void section.offsetWidth;
    section.classList.add('view-enter');
    if (window.PMOTION) window.PMOTION.refresh(view);
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  /** 지금 화면에서 만들어진 프롬프트 (복사·AI 실행에 쓴다) */
  function activeText() {
    if (state.view === 'cart') return lastCartText;
    if (state.view === 'ape') return apeText();
    if (state.view === 'fw') return fwText();
    if (state.view === 'question') return qText();
    if (state.view === 'detail' && state.current) return currentText();
    return '';
  }

  /* ---------- 빈칸 폼 ---------- */

  function formRow(slot, override) {
    const raw = override !== undefined ? override : state.values[slot.key];
    const v = raw == null ? '' : raw;
    const id = 'f-' + slot.key.replace(/\s+/g, '_');
    let input;
    if (slot.type === 'textarea') {
      input = '<textarea id="' + esc(id) + '" data-key="' + esc(slot.key) + '" rows="3" placeholder="' + esc(slot.example || '') + '">' + esc(v) + '</textarea>';
    } else if (slot.type === 'select' && slot.options) {
      input = '<select id="' + esc(id) + '" data-key="' + esc(slot.key) + '" class="select">' +
        '<option value="">고르기</option>' +
        slot.options.map(o => '<option value="' + esc(o) + '"' + (v === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('') +
        '</select>';
    } else {
      input = '<input id="' + esc(id) + '" data-key="' + esc(slot.key) + '" type="text" value="' + esc(v) + '" placeholder="' + esc(slot.example || '') + '">';
    }
    return '<div class="field' + (v ? ' done' : '') + '">' +
      '<label for="' + esc(id) + '">' + esc(slot.label || slot.key) +
      (slot.from ? ' <span class="from">' + esc(slot.from) + '</span>' : '') +
      '</label>' + input +
      (slot.help ? '<p class="help">' + esc(slot.help) + '</p>' : '') +
      '</div>';
  }

  function detailSlots() {
    const p = state.current;
    const base = (p.placeholders || []).slice();
    const extra = PC.applyModifiers(p.blocks, state.mods).slots;
    extra.forEach(s => { if (!base.some(b => b.key === s.key)) base.push(s); });
    // 블록 안에 있지만 placeholders에 빠진 빈칸도 폼에 넣는다
    PC.slotsInBlocks(p.blocks).forEach(k => {
      if (!base.some(b => b.key === k)) base.push({ key: k, label: k, example: '', type: 'text' });
    });
    return base;
  }

  function renderMods() {
    const recommended = (state.current.techniques || []);
    el['d-mods'].innerHTML = PC.MODIFIERS.map(m => {
      const on = state.mods.indexOf(m.id) >= 0;
      const rec = recommended.indexOf(m.tech) >= 0;
      return '<button class="chip' + (on ? ' on' : '') + (rec ? ' rec' : '') + '" type="button" data-mod="' + esc(m.id) + '"' +
        ' title="' + esc(m.hint) + '" aria-pressed="' + on + '">' + esc(m.name) + '</button>';
    }).join('');
  }

  function currentText() {
    return PC.render(state.current, {
      values: state.values, modifiers: state.mods,
      style: state.style, framework: state.fw ? fwById(state.fw) : null
    }).text;
  }

  function updatePreview() {
    const text = currentText();
    el['d-preview'].innerHTML = markSlots(text);
    const left = PC.slotsIn(text);
    el['d-left'].textContent = left.length ? '남은 빈칸 ' + left.length + '개' : '빈칸 없음 · 바로 쓸 수 있습니다';
    const s = PC.scoreKeys(text);
    const weak = s.rows.slice().sort((a, b) => a.score - b.score)[0];
    el['d-score'].textContent = '5가지 열쇠 점수 ' + s.total + '/100 · 보완점: ' + weak.name + ' — ' + weak.note;
    store(LS.values, state.values);
  }

  function renderDetail() {
    const p = state.current;
    const c = catById(p.categoryId);
    el['d-title'].textContent = p.title;
    el['d-summary'].textContent = p.summary;
    const techNames = (p.techniques || []).map(k => { const t = techById(k); return t ? t.name : k; });
    el['d-meta'].textContent = (c ? c.command + ' · ' : '') + p.level +
      ' · 빈칸 ' + (p.placeholders || []).length + '개' +
      (techNames.length ? ' · 쓰인 기법: ' + techNames.join(', ') : '') +
      (p.blocksSource === 'manual' ? ' · 다듬은 견본' : '');

    el['d-form'].innerHTML = detailSlots().map(formRow).join('');
    renderMods();

    [].forEach.call(el['d-style'].querySelectorAll('button'), b => {
      b.setAttribute('aria-pressed', String(b.dataset.style === state.style));
    });
    el['d-fw'].value = state.fw;

    if (p.example && p.example.expect) {
      el['d-expect'].hidden = false;
      el['d-expect'].innerHTML = '<strong>이런 결과가 옵니다</strong><br>' + esc(p.example.expect);
    } else { el['d-expect'].hidden = true; }

    if ((p.followUps || []).length) {
      el['d-follow'].hidden = false;
      el['d-follow'].innerHTML = '<h2 class="panel-title">답을 받은 뒤 이어서 쓸 프롬프트</h2>' +
        p.followUps.map((f, i) =>
          '<div class="follow-row"><p>' + markSlots(f) + '</p>' +
          '<button class="btn btn-mini" type="button" data-follow="' + i + '">복사</button></div>'
        ).join('');
    } else { el['d-follow'].hidden = true; }

    renderFavButton();
    updatePreview();
  }

  async function openDetail(id) {
    const p = await ensureFull(id);
    if (!p) { toast('프롬프트를 찾지 못했습니다'); return; }
    state.current = p;
    state.mods = [];
    state.fw = '';
    document.getElementById('detail-api-host').appendChild(el['api-panel']);
    el['api-panel'].hidden = true;
    show('detail');
    renderDetail();
    location.hash = 'p=' + id;
  }

  /* ---------- AI 실행 패널 ---------- */

  function renderApiPanel() {
    const prov = PAPI.PROVIDERS.filter(p => p.id === state.api.provider)[0] || PAPI.PROVIDERS[0];
    if (!state.api.model) state.api.model = prov.model;

    el['api-panel'].innerHTML =
      '<p class="warn">API 키는 비밀번호와 같습니다. 이 화면에서 넣은 키는 브라우저에서 바로 서비스로 전송되고, 저장을 켜면 이 브라우저에만 남습니다. 공용 컴퓨터에서는 저장하지 마세요.</p>' +
      '<div class="row">' +
        '<select id="api-prov" class="select" aria-label="서비스">' +
          PAPI.PROVIDERS.map(p => '<option value="' + p.id + '"' + (p.id === state.api.provider ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
        '</select>' +
        '<input id="api-model" type="text" value="' + esc(state.api.model) + '" placeholder="모델 이름" aria-label="모델 이름">' +
      '</div>' +
      '<div class="row">' +
        '<input id="api-key" type="password" value="' + esc(state.api.key) + '" placeholder="' + esc(prov.keyHint) + '" aria-label="API 키" autocomplete="off">' +
        '<label class="chk"><input id="api-remember" type="checkbox"' + (state.api.remember ? ' checked' : '') + '> 이 브라우저에 저장</label>' +
      '</div>' +
      '<p class="hint">' + esc(prov.where) + ' · 모델 이름은 바뀔 수 있습니다. 404 오류가 나면 서비스 문서에서 최신 이름을 확인해 고쳐 주세요.</p>' +
      '<div class="row"><button class="btn btn-copy" type="button" data-act="api-run">보내기</button>' +
      '<button class="btn" type="button" data-act="api-forget">저장한 키 지우기</button></div>' +
      '<div id="api-out" class="api-out" hidden></div>';
  }

  async function apiRun() {
    const out = document.getElementById('api-out');
    state.api.provider = document.getElementById('api-prov').value;
    state.api.model = document.getElementById('api-model').value.trim();
    state.api.key = document.getElementById('api-key').value.trim();
    state.api.remember = document.getElementById('api-remember').checked;

    if (state.api.remember) store(LS.api, state.api);
    else store(LS.api, { provider: state.api.provider, model: state.api.model });

    const text = activeText();
    const left = PC.slotsIn(text);
    if (left.length && !confirm('아직 채우지 않은 빈칸이 ' + left.length + '개 있습니다. 그대로 보낼까요?')) return;

    out.hidden = false;
    out.innerHTML = '<p class="hint">보내는 중…</p>';
    try {
      const answer = await PAPI.run({
        provider: state.api.provider, key: state.api.key,
        model: state.api.model, prompt: text
      });
      out.innerHTML = '<div class="row"><strong>결과</strong>' +
        '<button class="btn btn-mini" type="button" data-act="api-copy">결과 복사</button></div>' +
        '<pre class="body">' + esc(answer) + '</pre>';
      out.dataset.answer = answer;
    } catch (e) {
      out.innerHTML = '<p class="err">' + esc(e.message) + '</p>';
    }
  }

  /* ---------- 조립 카트 ---------- */

  function cartItems() {
    return state.cart.map(id => state.full[id]).filter(Boolean);
  }

  function cartSlots() {
    const items = cartItems();
    const out = [];
    items.forEach(it => {
      (it.placeholders || []).forEach(s => { if (!out.some(x => x.key === s.key)) out.push(s); });
      PC.slotsInBlocks(it.blocks).forEach(k => {
        if (!out.some(x => x.key === k)) out.push({ key: k, label: k, example: '', type: 'text' });
      });
    });
    if (state.cartMode === 'chain' && items.length > 1) {
      out.push({ key: PC.CHAIN_SLOT, label: PC.CHAIN_SLOT, help: '앞 단계에서 받은 답을 그대로 붙여넣는 자리입니다. 비워 두면 그대로 남습니다.', type: 'textarea' });
    }
    return out;
  }

  let lastCartText = '';
  function cartText() { return lastCartText; }

  function renderCart() {
    const items = cartItems();
    el['c-empty'].hidden = items.length > 0;
    el['c-items'].innerHTML = items.map((it, i) =>
      '<li><span class="num">' + (i + 1) + '</span>' +
      '<span class="ci-title">' + esc(it.title) + '<span class="ci-sub">' + esc((catById(it.categoryId) || {}).name || '') + '</span></span>' +
      '<span class="ci-acts">' +
        '<button class="btn btn-mini" type="button" data-up="' + i + '" aria-label="위로">↑</button>' +
        '<button class="btn btn-mini" type="button" data-down="' + i + '" aria-label="아래로">↓</button>' +
        '<button class="btn btn-mini" type="button" data-rm="' + i + '" aria-label="제거">✕</button>' +
      '</span></li>'
    ).join('');

    [].forEach.call(el['c-mode'].querySelectorAll('button'), b => {
      b.setAttribute('aria-pressed', String(b.dataset.mode === state.cartMode));
    });

    const roles = items.map(it => (it.blocks && it.blocks.role) || '').filter(Boolean);
    if (state.cartMode === 'merge') {
      el['c-opts'].innerHTML =
        '<label class="chk"><input type="checkbox" data-opt="multiRole"' + (state.cartOpts.multiRole ? ' checked' : '') + '> 역할을 모두 쓰기 (다중 관점)</label>' +
        '<label class="chk"><input type="checkbox" data-opt="keepIntermediate"' + (state.cartOpts.keepIntermediate ? ' checked' : '') + '> 중간 단계 결과도 받기</label>' +
        (roles.length > 1 && !state.cartOpts.multiRole
          ? '<label class="chk">쓸 역할: <select class="select" data-opt="roleIndex">' +
            roles.map((r, i) => '<option value="' + i + '"' + (state.cartOpts.roleIndex === i ? ' selected' : '') + '>' +
              esc(r.replace(/^당신은\s*/, '').slice(0, 40)) + '</option>').join('') +
            '</select></label>'
          : '');
    } else {
      el['c-opts'].innerHTML = '<p class="hint">단계마다 따로 복사해서 차례로 보내세요. 2단계부터는 앞 단계 결과를 붙여넣는 자리가 생깁니다.</p>';
    }

    el['c-form'].innerHTML = cartSlots().map(formRow).join('') || '<p class="hint">담은 프롬프트에 빈칸이 없습니다.</p>';

    renderCartResult(items);
    renderSuggest(items);
    renderSaved();
    el['cart-n'].textContent = String(state.cart.length);
  }

  function renderCartResult(items) {
    if (el['c-result'].contains(el['api-panel'])) {
      document.getElementById('detail-api-host').appendChild(el['api-panel']);
      el['api-panel'].hidden = true;
    }
    if (!items.length) {
      el['c-result'].innerHTML = '<p class="hint">담은 프롬프트가 없습니다.</p>';
      el['c-warn'].innerHTML = '';
      lastCartText = '';
      return;
    }

    if (state.cartMode === 'merge') {
      const m = PC.merge(items, state.cartOpts);
      const r = PC.render({ blocks: m.blocks }, { values: state.values, style: state.style });
      lastCartText = r.text;
      const left = PC.slotsIn(r.text);
      el['c-result'].innerHTML =
        '<p class="count">' + items.length + '개를 하나로 합쳤습니다 · ' +
        (left.length ? '남은 빈칸 ' + left.length + '개' : '빈칸 없음') + '</p>' +
        '<pre class="body">' + markSlots(r.text) + '</pre>' +
        '<div class="row">' +
          '<button class="btn btn-copy" type="button" data-act="c-copy">복사</button>' +
          '<button class="btn" type="button" data-act="toggle-api">AI로 바로 실행</button>' +
        '</div><div id="api-panel-cart"></div>';
      el['c-warn'].innerHTML = m.conflicts.length
        ? '<div class="warn"><strong>조건이 부딪칠 수 있습니다</strong><ul>' +
          m.conflicts.map(c => '<li>' + esc(c.kind) + ': ' +
            c.hits.map(h => esc(h.title) + ' — ' + esc(h.line.slice(0, 60))).join(' / ') + '</li>').join('') +
          '</ul>하나로 정리하거나, 체인으로 나눠 보내는 것이 낫습니다.</div>'
        : '';
    } else {
      const steps = PC.chain(items, { values: state.values, style: state.style });
      lastCartText = steps.map(s => 'STEP ' + s.step + ' (' + s.title + ')\n' + s.text).join('\n\n----\n\n');
      el['c-result'].innerHTML = steps.map(s =>
        '<div class="step">' +
          '<div class="row"><strong>STEP ' + s.step + '. ' + esc(s.title) + '</strong>' +
          '<button class="btn btn-mini" type="button" data-step="' + (s.step - 1) + '">이 단계 복사</button></div>' +
          '<pre class="body">' + markSlots(s.text) + '</pre>' +
        '</div>'
      ).join('') + '<div class="row"><button class="btn" type="button" data-act="c-copy">전체 복사</button></div>';
      el['c-warn'].innerHTML = '';
      state.chainSteps = steps;
    }
  }

  function renderSuggest(items) {
    if (!items.length) { el['c-suggest'].innerHTML = '<p class="hint">먼저 프롬프트를 담아 주세요.</p>'; return; }
    const last = items[items.length - 1];
    const produces = (last.combine && last.combine.produces) || [];
    const order = (last.combine && last.combine.order) || 20;
    const scored = state.index
      .filter(r => state.cart.indexOf(r.id) < 0)
      .map(r => {
        const f = state.full[r.id];
        let s = 0;
        if (f && f.combine) {
          const consumes = f.combine.consumes || [];
          if (produces.some(p => consumes.indexOf(p) >= 0)) s += 10;
          if (f.combine.order > order) s += 3;
        }
        if (r.c === last.categoryId) s += 2;
        (last.tags || []).forEach(t => { if ((r.g || []).indexOf(t) >= 0) s += 1; });
        return { r: r, s: s };
      })
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8);

    el['c-suggest'].innerHTML = scored.length
      ? scored.map(x => '<button class="chip" type="button" data-add="' + esc(x.r.id) + '">+ ' + esc(x.r.t) + '</button>').join('')
      : '<p class="hint">추천할 다음 프롬프트를 찾지 못했습니다. 목록에서 직접 담아 주세요.</p>';
  }

  function renderSaved() {
    const list = restore(LS.recipes, []);
    el['c-saved'].innerHTML = list.length
      ? '<h2 class="panel-title">저장한 조합</h2>' + list.map((r, i) =>
        '<div class="follow-row"><p>' + esc(r.name) + ' <span class="hint">· ' + r.ids.length + '개 · ' + (r.mode === 'merge' ? '병합' : '체인') + '</span></p>' +
        '<button class="btn btn-mini" type="button" data-load="' + i + '">불러오기</button>' +
        '<button class="btn btn-mini" type="button" data-delr="' + i + '">삭제</button></div>'
      ).join('')
      : '';
  }

  async function addToCart(id) {
    if (state.cart.indexOf(id) >= 0) { toast('이미 담겨 있습니다'); return; }
    await ensureFull(id);
    state.cart.push(id);
    el['cart-n'].textContent = String(state.cart.length);
    toast('카트에 담았습니다 (' + state.cart.length + '개)');
    if (state.view === 'cart') renderCart();
  }

  async function openCart() {
    await Promise.all(state.cart.map(id => ensureFull(id)));
    show('cart');
    renderCart();
    location.hash = 'c=' + state.cart.join(',') + '&m=' + state.cartMode;
  }

  /* ---------- 즐겨찾기 ---------- */

  function isFav(id) { return state.favs.indexOf(id) >= 0; }

  function toggleFav(id) {
    const i = state.favs.indexOf(id);
    if (i >= 0) { state.favs.splice(i, 1); toast('즐겨찾기에서 뺐습니다'); }
    else { state.favs.push(id); toast('즐겨찾기에 넣었습니다 (' + state.favs.length + '개)'); }
    store(LS.favs, state.favs);
    renderCategories();
    renderList(true);
    renderHome();
    el['finder-results'].querySelectorAll('[data-fav]').forEach(button => {
      const on = isFav(button.dataset.fav);
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
      button.textContent = on ? '★' : '☆';
    });
    if (state.view === 'detail') renderFavButton();
  }

  function renderFavButton() {
    const b = el['view-detail'].querySelector('button[data-act="fav"]');
    if (!b || !state.current) return;
    const on = isFav(state.current.id);
    b.textContent = on ? '★ 즐겨찾기' : '☆ 즐겨찾기';
    b.setAttribute('aria-pressed', String(on));
  }

  /* ---------- 도구: 사용자 API 키 기반 프롬프트 생성기 ---------- */

  const APE_FIELDS = [
    { key: 'task', label: '하고 싶은 작업 (필수)', help: 'AI에게 맡기려는 작업을 구체적으로 적어 주세요', example: '고객 불만 메일에 답장 쓰기', type: 'textarea' },
    { key: 'want', label: '원하는 결과물 (선택)', help: '형식, 분량, 대상, 말투 등 원하는 결과를 적어 주세요', example: '차분한 말투의 300자 답장, 해결 방법과 다음 안내 포함', type: 'textarea' },
    { key: 'avoid', label: '피해야 할 것 (선택)', help: '꼭 제외하거나 주의해야 할 내용을 적어 주세요', example: '변명, 책임 떠넘기기, 근거 없는 보상 약속', type: 'textarea' }
  ];

  function apeText() {
    return PC.buildGenerator({
      task: state.ape.task, want: state.ape.want, avoid: state.ape.avoid,
      count: state.ape.count, strategies: state.ape.strategies
    });
  }

  function renderApe() {
    el['ape-form'].innerHTML = APE_FIELDS.map(f => formRow({
      key: 'ape:' + f.key, label: f.label, help: f.help, example: f.example, type: f.type
    }, state.ape[f.key])).join('');
    el['ape-strategies'].innerHTML = PC.APE_STRATEGIES.map(s => {
      const on = state.ape.strategies.indexOf(s.id) >= 0;
      return '<button class="chip' + (on ? ' on' : '') + '" type="button" data-ape-s="' + esc(s.id) + '"' +
        ' title="' + esc(s.hint) + '" aria-pressed="' + on + '">' + esc(s.name) + '</button>';
    }).join('');
    el['ape-count'].value = String(state.ape.count);
    el['ape-preview'].innerHTML = markSlots(apeText());
    renderGeneratorConnection();
    el['gen-result'].value = state.generator.result;
    updateGeneratorControls();
    store(LS.tools, { ape: state.ape, fwb: state.fwb, q: state.q });
  }

  function renderGeneratorConnection() {
    const g = state.generator;
    const provider = PAPI.PROVIDERS.find(p => p.id === g.provider);
    if (!g.model) g.model = provider.model;
    el['gen-provider'].innerHTML = PAPI.PROVIDERS.map(p => '<option value="' + esc(p.id) + '"' + (p.id === g.provider ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
    el['gen-model'].value = g.model;
    el['gen-key'].value = g.key;
    el['gen-key'].placeholder = provider.keyHint;
    el['gen-key-help'].textContent = provider.where + ' · 본인 계정에서 사용할 수 있는 모델 이름을 입력하세요.';
  }

  function updateGeneratorControls() {
    const g = state.generator;
    el['gen-submit'].disabled = g.busy;
    el['gen-submit'].textContent = g.busy ? '프롬프트 생성 중…' : '프롬프트 생성하기';
    el['gen-cancel'].hidden = !g.busy;
    el['gen-result'].readOnly = g.busy;
    el['gen-result'].setAttribute('aria-busy', String(g.busy));
    el['gen-copy'].disabled = g.busy || !g.result.trim();
    el['gen-open'].disabled = g.busy || !g.result.trim();
    ['gen-provider', 'gen-model', 'gen-key', 'ape-count'].forEach(id => { el[id].disabled = g.busy; });
    el['ape-form'].querySelectorAll('textarea').forEach(input => { input.disabled = g.busy; });
    el['ape-strategies'].querySelectorAll('button').forEach(button => { button.disabled = g.busy; });
  }

  function generatorChanged() {
    if (state.generator.result) el['gen-status'].textContent = '입력 조건이 바뀌었습니다. 아래는 이전 생성 결과입니다. 새 조건으로 다시 생성해 주세요.';
  }

  function cancelGeneration() {
    const g = state.generator;
    if (g.controller) g.controller.abort();
    g.controller = null; g.busy = false;
    el['gen-status'].textContent = '생성을 취소했습니다.';
    updateGeneratorControls();
  }

  async function generatePrompt() {
    const g = state.generator;
    if (g.busy) return;
    const task = state.ape.task.trim();
    g.key = el['gen-key'].value.trim(); g.model = el['gen-model'].value.trim();
    if (!task) { el['gen-status'].textContent = '하고 싶은 작업을 먼저 입력해 주세요.'; el['ape-form'].querySelector('textarea').focus(); return; }
    if ([state.ape.task, state.ape.want, state.ape.avoid].join('').length > 12000) { el['gen-status'].textContent = '작업과 조건은 합해서 12,000자 이내로 입력해 주세요.'; return; }
    if (!g.key) { el['gen-status'].textContent = '선택한 AI 제공사의 API 키를 입력해 주세요.'; el['gen-key'].focus(); return; }
    if (!g.model) { el['gen-status'].textContent = '사용할 모델 이름을 입력해 주세요.'; el['gen-model'].focus(); return; }
    const controller = new AbortController();
    g.controller = controller; g.busy = true;
    el['gen-status'].textContent = 'AI가 작업에 맞는 프롬프트를 만들고 있습니다…';
    updateGeneratorControls();
    try {
      const answer = await PAPI.run({ provider: g.provider, key: g.key, model: g.model, prompt: apeText(), maxTokens: 4000, signal: controller.signal });
      if (g.controller !== controller) return;
      const result = answer.trim().replace(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```\s*$/i, '$1').trim();
      if (!result) throw new Error('생성된 프롬프트가 비어 있습니다. 조건을 바꿔 다시 시도해 주세요.');
      g.result = result; el['gen-result'].value = result;
      el['gen-status'].textContent = '프롬프트가 완성됐습니다. 필요한 부분을 수정한 뒤 복사해 사용하세요.';
    } catch (error) {
      if (g.controller !== controller) return;
      el['gen-status'].textContent = error.name === 'AbortError' ? '생성을 취소했습니다.' : error.message + (g.result ? ' 이전 생성 결과는 유지됩니다.' : '');
    } finally {
      if (g.controller === controller) { g.controller = null; g.busy = false; updateGeneratorControls(); }
    }
  }

  /* ---------- 도구: 프레임워크 빌더 ---------- */

  function fwDef() {
    return (state.taxonomy.frameworks || []).filter(f => f.id === state.fwb.id)[0] || state.taxonomy.frameworks[0];
  }

  function fwText() {
    return PC.buildFrameworkPrompt(fwDef(), state.fwb.values, state.fwb.task);
  }

  function renderFw() {
    const cur = fwDef();
    el['fw-picker'].innerHTML = state.taxonomy.frameworks.map(f =>
      '<button class="chip' + (f.id === cur.id ? ' on' : '') + '" type="button" data-fw="' + esc(f.id) + '"' +
      ' aria-pressed="' + (f.id === cur.id) + '">' + esc(f.name) + '</button>'
    ).join('');
    el['fw-use'].textContent = cur.name + ' · ' + cur.use + ' — 칸을 비워 두면 그 자리가 빈칸으로 남습니다.';
    el['fw-form'].innerHTML = cur.slots.map(s => formRow({
      key: 'fw:' + s.key, label: s.label + ' (' + s.key + ')', help: '', example: '', type: 'textarea'
    }, state.fwb.values[s.key])).join('');
    el['fw-task'].value = state.fwb.task;
    updateFwPreview();
  }

  function updateFwPreview() {
    const text = fwText();
    el['fw-preview'].innerHTML = markSlots(text);
    const left = PC.slotsIn(text);
    el['fw-left'].textContent = left.length ? '남은 칸 ' + left.length + '개' : '모두 채웠습니다';
    store(LS.tools, { ape: state.ape, fwb: state.fwb, q: state.q });
  }

  /* ---------- 도구: 질문 다듬기 ---------- */

  function qText() {
    return PC.buildQuestionRefine({ question: state.q.text, checks: state.q.checks });
  }

  function renderQuestion() {
    el['q-text'].value = state.q.text;
    el['q-checks'].innerHTML = PC.QUESTION_CHECKS.map(c =>
      '<label class="chk"><input type="checkbox" data-qc="' + esc(c.id) + '"' +
      (state.q.checks[c.id] ? ' checked' : '') + '> <strong>' + esc(c.name) + '</strong> — ' + esc(c.ask) + '</label>'
    ).join('');
    const s = PC.scoreQuestion(state.q.checks);
    const missing = PC.QUESTION_CHECKS.filter(c => !state.q.checks[c.id]);
    el['q-score'].textContent = s.total + '/100' + (missing.length ? ' · ' + missing[0].fix : ' · 좋은 질문입니다');
    el['q-preview'].innerHTML = markSlots(qText());
    store(LS.tools, { ape: state.ape, fwb: state.fwb, q: state.q });
  }

  /* ---------- 도구: 기법 사전 ---------- */

  function renderTech() {
    const counts = {};
    state.index.forEach(r => (r.k || []).forEach(k => { counts[k] = (counts[k] || 0) + 1; }));
    const days = [1, 2, 3];
    const dayName = { 1: 'DAY 1 · 기본기', 2: 'DAY 2 · 패턴', 3: 'DAY 3 · 고급' };

    const sections = days.map(d => {
      const list = state.taxonomy.techniques.filter(t => t.day === d);
      return '<h2 class="panel-title">' + dayName[d] + '</h2>' +
        '<div class="tech-grid">' + list.map(t => {
          const mod = PC.MODIFIERS.filter(m => m.tech === t.id)[0];
          const pv = mod ? PC.modifierPreview(mod.id) : null;
          return '<article class="panel tech-card">' +
            '<h3>' + esc(t.name) + (mod ? ' <span class="badge">토핑</span>' : '') + '</h3>' +
            '<p class="summary">' + esc(t.oneLine) + '</p>' +
            '<p class="hint">이럴 때: ' + esc(t.when) + '</p>' +
            (pv && pv.added.length
              ? '<details><summary>켜면 더해지는 문장</summary><pre class="body">' +
                markSlots(pv.added.join('\n')) + '</pre></details>'
              : '') +
            '<div class="row">' +
              '<button class="btn btn-mini" type="button" data-tech-go="' + esc(t.id) + '">이 기법 프롬프트 ' + (counts[t.id] || 0) + '개</button>' +
            '</div>' +
          '</article>';
        }).join('') + '</div>';
    }).join('');

    const fws = '<h2 class="panel-title">프레임워크</h2><div class="tech-grid">' +
      state.taxonomy.frameworks.map(f =>
        '<article class="panel tech-card">' +
          '<h3>' + esc(f.name) + '</h3>' +
          '<p class="summary">' + esc(f.use) + '</p>' +
          '<p class="hint">칸: ' + f.slots.map(s => esc(s.label)).join(' · ') + '</p>' +
          '<div class="row"><button class="btn btn-mini" type="button" data-fw-go="' + esc(f.id) + '">이 틀로 만들기</button></div>' +
        '</article>'
      ).join('') + '</div>';

    const keys = '<h2 class="panel-title">프롬프트를 잘 쓰는 5가지 열쇠</h2><div class="panel"><ol class="keys">' +
      state.taxonomy.keys.map(k => '<li><strong>' + esc(k.name) + '</strong> — ' + esc(k.check) + '</li>').join('') +
      '</ol><p class="hint">프롬프트 상세 화면에서 이 다섯 가지로 점수를 매겨 보여 줍니다.</p></div>';

    el['tech-count'].textContent = '기법 ' + state.taxonomy.techniques.length + '개 · 프레임워크 ' +
      state.taxonomy.frameworks.length + '개 · 토핑으로 쓸 수 있는 것 ' + PC.MODIFIERS.length + '개';
    el['tech-body'].innerHTML = sections + fws + keys;
  }

  function openMega(which) {
    state.mega = which;
    ['cat', 'tech', 'tool'].forEach(k => {
      el['mega-' + k].hidden = k !== which;
      const b = el.gnb.querySelector('button[data-mega="' + k + '"]');
      if (b) b.setAttribute('aria-expanded', String(k === which));
    });
  }

  function listHash() {
    return 'cat=' + encodeURIComponent(state.catId) + '&group=' + encodeURIComponent(state.group) +
      '&tech=' + encodeURIComponent(state.tech) + '&level=' + encodeURIComponent(state.level) + '&q=' + encodeURIComponent(state.query) + '&page=' + state.page;
  }

  function rememberList() {
    history.replaceState(null, '', '#' + listHash());
  }

  function goCategory(id) {
    state.catId = id;
    state.group = 'all';
    state.tech = 'all'; state.level = 'all';
    state.query = '';
    el.search.value = '';
    openMega(null);
    renderCategories(); renderFilters(); renderList(); show('list');
    location.hash = listHash();
    if (window.innerWidth <= 860) { el.gnb.hidden = true; el['nav-toggle'].setAttribute('aria-expanded', 'false'); }
  }

  function goHome() {
    state.catId = 'all'; state.tech = 'all'; state.group = 'all'; state.level = 'all';
    state.query = ''; el.search.value = '';
    openMega(null);
    renderCategories(); renderTechList(); renderFilters(); renderHome();
    show('home');
    location.hash = '';
  }

  /** 상세·도구에서 뒤로: 걸어 둔 조건이 있으면 목록으로, 없으면 홈으로 */
  function backToList() {
    openMega(null);
    renderList(true); show('list');
    location.hash = listHash();
  }

  function openTool(tool) {
    if (tool === 'ape') { show('ape'); renderApe(); }
    else if (tool === 'fw') { show('fw'); renderFw(); }
    else if (tool === 'question') { show('question'); renderQuestion(); }
    else if (tool === 'tech') { show('tech'); renderTech(); }
    location.hash = 't=' + tool;
    openMega(null);
    if (window.innerWidth <= 860) { el.gnb.hidden = true; el['nav-toggle'].setAttribute('aria-expanded', 'false'); }
  }

  /* ---------- 도구 공통 이벤트 ---------- */

  function attachApi(hostId) {
    const host = document.getElementById(hostId);
    if (!host) return;
    if (host.firstChild) { host.innerHTML = ''; return; }
    host.appendChild(el['api-panel']);
    el['api-panel'].hidden = false;
    renderApiPanel();
  }

  function bindTools() {
    // APE
    el['ape-form'].addEventListener('input', e => {
      const k = (e.target.dataset.key || '').replace('ape:', '');
      if (!k) return;
      state.ape[k] = e.target.value;
      e.target.closest('.field').classList.toggle('done', !!e.target.value);
      el['ape-preview'].innerHTML = markSlots(apeText());
      generatorChanged();
      store(LS.tools, { ape: state.ape, fwb: state.fwb, q: state.q });
    });
    el['ape-strategies'].addEventListener('click', e => {
      const b = e.target.closest('button[data-ape-s]');
      if (!b) return;
      const id = b.dataset.apeS;
      const i = state.ape.strategies.indexOf(id);
      if (i >= 0) state.ape.strategies.splice(i, 1); else state.ape.strategies.push(id);
      renderApe();
      generatorChanged();
    });
    el['ape-count'].addEventListener('change', e => { state.ape.count = Number(e.target.value); renderApe(); generatorChanged(); });
    el['gen-provider'].addEventListener('change', e => {
      state.generator.provider = e.target.value;
      state.generator.model = ''; state.generator.key = '';
      renderGeneratorConnection(); generatorChanged();
    });
    el['gen-model'].addEventListener('input', e => { state.generator.model = e.target.value; generatorChanged(); });
    el['gen-key'].addEventListener('input', e => { state.generator.key = e.target.value; });
    el['gen-result'].addEventListener('input', e => { state.generator.result = e.target.value; updateGeneratorControls(); });
    el['view-ape'].addEventListener('click', async e => {
      const button = e.target.closest('[data-act]');
      if (!button) return;
      const action = button.dataset.act;
      if (action === 'gen-generate') generatePrompt();
      else if (action === 'gen-cancel') cancelGeneration();
      else if (action === 'gen-forget') {
        if (state.generator.busy) cancelGeneration();
        state.generator.key = ''; el['gen-key'].value = '';
        el['gen-status'].textContent = '입력한 API 키를 지웠습니다.';
      } else if (action === 'gen-copy') copy(state.generator.result, '프롬프트 복사');
      else if (action === 'gen-open') {
        if (await copy(state.generator.result, '프롬프트 복사')) window.open('https://claude.ai/new', '_blank', 'noopener');
      }
    });

    // 프레임워크
    el['fw-picker'].addEventListener('click', e => {
      const b = e.target.closest('button[data-fw]');
      if (!b) return;
      state.fwb.id = b.dataset.fw;
      renderFw();
    });
    el['fw-form'].addEventListener('input', e => {
      const k = (e.target.dataset.key || '').replace('fw:', '');
      if (!k) return;
      state.fwb.values[k] = e.target.value;
      e.target.closest('.field').classList.toggle('done', !!e.target.value);
      updateFwPreview();
    });
    el['fw-task'].addEventListener('input', e => { state.fwb.task = e.target.value; updateFwPreview(); });

    // 질문
    el['q-text'].addEventListener('input', e => { state.q.text = e.target.value; renderQuestion(); });
    el['q-checks'].addEventListener('change', e => {
      const id = e.target.dataset.qc;
      if (!id) return;
      state.q.checks[id] = e.target.checked;
      renderQuestion();
    });

    // 기법 사전에서 바로 이동
    el['tech-body'].addEventListener('click', e => {
      const t = e.target.closest('button[data-tech-go]');
      if (t) {
        state.tech = t.dataset.techGo; state.catId = 'all'; state.group = 'all'; state.level = 'all'; state.query = ''; el.search.value = '';
        renderTechList(); renderFilters(); renderCategories(); renderList(); show('list');
        location.hash = listHash();
        return;
      }
      const f = e.target.closest('button[data-fw-go]');
      if (f) { state.fwb.id = f.dataset.fwGo; openTool('fw'); }
    });

    // 도구 화면의 버튼들
    ['view-ape', 'view-fw', 'view-question'].forEach(vid => {
      el[vid].addEventListener('click', e => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        const hostId = vid === 'view-ape' ? 'ape-api' : vid === 'view-fw' ? 'fw-api' : 'q-api';
        if (act === 'back') { backToList(); }
        else if (act === 'ape-copy' || act === 'fw-copy' || act === 'q-copy') copy(activeText(), '복사했습니다');
        else if (act === 'open-claude') { copy(activeText(), '복사했습니다'); window.open('https://claude.ai/new', '_blank', 'noopener'); }
        else if (act === 'toggle-api') attachApi(hostId);
        else if (act === 'api-run') apiRun();
        else if (act === 'api-forget') { store(LS.api, {}); state.api.key = ''; renderApiPanel(); toast('저장한 키를 지웠습니다'); }
        else if (act === 'api-copy') {
          const out = document.getElementById('api-out');
          if (out && out.dataset.answer) copy(out.dataset.answer, '결과 복사');
        }
      });
    });

    el['view-tech'].addEventListener('click', e => {
      if (e.target.closest('button[data-act="back"]')) { backToList(); }
    });
  }

  /* ---------- 이벤트 ---------- */

  function bindGlobal() {
    el['home-generator-form'].addEventListener('submit', e => {
      e.preventDefault();
      const task = el['home-generator-task'].value.trim();
      if (task) { state.ape.task = task; generatorChanged(); }
      openTool('ape');
    });
    document.getElementById('home-generator').addEventListener('click', e => {
      const button = e.target.closest('[data-generator-example]');
      if (!button) return;
      el['home-generator-task'].value = button.dataset.generatorExample;
      el['home-generator-task'].focus();
    });
    const turnPage = delta => {
      state.page += delta; renderList(true); rememberList();
      window.scrollTo({ top: 0, behavior: 'auto' });
      el['cat-title'].setAttribute('tabindex', '-1'); el['cat-title'].focus({ preventScroll: true });
    };
    el['page-prev'].addEventListener('click', () => turnPage(-1));
    el['page-next'].addEventListener('click', () => turnPage(1));
    el['finder-form'].addEventListener('submit', e => { e.preventDefault(); recommendPrompts(); });
    el['view-home'].addEventListener('click', e => {
      if (e.target.closest('[data-find-start]')) {
        const finder = document.getElementById('prompt-finder');
        finder.scrollIntoView({ behavior: window.PMOTION && window.PMOTION.reduced() ? 'auto' : 'smooth', block: 'start' });
        el['finder-group'].focus({ preventScroll: true });
      }
      if (e.target.closest('[data-finder-reset]')) {
        el['finder-group'].value = 'all'; el['finder-goal'].value = 'all'; el['finder-query'].value = '';
        el['finder-output'].hidden = true; el['finder-results'].innerHTML = ''; el['finder-status'].textContent = '';
        el['finder-group'].focus({ preventScroll: true });
      }
    });
    document.getElementById('back-top').addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: window.PMOTION && window.PMOTION.reduced() ? 'auto' : 'smooth' });
      el.home.focus({ preventScroll: true });
    });
    el.search.addEventListener('input', e => {
      const v = e.target.value;
      if (v.charAt(0) === '/' && v.length > 1) {
        const tools = { '/ape': 'ape', '/fw': 'fw', '/ask': 'question', '/tech': 'tech' };
        const toolKey = Object.keys(tools).filter(k => k.indexOf(v) === 0)[0];
        if (toolKey) { e.target.value = ''; state.query = ''; openTool(tools[toolKey]); return; }
        const hit = state.categories.filter(c => c.command.indexOf(v) === 0)[0];
        if (hit) { goCategory(hit.id); return; }
        if (v === '/fav' && state.favs.length) { goCategory('fav'); return; }
      }
      state.query = v;
      if (state.view !== 'list') show('list');
      renderList();
      rememberList();
    });

    el['category-search'].addEventListener('input', renderCategories);
    el['category-filter'].addEventListener('change', e => {
      state.catId = e.target.value;
      renderFilters(); renderList(); show('list'); rememberList();
    });

    el.levels.addEventListener('click', e => {
      const b = e.target.closest('button[data-level]');
      if (!b) return;
      state.level = b.dataset.level;
      renderFilters(); renderList(); show('list');
      rememberList();
    });

    el['tech-filter'].addEventListener('change', e => {
      state.tech = e.target.value;
      renderTechList(); renderList(); show('list');
      rememberList();
    });

    el['group-filter'].addEventListener('change', e => {
      state.group = e.target.value;
      state.catId = 'all';
      renderFilters(); renderList(); show('list');
      rememberList();
    });

    // 메가 메뉴 열고 닫기
    el.gnb.addEventListener('click', e => {
      if (e.target.closest('[data-tool="ape"]')) { openTool('ape'); return; }
      const b = e.target.closest('button[data-mega]');
      if (!b) return;
      openMega(state.mega === b.dataset.mega ? null : b.dataset.mega);
    });
    document.addEventListener('click', e => {
      if (!state.mega) return;
      if (e.target.closest('.mega') || e.target.closest('.gnb')) return;
      openMega(null);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const previous = state.mega;
        openMega(null);
        if (previous) el.gnb.querySelector('[data-mega="' + previous + '"]').focus();
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest('input, textarea, select, [contenteditable="true"]')) {
        e.preventDefault(); el.search.focus();
      }
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 860) {
        el.gnb.hidden = false;
        el['nav-toggle'].setAttribute('aria-expanded', 'false');
      } else if (el['nav-toggle'].getAttribute('aria-expanded') !== 'true') {
        el.gnb.hidden = true; openMega(null);
      }
    });

    // 메가 메뉴 안의 항목들
    ['mega-cat-body', 'mega-tech-body', 'mega-tool-body', 'home-groups', 'home-tools'].forEach(id => {
      el[id].addEventListener('click', e => {
        const cat = e.target.closest('button[data-cat]');
        if (cat) { goCategory(cat.dataset.cat); return; }
        const tech = e.target.closest('button[data-tech]');
        if (tech) {
          state.tech = tech.dataset.tech === 'all' ? 'all' : tech.dataset.tech;
          state.catId = 'all'; state.group = 'all'; state.level = 'all'; state.query = ''; el.search.value = '';
          openMega(null); renderTechList(); renderFilters(); renderList(); show('list');
          location.hash = listHash();
          if (window.innerWidth <= 860) { el.gnb.hidden = true; el['nav-toggle'].setAttribute('aria-expanded', 'false'); }
          return;
        }
        const tool = e.target.closest('button[data-tool]');
        if (tool) { openMega(null); openTool(tool.dataset.tool); }
      });
    });

    el['nav-toggle'].addEventListener('click', () => {
      const open = el.gnb.hidden;
      el.gnb.hidden = !open;
      el['nav-toggle'].setAttribute('aria-expanded', String(open));
      if (!open) openMega(null);
    });

    el['view-home'].addEventListener('click', e => {
      const go = e.target.closest('button[data-go]');
      if (!go) return;
      if (go.dataset.go === 'all') goCategory('all');
      else if (go.dataset.go.indexOf('tool-') === 0) openTool(go.dataset.go.slice(5));
    });

    el['fav-btn'].addEventListener('click', () => {
      if (!state.favs.length) { toast('아직 즐겨찾기가 없습니다. 카드의 별을 눌러 보세요'); return; }
      goCategory('fav');
    });

    ['home-easy', 'finder-results'].forEach(id => el[id].addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.fav) toggleFav(b.dataset.fav);
      else if (b.dataset.open) openDetail(b.dataset.open);
      else if (b.dataset.add) addToCart(b.dataset.add);
      else if (b.dataset.quick) {
        const p = await ensureFull(b.dataset.quick);
        if (p) copy(PC.render(p, { style: 'markdown' }).text, p.title + ' 복사');
      }
    }));

    el['view-list'].addEventListener('click', e => {
      if (!e.target.closest('[data-clear-filters]')) return;
      state.catId = 'all'; state.tech = 'all'; state.level = 'all'; state.group = 'all'; state.query = ''; el.search.value = '';
      renderFilters(); renderList(); rememberList();
    });

    el.cards.addEventListener('click', async e => {
      const fav = e.target.closest('button[data-fav]');
      if (fav) { toggleFav(fav.dataset.fav); return; }
      const open = e.target.closest('button[data-open]');
      if (open) { openDetail(open.dataset.open); return; }
      const quick = e.target.closest('button[data-quick]');
      if (quick) {
        const p = await ensureFull(quick.dataset.quick);
        if (p) copy(PC.render(p, { style: 'markdown' }).text, p.title + ' 복사');
        return;
      }
      const add = e.target.closest('button[data-add]');
      if (add) addToCart(add.dataset.add);
    });

    el.empty.addEventListener('click', e => {
      if (!e.target.closest('button[data-reset]')) return;
      state.catId = 'all'; state.tech = 'all'; state.level = 'all'; state.group = 'all';
      renderCategories(); renderTechList(); renderFilters(); renderList();
      rememberList();
    });

    el['cart-btn'].addEventListener('click', openCart);
    el.home.addEventListener('click', goHome);
    // AI 패널은 다시 그려지므로 문서 단위로 받는다
    document.addEventListener('change', e => {
      if (e.target.id === 'api-prov') {
        state.api.provider = e.target.value;
        const prov = PAPI.PROVIDERS.filter(p => p.id === state.api.provider)[0];
        state.api.model = prov ? prov.model : '';
        renderApiPanel();
      } else if (e.target.id === 'api-remember') {
        state.api.remember = e.target.checked;
      }
    });
    document.addEventListener('input', e => {
      if (e.target.id === 'api-model') state.api.model = e.target.value;
      else if (e.target.id === 'api-key') state.api.key = e.target.value;
    });

  }

  function bindDetail() {
    el['d-form'].addEventListener('input', e => {
      const k = e.target.dataset.key;
      if (!k) return;
      state.values[k] = e.target.value;
      e.target.closest('.field').classList.toggle('done', !!e.target.value);
      updatePreview();
    });
    el['d-form'].addEventListener('change', e => {
      if (e.target.tagName === 'SELECT' && e.target.dataset.key) {
        state.values[e.target.dataset.key] = e.target.value;
        updatePreview();
      }
    });

    el['d-mods'].addEventListener('click', e => {
      const b = e.target.closest('button[data-mod]');
      if (!b) return;
      const id = b.dataset.mod;
      const i = state.mods.indexOf(id);
      if (i >= 0) state.mods.splice(i, 1); else state.mods.push(id);
      el['d-form'].innerHTML = detailSlots().map(formRow).join('');
      renderMods();
      updatePreview();
    });

    el['d-style'].addEventListener('click', e => {
      const b = e.target.closest('button[data-style]');
      if (!b) return;
      state.style = b.dataset.style;
      [].forEach.call(el['d-style'].querySelectorAll('button'), x =>
        x.setAttribute('aria-pressed', String(x.dataset.style === state.style)));
      updatePreview();
      if (state.view === 'cart') renderCart();
    });

    el['d-fw'].addEventListener('change', e => { state.fw = e.target.value; updatePreview(); });

    el['d-follow'].addEventListener('click', e => {
      const b = e.target.closest('button[data-follow]');
      if (!b) return;
      const f = state.current.followUps[Number(b.dataset.follow)];
      copy(PC.fill(f, state.values), '후속 프롬프트 복사');
    });

    el['view-detail'].addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'back') { backToList(); }
      else if (act === 'copy') copy(currentText(), '복사했습니다');
      else if (act === 'fav') toggleFav(state.current.id);
      else if (act === 'cart') addToCart(state.current.id);
      else if (act === 'fill-example') {
        const p = state.current;
        const ex = (p.example && p.example.filled) || {};
        detailSlots().forEach(s => {
          if (ex[s.key]) state.values[s.key] = ex[s.key];
          else if (!state.values[s.key] && s.example) state.values[s.key] = s.example;
        });
        el['d-form'].innerHTML = detailSlots().map(formRow).join('');
        updatePreview();
        toast('예시 값으로 채웠습니다. 내 내용으로 바꿔 주세요');
      }
      else if (act === 'open-claude') { copy(currentText(), '복사했습니다'); window.open('https://claude.ai/new', '_blank', 'noopener'); }
      else if (act === 'open-gemini') { copy(currentText(), '복사했습니다'); window.open('https://gemini.google.com/app', '_blank', 'noopener'); }
      else if (act === 'toggle-api') {
        const panel = el['api-panel'];
        panel.hidden = !panel.hidden;
        if (!panel.hidden) renderApiPanel();
      }
      else if (act === 'api-run') apiRun();
      else if (act === 'api-forget') { store(LS.api, {}); state.api.key = ''; renderApiPanel(); toast('저장한 키를 지웠습니다'); }
      else if (act === 'api-copy') {
        const out = document.getElementById('api-out');
        if (out && out.dataset.answer) copy(out.dataset.answer, '결과 복사');
      }
    });
  }

  function bindCart() {
    el['c-items'].addEventListener('click', e => {
      const up = e.target.closest('button[data-up]');
      const down = e.target.closest('button[data-down]');
      const rm = e.target.closest('button[data-rm]');
      if (up) { const i = +up.dataset.up; if (i > 0) { const t = state.cart[i - 1]; state.cart[i - 1] = state.cart[i]; state.cart[i] = t; } }
      else if (down) { const i = +down.dataset.down; if (i < state.cart.length - 1) { const t = state.cart[i + 1]; state.cart[i + 1] = state.cart[i]; state.cart[i] = t; } }
      else if (rm) { state.cart.splice(+rm.dataset.rm, 1); }
      else return;
      renderCart();
    });

    el['c-mode'].addEventListener('click', e => {
      const b = e.target.closest('button[data-mode]');
      if (!b) return;
      state.cartMode = b.dataset.mode;
      renderCart();
      history.replaceState(null, '', '#c=' + state.cart.join(',') + '&m=' + state.cartMode);
    });

    el['c-opts'].addEventListener('change', e => {
      const opt = e.target.dataset.opt;
      if (!opt) return;
      if (opt === 'roleIndex') state.cartOpts.roleIndex = Number(e.target.value);
      else state.cartOpts[opt] = e.target.checked;
      renderCart();
    });

    el['c-form'].addEventListener('input', e => {
      const k = e.target.dataset.key;
      if (!k) return;
      state.values[k] = e.target.value;
      e.target.closest('.field').classList.toggle('done', !!e.target.value);
      store(LS.values, state.values);
      renderCartResult(cartItems());
    });
    el['c-form'].addEventListener('change', e => {
      if (e.target.tagName === 'SELECT' && e.target.dataset.key) {
        state.values[e.target.dataset.key] = e.target.value;
        renderCartResult(cartItems());
      }
    });

    el['c-suggest'].addEventListener('click', e => {
      const b = e.target.closest('button[data-add]');
      if (b) addToCart(b.dataset.add);
    });

    el['c-saved'].addEventListener('click', async e => {
      const load = e.target.closest('button[data-load]');
      const del = e.target.closest('button[data-delr]');
      const list = restore(LS.recipes, []);
      if (load) {
        const r = list[+load.dataset.load];
        state.cart = r.ids.slice(); state.cartMode = r.mode;
        await Promise.all(state.cart.map(id => ensureFull(id)));
        renderCart(); toast('조합을 불러왔습니다');
      } else if (del) {
        list.splice(+del.dataset.delr, 1); store(LS.recipes, list); renderSaved(); toast('삭제했습니다');
      }
    });

    el['view-cart'].addEventListener('click', e => {
      const b = e.target.closest('button[data-act], button[data-step]');
      if (!b) return;
      if (b.dataset.step != null) {
        const s = (state.chainSteps || [])[+b.dataset.step];
        if (s) copy(s.text, 'STEP ' + s.step + ' 복사');
        return;
      }
      const act = b.dataset.act;
      if (act === 'back') { backToList(); }
      else if (act === 'c-copy') copy(lastCartText, '복사했습니다');
      else if (act === 'c-clear') { state.cart = []; renderCart(); toast('카트를 비웠습니다'); }
      else if (act === 'c-save') {
        if (!state.cart.length) { toast('담은 것이 없습니다'); return; }
        const name = prompt('이 조합의 이름을 적어 주세요', cartItems().map(i => i.title).join(' + ').slice(0, 40));
        if (!name) return;
        const list = restore(LS.recipes, []);
        list.unshift({ name: name, ids: state.cart.slice(), mode: state.cartMode, at: Date.now() });
        store(LS.recipes, list.slice(0, 30));
        renderSaved(); toast('저장했습니다');
      }
      else if (act === 'c-share') {
        const url = location.href.split('#')[0] + '#c=' + state.cart.join(',') + '&m=' + state.cartMode;
        copy(url, '공유 링크 복사');
      }
      else if (act === 'toggle-api') {
        const host = document.getElementById('api-panel-cart');
        if (!host) return;
        if (host.firstChild) { host.innerHTML = ''; return; }
        host.appendChild(el['api-panel']);
        el['api-panel'].hidden = false;
        renderApiPanel();
      }
      else if (act === 'api-run') apiRun();
      else if (act === 'api-forget') { store(LS.api, {}); state.api.key = ''; renderApiPanel(); }
      else if (act === 'api-copy') {
        const out = document.getElementById('api-out');
        if (out && out.dataset.answer) copy(out.dataset.answer, '결과 복사');
      }
    });
  }

  /* ---------- 주소(해시) ---------- */

  async function route() {
    const h = location.hash.replace(/^#/, '');
    if (!h) { renderHome(); show('home'); return; }
    const params = Object.fromEntries(new URLSearchParams(h));
    if (params.p) { await openDetail(params.p); return; }
    if (params.c !== undefined) {
      state.cart = [...new Set(params.c.split(',').filter(id => state.index.some(r => r.id === id)))];
      state.cartMode = params.m === 'chain' ? 'chain' : 'merge';
      await openCart();
      return;
    }
    if (params.t) { openTool(params.t); return; }
    if (params.cat) {
      state.catId = ['all', 'fav'].includes(params.cat) || catById(params.cat) ? params.cat : 'all';
      state.group = groups().some(g => g.id === params.group) ? params.group : 'all';
      state.tech = techById(params.tech) ? params.tech : 'all';
      state.level = LEVELS.includes(params.level) ? params.level : 'all';
      state.query = params.q || ''; el.search.value = state.query;
      state.page = Math.max(1, parseInt(params.page, 10) || 1);
      renderCategories(); renderFilters(); renderList(true); show('list');
    }
  }

  /* ---------- 시작 ---------- */

  async function boot() {
    try {
      const how = await loadData();
      state.values = restore(LS.values, {});
      state.favs = restore(LS.favs, []).filter(id => state.index.some(r => r.id === id));
      const savedTools = restore(LS.tools, null);
      if (savedTools) {
        state.ape = Object.assign(state.ape, savedTools.ape || {});
        state.fwb = Object.assign(state.fwb, savedTools.fwb || {});
        state.q = Object.assign(state.q, savedTools.q || {});
      }
      const savedApi = restore(LS.api, {});
      if (savedApi.provider) state.api.provider = savedApi.provider;
      if (savedApi.model) state.api.model = savedApi.model;
      if (savedApi.key) { state.api.key = savedApi.key; state.api.remember = true; }
      renderCategories(); renderTechList(); renderToolMenu(); renderFilters();
      renderHome(); renderList();
      bindGlobal(); bindDetail(); bindCart(); bindTools();
      if (window.innerWidth <= 860) el.gnb.hidden = true;
      window.addEventListener('hashchange', route);
      await route();
      if (how === 'bundle') {
        el.count.textContent += ' · 파일을 직접 열어 묶음 데이터로 동작 중';
      }
    } catch (e) {
      document.getElementById('cards').innerHTML =
        '<div class="panel"><h2 class="panel-title">데이터를 읽지 못했습니다</h2>' +
        '<p class="hint">' + esc(e.message) + '</p>' +
        '<p class="hint">폴더에서 아래 명령으로 서버를 띄우고 http://localhost:8000 을 열어 주세요.</p>' +
        '<pre class="body">python -m http.server 8000</pre>' +
        '<p class="hint">또는 <code>node tools/build.js</code> 를 실행해 data/data.js 를 만든 뒤 다시 열어 주세요.</p></div>';
    }
  }

  boot();
})();
