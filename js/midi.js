// MIDI 파일을 읽어서 소리를 합성하고, 노트 채보용 데이터를 만든다.
// 외부 라이브러리 없이 표준 MIDI 파일(형식 0, 1)을 직접 해석한다.
import { SR, Rng, tone, mix, mtof, makeDrums, tom, addInto, finalize } from "./synth.js";

const LEAD_IN = 2.5; // 첫 음 전에 최소한 이만큼(초) 여유

const GM_FAMILIES = ["피아노", "건반 타악기", "오르간", "기타", "베이스", "현악기", "앙상블", "금관",
  "리드", "파이프", "신스 리드", "신스 패드", "신스 효과", "민속 악기", "타악기", "효과음"];

const KICKS = new Set([35, 36]);
const SNARES = new Set([37, 38, 39, 40]);
const HATS = new Set([42, 44, 46, 51, 53, 59]);
const CYMBALS = new Set([49, 52, 55, 57]);
const TOMS = new Set([41, 43, 45, 47, 48, 50]);
// 드럼 트랙으로 채보할 때 레인: 크래시/탐=X, 킥=A, 스네어=Y, 하이햇=B
const DRUM_PRIORITY = [[KICKS, 1], [SNARES, 2], [CYMBALS, 0], [TOMS, 0], [HATS, 3]];

