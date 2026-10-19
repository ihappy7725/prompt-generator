# PROMPTERA

복사해서 빈칸만 바꾸면 되는 프롬프트 모음. 여러 프롬프트를 하나로 합치거나 단계별로 이어 쓸 수 있습니다.

현재 **프롬프트 340개 · 카테고리 34개 · 대분류 7개 · 기법 24개**입니다. 상단의 프롬프트 카테고리와 프롬프트 기법에서 각각 찾을 수 있습니다. 카테고리 메뉴 안에서 이름·상황으로 검색하거나 목록에서 대분류·카테고리·기법·난이도를 함께 선택하세요. 검색에는 카테고리 이름도 포함되며 `/` 키로 검색창에 이동합니다.

밝은 배경과 큰 제목, 번호 섹션, 얇은 구분선으로 구성했습니다. 헤더·푸터에는 `assets/logo.png`, 탭·홈 화면 아이콘에는 `assets/icon.png`를 사용합니다.

## 실행

```bash
python -m http.server 8000
```

열기: http://localhost:8000

파일을 그대로 더블 클릭해서 열면 브라우저 보안 때문에 `fetch`가 막힙니다. 그때는 `data/data.js`(빌드가 만들어 둔 통짜 묶음)로 자동 전환됩니다.

## 폴더

```
index.html        화면
style.css         스타일
compose.js        조립 엔진 (빈칸 채우기 · 기법 토핑 · 병합 · 체인) — 화면을 모르는 순수 함수
api.js            사용자가 넣은 API 키로 AI 호출
app.js            화면 로직
data/
  taxonomy.json   기법 24개 · 프레임워크 6개 · 유형 3개 · 5가지 열쇠  (손으로 고치는 파일)
  prompts/<카테고리>.json   프롬프트 원본  (손으로 고치는 파일)
  categories.json  index.json  data.js    자동 생성 — 고치지 마세요
  _legacy/prompts.json        쪼개기 전 원본 보관
tools/
  build.js        data/prompts/*.json -> categories.json · index.json · data.js
  check.js        필드 · 중복 · 빈칸 안내 · 전문가 안내 · 조립 결과 점검
  check-ui.js     DOM 기반 화면 동작 회귀 검사 (배치·색상은 검사하지 않음)
  expand.js       006~010번 추가 원고 170개 보관·최초 반영 (재실행 시 기존 항목 보존)
  fill.js         빈칸 설명(label·help·example)을 묶어서 채워 넣는 도구
```

## 프롬프트 추가하기

개수 제한은 없습니다. 카테고리 파일에 항목을 넣고 빌드하면 됩니다.

1. `data/prompts/<카테고리>.json` 의 `prompts` 배열에 아래 틀로 추가
2. `node tools/build.js` (색인과 묶음 파일 갱신)
3. `node tools/check.js` (문제가 있으면 줄 단위로 알려 줍니다)

새 카테고리를 만들 때는 `data/prompts/<새id>.json` 파일을 만들고 `category` 칸을 채우면 됩니다. 파일 이름과 `category.id`가 같아야 합니다.
`data/taxonomy.json`의 `groups`에도 새 카테고리를 정확히 한 번 넣으세요. 상단 메뉴와 홈의 대분류는 이 목록을 사용합니다.

### 화면 동작 검사

임시 폴더에 DOM 검사 도구를 설치한 뒤 실행할 수 있습니다. 프로젝트 실행에는 추가 의존성이 필요하지 않습니다.

```powershell
npm.cmd install --prefix "$env:TEMP/promptera-qa" linkedom --ignore-scripts --no-audit --no-fund
node tools/check-ui.js
```

홈 추천·도구 카드, 카테고리 검색, 상세 예시·복사, 즐겨찾기, 카트 병합·체인, API 패널 이동, 필터 주소 복원, 메뉴 폭 전환, 파일 직접 열기용 묶음 데이터를 검사합니다. 실제 브라우저에서 320·390·768·1280px 화면의 배치와 줄바꿈은 별도로 확인해야 합니다.

빈칸 설명을 여러 개 한꺼번에 채울 때는 `tools/fill.js`를 씁니다. 짧은 채움 파일을 만들어 넘기면 되고, 자리 하나만 고칠 때는 `null`로 나머지를 그대로 둘 수 있습니다.

```bash
node tools/fill.js 채움파일.json
```

