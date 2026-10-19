/* 선택한 프롬프트만 영문으로 변환합니다. 키·원문·결과는 저장하지 않습니다. */
(function () {
  'use strict';
  const ids = ['english-dialog', 'english-close', 'english-original', 'english-provider', 'english-model', 'english-language', 'english-key', 'english-run', 'english-cancel', 'english-forget', 'english-status', 'english-result', 'english-copy'];
  const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const state = { source: '', result: '', valid: false, busy: false, controller: null, copy: null, reuseKey: true };
  window.PAPI.PROVIDERS.forEach(provider => {
    const option = document.createElement('option');
    option.value = provider.id; option.textContent = provider.name;
    el['english-provider'].appendChild(option);
  });
  el['english-provider'].value = 'openai';

  function connection() {
    const provider = window.PAPI.PROVIDERS.find(p => p.id === el['english-provider'].value);
    el['english-model'].value = provider.model;
    el['english-key'].value = '';
    el['english-key'].placeholder = provider.keyHint;
  }

  function controls() {
    ['english-provider', 'english-model', 'english-key', 'english-language', 'english-run'].forEach(id => { el[id].disabled = state.busy; });
    el['english-result'].readOnly = state.busy;
    el['english-result'].setAttribute('aria-busy', String(state.busy));
    el['english-cancel'].hidden = !state.busy;
    el['english-run'].textContent = state.busy ? '영문으로 변환 중…' : '영문으로 변환';
    el['english-copy'].disabled = state.busy || !state.valid || !state.result.trim();
  }

  function cancel() {
    if (!state.busy) return;
    if (state.controller) state.controller.abort();
    state.controller = null; state.busy = false;
    el['english-status'].textContent = '변환을 취소했습니다. 원문은 그대로 유지됩니다.';
    controls();
  }

  async function convert() {
    if (state.busy) return;
    const key = el['english-key'].value.trim();
    const model = el['english-model'].value.trim();
    if (!key) { el['english-status'].textContent = '변환에 사용할 본인 API 키를 입력해 주세요.'; el['english-key'].focus(); return; }
    if (!model) { el['english-status'].textContent = '사용할 모델 이름을 입력해 주세요.'; el['english-model'].focus(); return; }
    if (state.source.length > 16000) { el['english-status'].textContent = '한 번에 16,000자까지 변환할 수 있습니다. 카트는 단계를 나눠 사용해 주세요.'; return; }
    const job = window.PC.prepareEnglishConversion(state.source, el['english-language'].value);
    const controller = new AbortController();
    state.controller = controller; state.busy = true;
    el['english-status'].textContent = '원문의 조건을 보존하며 영문으로 변환하고 있습니다…';
    controls();
    try {
      const answer = await window.PAPI.run({ provider: el['english-provider'].value, model, key, prompt: job.prompt, maxTokens: 8192, signal: controller.signal });
      if (state.controller !== controller) return;
      const restored = job.restore(answer);
      state.result = restored; state.valid = true;
      el['english-result'].value = restored;
      el['english-status'].textContent = '영문 변환이 완료됐습니다. 원문과 비교하고 필요한 부분을 수정한 뒤 복사하세요.';
    } catch (error) {
      if (state.controller !== controller) return;
      el['english-status'].textContent = error.name === 'AbortError' ? '변환을 취소했습니다.' : error.message + ' 원문은 그대로 유지됩니다.';
    } finally {
      if (state.controller === controller) { state.controller = null; state.busy = false; controls(); }
    }
  }

  function open(options) {
    cancel();
    const source = String(options.source || '').trim();
    if (!source) return;
    if (source !== state.source) {
      state.source = source; state.result = ''; state.valid = false;
      el['english-result'].value = '';
    }
    state.copy = options.copy;
    el['english-original'].value = source;
    const shared = options.connection;
    if (state.reuseKey && shared && shared.key && !el['english-key'].value) {
      el['english-provider'].value = shared.provider;
      connection();
      el['english-model'].value = shared.model || el['english-model'].value;
      el['english-key'].value = shared.key;
    }
    el['english-status'].textContent = state.valid ? '이 원문의 이전 변환 결과입니다. 수정하거나 다시 변환할 수 있습니다.' : '원문의 조건을 유지해 영문 지시문으로 바꿉니다. 답변 언어를 확인해 주세요.';
    controls();
    if (!el['english-dialog'].open) el['english-dialog'].showModal();
  }

  el['english-provider'].addEventListener('change', connection);
  el['english-language'].addEventListener('change', () => {
    state.valid = false;
    el['english-status'].textContent = '답변 언어를 바꿨습니다. 새 언어로 다시 변환하거나 아래 결과를 직접 수정해 주세요.';
    controls();
  });
  el['english-result'].addEventListener('input', e => { state.result = e.target.value; state.valid = !!state.result.trim(); controls(); });
  el['english-run'].addEventListener('click', convert);
  el['english-cancel'].addEventListener('click', cancel);
  el['english-close'].addEventListener('click', () => el['english-dialog'].close());
  el['english-dialog'].addEventListener('close', cancel);
  el['english-dialog'].addEventListener('cancel', cancel);
  el['english-forget'].addEventListener('click', () => {
    cancel(); state.reuseKey = false; el['english-key'].value = '';
    el['english-status'].textContent = '변환기에 입력한 키를 지웠습니다.';
  });
  el['english-copy'].addEventListener('click', async () => {
    if (state.valid && state.result.trim() && !state.busy && state.copy) {
      const copied = await state.copy(state.result, '영문 프롬프트 복사');
      el['english-status'].textContent = copied ? '영문 프롬프트를 복사했습니다.' : '자동 복사가 지원되지 않으면 위 결과를 직접 선택해 복사해 주세요.';
    }
  });
  connection(); controls();
  window.PENGLISH = { open, close: () => { if (el['english-dialog'].open) el['english-dialog'].close(); } };
})();
