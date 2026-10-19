#!/usr/bin/env node
/**
 * PROMPTERA 빌드 스크립트
 *
 *   node tools/build.js convert   한 번만: 옛 data/prompts.json -> data/prompts/<카테고리>.json 으로 쪼개기
 *   node tools/build.js           매번: 쪼개 둔 파일 -> data/categories.json, data/index.json, data/data.js 생성
 *
 * 쪼갠 뒤에는 data/prompts/<카테고리>.json 이 원본입니다. 손으로 고치는 곳도 여기입니다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT_DIR = path.join(DATA, 'prompts');
const LEGACY = path.join(DATA, 'prompts.json');
const ARCHIVE = path.join(DATA, '_legacy');

const OUTPUT_MARK = '출력 형식:';

// 제약 조건으로 볼 문장
const CONSTRAINT_RE = /(말아 주세요|말고|하지 마|하지 않|반드시|지어내지|넣지 말|적지 말|추가하지|주의|전문가|확인이 필요|확인하라|구분해서|분리해서|표시해 주세요|표시해|두세요|않도록)/;

// 기법 자동 태깅 규칙
const TECH_RULES = [
  ['persona', /당신은/],
  ['blocks', /출력 형식/],
  ['numbers', /\d+\s*(개|문장|줄|자|단계|가지|초|분)/],
  ['recipe', /(단계별|순서대로|STEP|단계로)/],
  ['alternatives', /(비교|장단점|선택지|대안|후보)/],
  ['factcheck', /(지어내지|확인이 필요|확인하|출처|사실)/],
  ['flipped', /(먼저 질문|질문해 주세요|물어볼|되묻)/],
  ['audience', /(읽는 사람|독자|듣는 사람|보는 사람|대상은)/],
  ['context', /(제 상황|내 상황|지금 상황|현재 상황|제약)/],
  ['reflection', /(비평|점검|검토|자체 평가)/],
  ['multiview', /(관점|입장에서|이해관계자)/],
  ['deliberate', /(단계별로 생각|중간 결론|반론)/],
  ['fewshot', /(예시|보기:)/],
  ['tone', /(말투|톤|분위기)/],
  ['negative', /(하지 말|넣지 말|피해야|빼고)/]
];

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function findPlaceholders(text) {
  const out = [];
  const seen = new Set();
  const re = /\{([^{}]+)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const key = m[1].trim();
    if (!seen.has(key)) { seen.add(key); out.push(key); }
  }
  return out;
}

/** 출력 형식 뒤쪽을 번호 항목과 뒤따르는 제약으로 나눈다. */
function parseOutput(tail) {
  const items = [];
  const extras = [];
  if (!tail) return { items, extras };

  const marks = [];
  const re = /(\d)\)/g;
  let m;
  while ((m = re.exec(tail))) marks.push(m.index);

  if (!marks.length) {
    const ss = splitSentences(tail);
    ss.forEach(s => (CONSTRAINT_RE.test(s) ? extras : items).push(s.replace(/^\d\)\s*/, '')));
    return { items, extras };
  }

  for (let i = 0; i < marks.length; i++) {
    const from = marks[i];
    const to = i + 1 < marks.length ? marks[i + 1] : tail.length;
    let chunk = tail.slice(from, to).trim();
    chunk = chunk.replace(/^\d\)\s*/, '');

    if (i === marks.length - 1) {
      // 마지막 항목 뒤에는 제약 문장이 붙어 있을 수 있다
      const ss = splitSentences(chunk);
      if (ss.length > 1) {
        chunk = ss[0];
        ss.slice(1).forEach(s => extras.push(s));
      }
    }
    chunk = chunk.replace(/[.\s]+$/, '');
    if (chunk) items.push(chunk);
  }
  return { items, extras };
}

function toBlocks(prompt) {
  const text = String(prompt).trim();
  const outIdx = text.indexOf(OUTPUT_MARK);
  const head = (outIdx >= 0 ? text.slice(0, outIdx) : text).trim();
  const tail = outIdx >= 0 ? text.slice(outIdx + OUTPUT_MARK.length).trim() : '';

  const { items, extras } = parseOutput(tail);

  const sentences = splitSentences(head);
  let role = '';
  const task = [];
  const constraints = [];

  sentences.forEach(s => {
    if (!role && /^당신은[\s\S]*?(입니다|이에요|예요)\.?$/.test(s)) { role = s; return; }
    if (CONSTRAINT_RE.test(s) && !/^(제|저|우리|아래|제가|저는)/.test(s)) { constraints.push(s); return; }
    task.push(s);
  });
  extras.forEach(s => constraints.push(s));

  return {
    role: role || '',
    task: task,
    input: findPlaceholders(task.join(' ')),
    constraints: constraints,
    output: items
  };
}

function detectTechniques(prompt, blocks) {
  const text = prompt + ' ' + blocks.constraints.join(' ');
  const found = [];
  TECH_RULES.forEach(([id, re]) => { if (re.test(text) && !found.includes(id)) found.push(id); });
  return found;
}