/** 파일 내용으로 만든 짧은 해시 (같은 MIDI면 누구 컴퓨터에서든 같은 값 → 랭킹 구분용) */
export function hashBytes(bytes) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 2654435761);
    h2 = Math.imul(h2 ^ bytes[i], 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

function decodeText(bytes) {
  for (const enc of ["utf-8", "euc-kr", "latin1"]) {
    try {
      return new TextDecoder(enc, { fatal: true }).decode(bytes).replace(/^[\0 ]+|[\0 ]+$/g, "");
    } catch { /* 다음 인코딩 시도 */ }
  }
  return "";
}

function parseTrack(d, tr, tempos, timesigs, notes, names) {
  let j = 0, tick = 0, status = 0;
  const vlq = () => {
    let v = 0, b;
    do { b = d[j++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80);
    return v;
  };
  const opened = new Map();
  const prog = {};
  while (j < d.length) {
    tick += vlq();
    const b = d[j];
    if (b === 0xff) { // 메타 이벤트
      const type = d[j + 1];
      j += 2;
      const ln = vlq();
      const payload = d.subarray(j, j + ln);
      j += ln;
      if (type === 0x51 && ln === 3) tempos.push([tick, (payload[0] << 16) | (payload[1] << 8) | payload[2]]);
      else if (type === 0x58 && ln >= 2) timesigs.push([tick, payload[0], 2 ** payload[1]]);
      else if (type === 0x03 && !(tr in names)) names[tr] = decodeText(payload);
      else if (type === 0x2f) break;
      continue;
    }
    if (b === 0xf0 || b === 0xf7) { // SysEx
      j++;
      j += vlq();
      continue;
    }
    if (b & 0x80) { status = b; j++; }
    else if (!status) throw new Error("MIDI 데이터가 손상되었습니다");
    const kind = status & 0xf0, ch = status & 0x0f;
    let a, v = 0;
    if (kind === 0xc0 || kind === 0xd0) a = d[j++];
    else { a = d[j]; v = d[j + 1]; j += 2; }
    const key = ch * 128 + a;
    if (kind === 0x90 && v > 0) {
      if (!opened.has(key)) opened.set(key, []);
      opened.get(key).push([tick, v, prog[ch] || 0]);
    } else if (kind === 0x80 || kind === 0x90) {
      const stack = opened.get(key);
      if (stack && stack.length) {
        const [start, vel, p] = stack.shift();
        notes.push([start, tick, a, vel, ch, tr, p]);
      }
    } else if (kind === 0xc0) prog[ch] = a;
  }
  for (const [key, stack] of opened) // 끝나지 않은 음은 트랙 끝에서 끊는다
    for (const [start, vel, p] of stack) notes.push([start, tick, key % 128, vel, Math.floor(key / 128), tr, p]);
}

export class MidiSong {
  constructor(name, bytes) {
    this.name = name.replace(/(\.midi?)+$/i, "");
    this.bytes = bytes;
    this.hash = hashBytes(bytes);
    this.key = "midi:" + this.hash;
    this.boardId = "m" + this.hash;
    this.parts = [];
    this.defaultPart = 0;
    this.error = null;
    this.buffer = null;
    try {
      this._parse();
    } catch (e) {
      this.error = "불러오기 실패: " + e.message;
    }
  }

  _parse() {
    const d = this.bytes;
    const str = (i) => String.fromCharCode(d[i], d[i + 1], d[i + 2], d[i + 3]);
    const u32 = (i) => ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
    const u16 = (i) => (d[i] << 8) | d[i + 1];
    if (d.length < 14 || str(0) !== "MThd") throw new Error("MIDI 파일이 아닙니다");
    const hlen = u32(4);
    const div = u16(12);
    if (div & 0x8000) throw new Error("SMPTE 시간 형식은 지원하지 않습니다");
    this.ppq = div;

    const tempos = [], timesigs = [], raw = [], names = {};
    let i = 8 + hlen, tr = 0;
    while (i + 8 <= d.length) {
      const id = str(i), len = u32(i + 4);
      if (id === "MTrk") parseTrack(d.subarray(i + 8, i + 8 + len), tr++, tempos, timesigs, raw, names);
      i += 8 + len;
    }
    const notes = raw.filter((n) => n[1] >= n[0]);
    if (!notes.length) throw new Error("음표가 없습니다");

    // 템포 맵 (같은 tick의 템포는 마지막 것만)
    const tmap = new Map([[0, 500000]]);
    tempos.sort((a, b) => a[0] - b[0]).forEach(([t, us]) => tmap.set(t, us));
    this.segTicks = []; this.segSecs = []; this.segUs = [];
    let sec = 0, prevTick = 0, prevUs = null;
    for (const t of [...tmap.keys()].sort((a, b) => a - b)) {
      if (prevUs !== null) sec += ((t - prevTick) * prevUs) / 1e6 / this.ppq;
      this.segTicks.push(t); this.segSecs.push(sec); this.segUs.push(tmap.get(t));
      prevTick = t; prevUs = tmap.get(t);
    }
    this.lead = 0;
    const first = Math.min(...notes.map((n) => this.sec(n[0])));
    this.lead = Math.max(0, LEAD_IN - first);

    // 트랙/채널별로 묶기
    const groups = new Map();
    for (const [start, end, pitch, vel, ch, trk, p] of notes) {
      const k = trk * 16 + ch;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push([start, this.sec(start), this.sec(end), pitch, vel, p]);
    }
    const chPerTrack = {};
    for (const k of groups.keys()) chPerTrack[Math.floor(k / 16)] = (chPerTrack[Math.floor(k / 16)] || 0) + 1;
    this.notes = []; // 합성용 [start, end, pitch, vel, drum, program]
    for (const k of [...groups.keys()].sort((a, b) => a - b)) {
      const trk = Math.floor(k / 16), ch = k % 16;
      const lst = groups.get(k).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[3] - b[3]);
      const progCount = {};
      for (const n of lst) progCount[n[5]] = (progCount[n[5]] || 0) + 1;
      const prog = +Object.entries(progCount).sort((a, b) => b[1] - a[1])[0][0];
      const family = ch === 9 ? "드럼" : GM_FAMILIES[prog >> 3];
      const tname = names[trk] || "";
      let name;
      if (tname && chPerTrack[trk] === 1) name = tname;
      else if (tname) name = `${tname} / ${family}`;
      else name = `${family} (채널 ${ch + 1})`;
      this.parts.push({
        name, drum: ch === 9,
        notes: lst.map((n) => [n[0], n[1], n[2], n[3], n[4]]), // tick, start, end, pitch, vel
        meanPitch: lst.reduce((a, n) => a + n[3], 0) / lst.length,
        label() { return `${this.name} (${this.notes.length}음)`; },
      });
      for (const n of lst) this.notes.push([n[1], n[2], n[3], n[4], ch === 9, n[5]]);
    }
    this.defaultPart = this._guessMelody();
    this.length = Math.max(...this.notes.map((n) => n[1])) + 2;
    this._buildPhase();

    // 마디선
    const sigs = timesigs.sort((a, b) => a[0] - b[0]);
    if (!sigs.length || sigs[0][0] !== 0) sigs.unshift([0, 4, 4]);
    const endTick = Math.max(...notes.map((n) => n[1]));
    this.barTimes = [];
    sigs.forEach(([tick, num, den], k) => {
      const stop = k + 1 < sigs.length ? sigs[k + 1][0] : endTick + 1;
      const step = Math.max(1, Math.floor((num * this.ppq * 4) / den));
      for (let bt = tick; bt < stop; bt += step) this.barTimes.push(this.sec(bt + this.phase(bt / this.ppq) * this.ppq));
    });
  }

  _rawSec(tick) {
    let k = 0;
    while (k + 1 < this.segTicks.length && this.segTicks[k + 1] <= tick) k++;
    return this.segSecs[k] + ((tick - this.segTicks[k]) * this.segUs[k]) / 1e6 / this.ppq;
  }

  sec(tick) {
    return this._rawSec(tick) + this.lead;
  }

  /** 드럼이 아니고, 음이 충분히 많고, 단선율에 가깝고, 높은 음역인 파트를 고른다. */
  _guessMelody() {
    const cands = this.parts.filter((p) => !p.drum);
    if (!cands.length) return 0;
    const most = Math.max(...cands.map((p) => p.notes.length));
    const score = (p) => {
      const starts = {};
      for (const n of p.notes) starts[n[0]] = (starts[n[0]] || 0) + 1;
      const vals = Object.values(starts);
      return p.meanPitch + (15 * vals.filter((c) => c === 1).length) / vals.length;
    };
    let pool = cands.filter((p) => p.notes.length >= Math.max(16, most * 0.25));
    if (!pool.length) pool = cands;
    const best = pool.reduce((a, b) => (score(b) > score(a) ? b : a));
    return this.parts.indexOf(best);
  }

  /**
   * 박자 어긋남 보정값(박 단위)을 2박마다 계산한다.
   * 사람이 직접 연주해 녹음한 MIDI는 실제 박이 MIDI의 박 위치에서 조금씩 밀리는 경우가 많다.
   */
  _buildPhase() {
    const melodic = new Set();
    for (const p of this.parts) if (!p.drum) for (const n of p.notes) melodic.add(n[0]);
    let ticks = melodic;
    if (!ticks.size) { ticks = new Set(); for (const p of this.parts) for (const n of p.notes) ticks.add(n[0]); }
    const onsets = [...ticks].sort((a, b) => a - b).map((t) => t / this.ppq);
    const cands = Array.from({ length: 48 }, (_, i) => (i - 24) / 48);
    const fr = (x) => Math.abs(x - Math.round(x));
    this.phasePts = [];
    this.phases = [];
    let prev = null;
    for (let c = 0; c < onsets[onsets.length - 1] + 4; c += 2) {
      this.phasePts.push(c);
      const w = onsets.filter((x) => x > c - 8 && x < c + 8);
      if (w.length < 4) { this.phases.push(prev || 0); continue; }
      let best = 0, bestScore = -Infinity;
      for (const cand of cands) {
        let score = 0;
        for (const x of w) {
          const d = x - cand;
          const on1 = fr(d) < 0.06;
          const on2 = !on1 && fr(d * 2) / 2 < 0.05;
          const on4 = !on1 && !on2 && fr(d * 4) / 4 < 0.04;
          score += on1 ? 3 : on2 ? 2 : on4 ? 1 : 0;
        }
        if (prev !== null) score -= w.length * 0.6 * Math.abs((((cand - prev + 0.5) % 1) + 1) % 1 - 0.5);
        if (score > bestScore) { bestScore = score; best = cand; }
      }
      if (prev !== null) best = prev + ((((best - prev + 0.5) % 1) + 1) % 1 - 0.5);
      this.phases.push(best);
      prev = best;
    }
  }

  phase(beat) {
    const xs = this.phasePts, ys = this.phases;
    if (beat <= xs[0]) return ys[0];
    if (beat >= xs[xs.length - 1]) return ys[ys.length - 1];
    const k = Math.floor(beat / 2);
    const t = (beat - xs[k]) / (xs[k + 1] - xs[k]);
    return ys[k] + (ys[k + 1] - ys[k]) * t;
  }

  /** 소리를 합성해 Float32Array로 돌려준다. */
  render() {
    const buf = new Float32Array(Math.floor(this.length * SR));
    const dr = makeDrums(new Rng(1));
    const cache = new Map();
    const drum = (p) => {
      if (KICKS.has(p)) return [dr.kick, 0.9];
      if (SNARES.has(p)) return [dr.snare, 0.6];
      if (p === 46) return [dr.openHat, 0.5];
      if (p === 51 || p === 53 || p === 59) return [dr.ride, 0.5];
      if (CYMBALS.has(p)) return [dr.crash, 0.6];
      if (TOMS.has(p)) {
        const k = "tom" + p;
        if (!cache.has(k)) cache.set(k, tom(mtof(p)));
        return [cache.get(k), 0.6];
      }
      return [dr.hat, 0.4];
    };
    for (const [start, end, pitch, vel, isDrum, prog] of this.notes) {
      let sig, gain;
      if (isDrum) [sig, gain] = drum(pitch);
      else {
        const dur = Math.round(Math.min(Math.max(end - start, 0.05), 6) * 100) / 100;
        const k = `${prog >> 3}:${pitch}:${dur}`;
        if (!cache.has(k)) cache.set(k, instrument(prog >> 3, mtof(pitch), dur));
        sig = cache.get(k);
        gain = 0.22;
      }
      addInto(buf, sig, start, (gain * vel) / 127);
    }
    return finalize(buf);
  }

  /** [[시각, 박자 단계, 음높이, 동시음 수, 고정 레인, 음 길이], ...] */
  chartSource(partIdx) {
    const part = this.parts[partIdx];
    const groups = new Map();
    const lens = new Map();
    for (const [tick, start, end, pitch] of part.notes) {
      if (!groups.has(tick)) groups.set(tick, []);
      const g = groups.get(tick);
      g.push(pitch);
      if (pitch >= Math.max(...g)) lens.set(tick, end - start); // 가장 높은 음의 길이
    }
    const out = [];
    let lastT = -1;
    for (const tick of [...groups.keys()].sort((a, b) => a - b)) {
      const t = this.sec(tick);
      if (t - lastT < 0.02) continue; // 거의 같은 순간에 친 음은 하나로
      lastT = t;
      const pitches = groups.get(tick);
      let beat = tick / this.ppq;
      beat -= this.phase(beat);
      const tier = Math.abs(beat - Math.round(beat)) < 0.07 ? 0
        : Math.abs(beat * 2 - Math.round(beat * 2)) < 0.1 ? 1 : 2;
      let fixed = null;
      if (part.drum) {
        fixed = 3;
        for (const [kinds, lane] of DRUM_PRIORITY) if (pitches.some((p) => kinds.has(p))) { fixed = lane; break; }
      }
      out.push([t, tier, Math.max(...pitches), new Set(pitches).size, fixed, part.drum ? 0 : lens.get(tick)]);
    }
    return out;
  }
}

/** GM 악기 계열에 따라 대충 비슷한 음색을 만든다. */
function instrument(family, f, dur) {
  const T = (type, freq, rel, opt) => tone(type, freq, dur + rel, { ...opt, release: rel });
  switch (family) {
    case 0: { const o = { attack: 0.003, decay: 0.35, sustain: 0.15 };
      return mix([[T("pulse", f, 0.12, { ...o, duty: 0.5 }), 0.4], [T("triangle", f, 0.12, o), 0.4]]); }
    case 1: { const o = { attack: 0.002, decay: 0.25, sustain: 0 };
      return mix([[T("sine", f, 0.3, o), 1], [T("sine", f * 4, 0.3, o), 0.3]]); }
    case 2: { const o = { attack: 0.01, decay: 0.2, sustain: 0.85 };
      return mix([[T("sine", f, 0.05, o), 0.6], [T("sine", f * 2, 0.05, o), 0.3], [T("sine", f * 3, 0.05, o), 0.15]]); }
    case 3: return mix([[T("pulse", f, 0.1, { attack: 0.002, decay: 0.25, sustain: 0.2, duty: 0.3 }), 0.7]]);
    case 4: { const o = { attack: 0.004, decay: 0.2, sustain: 0.7 };
      return mix([[T("triangle", f, 0.05, o), 1.3], [T("pulse", f, 0.05, { ...o, duty: 0.5 }), 0.2]]); }
    case 5: case 6: case 11: { const o = { attack: 0.08, decay: 0.5, sustain: 0.75 };
      return mix([[T("saw", f, 0.25, o), 0.22], [T("saw", f * 1.004, 0.25, o), 0.22]]); }
    case 7: return mix([[T("saw", f, 0.08, { attack: 0.03, decay: 0.3, sustain: 0.8 }), 0.55]]);
    case 8: case 9: { const o = { attack: 0.02, decay: 0.3, sustain: 0.8 };
      return mix([[T("triangle", f, 0.06, o), 0.8], [T("sine", f * 2, 0.06, o), 0.24]]); }
    case 10: return mix([[T("pulse", f, 0.05, { attack: 0.004, decay: 0.15, sustain: 0.6, duty: 0.25 }), 0.6]]);
    default: return mix([[T("pulse", f, 0.08, { attack: 0.005, decay: 0.2, sustain: 0.5, duty: 0.5 }), 0.5]]);
  }
}
