# READY

고려에듀의 지문 중심 영어 문제 풀이와 인터랙티브 워크북입니다.

## UI 개발 원칙

Student 또는 Admin UI를 변경하기 전에 반드시 [`DESIGN.md`](./DESIGN.md)를 먼저 읽습니다. 현재 시각 구조와 기능 보존 경계는 [`UI_AUDIT.md`](./UI_AUDIT.md), 정적 컴포넌트 기준은 [`design-preview.html`](./design-preview.html), 의미 토큰의 기준값은 [`design-tokens.css`](./design-tokens.css)에 있습니다. 실제 READY 표현 계층은 [`ready/design.css`](./ready/design.css)에, 런타임이 요구하는 구조·동작 호환 규칙만 [`ready/ready.css`](./ready/ready.css)에 둡니다.

시각 개편은 기존 Question Contract와 Interaction Contract의 표현 계층만 다룹니다. importer, validator, renderer 데이터 계약, grader, Attempt, READY/DROP, source filter, Shorts navigation, Workbook, authentication, API, DB를 디자인 때문에 다시 작성하거나 확장하지 않습니다.

이 저장소가 READY의 단일 배포 기준입니다.

- `ready/`: 학생 화면과 관리자 화면
- `server/ready/`: READY API의 실제 로직
- `supabase/functions/ready/`: Supabase 배포 진입점
- `tools/`: PDF 추출, 검증, 정적 사이트 빌드
- `tests/`: 문제 명세·워크북·API 계약 검증

## 로컬 확인

```sh
npm test
npm run build
npm run dev
```

로컬 주소는 `http://localhost:4173/ready/`입니다.

## 배포 원칙

`main`에 푸시하면 먼저 전체 READY 검증을 수행한 뒤 GitHub Pages를 배포합니다.
API는 같은 커밋의 `server/ready/`를 Supabase Edge Function으로 배포합니다. API 자동 배포에는 저장소의 `SUPABASE_ACCESS_TOKEN` secret이 필요합니다.

GitHub Pages용 결과물은 `dist/`에 생성되며, 학생 화면은 배포 주소의 루트에, 관리자 화면은 `/admin/`에 놓입니다.
