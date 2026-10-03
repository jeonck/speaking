# 실습 4단계 기능 설계 (Speaking Lab)

- 작성일: 2026-10-03
- 대상: speaking.metacog.co.kr (`jeonck/speaking`)
- 근거: 길잡이영어 영상 "10년을 들어도 귀 안 뚫리는 이유" 분석 — 듣기는 ① 음원 길이 안에 끝나는 직독직해와 ② 소리 예측력(강세·리듬·연음·끊어읽기)이 전제될 때 트인다. 루틴은 읽고 이해 → 낭독 → 원음 다시 듣기.

## 1. 목표와 범위

유튜브 영상의 한 구간을 입력하면, 그 구간으로 영상의 학습 루틴을 그대로 따라 하는 실습 페이지를 자동으로 게시한다.

| 단계 | 사용자가 하는 일 | 확인하는 것 |
|---|---|---|
| 1 직독직해 | 구간 길이만큼의 시간 안에 스크립트를 읽고 이해 | 문장별 이해/막힘, 걸린 시간 |
| 2 낭독 | 강세 가이드를 보며 제한 시간 안에 소리 내어 읽기 | 낭독 시간 vs 목표, 음성인식 단어 인식률, 내 녹음 vs 원음 |
| 3 가리고 듣기 | 화면을 가린 채 듣고 이해 문제 + 문장별 받아쓰기 | 문제 점수, 받아쓰기 단어 일치율 |
| 4 정리 | 강세 표기된 전체 스크립트 복습 | 이번 결과 요약, 직전 시도 비교 |

**범위 밖**: 계정·서버 저장, 실제 음원 분석 기반 강세 측정(강세는 Claude가 텍스트로 예측한 값), 발음 정확도 채점.

**제거되는 기존 기능**: 이디엄·Say It Better·퀴즈·미니 일기 포스트 형식, 매일 07:00 크론과 이디엄 폴백(후킹 전용 모드로 전환), 기존 테스트 포스트 2개.

## 2. 아키텍처

```
input/script.md  (유튜브 URL + 스크립트 패널 복붙)
      │  push 후킹 (daily.yml, schedule 제거)
      ▼
pipeline/transcript.py   [신규] 파싱·구간 계산·문장 타이밍 정렬 (순수 함수)
pipeline/generate.py     [수정] oEmbed 확인 → Claude 생성 → 검증 → 페이지 번들 작성
      ▼
content/practice/YYYY-MM-DD-<slug>/index.md + data.json
      ▼  Hugo build (확장판 내장 esbuild로 JS 번들, Node 빌드 체인 없음)
layouts/practice/single.html   [신규] data.json을 <script type="application/json">으로 삽입
assets/js/practice/*.js        [신규] 실습 위젯
assets/css/extended/practice.css [신규]
```

| 단위 | 책임 | 의존 |
|---|---|---|
| `transcript.py` | URL→video id, 복붙→자막 조각, 구간 시작·끝, 문장↔자막 정렬과 문장 시각 | 표준 라이브러리만 |
| `generate.py` | 입력 읽기, oEmbed 확인, Claude 호출·검증, 번들 작성, dedup·입력 초기화 | transcript.py, Claude |
| `player.js` | YouTube IFrame API 로드, 구간/문장 재생·정지 | YouTube |
| `speech.js` | MediaRecorder 녹음, Web Speech 인식(미지원 시 비활성) | 브라우저 |
| `score.js` | 단어 정규화와 단어 단위 편집 거리 정렬 채점 | 없음 |
| `markup.js` | 강세 표기·덩어리 뜻·어휘·채점 결과 HTML 생성 (모든 텍스트 이스케이프) | score.js |
| `store.js` | localStorage 이력 읽기/쓰기, 오늘 시도 수 | 없음 |
| `ui.js` | 카운트다운·스톱워치·숫자 표시 | markup.js |
| `stages.js` | 셸: 단계 전환, 화면 가리기, 안내, 결과 기록, 다시 하기, 플레이어 연결 | 위 전부 |
| `stage1.js`~`stage4.js` | 단계별 화면과 동작 (`mount(panel, ctx)`, 선택적 `onShow`) | 위 모듈 |
| `main.js` | data.json 읽고 셸 초기화 (esbuild 진입점) | stages.js |

## 3. 입력 형식

