// 코드로 작곡하는 기본 곡 "BEAT PAD"
import { SR, Rng, tone, mtof, makeDrums, addInto } from "./synth.js";

export const BPM = 128;
export const BEAT = 60 / BPM;
const STEP = BEAT / 4; // 16분음표

const CHORDS = {
  Am: [45, [57, 60, 64]],
  F: [41, [57, 60, 65]],
  C: [48, [55, 60, 64]],
  G: [43, [55, 59, 62]],
  Em: [40, [55, 59, 64]],
};
const PROG = { A: ["Am", "F", "C", "G"], B: ["F", "G", "Em", "Am"] };
const SECTIONS = [
  ...Array(2).fill("intro"), ...Array(8).fill("A"), ...Array(8).fill("B"), ...Array(8).fill("A"), "end",
];
const SCALE = [69, 72, 74, 76, 79, 81, 84]; // A 단조 펜타토닉

function makePhrase(rng, prog, busy) {
  const notes = [];
  let idx = 3;
  prog.forEach((chord, bar) => {
    const pcs = new Set(CHORDS[chord][1].map((p) => p % 12));
    for (let s = 0; s < 16; s++) {
      let p = s % 4 === 0 ? 0.85 : s % 2 === 0 ? 0.5 : busy ? 0.25 : 0;
      if (bar === 3 && s > 12) p = 0; // 프레이즈 끝에서 숨 고르기
      if (s === 0 && bar === 0) p = 1;
      if (rng.next() >= p) continue;
      idx = Math.max(0, Math.min(SCALE.length - 1, idx + rng.choice([-2, -1, -1, 0, 1, 1, 2])));
      if (s % 4 === 0) {
        // 정박에서는 코드 구성음으로
        let best = idx, bestD = 99;
        SCALE.forEach((m, i) => {
          if (pcs.has(m % 12) && Math.abs(i - idx) < bestD) { best = i; bestD = Math.abs(i - idx); }
        });
        idx = best;
      }
      notes.push([bar * 16 + s, SCALE[idx]]);
    }
  });
  return notes;
}

export class BuiltinSong {
  constructor() {
    this.name = "BEAT PAD (기본 곡)";
    this.key = "builtin";
    this.boardId = "builtin1";
    this.parts = [];
    this.defaultPart = 0;
    this.error = null;
    this.buffer = null;
    this.length = SECTIONS.length * 16 * STEP + 3;
    this.barTimes = SECTIONS.map((_, k) => k * 16 * STEP);
    this._render(true);
  }

  /** melodyOnly=true면 소리 없이 멜로디만 계산 (채보용) */
  _render(melodyOnly) {
    const rng = new Rng(7);
    const drums = makeDrums(new Rng(77));
    const phrases = { A: makePhrase(rng, PROG.A, false), B: makePhrase(rng, PROG.B, true) };
    const n = Math.floor(this.length * SR);
    const out = melodyOnly ? null : new Float32Array(n);
    const lead = melodyOnly ? null : new Float32Array(n);
    const add = (buf, sig, t, g) => { if (buf) addInto(buf, sig, t, g); };
    const melody = [];
    const pos = { A: 0, B: 0 };

    SECTIONS.forEach((sec, bar) => {
      const t0 = bar * 16 * STEP;
      if (sec === "intro") {
        if (melodyOnly) return;
        for (let s = 0; s < 16; s++) {
          if (s % 4 === 0) add(out, drums.kick, t0 + s * STEP, 0.9);
          if (s % 2 === 0) add(out, drums.hat, t0 + s * STEP, 0.35);
        }
        if (bar === 1) for (const s of [12, 14, 15]) add(out, drums.snare, t0 + s * STEP, 0.5);
        return;
      }
      if (sec === "end") {
        melody.push([bar * 16, 81, 8]);
        if (melodyOnly) return;
        add(out, drums.kick, t0, 1);
        add(out, drums.crash, t0, 0.8);
        for (const m of [...CHORDS.Am[1], CHORDS.Am[0]])
          add(out, tone("sine", mtof(m), 2.5, { attack: 0.01, decay: 0.8, sustain: 0, release: 0.3 }), t0, 0.18);
        add(lead, tone("pulse", mtof(81), 1, { decay: 0.4, sustain: 0, release: 0.2 }), t0, 0.16);
        return;
      }

      const k = pos[sec]++;
      const [root, pad] = CHORDS[PROG[sec][k % 4]];
      const barNotes = phrases[sec].filter(([s]) => Math.floor(s / 16) === k % 4).map(([s, m]) => [s % 16, m]);
      barNotes.forEach(([s, m], i) => {
        const nxt = i + 1 < barNotes.length ? barNotes[i + 1][0] : 16;
        const steps = Math.min(nxt - s, 8);
        melody.push([bar * 16 + s, m, steps]);
        if (!melodyOnly) {
          const d = steps * STEP * 0.95;
          add(lead, tone("pulse", mtof(m), d, { attack: 0.004, decay: 0.12, sustain: 0.45 }), t0 + s * STEP, 0.16);
        }
      });
      if (melodyOnly) return;

      // 드럼
      const kicks = sec === "A" ? [0, 8] : [0, 6, 8, 14];
      for (let s = 0; s < 16; s++) {
        const ts = t0 + s * STEP;
        if (kicks.includes(s)) add(out, drums.kick, ts, 0.9);
        if (s === 4 || s === 12) add(out, drums.snare, ts, 0.55);
        if (sec === "B" || s % 2 === 0) add(out, drums.hat, ts, s % 2 === 0 ? 0.3 : 0.18);
      }
      if (k === 0) add(out, drums.crash, t0, 0.5);
      // 베이스
      for (let e = 0; e < 8; e++) {
        const d = STEP * 2 * 0.9;
        add(out, tone("triangle", mtof(root + (e % 2 ? 12 : 0)), d, { attack: 0.003, decay: 0.1, sustain: 0.6, release: 0.02 }),
          t0 + e * 2 * STEP, 0.35);
      }
      // 패드 화음
      for (const m of pad)
        add(out, tone("sine", mtof(m), 16 * STEP, { attack: 0.15, decay: 1, sustain: 0.7, release: 0.2 }), t0, 0.06);
    });

    this.melody = melody;
    if (melodyOnly) return null;

    // 멜로디에 간단한 에코
    const delay = Math.floor(3 * STEP * SR);
    for (let i = 0; i < n; i++) out[i] += lead[i] + (i >= delay ? lead[i - delay] * 0.28 : 0);
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
    for (let i = 0; i < n; i++) out[i] /= peak * 1.1;
    return out;
  }

  render() {
    return this._render(false);
  }

  chartSource() {
    return this.melody.map(([step, midi, steps]) => {
      const tier = step % 4 === 0 ? 0 : step % 2 === 0 ? 1 : 2;
      return [step * STEP, tier, midi, step % 16 === 0 ? 2 : 1, null, steps * STEP];
    });
  }
}
