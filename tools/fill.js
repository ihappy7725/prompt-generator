#!/usr/bin/env node
/**
 * 빈칸 설명 채우기
 *   node tools/fill.js <채움파일.json> [...]
 *
 * 채움파일 형식 (짧게 쓰려고 배열을 씁니다):
 * {
 *   "daily-001": {
 *     "할 일 목록": ["화면에 보일 이름", "무엇을 적는지 안내", "예시 값", "textarea", false]
 *   }
 * }
 * 배열 순서: label, help, example, type(기본 text), required(기본 true)
 * type 이 "select|보기1|보기2" 형태면 선택지가 됩니다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'prompts');

const sandbox = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8'))(sandbox);
const PC = sandbox.PC;

let touched = 0, filled = 0;
const problems = [];

process.argv.slice(2).forEach(file => {
  const fills = JSON.parse(fs.readFileSync(file, 'utf8'));
  const allIds = Object.keys(fills);
  if (!allIds.length) return;

  // 한 파일에 여러 카테고리가 섞여 있어도 되도록 카테고리별로 나눈다
  const groups = {};
  allIds.forEach(id => {
    const cat = id.replace(/-\d+$/, '');
    (groups[cat] = groups[cat] || []).push(id);
  });

  Object.keys(groups).forEach(catId => applyGroup(file, catId, groups[catId], fills));
});

function applyGroup(file, catId, ids, fills) {
  const target = path.join(DIR, catId + '.json');
  if (!fs.existsSync(target)) { problems.push(file + ': ' + catId + ' 카테고리 파일 없음'); return; }

  const data = JSON.parse(fs.readFileSync(target, 'utf8'));
  const byId = {};
  data.prompts.forEach(p => { byId[p.id] = p; });

  ids.forEach(id => {
    const p = byId[id];
    if (!p) { problems.push(id + ': 프롬프트를 찾지 못함'); return; }
    const used = PC.slotsInBlocks(p.blocks);
    const map = fills[id];

    Object.keys(map).forEach(key => {
      if (used.indexOf(key) < 0) { problems.push(id + ': 쓰이지 않는 빈칸 {' + key + '}'); return; }
      const row = map[key];
      const i0 = p.placeholders.findIndex(s => s.key === key);
      const old = i0 >= 0 ? p.placeholders[i0] : {};
      // null 로 두면 지금 값을 그대로 둡니다 (예: [null, null, "새 예시"])
      const pick = (v, fallback) => (v === null || v === undefined ? fallback : v);
      const type = pick(row[3], old.type || 'text');
      const slot = {
        key: key,
        label: pick(row[0], old.label || ''),
        help: pick(row[1], old.help || ''),
        example: pick(row[2], old.example || ''),
        required: row[4] === undefined || row[4] === null ? (old.required === undefined ? true : old.required) : !!row[4],
        type: type.indexOf('select|') === 0 ? 'select' : type
      };
      if (slot.type === 'select') {
        slot.options = type.indexOf('select|') === 0 ? type.split('|').slice(1) : (old.options || []);
      }
      if (!slot.label) problems.push(id + ': label 비어 있음 {' + key + '}');
      if (!slot.help) problems.push(id + ': help 비어 있음 {' + key + '}');
      if (!slot.example) problems.push(id + ': example 비어 있음 {' + key + '}');

      const i = p.placeholders.findIndex(s => s.key === key);
      if (i < 0) p.placeholders.push(slot); else p.placeholders[i] = slot;
      filled++;
    });

    used.forEach(k => {
      const s = p.placeholders.filter(x => x.key === k)[0];
      if (!s || !s.help || !s.example) problems.push(id + ': 아직 안 채운 빈칸 {' + k + '}');
    });

    if (p.blocksSource !== 'manual') p.blocksSource = 'filled';
    touched++;
  });

  fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(path.basename(target) + ' 갱신: 프롬프트 ' + ids.length + '개');
}

console.log('프롬프트 ' + touched + '개 / 빈칸 ' + filled + '개 채움');
if (problems.length) {
  console.log('\n확인할 것 ' + problems.length + '건:\n- ' + problems.join('\n- '));
  process.exit(1);
}
