# READY native shell

READY의 기존 웹 번들을 그대로 담는 Capacitor 셸입니다. Question Contract,
Renderer, Grader, Importer, API, DB는 네이티브 프로젝트와 분리되어 있으며
`npm run native:sync`가 웹 `dist/`를 iOS와 Android에 복사합니다.

## 식별자

- App name: `READY`
- Bundle / application id: `kr.co.breeze.ready`
- Orientation: portrait
- Web assets: `dist/`
- API: 기존 READY Supabase API

## 웹 변경 후 동기화

```bash
npm install
npm run native:sync
npm run native:verify
```

## iPhone에 개발 빌드 설치

1. iPhone을 케이블로 Mac에 연결하고 잠금을 풉니다.
2. iPhone에서 이 Mac을 신뢰하고, `설정 > 개인정보 보호 및 보안 > 개발자 모드`를 켭니다.
3. 프로젝트 루트에서 `npm run native:ios`를 실행합니다.
4. Xcode 왼쪽에서 `App`을 누르고 `Signing & Capabilities`를 엽니다.
5. `Team`에서 본인의 Apple 계정을 선택합니다.
6. 상단 기기에서 연결한 iPhone을 고르고 ▶ Run을 누릅니다.

무료 Apple 계정도 개발 기기 설치는 가능하지만 서명 유효기간 때문에 주기적으로
다시 설치해야 할 수 있습니다. App Store나 TestFlight 설정은 이 셸에 포함하지 않습니다.

## Android 빌드

Android Studio에서 `android/`를 열거나 아래 명령을 사용합니다.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
npm run native:sync
cd android
./gradlew assembleDebug bundleRelease
```

출력:

- debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- unsigned release AAB: `android/app/build/outputs/bundle/release/app-release.aab`

생성되는 release AAB는 내부 빌드 검증용이며 서명되지 않습니다. 스토어 제출용
AAB에는 별도의 release keystore와 배포 서명이 필요합니다.