`input/script.md` 코드블록 안, 항목 여러 개는 `---` 줄로 구분 (기존과 동일).

```
https://youtu.be/7KMo8GOwg78
4:12
Most people think happiness comes from big
4:15
moments, a promotion, a vacation or a perfect day.
```

- 첫 번째 비어 있지 않은 줄 = 유튜브 URL. `youtu.be/<id>`, `youtube.com/watch?v=<id>`, `youtube.com/shorts/<id>`, `youtube.com/embed/<id>` 허용.
- 시각 형식: `m:ss`, `h:mm:ss` 단독 줄 다음 줄이 텍스트, 또는 `m:ss 텍스트` 한 줄.
- `[음악]`, `[Music]`, `(박수)` 처럼 괄호로만 이뤄진 텍스트 줄은 버린다.
- 구간 시작 = 첫 자막 시각. 구간 끝 = 마지막 자막 시각 + max(1.5초, 마지막 자막 단어 수 × 0.4초).
- 구간 길이 권장 20~60초, 180초 초과는 거부.

## 4. 문장 타이밍 계산

Claude는 시각을 출력하지 않는다. 코드가 계산한다.

1. 자막 조각 i의 단어들에 시각을 선형 보간한다: 조각 시작 ~ 다음 조각 시작(마지막은 구간 끝) 사이를 단어 수로 균등 분할.
2. 단어 정규화: 소문자, 둥근 따옴표를 곧은 따옴표로, 단어 내부 아포스트로피를 뺀 구두점 제거.
3. 자막 단어열과 Claude가 정리한 문장들을 이어 붙인 단어열을 `difflib.SequenceMatcher(autojunk=False)`로 정렬한다.
4. 각 문장 첫 단어가 일치 블록에 속하면 그 자막 단어의 시각을, 아니면 그 문장 안에서 처음 일치하는 단어의 시각에서 (그 앞 단어 수 × 0.3초)를 뺀 값을 시작으로 쓴다.
5. 문장 끝 = 다음 문장 시작, 마지막 문장 끝 = 구간 끝. 시작이 앞 문장 시작보다 작거나 같으면 앞 문장 시작 + 0.1초로 보정한다. 문장 안에 일치 단어가 하나도 없으면 앞 문장 시작(첫 문장이면 구간 시작)에서 같은 보정을 적용한다.
6. 정렬 일치율(`ratio()`)이 0.6 미만이면 항목 실패.

## 5. Claude 출력과 data.json

Claude 입력: 번호 붙인 자막 조각 텍스트 (시각 제외), 영상 제목(oEmbed 성공 시).

Claude 출력 JSON 스키마:

```json
{
  "title": "Happiness Is About Frequency",
  "summary": "행복은 강도가 아니라 빈도라는 연구 결과를 소개하는 짧은 구간",
  "tags": ["happiness", "research"],
  "sentences": [{
    "text": "Most people think happiness comes from big moments.",
    "chunks": [{ "en": "Most people think", "ko": "대부분 사람들은 생각한다" }],
    "words": [{ "w": "happiness", "strong": true, "syl": "hap", "link": false }],
    "tip": "comes from → 'from'은 약하게 [frəm]"
  }],
  "questions": [{
    "q": "According to the speaker, what matters most for happiness?",
    "options": ["How intense an experience is", "How often you feel good", "Big life events"],
    "answer": 1,
    "why": "'It's frequency that matters, not intensity' — 빈도가 중요하다고 함"
  }],
  "vocab": [{ "term": "simply put", "ko": "간단히 말하면", "note": "결론을 요약할 때 쓰는 관용구" }]
}
```

프롬프트 규칙:
- 문장 텍스트는 자막 단어를 유지하되 자동자막 오인식은 문맥상 확실할 때만 고친다. 구두점·대소문자를 정리한다.
- `chunks`는 문장 전체를 빠짐없이 순서대로 나눈 의미 덩어리, `ko`는 영어 어순 그대로의 직독직해 뜻.
- `words`는 문장의 모든 단어를 순서대로 포함. `strong`은 문장 강세(내용어), `syl`은 강세 음절 철자(`strong`일 때만), `link`는 다음 단어와 연음되는지.
- `tip`은 선택, 한국어 한 줄.
- `questions` 3~5개, 질문·보기는 영어, `why`는 한국어. 보기 3~4개.
- `vocab` 2~6개, 직독직해에 걸릴 만한 구문 우선.
- 개인정보 보호 규칙(Privacy rules) 문단은 기존 프롬프트에서 그대로 옮긴다.