function detectType(blocks) {
  if (blocks.output.length >= 3 && blocks.constraints.length >= 1) return 'instruction';
  if (blocks.output.length >= 3) return 'instruction';
  return 'narrative';
}

function detectOrder(title) {
  if (/(정리|계획|아웃라인|목차|뼈대|기획|준비|순서)/.test(title)) return 10;
  if (/(점검|검토|비평|확인|원인|분석)/.test(title)) return 40;
  if (/(요약|정리해)/.test(title)) return 30;
  return 20;
}

function convertPrompt(p) {
  const blocks = toBlocks(p.prompt);
  const keys = findPlaceholders(p.prompt);
  return {
    id: p.id,
    categoryId: p.categoryId,
    title: p.title,
    summary: p.summary,
    level: p.level,
    tags: p.tags,
    type: detectType(blocks),
    techniques: detectTechniques(p.prompt, blocks),
    framework: null,
    blocksSource: 'auto',
    blocks: blocks,
    placeholders: keys.map(k => ({ key: k, label: k, help: '', example: '', required: true })),
    followUps: [],
    combine: { role: 'replaceable', order: detectOrder(p.title), consumes: [], produces: [] },
    prompt: p.prompt
  };
}

function convert() {
  if (!fs.existsSync(LEGACY)) {
    console.error('data/prompts.json 이 없습니다. 이미 쪼갠 뒤라면 convert 없이 그냥 실행하세요.');
    process.exit(1);
  }
  const src = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const byCat = new Map();
  src.prompts.forEach(p => {
    if (!byCat.has(p.categoryId)) byCat.set(p.categoryId, []);
    byCat.get(p.categoryId).push(convertPrompt(p));
  });

  src.categories.forEach(c => {
    const list = byCat.get(c.id) || [];
    const file = path.join(OUT_DIR, c.id + '.json');
    const payload = {
      category: { id: c.id, name: c.name, command: c.command, description: c.description },
      prompts: list
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  });

  fs.mkdirSync(ARCHIVE, { recursive: true });
  fs.renameSync(LEGACY, path.join(ARCHIVE, 'prompts.json'));
  console.log('쪼개기 완료: 카테고리 ' + src.categories.length + '개 -> data/prompts/*.json');
  console.log('원본은 data/_legacy/prompts.json 으로 옮겼습니다.');
}

function loadSplit() {
  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.json')).sort();
  const categories = [];
  const prompts = [];
  files.forEach(f => {
    const o = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8'));
    const expected = path.basename(f, '.json');
    if (o.category.id !== expected) {
      throw new Error(f + ' 의 category.id(' + o.category.id + ')가 파일 이름과 다릅니다.');
    }
    categories.push(o.category);
    o.prompts.forEach(p => prompts.push(p));
  });
  return { categories, prompts };
}

function build() {
  const taxonomy = JSON.parse(fs.readFileSync(path.join(DATA, 'taxonomy.json'), 'utf8'));
  const { categories, prompts } = loadSplit();

  const counts = {};
  prompts.forEach(p => { counts[p.categoryId] = (counts[p.categoryId] || 0) + 1; });

  const categoriesOut = categories.map(c => Object.assign({}, c, { count: counts[c.id] || 0 }));

  // 전체 목록(검색·필터용 경량 색인). 프롬프트 본문은 넣지 않는다.
  const index = prompts.map(p => ({
    id: p.id, c: p.categoryId, t: p.title, s: p.summary,
    l: p.level, g: p.tags, k: p.techniques, y: p.type,
    n: (p.placeholders || []).length
  }));

  fs.writeFileSync(path.join(DATA, 'categories.json'),
    JSON.stringify({ categories: categoriesOut, taxonomy: taxonomy }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(DATA, 'index.json'),
    JSON.stringify({ total: prompts.length, items: index }, null, 2) + '\n', 'utf8');

  // file:// 로 열었을 때를 위한 통짜 묶음 (fetch가 막히면 이걸 쓴다)
  const bundle = {
    categories: categoriesOut,
    taxonomy: taxonomy,
    prompts: prompts
  };
  fs.writeFileSync(path.join(DATA, 'data.js'),
    '/* 자동 생성 파일 - 고치지 마세요. node tools/build.js 로 다시 만듭니다. */\n' +
    'window.PROMPTERA_DATA = ' + JSON.stringify(bundle) + ';\n', 'utf8');

  console.log('빌드 완료');
  console.log('  카테고리 ' + categoriesOut.length + '개 / 프롬프트 ' + prompts.length + '개');
  console.log('  기법 ' + taxonomy.techniques.length + '개 / 프레임워크 ' + taxonomy.frameworks.length + '개');
  console.log('  -> data/categories.json, data/index.json, data/data.js');
}

const cmd = process.argv[2];
if (cmd === 'convert') convert();
else build();
