# 첫 화면 그림

`breeze-day` 는 세로 화면용(2160×3840), `breeze-day-wide` 는 가로 화면용(3840×2160)
입니다. 어느 쪽을 쓸지는 `styles/base.css` 의 `@media (min-aspect-ratio:4/3)` 이
고릅니다. **이 그림은 첫 화면에서만 씁니다** — 본문 배경으로는 절대 쓰지 않습니다.

## 왜 AVIF · JPEG 두 벌인가

한 벌만 받습니다. CSS 가 `image-set` 으로 골라 주고, `image-set` 을 모르는 낡은
브라우저는 그 앞줄의 webp 에서 멈춥니다. jpeg 는 두지 않습니다 — webp 를 못 읽는
브라우저(iOS 13 이하)는 이제 사실상 없고, 그 경우에도 하늘색 바탕(`--brand-sky`)이
1.6초 동안 깔릴 뿐입니다.

| | 예전 jpeg | 지금 avif | 지금 webp |
| --- | --- | --- | --- |
| breeze-day (2160×3840) | 1.7MB | 634KB | — |
| breeze-day-wide (3840×2160) | 1.8MB | 707KB | — |

## 만드는 법

세로·가로 원본 PNG에서 앱용 AVIF와 JPEG를 굽습니다. AVIF를 읽는 브라우저는
한 장만 받고, JPEG는 AVIF를 못 읽는 환경의 예비본입니다.

```js
sips -z <height> <width> -s format avif -s formatOptions 82 "$src" --out "$out.avif"
sips -z <height> <width> -s format jpeg -s formatOptions 88 "$src" --out "$out.jpg"
```

## 원본 크기 확인

파일명은 목표 화면 크기일 뿐입니다. 앱에 넣기 전 `sips -g pixelWidth -g pixelHeight`
로 실제 픽셀을 확인합니다. 작은 원본을 4K 캔버스로 키우면 비율과 압축은 좋아져도
그림 속 세부 정보가 새로 생기지는 않습니다. 진짜 고해상도 결과에는 그 크기 이상의
원화가 필요합니다.

## 알아 둘 것: 이 그림의 실제 해상도

현재 파일은 별도 세로·가로 구도를 가지므로 폰·Fold·태블릿·데스크톱에서 불필요한
중앙 크롭 없이 장면의 중요한 부분을 유지합니다.