```json
{
  "study-006": {
    "빈칸": ["화면에 보일 이름", "무엇을 적는지", "예시 값", "textarea"],
    "다른 빈칸": [null, null, "예시만 바꾸기"]
  }
}
```

`type` 자리에 `"select|보기1|보기2"`처럼 적으면 고르는 칸이 됩니다. 예시 값은 문장이 아니라 **명사형**으로 쓰세요. 프롬프트 문장이 `{빈칸}입니다`처럼 이어지기 때문에 `~합니다`로 끝나면 어색해집니다.

```json
{
  "id": "study-006",
  "categoryId": "study",
  "title": "짧은 제목",
  "summary": "한 줄 설명",
  "level": "쉬움",
  "tags": ["태그", "두 개 이상"],
  "type": "instruction",
  "techniques": ["persona", "numbers"],
  "framework": null,
  "blocksSource": "manual",
  "blocks": {
    "role": "당신은 ...입니다.",
    "task": ["...{빈칸}..."],
    "input": ["빈칸"],
    "constraints": ["지킬 것", "하지 말 것"],
    "output": ["받을 항목 1", "받을 항목 2"]
  },
  "placeholders": [
    { "key": "빈칸", "label": "화면에 보일 이름", "help": "무엇을 적는지", "example": "예시 값", "required": true, "type": "text" }
  ],
  "example": { "filled": { "빈칸": "예시 값" }, "expect": "이런 결과가 옵니다" },
  "followUps": ["답을 받은 뒤 이어서 쓸 요청"],
  "combine": { "role": "replaceable", "order": 20, "consumes": ["요약문"], "produces": ["문제지"] },
  "prompt": "한 문단으로 쓴 같은 내용 (구버전 화면과 복사 대비용)"
}
```

### 칸 설명

| 칸 | 뜻 |
|---|---|
| `blocks` | 수업에서 배운 다섯 칸 뼈대. 역할 · 작업 · 입력 · 제약 · 출력 |
| `placeholders` | 빈칸 하나하나의 이름 · 설명 · 예시. 화면의 입력 폼이 이걸로 만들어집니다 |
| `type` | `narrative`(서술형) · `instruction`(지침형) · `function`(함수형) |
| `techniques` | `data/taxonomy.json`의 기법 id. 카드의 칩과 기법 필터에 쓰입니다 |
| `framework` | 프레임워크 id 또는 `null` |
| `blocksSource` | `manual`(손으로 다듬음) · `auto`(변환 스크립트가 만든 것) |
| `combine.produces / consumes` | 결합 추천에 쓰는 꼬리표. 앞 프롬프트의 `produces`와 뒤 프롬프트의 `consumes`가 맞으면 추천합니다 |
| `combine.order` | 작은 수가 앞 단계(기획·정리), 큰 수가 뒤 단계(검토·분석) |
| `placeholders[].type` | `text` · `textarea` · `select`(이때 `options` 필요) |

### 지킬 것

- 한국어, 쉬운 말
- `level`은 `쉬움` · `보통` · `전문` 중 하나
- 사실 · 통계 · 숫자를 지어내지 않기. 필요하면 빈칸으로 두기
- 특정 회사 · 사람 · 상품을 홍보하거나 깎아내리지 않기
- 건강 · 돈 · 법률 프롬프트에는 전문가 확인이 필요하다는 문장을 넣기 (점검 스크립트가 확인합니다)

## 결합 기능

- **병합**: 담은 프롬프트를 STEP 1, 2, 3으로 묶어 한 개의 프롬프트로 만듭니다. 같은 이름의 빈칸은 한 번만 입력하고, 조건이 부딪치면 경고를 띄웁니다.
- **체인**: 단계마다 따로 복사해서 차례로 보냅니다. 2단계부터 `{앞 단계 결과}` 자리가 생깁니다.
- **기법 토핑**: 페르소나 강화, 예시 주기, 팩트체크, 스스로 검토 등 17개를 켜면 프롬프트에 해당 문장이 더해집니다.

## AI로 바로 실행

API 키는 사용자가 화면에서 직접 넣습니다. 코드에는 키가 없습니다. `이 브라우저에 저장`을 켜면 그 브라우저의 localStorage에만 남습니다. 공용 컴퓨터에서는 저장하지 마세요. 모델 이름은 바뀔 수 있어서, 404 오류가 나면 각 서비스 문서에서 최신 이름을 확인해 고치면 됩니다.