검증 (`parse_result` 대체): `title`·`summary` 문자열, 문장 1개 이상, 각 문장에 `chunks` 1개 이상과 `words` 1개 이상, 질문 3~5개이며 `answer`가 보기 인덱스 범위 안. 실패 시 1회 재시도 후 항목 실패. 정리(실패 아님): 정규화하면 빈 문자열이 되는 단어(예: `—`)는 `words`에서 뺀다 — 채점 인덱스와 화면 단어 위치를 일치시키기 위해. `syl`이 단어 안에 (대소문자 무시) 없으면 `syl`만 버린다.

`data.json` = Claude 출력에서 `title`·`summary`·`tags`를 뺀 것 + 아래 필드:

```json
{
  "video_id": "7KMo8GOwg78",
  "source_title": "oEmbed 영상 제목 (없으면 null)",
  "segment": { "start": 252.0, "end": 271.4 },
  "sentences": [{ "start": 252.0, "end": 256.3, "text": "…", "chunks": [], "words": [], "tip": "…" }]
}
```

`index.md` front matter: `title`, `date`, `summary`, `tags`, `video_id`, `duration`(초, 정수 올림). `layout` 필드는 두지 않는다 — `content/practice/` 섹션이라 Hugo가 `layouts/practice/single.html`을 자동 사용한다. 본문은 비운다. 번들 디렉터리 이름(`YYYY-MM-DD-<slug>`, slug는 `title`을 기존 `slugify()`로 변환)을 이 문서에서 "slug"라 부른다.

## 6. 실습 화면

실습 페이지 UI 문구는 한국어. 사이트 메뉴·홈은 영어 유지. 상단에 제목, 원본 영상 제목, 구간 길이, 오늘 시도 횟수, 단계 표시줄(자유 이동), YouTube 플레이어.

**강세 표기** (2·4단계와 3단계 문장 공개에 공통): `strong` 단어 굵게, 그 안의 `syl` 밑줄, `strong: false` 단어 흐리게, `link: true` 뒤에 `‿`, 덩어리 경계에 `/`.

**1단계 직독직해**: [시작] → 덩어리 `/` 표시된 스크립트 표시, 카운트다운 = 구간 길이(초 올림). [다 읽었다] 누르면 그 시점 기록. 시간 종료 또는 [다 읽었다] 후 스크립트 흐림 처리, 문장별 이해됨/막힘 선택 → [뜻 보기]로 덩어리별 `ko`와 어휘 공개. 결과: 이해 문장 수, 걸린 시간.

**2단계 낭독**: 강세 표기 스크립트와 문장별 [원음]. [녹음 시작] → 타이머 + 녹음 + 음성인식(`lang=en-US`, `continuous`, 녹음 중 `onend`면 재시작). [끝] → 내 시간 vs 목표(구간 길이), 1.15배 이내면 통과. 인식된 텍스트를 스크립트와 LCS 정렬해 인식률과 인식 안 된 단어 강조. [내 녹음]/[원음] 재생.

**3단계 가리고 듣기**: 플레이어 전체를 가림막으로 덮어 소리만 들리게 한다 (영상에 박힌 자막과 YouTube 자막 모두 가려짐, `cc_load_policy`로 자막을 강제로 켜지 않음). 3-a [전체 듣기](재생 횟수 표시) → 문제 풀이 → 채점과 `why`. 3-b 문장마다 [듣기](반복 가능) → 입력 → [확인] → 단어별 결과(일치/오답/누락 `___`, 추가 입력은 취소선) → 그 문장을 강세 표기와 함께 공개하고 [다시 듣기]. 결과: 문제 정답 수, 받아쓰기 전체 일치율.

**4단계 정리**: 강세 표기 전체 스크립트, 문장별 재생, 덩어리 뜻, 어휘, `tip`. 결과 요약과 직전 시도 비교. [다시 하기]는 현재 진행만 초기화.

**채점 (`score.js`)**: 정규화는 §4와 동일. 정답 단어열과 입력 단어열을 단어 단위 편집 거리(비용 1)로 정렬해 각 위치를 일치 / 오답(다른 단어로 대체) / 누락 / 추가로 분류한다. 일치율 = 일치 수 ÷ 정답 단어 수.

