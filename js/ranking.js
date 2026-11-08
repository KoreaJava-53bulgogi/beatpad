// Firebase Firestore 온라인 랭킹.
// 구조: leaderboards/{보드 ID}/scores/{자동 ID}
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
      return { fs, db: fs.getFirestore(initializeApp(firebaseConfig)) };
    })();
    ready.catch(() => { ready = null; }); // 실패하면 다음에 다시 시도
  }
  return ready;
}

/** 상위 n개 기록 */
export async function fetchTop(boardId, n = 10) {
  const { fs, db } = await connect();
  const q = fs.query(fs.collection(db, "leaderboards", boardId, "scores"), fs.orderBy("score", "desc"), fs.limit(n));
  const snap = await fs.getDocs(q);
  return snap.docs.map((d) => d.data());
}

/** 기록을 올리고 몇 위인지 돌려준다. */
export async function submitScore(boardId, entry) {
  const { fs, db } = await connect();
  const col = fs.collection(db, "leaderboards", boardId, "scores");
  await fs.addDoc(col, { ...entry, createdAt: fs.serverTimestamp() });
  try {
    const higher = await fs.getCountFromServer(fs.query(col, fs.where("score", ">", entry.score)));
    return higher.data().count + 1;
  } catch {
    return null;
  }
}
