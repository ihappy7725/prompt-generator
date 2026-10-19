/* PROMPTERA — 조립한 프롬프트를 AI에 바로 보내기
 *
 * API 키는 사용자가 화면에서 직접 넣습니다. 코드에 키를 넣지 않습니다.
 * 저장을 선택하면 이 브라우저(localStorage)에만 남고 서버로 가지 않습니다.
 * 브라우저에서 바로 호출하므로 키는 이 컴퓨터를 쓰는 사람에게 노출될 수 있습니다.
 */
(function (global) {
  'use strict';

  const PROVIDERS = [
    {
      id: 'anthropic', name: 'Claude (Anthropic)',
      model: 'claude-sonnet-5-5', keyHint: 'sk-ant-...',
      where: 'console.anthropic.com 에서 발급'
    },
    {
      id: 'openai', name: 'ChatGPT (OpenAI)',
      model: 'gpt-4.1-mini', keyHint: 'sk-...',
      where: 'platform.openai.com 에서 발급'
    },
    {
      id: 'gemini', name: 'Gemini (Google)',
      model: 'gemini-3.8-flash', keyHint: 'AIza...',
      where: 'aistudio.google.com 에서 발급'
    }
  ];

  function friendlyError(status, body, provider) {
    if (status === 401 || status === 403) return 'API 키가 맞지 않습니다. 키를 다시 확인해 주세요.';
    if (status === 404) return '모델 이름을 찾을 수 없습니다. 모델 이름은 자주 바뀌니 ' + provider.where.split(' ')[0] + ' 문서에서 확인해 고쳐 주세요.';
    if (status === 429) return '사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도해 주세요.';
    if (status === 400) return '요청 형식 또는 모델 설정을 확인해 주세요. 선택한 모델이 이 API 형식을 지원하는지도 확인해 주세요.';
    return 'AI 서비스 오류가 발생했습니다 (' + status + '). 잠시 뒤 다시 시도해 주세요.';
  }

  async function run(opt) {
    const provider = PROVIDERS.filter(p => p.id === opt.provider)[0];
    if (!provider) throw new Error('알 수 없는 서비스입니다.');
    if (!opt.key) throw new Error('API 키를 입력해 주세요.');
    if (!opt.model) throw new Error('모델 이름을 입력해 주세요.');
    if (!opt.prompt || !opt.prompt.trim()) throw new Error('보낼 프롬프트가 비어 있습니다.');
    const maxTokens = Math.min(8192, Math.max(256, Number(opt.maxTokens) || 2000));

    let url, init;

    if (provider.id === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      init = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': opt.key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: opt.model, max_tokens: maxTokens,
          messages: [{ role: 'user', content: opt.prompt }]
        })
      };
    } else if (provider.id === 'openai') {
      url = 'https://api.openai.com/v1/chat/completions';
      init = {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + opt.key },
        body: JSON.stringify({
          model: opt.model,
          max_completion_tokens: maxTokens,
          messages: [{ role: 'user', content: opt.prompt }]
        })
      };
    } else {
      url = 'https://generativelanguage.googleapis.com/v1beta/models/'
        + encodeURIComponent(opt.model) + ':generateContent';
      init = {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': opt.key },
        body: JSON.stringify({ contents: [{ parts: [{ text: opt.prompt }] }], generationConfig: { maxOutputTokens: maxTokens } })
      };
    }

    let res;
    try {
      res = await fetch(url, Object.assign(init, { signal: opt.signal }));
    } catch (e) {
      if (e.name === 'AbortError' || (opt.signal && opt.signal.aborted)) throw e;
      throw new Error('AI 서비스에 연결하지 못했습니다. 인터넷 연결, 브라우저 확장 프로그램, 제공사의 브라우저 요청 허용 여부를 확인해 주세요.');
    }

    const raw = await res.text();
    if (!res.ok) throw new Error(friendlyError(res.status, raw, provider));

    let data;
    try { data = JSON.parse(raw); } catch (e) { throw new Error('AI 서비스 응답을 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요.'); }

    let text = '';
    let truncated = false;
    if (provider.id === 'anthropic') {
      text = (data.content || []).filter(c => c.type === 'text' || !c.type).map(c => c.text || '').join('').trim();
      truncated = data.stop_reason === 'max_tokens';
    } else if (provider.id === 'openai') {
      const choice = (data.choices || [])[0];
      text = (choice && choice.message && choice.message.content || '').trim();
      truncated = choice && choice.finish_reason === 'length';
    } else {
      const candidate = (data.candidates || [])[0];
      text = ((candidate && candidate.content && candidate.content.parts) || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
      truncated = candidate && candidate.finishReason === 'MAX_TOKENS';
    }
    if (truncated) throw new Error('AI 응답이 길이 한도에서 중단됐습니다. 작업 범위를 줄이거나 더 짧은 결과를 요청해 주세요.');
    if (!text) throw new Error('AI가 텍스트 결과를 반환하지 않았습니다. 입력 내용을 바꾸거나 다른 모델을 선택해 주세요.');
    return text;
  }

  global.PAPI = { PROVIDERS: PROVIDERS, run: run };
})(window);