**저장**: localStorage 키 `speaking:practice:<slug>`, 값 `{ attempts: [{ date: "YYYY-MM-DD", stage1, stage2, stage3 }] }`, 최근 20개 유지. "오늘 n회째" = 오늘 날짜 시도 수 + 1. 모든 접근은 try/catch, 실패해도 실습은 동작.

## 7. 오류 처리

파이프라인 (실패 항목은 입력에 남아 재시도 가능, 기존 규칙 유지):

| 상황 | 처리 |
|---|---|
| URL 없음/형식 오류 | 항목 실패, "첫 줄에 유튜브 URL 필요" |
| 타임스탬프 0개 | 항목 실패, "스크립트 패널에서 시각 포함해 복사" |
| 구간 180초 초과 | 항목 실패, 실제 길이 로그 |
| oEmbed 401/403 (임베드 불가), 404 (삭제·비공개) | 항목 실패 |
| oEmbed 네트워크 오류·기타 | 경고 로그, `source_title: null`로 진행 |
| Claude 출력 검증 실패 | 1회 재시도 후 항목 실패 |
| 정렬 일치율 < 0.6 | 항목 실패 |
| 입력 비어 있음 | "건너뜁니다" 로그, 정상 종료 |
| 크레딧/인증 오류 | 기존 fast-abort 유지 |

브라우저:

| 상황 | 처리 |
|---|---|
| YouTube API 로드 실패·영상 오류 | 안내 표시, 재생 의존 기능만 비활성, 1·2단계 타이머는 동작 |
| 구간/문장 끝 정지 | 재생 중 100ms 간격으로 위치 확인 후 정지 |
| MediaRecorder 미지원·마이크 거부 | 타이머 전용 모드, 사유 안내 |
| SpeechRecognition 미지원 | 인식률 숨김, "Chrome/Edge에서 지원" 안내 |
| localStorage 예외 | 저장 없이 진행 |

## 8. 테스트

- `pipeline/test_transcript.py` (`unittest`): URL 4형식, 시각 3형식, 괄호 줄 제거, 구간 끝 추정, 오인식 교정 문장 정렬(예: "a va perfect" → "a vacation or a perfect"), 역순 보정, 180초 초과 거부, 일치율 미달 거부.
- `pipeline/test_generate.py` (`unittest`): 출력 검증·정리, oEmbed 상태별 처리, 페이지 데이터 계산, 번들 작성(`</script>` 이스케이프 포함).
- `assets/js/practice/*.test.mjs` (`node --test`): 채점(대소문자·구두점·둥근 아포스트로피 무시, 누락·오답·추가 구분, 일치율), 강세 표기 HTML(이스케이프, `syl` 대소문자·불일치), 이력 저장(차단·손상된 localStorage).
- `daily.yml` generate 잡에서 테스트를 생성 단계 앞에 실행. 테스트가 실패하면 생성도 배포도 하지 않는다.
- 실데이터: 분석한 영상의 "happiness" 구간(약 4:12~4:31)으로 생성 → 문장 타이밍, 강세, 덩어리 뜻 어순 확인.
- 브라우저: 로컬 `hugo server`에서 4단계 진행 — 타이머, 구간 재생·정지, 가림막, 받아쓰기 채점, 결과 저장, 모바일 폭. 마이크·음성인식은 브라우저 창에서 확인 불가하면 그 사실을 보고하고 사용자 확인을 요청한다.

## 9. 함께 바뀌는 것

- `daily.yml`: 워크플로 이름 `Practice Pipeline`, `schedule` 제거, Node 24 설정과 테스트 단계 추가, push 경로에 `pipeline/**`·`layouts/**`·`.github/workflows/**` 추가, commit 스텝 `git add` 경로를 `content/practice`로, deploy는 테스트 통과 시에만.
- `generate.py`: `FALLBACK_QUOTES`·이디엄 경로·기존 포스트 렌더링 제거.
- `hugo.toml`: `mainSections = ['practice']`, 메뉴 `Posts` → `Practice` (`/practice/`).
- `content/posts/` 삭제, `pipeline/state.json` 초기화.
- `README.md`·`input/script.md` 안내문을 새 입력 형식과 후킹 전용 모드로 수정 (개인정보 안내 문구 유지).
