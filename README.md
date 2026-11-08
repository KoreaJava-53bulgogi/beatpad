# BEAT PAD

게임패드, 키보드, 터치로 즐기는 브라우저 리듬 게임입니다.
MIDI 파일을 넣으면 소리를 합성하고 노트를 자동으로 만들어 줍니다.

- 조작: X(←) A(↓) Y(↑) B(→) / 키보드 D F J K 또는 방향키 / 화면 터치
- 난이도 EASY · NORMAL · HARD, 롱노트와 동시 롱노트
- Firebase로 온라인 랭킹 (선택)

## 내 컴퓨터에서 실행

ES 모듈을 쓰기 때문에 파일을 더블클릭하면 안 되고, 간단한 서버로 열어야 합니다.

```
cd web
python -m http.server 8000
```

브라우저에서 http://localhost:8000 을 엽니다.

## 온라인 랭킹 켜기 (Firebase)

1. https://console.firebase.google.com 에서 프로젝트를 만듭니다. Google 애널리틱스는 꺼도 됩니다.
2. **빌드 → Firestore Database → 데이터베이스 만들기**를 누릅니다. 위치는 `asia-northeast3 (서울)`을 추천하고, **프로덕션 모드**로 시작합니다.
3. Firestore의 **규칙** 탭에 [`firestore.rules`](firestore.rules) 내용을 그대로 붙여 넣고 **게시**합니다.
4. **프로젝트 설정(톱니바퀴) → 내 앱 → 웹 앱 추가(`</>`)**를 누르고, 화면에 나오는 `firebaseConfig` 값을 [`firebase-config.js`](firebase-config.js)에 붙여 넣습니다.

설정 값(apiKey 등)은 공개되어도 괜찮습니다. 누가 무엇을 쓸 수 있는지는 Firestore 규칙이 정합니다.

### Google 로그인 켜기

랭킹 등록은 Google로 로그인한 사람만 할 수 있습니다. 로그인하면 설정과 최고 기록이 계정에 저장되어 다른 기기에서도 이어집니다.

1. **빌드 → Authentication → 시작하기**를 누릅니다.
2. **로그인 방법** 탭에서 **Google**을 사용 설정하고, 지원 이메일을 고른 뒤 저장합니다.
3. **설정 → 승인된 도메인**에 게임 주소의 도메인(예: `내아이디.github.io`)을 추가합니다.
4. 보안 규칙을 바꿨다면 [`firestore.rules`](firestore.rules)를 다시 붙여 넣고 **게시**합니다.

랭킹에는 Google 계정 이름이 아니라, 게임에서 정한 **닉네임**만 보입니다.

## GitHub Pages에 올리기

1. GitHub에서 새 저장소를 만듭니다. 예: `beatpad`, Public.
2. 이 폴더(`web`)에서 아래 명령을 실행합니다.
   ```
   git remote add origin https://github.com/<내 아이디>/beatpad.git
   git push -u origin main
   ```
3. 저장소 **Settings → Pages**에서 Source를 **Deploy from a branch**, Branch를 **main / (root)**로 정하고 저장합니다.
4. 1~2분 뒤 `https://<내 아이디>.github.io/beatpad/`에서 열립니다.

## 곡 저작권

이 저장소에는 기본 곡(코드로 작곡)만 들어 있습니다. 플레이어가 고른 MIDI 파일은 그 사람의 브라우저 안에서만 읽고 저장하며, 서버로 올라가지 않습니다.
