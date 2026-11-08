// 곡 데이터로 노트(채보)를 만든다. 파이썬 버전 build_chart와 같은 규칙.

// 채보 규칙이나 랭킹 방식을 바꾸면 올린다 (랭킹이 버전별로 나뉨)
// 1: 첫 버전(로그인 없음)  2: Google 로그인 랭킹으로 새로 시작
export const CHART_VERSION = 2;
export const DIFFS = ["EASY", "NORMAL", "HARD"];
const MIN_GAP = { EASY: 0.22, NORMAL: 0.11, HARD: 0.06 }; // 노트 사이 최소 간격(초)
const MAX_GAP = { EASY: 1.0, NORMAL: 0.6, HARD: 9e9 }; // 이보다 오래 비면 엇박 노트로 채움
const LONG_MIN = 0.4; // 이보다 긴 음은 롱노트(초)
const LONG_CLEAR = 0.12; // 롱노트 끝과 다음 노트 사이 최소 여유(초)
const EASY_FILL_GAP = 1.0; // EASY: 다음 노트까지 이만큼 비면 그 사이를 롱노트로 채움(초)
const EASY_FILL_CLEAR = 0.3; // EASY: 채운 롱노트 끝과 다음 노트 사이 여유(초)
const DOUBLE_LONG_MIN = 0.6; // 화음이 아니어도 이보다 긴 롱노트는 번갈아 동시 롱노트로(초)

function note(t, lane, end = null) {
  // done: 머리 판정 끝, hold: null | holding | ok | broken | missed
  return { t, lane, end, done: false, hold: null, chord: 1, double: false };
}

const byTime = (a, b) => a.t - b.t || a.lane - b.lane;

/** source: [[시각, 박자 단계 0/1/2, 음높이, 동시음 수, 고정 레인|null, 음 길이], ...] */
export function buildChart(source, diff, longNotes = true) {
  const level = DIFFS.indexOf(diff);
  const gap = MIN_GAP[diff];
  let notes = [];
  let lane = 1, prev = null, lastT = -9;
  for (const [t, tier, midi, chord, fixed, dur] of source) {
    // 멜로디가 올라가면 오른쪽, 내려가면 왼쪽 레인으로 (벽에 닿으면 튕김)
    if (fixed === null && prev !== null && midi !== prev) {
      lane += (midi > prev ? 1 : -1) * (Math.abs(midi - prev) >= 5 ? 2 : 1);
      if (lane < 0) lane = -lane;
      if (lane > 3) lane = 6 - lane;
    }
    prev = midi;
    if (t - lastT < gap || (tier > level && t - lastT < MAX_GAP[diff])) continue;
    lastT = t;
    const use = fixed === null ? lane : fixed;
    const longOk = longNotes && fixed === null && dur >= LONG_MIN;
    const n = note(t, use, longOk ? t + dur : null);
    n.chord = fixed === null ? chord : 1;
    notes.push(n);
    if (level === 2 && chord >= 2 && tier === 0 && fixed === null && !longOk)
      notes.push(note(t, (use + 2) % 4)); // HARD: 화음은 동시 치기
  }
  notes.sort(byTime);

  // EASY: 노트가 오래 비는 구간은 앞 노트를 롱노트로 늘려서 채운다.
  if (level === 0 && longNotes) {
    for (let i = 0; i + 1 < notes.length; i++) {
      const n = notes[i], m = notes[i + 1];
      if (n.end === null && m.t - n.t >= EASY_FILL_GAP) n.end = m.t - EASY_FILL_CLEAR;
    }
  }

  // 화음에서 시작하는 롱노트는 맞은편 레인에도 하나 더 → 동시 롱노트.
  // 단선율 곡도 동시 롱노트가 나오도록, 긴 롱노트는 두 개 중 하나를 동시로 만든다.
  if (longNotes) {
    let veryLong = 0;
    for (const n of [...notes]) {
      if (n.end === null) continue;
      let make = n.chord >= 2;
      if (!make && n.end - n.t >= DOUBLE_LONG_MIN) make = ++veryLong % 2 === 1;
      if (make) {
        const p = note(n.t, (n.lane + 2) % 4, n.end);
        n.double = p.double = true;
        notes.push(p);
      }
    }
    notes.sort(byTime);
  }

  // 롱노트는 다음 노트가 오기 전에 끝나게 자른다.
  // HARD의 한 손 롱노트는 다른 레인 노트와 겹쳐도 된다. 동시 롱노트는 어떤 노트와도 안 겹치게.
  notes.forEach((n, i) => {
    if (n.end === null) return;
    const anyLane = level < 2 || n.double;
    for (let k = i + 1; k < notes.length; k++) {
      const m = notes[k];
      if (m.t > n.t && (anyLane || m.lane === n.lane || m.double)) {
        n.end = Math.min(n.end, m.t - LONG_CLEAR);
        break;
      }
    }
    if (n.end - n.t < LONG_MIN) { n.end = null; n.double = false; }
  });
  return notes;
}
