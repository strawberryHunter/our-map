# OURS

둘이 함께한 날을 사진으로 찾아 모으고, 이야기와 영화로 남기는 커플 앱이에요. 아이폰과 안드로이드에서 모두 쓸 수 있어요.

## 기능

| 기능 | 하는 일 |
|---|---|
| **AI 추억 자동 발견** | 촬영 날짜와 위치로 여행·데이트 단위로 묶어요. 두 가지 방식이 있어요. 하나는 앱을 열 때 갤러리에서 둘이 나온 사진을 자동으로 찾는 거고, 다른 하나는 사진을 직접 고르는 거예요. GPS가 없으면 장소를 자동으로 정하지 않고 "장소 미확정"으로 남겨서, 지도에서 직접 고르게 해요. |
| **AI 추억 스토리** | 사진과 우리가 쓴 메모로 그날의 이야기를 써요. 메모는 사실로 취급하고, 사진·메모에 없는 일은 지어내지 않아요. 언제든 다시 쓰거나 직접 고칠 수 있어요. |
| **AI 추억 영화** | 고른 추억만 써서 9:16 영상을 만들어요. 첫 2초에 대표 사진과 숫자, 장소 사이 지도 비행, 필름 날짜 도장이 찍힌 폴라로이드 사진, "우리가 그린 지도" 엔딩이 들어가요. 컷은 120BPM 박자에 맞춰서 어떤 음악을 붙여도 맞아요. |
| **오늘의 추억** | N년 전 오늘, 첫 추억·첫 여행 N주년, D+100/200/…/1000일(첫날 = 1일)을 보여줘요. 해당하는 게 없으면 "이맘때의 우리"를 보여줘요. 날짜는 한국 시간 기준이고, 2월 29일 추억은 평년에는 2월 28일에 나와요. |
| **AI 데이트 추천** | 저장된 장소와 취향(자주 간 동네, 자주 한 것, 저녁/낮)을 바탕으로 코스를 짜요. Claude가 웹 검색으로 실제 영업 중인 곳만 고르고, 이미 가본 곳은 빼요. 지도에 번호 핀으로 보여주고 저장할 수 있어요. |

## 구조

| 부분 | 기술 |
|---|---|
| 앱 | Expo (React Native), expo-router |
| 갤러리 접근 | expo-media-library |
| 얼굴 검출 | MediaPipe BlazeFace short-range (`assets/models/blaze_face_short_range.tflite`) |
| 얼굴 인식 | MobileFaceNet, 192차원 (`assets/models/mobilefacenet.tflite`), 랜드마크 정렬 후 cosine ≥ 0.5 |
| 저장·동기화 | Supabase (Postgres + Storage + Realtime, RLS로 커플 단위 격리) |
| AI 스토리 / 추천 | Supabase Edge Functions `summarize`, `recommend` → Claude API (키는 서버에만 있음). 추천은 Claude 웹 검색 사용 |
| 지도 | MapLibre + OpenFreeMap 타일 (무료, API 키 불필요) |
| 영화 | WebView 안에서 maplibre-gl + canvas로 한 프레임씩 그려 WebCodecs로 인코딩(mp4). 구성·카메라는 TS에서 미리 계산 (`src/video/timeline.ts`, `camera.ts`). WebCodecs가 없는 기기는 실시간 녹화로 대체 |

## 검증

```bash
pip install ai-edge-litert numpy        # 얼굴 모델 테스트용 (없으면 그 테스트만 건너뜀)
npx playwright-core install chromium-headless-shell   # 영상 테스트용
npm run verify                           # 전체 검사, 약 2분
npm run verify -- --quick                # 느린 단계(영상, 네이티브 번들, 권한) 빼고
npm run verify -- sync db                # 이름이 맞는 단계만
```

| 단계 | 확인하는 것 |
|---|---|
| typecheck | 앱과 테스트의 타입 오류 |
| cluster | 사진 묶기: 시간 공백, 이동, GPS 없음/튐, 1만 장 성능 |
| face | 실제 TFLite 모델로 얼굴 검출·같은 사람 구분 (같은 사람 0.83, 다른 사람 ~0) |
| sync | 가짜 갤러리·서버로 동기화 전체 흐름: 건너뛰기, 대기, 두 폰 합치기, 네트워크 끊김 후 재시도, 중복 방지 |
| db | SQL 마이그레이션 실행, 커플 연결, 다른 커플 데이터 접근 차단 (PGlite) |
| summary | AI 응답이 이상해도 앱이 안 깨지는지 |
| privacy | 폰 밖으로 나가는 모든 호출이 목록에 있는지, 분석 SDK·위치 로그 없는지 |
| config | iOS/Android 권한: 필요한 건 한글 설명과 함께 있고, 안 쓰는 건 없는지 |
| video | 헤드리스 크롬에서 실제로 영상을 녹화해 파일이 끝까지 오는지, 해상도·프레임 수 |
| bundle | Android/iOS JS 번들 빌드 |

실패하면 어떤 테스트가 어느 줄에서 무엇을 기대했고 실제로 뭐가 나왔는지 출력하고, `verify/out/report.md`에 정리해요. 영상 테스트는 `verify/out/`에 장소별 프레임과 영상 파일도 남겨요. 데이터가 어디로 나가는지는 `verify/out/privacy.md`에 표로 정리돼요.

## 처음 세팅

### 1. Supabase 만들기 (무료 플랜)

1. https://supabase.com 에서 프로젝트를 만들어요.
2. SQL Editor에서 `supabase/migrations/0001_init.sql`, `0002_ours_features.sql`을 순서대로 실행해요.
3. 요약 함수를 배포하고 Claude API 키를 넣어요.

```bash
npm i -g supabase
supabase login
supabase link --project-ref <프로젝트 ref>
supabase functions deploy summarize
supabase functions deploy recommend
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
5. 특정 여행만 넣고 싶으면 **추억 탭 → ＋ 사진으로 만들기**에서 사진을 골라요.

## 알아둘 점

- **사진 범위**: 한 번에 400장씩 처리해요. 기간이 길면 여러 번 열어야 끝까지 정리돼요.
- **아직 진행 중인 외출**: 마지막 사진이 3시간이 안 됐으면 다음 정리 때 처리해요.
- **아이폰 위치 정보**: "제한된 사진 접근"을 고르면 일부 사진만 보여요. 위치 정보가 빠진 사진은 같은 시간대 사진의 위치를 따라가요.
- **영상 녹화**: 영상은 앱 화면에서 실제로 재생하면서 녹화해요. 만드는 동안에는 화면을 켜두세요.
- **비용**:
  - 스토리는 추억 하나당 저장된 사진 최대 4장을 보내요. 기본 모델은 `claude-haiku-5-5`이고, 시크릿 `SUMMARY_MODEL`로 바꿀 수 있어요.
  - 데이트 추천은 웹 검색을 최대 6번 해요. 기본 모델은 `claude-sonnet-5-5`이고, 시크릿 `RECOMMEND_MODEL`로 바꿀 수 있어요.
- **영화 만들기 시간**: 폰에서는 GPU와 하드웨어 인코더를 써요. 검증 환경(GPU 없음)에서는 21초 영상에 5분이 걸렸어요. 실제 폰 속도는 아직 재보지 않았어요.

## 모델 출처

- **BlazeFace short-range**: Google MediaPipe (Apache 2.0)
- **MobileFaceNet**: [MCarlomagno/FaceRecognitionAuth](https://github.com/MCarlomagno/FaceRecognitionAuth)에 포함된 tflite 변환본
