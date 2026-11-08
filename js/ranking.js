// Firebase 온라인 기능: Google 로그인, 계정 프로필(설정·최고 기록), 랭킹.
//
// Firestore 구조
//   users/{uid}                          닉네임, 설정, 내 최고 기록 (본인만 읽고 씀)
//   leaderboards/{보드 ID}/scores/{uid}   한 사람당 기록 1개, 더 높은 점수로만 바뀜
//   보드 ID = 곡 + 트랙 + 난이도 + 롱노트 여부 + 채보 버전 (같은 채보끼리만 경쟁)
import { firebaseConfig } from "../firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";

export const rankingEnabled = Boolean(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);

let ready = null;

function connect() {
  if (!ready) {
    ready = (async () => {
      const { initializeApp } = await import(SDK + "firebase-app.js");
      const fs = await import(SDK + "firebase-firestore.js");
      const au = await import(SDK + "firebase-auth.js");
      const app = initializeApp(firebaseConfig);
      return { fs, au, db: fs.getFirestore(app), auth: au.getAuth(app) };
    })();
    ready.catch(() => { ready = null; }); // 실패하면 다음에 다시 시도
  }
  return ready;
}

// ----- 로그인 --------------------------------------------------------------

/** 로그인 상태가 바뀔 때마다 cb({ uid }) 또는 cb(null)을 부른다. */
export async function watchUser(cb) {
  const { au, auth } = await connect();
  au.getRedirectResult(auth).catch(() => {}); // 휴대폰에서 페이지 이동 방식으로 로그인하고 돌아온 경우
  au.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid } : null));
}

/** 버튼 클릭에서 바로 불러야 팝업이 막히지 않는다. */
export async function signIn() {
  const { au, auth } = await connect();
  const provider = new au.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await au.signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
      await au.signInWithRedirect(auth, provider); // 팝업이 막히면 페이지 이동 방식으로
    } else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      throw e;
    }
  }
}

export async function signOutUser() {
  const { au, auth } = await connect();
  await au.signOut(auth);
}

// ----- 계정 프로필 ---------------------------------------------------------

export async function loadProfile(uid) {
  const { fs, db } = await connect();
  const snap = await fs.getDoc(fs.doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

/** data: { nickname, settings, best } 중 일부. 나머지는 그대로 둔다. */
export async function saveProfile(uid, data) {
  const { fs, db } = await connect();
  await fs.setDoc(fs.doc(db, "users", uid), { ...data, updatedAt: fs.serverTimestamp() }, { merge: true });
}

// ----- 랭킹 ----------------------------------------------------------------

/** 상위 n개 기록. 각 줄의 id는 그 기록을 올린 사람의 uid. */
export async function fetchTop(boardId, n = 10) {
  const { fs, db } = await connect();
  const q = fs.query(fs.collection(db, "leaderboards", boardId, "scores"), fs.orderBy("score", "desc"), fs.limit(n));
  const snap = await fs.getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * 내 기록을 올린다. 이미 더 높은 기록이 있으면 바꾸지 않는다.
 * 돌려주는 값: { improved: 새 기록인지, best: 랭킹에 남은 내 점수, pos: 몇 위인지(모르면 null) }
 */
export async function submitScore(boardId, uid, entry) {
  const { fs, db } = await connect();
  const col = fs.collection(db, "leaderboards", boardId, "scores");
  const ref = fs.doc(col, uid);
  const kept = await fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const old = snap.exists() ? snap.data().score : -1;
    if (old >= entry.score) return old;
    tx.set(ref, { ...entry, updatedAt: fs.serverTimestamp() });
    return null;
  });
  const best = kept ?? entry.score;
  let pos = null;
  try {
    pos = (await fs.getCountFromServer(fs.query(col, fs.where("score", ">", best)))).data().count + 1;
  } catch { /* 순위 계산 실패는 무시 */ }
  return { improved: kept === null, best, pos };
}
