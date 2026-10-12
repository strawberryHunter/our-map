# 우리 지도

둘이 함께 나온 사진을 폰 갤러리에서 자동으로 찾아서, 날짜·장소별 추억으로 정리하고 지도에 꽂아주는 앱이에요. 아이폰과 안드로이드에서 모두 쓸 수 있어요.

## 하는 일

- **자동 정리**: 앱을 열 때마다 마지막 정리 이후에 찍은 사진을 훑어요.
  - 등록한 두 사람 얼굴이 나온 사진을 폰 안에서 찾아요(TFLite).
  - 3시간 넘게 사진이 없거나 5km 넘게 이동하면 다른 외출로 나눠요.
- **AI 기록**: 장소마다 제목, 장소 이름, 한두 줄 요약을 붙여요.
  - 장소 이름은 OpenStreetMap에서 찾고, 사진 내용은 Claude가 읽어요.
- **둘이 공유**: 두 폰이 같은 지도를 봐요.
  - 같은 날 같은 곳에서 찍은 사진은 누구 폰에서 올렸든 하나의 추억으로 합쳐져요.
- **지도 영상**: 다녀온 곳을 순서대로 날아가며 사진 카드를 보여주는 4:5 세로 영상을 만들어 갤러리에 저장해요.

## 구조

| 부분 | 기술 |
|---|---|
| 앱 | Expo (React Native), expo-router |
| 갤러리 접근 | expo-media-library |
| 얼굴 검출 | MediaPipe BlazeFace short-range (`assets/models/blaze_face_short_range.tflite`) |
| 얼굴 인식 | MobileFaceNet, 192차원 (`assets/models/mobilefacenet.tflite`), 랜드마크 정렬 후 cosine ≥ 0.5 |
| 저장·동기화 | Supabase (Postgres + Storage + Realtime, RLS로 커플 단위 격리) |
| AI 요약 | Supabase Edge Function `summarize` → Claude API (키는 서버에만 있음) |
| 지도 | MapLibre + OpenFreeMap 타일 (무료, API 키 불필요) |
| 영상 | WebView 안에서 maplibre-gl + canvas + MediaRecorder 사용, mp4 또는 webm |

얼굴 정렬 방식은 공개 테스트 사진으로 검증했어요. 같은 사람은 0.83, 다른 사람은 −0.1 ~ 0.0이 나왔어요. 내 사진으로 확인하려면 `scripts/test-face.js`를 쓰면 돼요.

## 처음 세팅

### 1. Supabase 만들기 (무료 플랜)

1. https://supabase.com 에서 프로젝트를 만들어요.
2. SQL Editor에 `supabase/migrations/0001_init.sql` 내용을 붙여넣고 실행해요.
3. 요약 함수를 배포하고 Claude API 키를 넣어요.

```bash
npm i -g supabase
supabase login
supabase link --project-ref <프로젝트 ref>
supabase functions deploy summarize
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

4. Authentication → Email에서 OTP 방식을 켜요.
   - 메일 템플릿(Magic Link)에 `{{ .Token }}`이 들어가야 앱에서 6자리 코드로 로그인돼요.

### 2. 앱 설정

```bash
cp .env.example .env
# .env 에 Supabase URL / anon key 입력
npm install --legacy-peer-deps
```

### 3. 폰에 설치

네이티브 모듈(TFLite, MapLibre)이 들어 있어서 Expo Go로는 실행되지 않아요. 개발 빌드가 필요해요.

```bash
npm i -g eas-cli
eas login
eas init
```

**안드로이드**: APK를 받아서 바로 설치하면 돼요.

```bash
eas build -p android --profile development   # 개발용 (코드 수정이 바로 반영됨)
eas build -p android --profile preview       # 완성본 APK
```

**아이폰**: Apple Developer 계정(연 $99)이 필요해요.

```bash
eas device:create                            # 내 아이폰 등록
eas build -p ios --profile development
```

Mac에 Xcode가 있다면 무료 Apple ID로 `npx expo run:ios --device`를 쓸 수도 있어요. 다만 이 방법은 7일마다 다시 설치해야 해요.

개발 빌드를 깔았으면 `npx expo start`로 실행해요.

## 처음 쓰는 순서

1. 이메일로 로그인해요.
2. 한 명이 **새 지도 만들기**를 누르고, 설정 화면의 초대 코드를 상대에게 보내요. 상대는 그 코드로 **참여하기**를 눌러요.
3. 설정 → **얼굴 등록**에서 두 사람 각각 얼굴이 잘 보이는 사진을 3~5장씩 골라요.
4. 정리할 기간을 고른 뒤 **지금 정리하기**를 눌러요. 이후로는 앱을 열 때마다 자동으로 정리돼요.

## 알아둘 점

- **사진 범위**: 한 번에 400장씩 처리해요. 기간이 길면 여러 번 열어야 끝까지 정리돼요.
- **아직 진행 중인 외출**: 마지막 사진이 3시간이 안 됐으면 다음 정리 때 처리해요.
- **아이폰 위치 정보**: "제한된 사진 접근"을 고르면 일부 사진만 보여요. 위치 정보가 빠진 사진은 같은 시간대 사진의 위치를 따라가요.
- **영상 녹화**: 영상은 앱 화면에서 실제로 재생하면서 녹화해요. 만드는 동안에는 화면을 켜두세요.
- **비용**: AI 요약은 추억 하나에 사진 최대 4장(768px)을 보내요. 기본 모델은 `claude-haiku-5-5`이고, Edge Function의 `SUMMARY_MODEL` 시크릿으로 바꿀 수 있어요.

## 모델 출처

- **BlazeFace short-range**: Google MediaPipe (Apache 2.0)
- **MobileFaceNet**: [MCarlomagno/FaceRecognitionAuth](https://github.com/MCarlomagno/FaceRecognitionAuth)에 포함된 tflite 변환본
