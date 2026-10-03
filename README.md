# Speaking Lab (speaking)

유튜브 영상 구간을 붙여넣으면, 그 구간으로 직독직해 → 낭독 → 가리고 듣기 → 정리
4단계 실습 페이지를 자동으로 만들어 주는 사이트.

사이트: https://speaking.metacog.co.kr/

## 어떻게 동작하나

```
input/script.md (유튜브 URL + 스크립트 붙여넣는 곳, GitHub 웹 UI에서 편집)
        │
        ▼  저장(커밋)하는 순간 push 후킹으로 즉시 실행
pipeline/transcript.py  URL·타임스탬프 파싱, 구간 길이 계산, 문장별 재생 시각 정렬
pipeline/generate.py
  - Claude가 자막 조각을 문장으로 정리해 의미 덩어리 뜻·강세 표기·이해 문제·어휘 생성
    (시각은 Claude가 아니라 transcript.py가 계산)
  - content/practice/YYYY-MM-DD-<제목>/{index.md,data.json} 로 저장
        │
        ▼  변경사항 커밋 & push
Hugo build → GitHub Pages 배포
```

## 사용하는 방법

1. GitHub 저장소에서 [`input/script.md`](input/script.md) 파일을 연다.
   (블로그 상단 "Add Transcript ✏️" 버튼으로 바로 이동 가능)
2. 연필(✏️) 아이콘을 눌러 편집 모드로 들어간다.
3. 코드블록(```) 안에 **첫 줄에 유튜브 URL**, 그다음 유튜브 "스크립트 표시"에서
   복사한 구간(타임스탬프 포함)을 그대로 붙여넣는다. 구간은 20~60초 정도가
   적당하고 180초를 넘으면 처리되지 않는다. 여러 구간을 한꺼번에 넣으려면
   `---` 만 있는 줄로 구분한다.
4. 우측 상단 "Commit changes"로 저장한다. **저장하는 순간 GitHub Actions가
   후킹되어 즉시 분석·게시가 시작된다.**
5. 몇 분 뒤 사이트에 새 실습 페이지가 올라온다.

게시가 전부 성공하면 파이프라인이 커밋 시 `input/script.md` 코드블록을 자동으로
비운다. 일부만 실패하면 재시도할 수 있도록 입력은 그대로 남는다. Actions 탭 →
"Practice Pipeline" → "Run workflow"로 수동 실행도 가능하다.

### 개인정보 보호

- **게시물**: `pipeline/generate.py`의 프롬프트가 실명 등 개인을 특정할 수 있는
  정보를 자동으로 일반화한다.
- **원본 커밋**: 이 저장소가 public이라면, 붙여넣은 원문 자체는 커밋하는 순간
  공개된다. 다만 유튜브 자막은 대개 화자 실명을 포함하지 않으므로 이디엄 버전만큼
  민감하지는 않다. 혹시 영상에 개인을 특정할 수 있는 내용이 있다면 붙여넣기 전에
  지우는 것을 권장한다.

### 입력이 없는 날

이 파이프라인은 후킹 전용이다 — 실습은 영상이 있어야 성립하므로, 입력이 비어
있으면 그날은 아무것도 게시하지 않고 조용히 종료한다 (매일 자동 게시되던 이전
이디엄 폴백은 없다).

## 최초 설정 (1회만, 사람이 직접 해야 하는 단계)

자동 생성 단계는 Claude Code CLI를 사용한다. GitHub Actions에서 이 CLI를 인증하려면
Claude 구독 계정으로 발급한 OAuth 토큰을 저장소 Secret으로 등록해야 한다. 이 과정은
브라우저 로그인이 필요해 에이전트가 대신할 수 없다.

```bash
claude setup-token
```

터미널에 표시되는 인증 코드를 브라우저에 붙여넣고 로그인하면, **그 다음에** 터미널에
`sk-ant-oat01-...` 로 시작하는 토큰이 출력된다.

```bash
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo jeonck/speaking
# 위 토큰을 붙여넣기
```

등록 후 Actions 탭에서 워크플로를 한 번 수동 실행(`workflow_dispatch`)해 정상 동작을
확인한다.

## 저장소 구조

| 경로 | 역할 |
|---|---|
| `input/script.md` | 유튜브 URL + 스크립트 붙여넣는 곳 (사람이 수정 — 저장 즉시 후킹 실행) |
| `pipeline/transcript.py` | URL·타임스탬프 파싱, 구간 계산, 문장-자막 타이밍 정렬 (순수 함수) |
| `pipeline/generate.py` | Claude 호출·검증 → `content/practice/` 페이지 번들 작성. 도메인 설정은 파일 상단 "도메인 설정" 블록 |
| `pipeline/state.json` | 게시에 사용된 구간 해시 목록 (중복 게시 방지) |
| `content/practice/` | 생성된 실습 페이지 (`index.md` + `data.json`) |
| `layouts/practice/single.html` | 실습 페이지 템플릿 — `data.json`을 삽입하고 JS 번들을 로드 |
| `assets/js/practice/` | 4단계 실습 UI (바닐라 JS, Hugo 내장 esbuild로 번들) |
| `.github/workflows/daily.yml` | push 후킹 + 테스트 + 생성/배포 워크플로 (크론 없음 — 후킹 전용) |
| `themes/PaperMod` | Hugo 테마 (git submodule) |
| `assets/css/extended/` | 카드 그리드·실습 페이지 스타일 (PaperMod 오버라이드 훅) |
| `static/CNAME` | 커스텀 도메인 설정 |

## 로컬에서 테스트

```bash
hugo server -D                                    # http://localhost:1313/
python3 -m unittest discover pipeline -p "test_*.py" -v
node --test assets/js/practice/*.test.mjs
python3 pipeline/generate.py --dry-run             # 파일 생성 없이 결과만 확인
```

로컬에는 `claude` CLI 로그인 세션이 있으면 그대로 사용되고(`JUDGE_BACKEND=claude-code`),
없으면 `ANTHROPIC_API_KEY`를 설정해 `JUDGE_BACKEND=api`로 실행할 수 있다.
