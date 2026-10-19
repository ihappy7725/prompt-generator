/* PROMPTERA 조립 엔진
 * 프롬프트를 다섯 칸(역할·작업·입력·제약·출력)으로 보고
 *  - 빈칸 채우기
 *  - 기법 토핑 덧붙이기
 *  - 여러 프롬프트 병합 / 체인
 * 을 담당합니다. 화면을 전혀 모르는 순수 함수 모음입니다.
 */
(function (global) {
  'use strict';

  /* ---------- 기본 유틸 ---------- */

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function emptyBlocks() {
    return { role: '', task: [], input: [], constraints: [], output: [] };
  }

  function normBlocks(b) {
    const x = Object.assign(emptyBlocks(), b || {});
    ['task', 'input', 'constraints', 'output'].forEach(k => {
      if (!Array.isArray(x[k])) x[k] = x[k] ? [String(x[k])] : [];
    });
    x.role = x.role || '';
    return x;
  }

  function slotsIn(text) {
    const out = [];
    const re = /\{([^{}]+)\}/g;
    let m;
    while ((m = re.exec(text))) if (out.indexOf(m[1].trim()) < 0) out.push(m[1].trim());
    return out;
  }

  function blocksText(b) {
    b = normBlocks(b);
    return [b.role].concat(b.task, b.constraints, b.output).join(' ');
  }

  /** 블록 전체에서 쓰이는 빈칸 이름 */
  function slotsInBlocks(b) { return slotsIn(blocksText(b)); }

  /** 빈칸을 값으로 채운다. 값이 없으면 {이름} 그대로 남긴다. */
  function fill(text, values) {
    if (!values) return text;
    return String(text).replace(/\{([^{}]+)\}/g, (whole, key) => {
      const v = values[key.trim()];
      return (v === undefined || v === null || String(v).trim() === '') ? whole : String(v).trim();
    });
  }

  /* ---------- 기법 토핑 ---------- */
  /* 각 토핑은 블록을 받아 고친다. 새로 생기는 빈칸은 slots로 알린다. */

  const MODIFIERS = [
    {
      id: 'persona-plus', name: '페르소나 강화', tech: 'persona',
      hint: '역할에 경력·전문분야·말투를 더합니다',
      slots: [
        { key: '경력', label: '경력', example: '10년', type: 'text' },
        { key: '전문분야', label: '전문분야', example: '초보자 눈높이 설명', type: 'text' },
        { key: '말투', label: '말투', example: '차분하고 다정한', type: 'text' }
      ],
      apply(b) {
        const add = '{경력} 경력으로 {전문분야}에 특화되어 있으며, {말투} 말투로 답합니다.';
        b.role = b.role ? b.role.replace(/\s*$/, ' ') + add : '당신은 전문가입니다. ' + add;
      }
    },
    {
      id: 'audience', name: '듣는 사람 정하기', tech: 'audience',
      hint: '답을 읽는 사람 정보를 블록으로 넣습니다',
      slots: [
        { key: '읽는 사람', label: '읽는 사람', example: '회사 팀장', type: 'text' },
        { key: '사전 지식', label: '사전 지식', example: '이 주제를 처음 접함', type: 'text' },
        { key: '독자 목적', label: '이 답으로 할 일', example: '회의에서 보고', type: 'text' }
      ],
      apply(b) {
        b.task.push('이 답을 읽는 사람은 {읽는 사람}이고, 이 주제에 대해 {사전 지식} 수준이며, 받은 답으로 {독자 목적}을 하려고 합니다. 설명 수준과 길이를 그 사람에게 맞춰 주세요.');
      }
    },
    {
      id: 'context', name: '내 상황 고정', tech: 'context',
      hint: '상황·수준·목적·제약·원하지 않는 것을 먼저 못 박습니다',
      slots: [
        { key: '내 상황', label: '내 상황', example: '직장인, 평일 저녁만 시간이 있음', type: 'textarea' },
        { key: '내 수준', label: '내 수준', example: '완전 초보', type: 'text' },
        { key: '목적', label: '목적', example: '2주 안에 결과를 내야 함', type: 'text' },
        { key: '제약', label: '제약', example: '돈을 쓰지 않는 방법만', type: 'text' },
        { key: '원하지 않는 것', label: '원하지 않는 것', example: '일반적인 원론 설명', type: 'text' }
      ],
      apply(b) {
        b.task.unshift('아래 상황 안에서만 답해 주세요. 상황: {내 상황} / 제 수준: {내 수준} / 목적: {목적} / 제약: {제약} / 원하지 않는 것: {원하지 않는 것}');
      }
    },
    {
      id: 'fewshot', name: '예시 주기', tech: 'fewshot',
      hint: '원하는 형식의 예시를 보여 줍니다',
      slots: [{ key: '예시', label: '원하는 형식 예시', example: '(원하는 결과 1개를 그대로 붙여넣기)', type: 'textarea' }],
      apply(b) {
        b.task.push('제가 원하는 결과 형식은 아래 예시와 같습니다. 예시: {예시}');
        b.constraints.push('위 예시와 같은 형식, 같은 길이, 같은 말투로 맞춰 주세요.');
      }
    },
    {
      id: 'numbers', name: '숫자로 말하기', tech: 'numbers',
      hint: '분량과 개수를 수치로 고정합니다',
      slots: [{ key: '분량', label: '분량', example: '전체 500자, 항목당 2문장', type: 'text' }],
      apply(b) { b.constraints.push('분량은 {분량}으로 맞추고, 개수를 세어 정확히 지켜 주세요.'); }
    },
    {
      id: 'tone', name: '말투 정하기', tech: 'tone',
      hint: '말투를 지정합니다',
      slots: [{ key: '원하는 말투', label: '원하는 말투', example: '정중하지만 친근한', type: 'text' }],
      apply(b) { b.constraints.push('말투는 {원하는 말투}로 통일해 주세요.'); }
    },
    {
      id: 'negative', name: '하지 말 것', tech: 'negative',
      hint: '빼야 할 것을 미리 막습니다',
      slots: [{ key: '하지 말 것', label: '하지 말 것', example: '배경 설명 반복, 과장된 표현', type: 'text' }],
      apply(b) { b.constraints.push('{하지 말 것}은 넣지 마세요.'); }
    },
    {
      id: 'strength', name: '강도 올리기', tech: 'strength',
      hint: '제약을 반드시 지켜야 하는 수준으로 올립니다',
      slots: [],
      apply(b) {
        b.constraints = b.constraints.map(c => /반드시|절대/.test(c) ? c : '반드시 ' + c);
        b.constraints.push('위 제약은 예외 없이 지켜 주세요. 하나라도 지킬 수 없으면 먼저 알려 주세요.');
      }
    },
    {
      id: 'priority', name: '신호등 우선순위', tech: 'priority',
      hint: '조건을 최우선·중요·선택으로 나눕니다',
      slots: [],
      apply(b) {
        b.constraints = b.constraints.map((c, i) => (i === 0 ? '🔴 최우선: ' : '🟡 중요: ') + c);
        b.constraints.push('✅ 선택: 표나 목록을 쓰면 더 좋습니다.');
      }
    },
    {
      id: 'recipe', name: '단계로 쪼개기', tech: 'recipe',
      hint: '결과를 STEP 형식으로 받습니다',
      slots: [],
      apply(b) {
        b.output.unshift('STEP 형식 진행 계획 (STEP 번호, 할 일, 소요 시간, 완료 기준, 흔한 실수)');
      }
    },
    {
      id: 'alternatives', name: '대안 받기', tech: 'alternatives',
      hint: '여러 방법을 비교표로 받습니다',
      slots: [{ key: '대안 개수', label: '대안 개수', example: '3', type: 'text' }],
      apply(b) {
        b.output.push('방법 {대안 개수}개를 비교표로 (방법, 핵심, 장점, 단점, 추천 상황)');
        b.output.push('제 상황에서 가장 맞는 방법 1개와 그 이유');
      }
    },
    {
      id: 'flipped', name: '역질문 먼저', tech: 'flipped',
      hint: 'AI가 먼저 묻고 그다음에 결과를 만듭니다',
      slots: [],
      apply(b) {
        b.task.unshift('바로 결과를 만들지 말고, 좋은 결과를 내기 위해 필요한 정보를 한 번에 최대 3개까지 먼저 질문해 주세요. 제가 답한 뒤에 결과물을 작성해 주세요.');
      }
    },
    {
      id: 'deliberate', name: '단계별로 생각하기', tech: 'deliberate',
      hint: '중간 결론을 보여 주며 따져 봅니다',
      slots: [],
      apply(b) {
        b.task.unshift('바로 답하지 말고 단계별로 생각하면서, 각 단계의 중간 결론을 짧게 보여 준 뒤 최종 답으로 넘어가 주세요.');
        b.output.push('판단의 근거와, 확신이 낮은 부분 표시');
      }
    },
    {
      id: 'multiview', name: '다중 관점', tech: 'multiview',
      hint: '여러 입장에서 동시에 봅니다',
      slots: [{ key: '관점 목록', label: '관점 목록', example: '사용하는 사람 / 돈을 내는 사람 / 반대하는 사람', type: 'text' }],
      apply(b) {
        b.task.push('아래 관점에서 각각 따로 분석해 주세요: {관점 목록}');
        b.output.push('관점별 분석');
        b.output.push('관점들이 부딪치는 지점과 모두가 동의하는 지점');
      }
    },
    {
      id: 'factcheck', name: '팩트체크 목록', tech: 'factcheck',
      hint: '직접 확인할 항목을 신호등으로 받습니다',
      slots: [],
      apply(b) {
        b.constraints.push('확실하지 않은 사실, 숫자, 날짜는 지어내지 말고 확인 필요로 표시해 주세요.');
        b.output.push('제가 직접 확인할 목록 (🔴 반드시 확인 / 🟡 확인 권장 / 🟢 참고 수준)');
      }
    },
    {
      id: 'reflection', name: '스스로 검토', tech: 'reflection',
      hint: '초안 → 자기 비평 → 개선본으로 받습니다',
      slots: [],
      apply(b) {
        b.output.push('위 결과의 약한 부분 2개와 빠진 내용 (스스로 비평)');
        b.output.push('비평을 반영한 최종본');
      }
    },
    {
      id: 'infinite', name: '여러 개 찍어내기', tech: 'infinite',
      hint: '같은 틀로 여러 개를 한 번에 만듭니다',
      slots: [
        { key: '생성 개수', label: '만들 개수', example: '5', type: 'text' },
        { key: '바꿀 변수', label: '바꿀 변수', example: '대상 독자(초보/중급/전문가)', type: 'text' }
      ],
      apply(b) {
        b.output.push('위 틀을 유지하고 {바꿀 변수}만 바꿔 결과물 {생성 개수}개를 번호를 붙여 제시');
      }
    }
  ];

  const MOD_BY_ID = {};
  MODIFIERS.forEach(m => { MOD_BY_ID[m.id] = m; });

  /** 토핑을 적용한 새 블록과, 추가로 필요한 빈칸 목록을 돌려준다. */
  function applyModifiers(blocks, modIds) {
    const b = normBlocks(clone(blocks));
    const slots = [];
    (modIds || []).forEach(id => {
      const m = MOD_BY_ID[id];
      if (!m) return;
      m.apply(b);
      (m.slots || []).forEach(s => {
        if (!slots.some(x => x.key === s.key)) slots.push(Object.assign({ from: m.name }, s));
      });
    });
    return { blocks: b, slots: slots };
  }

  /* ---------- 프레임워크 ---------- */

  const FRAMEWORK_MAP = {
    '5w1h': [['who', 'role'], ['what', 'task'], ['when', null], ['where', null], ['why', null], ['how', 'output']],
    costar: [['context', 'task'], ['objective', null], ['style', null], ['tone', null], ['audience', null], ['response', 'output']],
    focus: [['function', 'role'], ['objective', null], ['context', 'task'], ['utility', null], ['specifications', 'constraints']],
    roses: [['role', 'role'], ['objective', null], ['scenario', 'task'], ['solution', 'output'], ['steps', null]],
    risen: [['role', 'role'], ['instructions', 'task'], ['steps', null], ['end', null], ['narrowing', 'constraints']],
    bab: [['before', 'task'], ['after', null], ['bridge', 'output']]
  };

  /** 프레임워크 틀에 블록을 끼워 넣은 텍스트 */
  function renderFramework(fw, blocks, values) {
    const b = normBlocks(blocks);
    const map = FRAMEWORK_MAP[fw.id] || [];
    const lines = ['# ' + fw.name + ' 형식으로 작성해 주세요'];
    map.forEach(pair => {
      const slot = fw.slots.filter(s => s.key === pair[0])[0];
      if (!slot) return;
      let v = '';
      if (pair[1] === 'role') v = b.role;
      else if (pair[1] === 'task') v = b.task.join(' ');
      else if (pair[1] === 'constraints') v = b.constraints.join(' / ');
      else if (pair[1] === 'output') v = b.output.map((o, i) => (i + 1) + ') ' + o).join(' ');
      else v = '{' + slot.label + '}';
      lines.push(slot.label + ' (' + slot.key + '): ' + (v || '{' + slot.label + '}'));
    });
    return fill(lines.join('\n'), values);
  }

  /* ---------- 최종 텍스트 만들기 ---------- */

  /**
   * render(prompt, options)
   *  options: { values, modifiers, style: 'markdown'|'sentence', framework }
   */
  function render(prompt, options) {
    const opt = options || {};
    const base = prompt.blocks ? prompt.blocks : emptyBlocks();
    const applied = applyModifiers(base, opt.modifiers);
    const b = applied.blocks;

    if (opt.framework) return { text: renderFramework(opt.framework, b, opt.values), slots: applied.slots, blocks: b };

    let text;
    if (opt.style === 'sentence') {
      const parts = [];
      if (b.role) parts.push(b.role);
      b.task.forEach(t => parts.push(t));
      b.constraints.forEach(c => parts.push(c));
      if (b.output.length) parts.push('출력 형식: ' + b.output.map((o, i) => (i + 1) + ') ' + o).join(' '));
      text = parts.join(' ');
    } else {
      const parts = [];
      if (b.role) parts.push('#역할\n' + b.role);
      if (b.task.length) parts.push('#작업\n' + b.task.map(t => '- ' + t).join('\n'));
      if (b.constraints.length) parts.push('#제약\n' + b.constraints.map(c => '> ' + c).join('\n'));
      if (b.output.length) parts.push('#출력 형식\n' + b.output.map((o, i) => (i + 1) + ') ' + o).join('\n'));
      text = parts.join('\n\n');
    }
    return { text: fill(text, opt.values), slots: applied.slots, blocks: b };
  }

  /* ---------- 충돌 검사 ---------- */

  const CONFLICT_RULES = [
    { id: 'length', label: '분량', re: /(\d+\s*(자|문장|줄|단어|단락))|분량|이내로|짧게|줄여|줄인|간결|자세히|길게/ },
    { id: 'lang', label: '언어', re: /(영어|영문|한국어|한글)/ },
    { id: 'tone', label: '말투', re: /(말투|톤|정중|친근|딱딱|캐주얼)/ },
    { id: 'format', label: '출력 형식', re: /(표로|JSON|목록으로|코드 블록)/ }
  ];

  function findConflicts(items) {
    const found = [];
    CONFLICT_RULES.forEach(rule => {
      const hits = [];
      items.forEach(it => {
        const b = normBlocks(it.blocks);
        // 역할·작업·제약까지 본다. 출력 형식은 병합할 때 마지막 것만 쓰므로 제외.
        [b.role].concat(b.task, b.constraints).forEach(line => {
          if (line && rule.re.test(line)) hits.push({ title: it.title, line: line });
        });
      });
      if (hits.length > 1) {
        const uniqueTitles = hits.map(h => h.title).filter((v, i, a) => a.indexOf(v) === i);
        if (uniqueTitles.length > 1) found.push({ kind: rule.label, hits: hits });
      }
    });
    return found;
  }

  /* ---------- 병합: 여러 개를 한 프롬프트로 ---------- */

  /**
   * merge(items, options)
   *  options: { roleIndex, keepIntermediate, multiRole }
   */
  function merge(items, options) {
    const opt = options || {};
    const list = items.map(it => Object.assign({}, it, { blocks: normBlocks(it.blocks) }));
    const b = emptyBlocks();

    const roles = list.map(it => it.blocks.role).filter(Boolean);
    if (opt.multiRole && roles.length > 1) {
      b.role = '당신은 아래 역할을 모두 맡은 전문가 팀입니다. 각 단계에서 해당 역할로 답해 주세요.\n'
        + roles.map((r, i) => '- 역할 ' + (i + 1) + ': ' + r.replace(/^당신은\s*/, '')).join('\n');
    } else {
      const idx = Math.min(Math.max(opt.roleIndex || 0, 0), Math.max(roles.length - 1, 0));
      b.role = roles[idx] || '';
    }

    list.forEach((it, i) => {
      const step = 'STEP ' + (i + 1) + '. ' + it.title;
      const task = it.blocks.task.join(' ');
      const out = it.blocks.output.length
        ? ' 이 단계의 결과는 ' + it.blocks.output.map((o, j) => (j + 1) + ') ' + o).join(', ') + ' 형태로 정리합니다.'
        : '';
      b.task.push(step + ': ' + task + out);
    });

    const seen = {};
    list.forEach(it => {
      it.blocks.constraints.forEach(c => {
        const key = c.replace(/\s+/g, '');
        if (!seen[key]) { seen[key] = true; b.constraints.push(c); }
      });
    });
    b.constraints.unshift('STEP 순서대로 진행하고, 앞 단계의 결과를 다음 단계에 그대로 이어서 쓰세요.');

    if (opt.keepIntermediate) {
      b.output.push('STEP별 중간 결과 (각 STEP의 제목을 붙여서)');
    } else {
      b.output.push('중간 과정은 짧게, 최종 결과를 중심으로');
    }
    const last = list[list.length - 1];
    if (last) last.blocks.output.forEach(o => b.output.push(o));

    b.input = slotsInBlocks(b);
    return { blocks: b, conflicts: findConflicts(list) };
  }

  /* ---------- 체인: 순서대로 나눠서 ---------- */

  const CHAIN_SLOT = '앞 단계 결과';

  function chain(items, options) {
    const opt = options || {};
    return items.map((it, i) => {
      const b = normBlocks(clone(it.blocks));
      if (i > 0) {
        b.task.unshift('앞 단계에서 받은 결과는 아래와 같습니다. 이것을 입력으로 사용하세요.\n{' + CHAIN_SLOT + '}');
      }
      const r = render({ blocks: b }, {
        values: opt.values, modifiers: i === 0 ? opt.modifiers : [], style: opt.style
      });
      return { step: i + 1, id: it.id, title: it.title, text: r.text };
    });
  }

  /* ---------- 5가지 열쇠 점수 (규칙 기반, 참고용) ---------- */

  function scoreKeys(text) {
    const t = String(text || '');
    const rows = [
      { id: 'specific', name: '명확하고 구체적으로', score: 0, note: '' },
      { id: 'contextual', name: '충분한 맥락', score: 0, note: '' },
      { id: 'sample', name: '말보다 샘플 하나', score: 0, note: '' },
      { id: 'split', name: '큰 일은 잘게 쪼개기', score: 0, note: '' },
      { id: 'partner', name: 'AI를 파트너로', score: 0, note: '' }
    ];
    const hasNum = /\d+\s*(개|자|문장|줄|단어|단계|가지|분|시간)/.test(t);
    const hasOut = /(출력 형식|#출력|형식으로|표로|목록으로)/.test(t);
    rows[0].score = (hasNum ? 10 : 0) + (hasOut ? 10 : 0);
    rows[0].note = hasNum ? (hasOut ? '숫자와 출력 형식이 모두 있습니다' : '출력 형식을 정해 주면 더 좋습니다') : '분량이나 개수를 숫자로 적어 보세요';

    const hasRole = /당신은|#역할/.test(t);
    const hasCtx = /(상황|목적|제약|수준|대상|읽는 사람)/.test(t);
    rows[1].score = (hasRole ? 8 : 0) + (hasCtx ? 12 : 0);
    rows[1].note = hasCtx ? (hasRole ? '역할과 상황이 들어 있습니다' : '역할을 정해 주면 관점이 또렷해집니다') : '내 상황과 목적을 한 줄 넣어 보세요';

    const hasSample = /(예시|보기:|예:|아래와 같)/.test(t);
    rows[2].score = hasSample ? 20 : 0;
    rows[2].note = hasSample ? '예시가 있습니다' : '원하는 결과 예시 1개를 넣으면 형식이 맞습니다';

    const hasStep = /(STEP|단계|1\)|먼저|그다음)/.test(t);
    const tooLong = t.length > 2200;
    rows[3].score = (hasStep ? 14 : 4) + (tooLong ? 0 : 6);
    rows[3].note = hasStep ? (tooLong ? '너무 길어서 쪼개는 게 좋습니다' : '단계가 나뉘어 있습니다') : '한 번에 다 시키지 말고 단계로 나눠 보세요';

    const hasAsk = /(질문해|물어|확인 필요|모르면|지어내지)/.test(t);
    rows[4].score = hasAsk ? 20 : 8;
    rows[4].note = hasAsk ? '모르는 것을 묻거나 표시하게 했습니다' : '빠진 정보를 먼저 묻게 하거나, 모르면 표시하라고 적어 보세요';

    const total = rows.reduce((a, r) => a + r.score, 0);
    return { total: total, rows: rows };
  }

  /* ---------- APE: 프롬프트를 만드는 프롬프트 ---------- */

  const APE_STRATEGIES = [
    { id: 'role', name: '역할 부여형', hint: '당신은 ○○ 전문가입니다' },
    { id: 'steps', name: '단계별 지시형', hint: 'STEP 1 … STEP 2 …' },
    { id: 'example', name: '예시 포함형', hint: '이런 모양으로 해 주세요 [예시]' },
    { id: 'limit', name: '제약 명시형', hint: '반드시 ~하되 ~하지 마세요' },
    { id: 'goal', name: '목적 중심형', hint: '최종 목표는 ~입니다' },
    { id: 'reader', name: '독자 설정형', hint: '○○을 모르는 사람도 알게' },
    { id: 'format', name: '형식 지정형', hint: '결과를 [형식]으로' },
    { id: 'quality', name: '품질 기준형', hint: '○○ 기준으로 90점 이상' },
    { id: 'reverse', name: '역방향형', hint: '나쁜 예는 ~, 좋은 예는 ~' },
    { id: 'meta', name: '메타 지시형', hint: '이 작업의 본질은 ~' }
  ];

  function buildApe(opt) {
    const o = opt || {};
    const count = o.count || 5;
    const picked = (o.strategies && o.strategies.length)
      ? APE_STRATEGIES.filter(s => o.strategies.indexOf(s.id) >= 0)
      : APE_STRATEGIES;

    const lines = [
      '#역할',
      '당신은 프롬프트를 만드는 전문가입니다. 주어진 작업에 가장 잘 맞는 프롬프트를 여러 개 만들고, 스스로 채점하고, 좋은 점만 합쳐 하나로 다듬습니다.',
      '',
      '#작업 입력',
      '- 작업: ' + (o.task || '{작업}'),
      '- 원하는 결과물: ' + (o.want || '{원하는 결과물}'),
      '- 피해야 할 것: ' + (o.avoid || '{피해야 할 것}'),
      '',
      '#진행 순서',
      '1단계: 아래 전략을 서로 다르게 써서 프롬프트 후보 ' + count + '개를 만드세요.',
      picked.map(s => '  - ' + s.name + ': ' + s.hint).join('\n'),
      '2단계: 각 후보를 명확성(25점) · 완전성(25점) · 실행 가능성(25점) · 품질 유도력(25점), 100점 만점으로 채점해 표로 보여 주세요.',
      '3단계: 점수가 높은 2~3개의 장점을 합쳐 최종 프롬프트 1개를 만드세요.',
      '',
      '#출력 형식',
      '1) 후보별 채점 표 (전략, 점수 4개, 총점)',
      '2) 최종 프롬프트 (코드 블록 안에 넣어 바로 복사할 수 있게)',
      '3) 왜 이것이 가장 나은지 3줄',
      '4) 쓸 때 주의할 점 2줄'
    ];
    if (o.runToo) lines.push('5) 최종 프롬프트를 그대로 실행한 결과물');
    lines.push('', '#지킬 것', '> 한국어로, 쉬운 말로 쓰세요.',
      '> 사실과 숫자를 지어내지 말고, 모르는 것은 {빈칸}으로 남기세요.');
    if (o.avoid) lines.push('> 피해야 할 것에 적힌 내용은 최종 프롬프트에 넣지 마세요.');

    return lines.join('\n');
  }

  /* ---------- 프레임워크 빌더 ---------- */

  function buildFrameworkPrompt(fw, values, task) {
    const lines = ['#' + fw.name + ' 형식으로 작성합니다'];
    fw.slots.forEach(s => {
      const v = (values && values[s.key] && String(values[s.key]).trim()) || '';
      lines.push('- ' + s.label + ' (' + s.key + '): ' + (v || '{' + s.label + '}'));
    });
    lines.push('');
    lines.push('#요청');
    lines.push(task && task.trim() ? task.trim() : '위 내용을 바탕으로 결과물을 작성해 주세요.');
    lines.push('');
    lines.push('#지킬 것');
    lines.push('> 위 칸에 적힌 내용 안에서만 쓰고, 비어 있는 칸이 있으면 먼저 물어봐 주세요.');
    lines.push('> 사실과 숫자를 지어내지 마세요.');
    return lines.join('\n');
  }

  /* ---------- 질문 개선 ---------- */

  const QUESTION_CHECKS = [
    { id: 'target', name: '대상', ask: '누구를 위한, 누구에 대한 질문인지 적었나요?', fix: '대상을 한 줄 덧붙여 보세요' },
    { id: 'scope', name: '범위', ask: '다루는 범위를 좁혔나요?', fix: '기간·분야·개수로 범위를 좁혀 보세요' },
    { id: 'purpose', name: '목적', ask: '답을 받아 무엇을 할지 적었나요?', fix: '이 답으로 무엇을 할지 적어 보세요' },
    { id: 'state', name: '현재 상태', ask: '지금 상황이나 내 수준을 적었나요?', fix: '지금까지 한 것과 가진 것을 적어 보세요' },
    { id: 'premise', name: '잘못된 전제', ask: '사실인지 확인되지 않은 전제가 섞여 있지 않나요?', fix: '확실하지 않은 전제는 질문으로 바꿔 보세요' }
  ];

  function buildQuestionRefine(opt) {
    const o = opt || {};
    const missing = QUESTION_CHECKS.filter(c => (o.checks || {})[c.id] !== true);
    const lines = [
      '#역할',
      '당신은 질문을 다듬어 주는 선생님입니다. 답을 먼저 주지 않고, 질문부터 좋게 만듭니다.',
      '',
      '#내 질문',
      "'''",
      o.question || '{내 질문}',
      "'''",
      '',
      '#점검 기준',
      QUESTION_CHECKS.map(c => '- ' + c.name + ': ' + c.ask).join('\n')
    ];
    if (missing.length) {
      lines.push('', '#특히 봐 줄 것', missing.map(c => '- ' + c.name).join('\n'));
    }
    lines.push('',
      '#출력 형식',
      '1) 기준 5가지로 제 질문을 각 2점 만점 채점한 표 (총 10점)',
      '2) 빠진 정보 목록 — 제가 채워야 할 것은 {빈칸}으로 표시',
      '3) 고친 질문 3개와 각각 어떤 상황에 맞는지',
      '4) 가장 좋은 것 1개에 ★ 표시',
      '5) ★ 질문으로 답한 결과물',
      '',
      '#지킬 것',
      '> 제 질문에 잘못된 전제가 있으면 먼저 짚어 주세요.',
      '> 제가 적지 않은 사실을 지어내 채우지 마세요.');
    return lines.join('\n');
  }

  function scoreQuestion(checks) {
    const c = checks || {};
    const done = QUESTION_CHECKS.filter(x => c[x.id] === true);
    return { total: done.length * 20, done: done.length, of: QUESTION_CHECKS.length };
  }

  /* ---------- 기법 토핑 미리보기 ---------- */

  /** 토핑이 어떤 문장을 더하는지 보여 준다 (기법 사전용) */
  function modifierPreview(id) {
    const m = MOD_BY_ID[id];
    if (!m) return null;
    const before = emptyBlocks();
    before.role = '당신은 ○○ 전문가입니다.';
    before.task = ['(원래 작업 문장)'];
    before.constraints = ['(원래 제약)'];
    before.output = ['(원래 출력 항목)'];
    const after = applyModifiers(before, [id]).blocks;
    const added = [];
    if (after.role !== before.role) added.push('역할: ' + after.role.replace(before.role, '').trim());
    after.task.forEach(t => { if (before.task.indexOf(t) < 0) added.push('작업: ' + t); });
    after.constraints.forEach(c => { if (before.constraints.indexOf(c) < 0) added.push('제약: ' + c); });
    after.output.forEach(o => { if (before.output.indexOf(o) < 0) added.push('출력: ' + o); });
    if (!added.length && after.constraints.join() !== before.constraints.join()) {
      added.push('제약: ' + after.constraints.join(' / '));
    }
    return { name: m.name, hint: m.hint, slots: m.slots || [], added: added };
  }

  global.PC = {
    MODIFIERS: MODIFIERS,
    APE_STRATEGIES: APE_STRATEGIES,
    QUESTION_CHECKS: QUESTION_CHECKS,
    buildApe: buildApe,
    buildFrameworkPrompt: buildFrameworkPrompt,
    buildQuestionRefine: buildQuestionRefine,
    scoreQuestion: scoreQuestion,
    modifierPreview: modifierPreview,
    MOD_BY_ID: MOD_BY_ID,
    CHAIN_SLOT: CHAIN_SLOT,
    emptyBlocks: emptyBlocks,
    normBlocks: normBlocks,
    slotsIn: slotsIn,
    slotsInBlocks: slotsInBlocks,
    fill: fill,
    applyModifiers: applyModifiers,
    render: render,
    renderFramework: renderFramework,
    findConflicts: findConflicts,
    merge: merge,
    chain: chain,
    scoreKeys: scoreKeys
  };
})(window);
