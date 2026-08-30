# READY

고려에듀의 지문 중심 영어 문제 풀이와 인터랙티브 워크북입니다.

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
