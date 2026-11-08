// 페이지 시작: 게임을 만들고 HTML 도구 막대(곡 추가/삭제, 로그인, 닉네임)를 연결한다.
import { Game } from "./game.js";
import { rankingEnabled, watchUser, signIn, signOutUser, loadProfile, saveProfile } from "./ranking.js";

const game = new Game(document.getElementById("game"));
if (new URLSearchParams(location.search).has("debug")) window.game = game; // 개발자 도구에서 확인용

const $ = (id) => document.getElementById(id);
const fileInput = $("midi-file"), deleteBtn = $("delete-song");
const loginBtn = $("login"), logoutBtn = $("logout"), nameBox = $("name-box"), nameInput = $("player-name");

// ----- 곡 추가/삭제 ---------------------------------------------------------

fileInput.addEventListener("change", async () => {
  await game.addMidiFiles([...fileInput.files]);
  fileInput.value = "";
});

deleteBtn.addEventListener("click", () => {
  if (confirm(`"${game.song.name}" 곡을 목록에서 지울까요?`)) game.deleteCurrentSong();
});

const syncDelete = () => { deleteBtn.disabled = game.song.key === "builtin"; };
game.onChange = syncDelete;
syncDelete();

// 파일 끌어다 놓기
const drop = $("drop");
let dragDepth = 0;
addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; drop.hidden = false; });
addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; drop.hidden = true; } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", async (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.hidden = true;
  const files = [...e.dataTransfer.files].filter((f) => /\.midi?$/i.test(f.name));
  if (files.length) await game.addMidiFiles(files);
  else game.showToast("MIDI 파일(.mid)만 넣을 수 있어요");
});

// ----- 계정 (Google 로그인) -------------------------------------------------

const SYNC_KEYS = ["offset", "speed", "diff", "vibration", "long", "song", "parts"]; // 계정에 저장할 설정
let saveTimer = null;
let syncing = false; // 계정에서 불러오는 중에는 다시 저장하지 않는다

const cloudData = () => ({
  nickname: game.save.name,
  settings: Object.fromEntries(SYNC_KEYS.map((k) => [k, game.save[k]])),
  best: game.save.best,
});

function saveNow() {
  clearTimeout(saveTimer);
  if (!game.user) return Promise.resolve();
  return saveProfile(game.user.uid, cloudData()).catch((e) => {
    console.warn("계정 저장 실패", e);
    game.showToast("계정에 저장하지 못했어요: " + e.message, 5);
  });
}

// 설정이나 기록이 바뀌면 잠깐 모았다가 계정에 저장
game.onSaveChange = () => {
  if (!game.user || syncing) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1500);
};

/** 계정에 있던 설정을 쓰고, 최고 기록은 기기와 계정 중 높은 쪽을 남긴다. */
function mergeProfile(prof) {
  const s = game.save;
  if (prof.nickname) s.name = prof.nickname;
  for (const k of SYNC_KEYS) if (prof.settings && prof.settings[k] !== undefined) s[k] = prof.settings[k];
  for (const [key, rec] of Object.entries(prof.best || {}))
    if (!s.best[key] || rec.score > s.best[key].score) s.best[key] = rec;
  game.applySongFromSave();
}

function loginError(e) {
  if (e.code === "auth/unauthorized-domain")
    return "이 사이트 주소가 Firebase 승인된 도메인에 없어요 (Authentication → 설정 → 승인된 도메인)";
  if (e.code === "auth/operation-not-allowed") return "Firebase에서 Google 로그인을 사용 설정해 주세요";
  if (e.code === "auth/network-request-failed") return "인터넷 연결을 확인해 주세요";
  return "로그인 실패: " + (e.code || e.message);
}

function showAccount(user) {
  loginBtn.hidden = !rankingEnabled || Boolean(user);
  nameBox.hidden = logoutBtn.hidden = !user;
  nameInput.value = game.save.name;
}

if (rankingEnabled) {
  showAccount(null);
  loginBtn.addEventListener("click", () => {
    loginBtn.disabled = true;
    signIn()
      .catch((e) => game.showToast(loginError(e), 7))
      .finally(() => { loginBtn.disabled = false; });
  });
  logoutBtn.addEventListener("click", async () => {
    await saveNow();
    await signOutUser();
    game.showToast("로그아웃했어요");
  });
  nameInput.addEventListener("change", async () => {
    game.setName(nameInput.value);
    nameInput.value = game.save.name;
    await saveNow(); // 랭킹 등록 때 닉네임을 확인하므로 바로 저장
    game.showToast(`닉네임을 "${game.save.name}"(으)로 바꿨어요`);
  });
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInput.blur(); });

  watchUser(async (user) => {
    if (!user) {
      game.setUser(null);
      showAccount(null);
      return;
    }
    syncing = true;
    try {
      const prof = await loadProfile(user.uid);
      if (prof) mergeProfile(prof);
      game.writeSave(); // 이 기기에도 저장
      game.user = user;
      syncing = false;
      await saveProfile(user.uid, cloudData()); // 처음 로그인이면 여기서 계정 문서가 생긴다
      game.setUser(user);
      showAccount(user);
      game.showToast(prof ? `${game.save.name}님, 계정의 설정과 기록을 불러왔어요` : `처음 오셨네요! 닉네임은 "${game.save.name}"이에요. 아래에서 바꿀 수 있어요`, 5);
    } catch (e) {
      syncing = false;
      game.setUser(user);
      showAccount(user);
      game.showToast(e.code === "permission-denied"
        ? "계정 정보를 저장할 권한이 없어요. Firestore 보안 규칙을 새 버전으로 게시해 주세요"
        : "계정 정보를 불러오지 못했어요: " + e.message, 7);
    }
  }).catch((e) => game.showToast("Firebase에 연결하지 못했어요: " + e.message, 6));
}
