#!/usr/bin/env node
/** PROMPTERA 자체 점검
 *   node tools/check.js
 * 데이터 필드, 중복, 빈칸, 민감 분야 안내 문구, 조립 결과를 확인합니다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const DIR = path.join(DATA, 'prompts');

// compose.js 를 그대로 불러와 사이트와 같은 방식으로 조립해 본다
const sandbox = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8'))(sandbox);
const PC = sandbox.PC;

const taxonomy = JSON.parse(fs.readFileSync(path.join(DATA, 'taxonomy.json'), 'utf8'));
const TECH = new Set(taxonomy.techniques.map(t => t.id));
const FW = new Set(taxonomy.frameworks.map(f => f.id));
const LEVELS = new Set(['쉬움', '보통', '전문']);
const TYPES = new Set(['narrative', 'instruction', 'function']);
const SENSITIVE = new Set(['health', 'money', 'legal']);
const EXPERT_RE = /(전문가|의사|수의사|변호사|상담사|영양사|세무)/;
const BRANDS = /(삼성|애플|아이폰|갤럭시|쿠팡|네이버|카카오|구글|챗GPT|나이키)/;

const fail = [];
const warn = [];

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
const all = [];
const cats = [];

files.forEach(f => {
  const o = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const base = path.basename(f, '.json');
  if (!o.category || o.category.id !== base) fail.push(f + ': category.id가 파일 이름과 다릅니다');
  ['id', 'name', 'command', 'description'].forEach(k => {
    if (!o.category || !o.category[k]) fail.push(f + ': 카테고리 필드 누락 ' + k);
  });
  if (o.category && !/^\/[a-z-]+$/.test(o.category.command)) fail.push(f + ': 명령어 형식 ' + o.category.command);
  cats.push(o.category);
  (o.prompts || []).forEach(p => { p.__file = f; all.push(p); });
});

// 카테고리 중복
['id', 'name', 'command'].forEach(k => {
  const dup = cats.map(c => c[k]).filter((v, i, a) => a.indexOf(v) !== i);
  if (dup.length) fail.push('카테고리 ' + k + ' 중복: ' + dup.join(', '));
});

const perCat = {};
const techniqueCounts = Object.fromEntries(taxonomy.techniques.map(t => [t.id, 0]));
const scenes = new Map();
// 상단 대분류에서 빠지거나 두 번 나타나는 카테고리가 없는지 확인합니다.
const grouped = (taxonomy.groups || []).flatMap(g => g.categories || []);
cats.forEach(c => {
  if (grouped.filter(id => id === c.id).length !== 1) fail.push(c.id + ': 대분류에 정확히 한 번 포함되어야 합니다');
});
grouped.forEach(id => { if (!cats.some(c => c.id === id)) fail.push('대분류의 없는 카테고리: ' + id); });
all.forEach(p => {
  const where = p.id || p.__file;
  ['id', 'categoryId', 'title', 'summary', 'level', 'tags', 'type', 'techniques', 'blocks', 'placeholders', 'combine', 'prompt'].forEach(k => {
    if (p[k] === undefined || p[k] === null || p[k] === '') fail.push(where + ': 필드 누락 ' + k);
  });
  if (!LEVELS.has(p.level)) fail.push(where + ': level 값 오류 ' + p.level);
  if (!TYPES.has(p.type)) fail.push(where + ': type 값 오류 ' + p.type);
  if (!Array.isArray(p.tags) || p.tags.length < 2) fail.push(where + ': tags 부족');
  if (p.framework && !FW.has(p.framework)) fail.push(where + ': 없는 프레임워크 ' + p.framework);
  (p.techniques || []).forEach(t => { if (!TECH.has(t)) fail.push(where + ': 없는 기법 ' + t); });
  (p.techniques || []).forEach(t => { if (TECH.has(t)) techniqueCounts[t]++; });
  if (p.origin === 'scenario-technique-v1') {
    if (!p.scenarioId || !p.techniques.includes(p.variantTechnique)) fail.push(where + ': 기법 확장 메타데이터 불일치');
    if (!scenes.has(p.scenarioId)) scenes.set(p.scenarioId, new Set());
    scenes.get(p.scenarioId).add(p.variantTechnique);
    const markers = { fewshot: '참고 예시', numbers: '3문장', priority: '🔴', negative: '절대로', tone: '읽는 사람', alternatives: '3가지 대안', recipe: 'STEP 1', flipped: '지금은 결과물을 만들지 말고', verifier: '작은 질문', roleplay: '내 답을 기다리세요', shortcut: '/초기화', reflection: '최종 개선본', outline: '/전체', context: '가능한 자원', infinite: '변수 목록', multiview: '세 관점', ape: '최종 프롬프트', persona: '판단 기준 3가지' };
    if (!markers[p.variantTechnique] || !p.blocks.task.join(' ').includes(markers[p.variantTechnique])) fail.push(where + ': 본문에 기법 실행 지시가 없습니다');
  }
  if (!p.id.startsWith(p.categoryId + '-')) fail.push(where + ': id 접두사 불일치');
  perCat[p.categoryId] = (perCat[p.categoryId] || 0) + 1;

  const b = PC.normBlocks(p.blocks);
  if (!b.role) fail.push(where + ': blocks.role 비어 있음');
  if (!b.task.length) fail.push(where + ': blocks.task 비어 있음');
  if (!b.output.length) fail.push(where + ': blocks.output 비어 있음');

  // 빈칸: 블록에 있는 것이 placeholders에 다 있는지
  const inBlocks = PC.slotsInBlocks(b);
  if (!inBlocks.length) fail.push(where + ': 바꿀 빈칸 {}이 없음');
  const declared = new Set((p.placeholders || []).map(s => s.key));
  inBlocks.forEach(k => { if (!declared.has(k)) fail.push(where + ': 빈칸 설명 없음 {' + k + '}'); });
  (p.placeholders || []).forEach(s => {
    if (!s.key || !s.label) fail.push(where + ': placeholder 필드 누락');
    if (inBlocks.indexOf(s.key) >= 0) {
      if (!s.help) fail.push(where + ': 빈칸 안내(help) 없음 {' + s.key + '}');
      if (!s.example) fail.push(where + ': 빈칸 예시(example) 없음 {' + s.key + '}');
      if (s.label === s.key && s.key.length > 6) warn.push(where + ': label이 키와 같음 {' + s.key + '}');
    }
    if (s.type === 'select' && (!s.options || !s.options.length)) fail.push(where + ': select 선택지 없음 ' + s.key);
    if (inBlocks.indexOf(s.key) < 0) warn.push(where + ': 쓰이지 않는 빈칸 설명 {' + s.key + '}');
  });

  // 조립 결과 점검: 빈칸을 비운 상태에서 모든 빈칸이 남아 있어야 한다
  const md = PC.render(p, { style: 'markdown' }).text;
  inBlocks.forEach(k => { if (md.indexOf('{' + k + '}') < 0) fail.push(where + ': 조립 결과에서 빈칸이 사라짐 {' + k + '}'); });
  if (md.indexOf('#역할') < 0 || md.indexOf('#출력 형식') < 0) fail.push(where + ': 마크다운 조립 실패');

  const exampleValues = Object.fromEntries((p.placeholders || []).map(s => [s.key, s.example]));
  const filledText = PC.render(p, { style: 'markdown', values: exampleValues }).text;
  if (PC.slotsIn(filledText).length) fail.push(where + ': 예시로 채운 뒤에도 빈칸이 남습니다');

  // 모든 토핑을 한꺼번에 켜도 깨지지 않는지
  try {
    const allMods = PC.MODIFIERS.map(m => m.id);
    const r = PC.render(p, { style: 'markdown', modifiers: allMods });
    if (!r.text || r.text.length < md.length) fail.push(where + ': 토핑 적용 후 결과가 이상함');
  } catch (e) { fail.push(where + ': 토핑 적용 중 오류 ' + e.message); }

  // 민감 분야 안내
  if (SENSITIVE.has(p.categoryId) && !EXPERT_RE.test(p.prompt + ' ' + b.constraints.join(' ') + b.output.join(' '))) {
    fail.push(where + ': 전문가 확인 안내 없음');
  }
  if (BRANDS.test(p.prompt) || BRANDS.test(p.title)) fail.push(where + ': 특정 브랜드 언급');
});

// 중복
Object.entries(techniqueCounts).forEach(([id, n]) => { if (n === 0) fail.push(id + ': 연결된 프롬프트가 없습니다'); });
scenes.forEach((techniques, id) => { if (techniques.size !== 18) fail.push(id + ': 18개 기법 흐름이 필요합니다'); });
const bodies = new Set();
all.forEach(p => { const body = p.prompt.replace(/\s+/g, ' ').trim(); if (bodies.has(body)) fail.push(p.id + ': 프롬프트 본문 중복'); bodies.add(body); });
[['id', p => p.id], ['제목', p => p.title], ['요약', p => p.summary]].forEach(([label, get]) => {
  const vals = all.map(get);
  const dup = vals.filter((v, i, a) => a.indexOf(v) !== i).filter((v, i, a) => a.indexOf(v) === i);
  if (dup.length) fail.push(label + ' 중복: ' + dup.join(' / '));
});

// 결합 점검: 서로 다른 카테고리 3개를 병합·체인해 본다
try {
  const sample = [all[0], all[50], all[120]].filter(Boolean);
  const m = PC.merge(sample, { keepIntermediate: true });
  const mt = PC.render({ blocks: m.blocks }, { style: 'markdown' }).text;
  if (!/STEP 1/.test(mt) || !/STEP 3/.test(mt)) fail.push('병합 결과에 STEP이 빠졌습니다');
  const ch = PC.chain(sample, {});
  if (ch.length !== sample.length) fail.push('체인 단계 수가 맞지 않습니다');
  if (ch[1].text.indexOf('{' + PC.CHAIN_SLOT + '}') < 0) fail.push('체인 2단계에 앞 단계 결과 자리가 없습니다');
} catch (e) { fail.push('결합 점검 중 오류: ' + e.message); }

// 색인 일치
const idx = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
if (idx.total !== all.length) fail.push('index.json 개수 불일치: ' + idx.total + ' vs ' + all.length);
const bundle = fs.readFileSync(path.join(DATA, 'data.js'), 'utf8');
if (bundle.indexOf('window.PROMPTERA_DATA') < 0) fail.push('data.js 생성 실패');

const levelDist = all.reduce((a, p) => (a[p.level] = (a[p.level] || 0) + 1, a), {});
const manual = all.filter(p => p.blocksSource === 'manual').length;
const filled = all.filter(p => p.blocksSource === 'filled').length;
const expanded = all.filter(p => p.origin === 'scenario-technique-v1').length;
const slots = all.reduce((a, p) => a + (p.placeholders || []).length, 0);
const selects = all.reduce((a, p) => a + (p.placeholders || []).filter(s => s.type === 'select').length, 0);

console.log('카테고리 ' + cats.length + '개 / 프롬프트 ' + all.length + '개 (견본 ' + manual + '개, 설명을 채운 것 ' + filled + '개)');
console.log('빈칸 ' + slots + '개 (고르는 칸 ' + selects + '개) — 모두 안내와 예시 있음');
console.log('난이도 분포 ' + JSON.stringify(levelDist));
console.log('카테고리별 개수 최소 ' + Math.min.apply(null, Object.values(perCat)) + ' / 최대 ' + Math.max.apply(null, Object.values(perCat)));
console.log('실전 상황 확장 ' + expanded + '개 / 기법별 개수 최소 ' + Math.min(...Object.values(techniqueCounts)) + '개 / 빈 기법 ' + Object.values(techniqueCounts).filter(n => n === 0).length + '개');
if (warn.length) console.log('\n참고 ' + warn.length + '건:\n- ' + warn.slice(0, 12).join('\n- ') + (warn.length > 12 ? '\n- ...' : ''));
if (fail.length) {
  console.log('\n문제 ' + fail.length + '건:\n- ' + fail.slice(0, 40).join('\n- ') + (fail.length > 40 ? '\n- ...' : ''));
  process.exit(1);
}
console.log('\n점검 통과: 문제 없음');
