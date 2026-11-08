// 간단한 소리 합성 도구. 기본 곡과 MIDI 곡이 함께 쓴다.

export const SR = 44100;

export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

/** 시드가 같으면 항상 같은 수열을 내는 난수 (mulberry32) */
export class Rng {
  constructor(seed) {
    this.s = seed >>> 0;
  }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  uniform(a, b) {
    return a + (b - a) * this.next();
  }
  choice(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

/** 파형 × 엔벨로프. type: pulse, triangle, saw, sine */
export function tone(type, freq, dur, opt = {}) {
  const { attack = 0.005, decay = 0.15, sustain = 0.5, release = 0.03, duty = 0.25 } = opt;
  const n = Math.max(1, Math.floor(dur * SR));
  const out = new Float32Array(n);
  const total = n / SR;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const ph = (t * freq) % 1;
    let w;
    if (type === "pulse") w = ph < duty ? 1 : -1;
    else if (type === "triangle") w = 4 * Math.abs(ph - 0.5) - 1;
    else if (type === "saw") w = 2 * ph - 1;
    else w = Math.sin(2 * Math.PI * ph);
    const e = t < attack ? t / attack : sustain + (1 - sustain) * Math.exp(-(t - attack) / decay);
    const r = Math.min(1, Math.max(0, (total - t) / release));
    out[i] = w * e * r;
  }
  return out;
}

/** 여러 신호를 더한다: mix([[sig, gain], ...]) */
export function mix(parts) {
  const n = Math.max(...parts.map(([s]) => s.length));
  const out = new Float32Array(n);
  for (const [s, g] of parts) for (let i = 0; i < s.length; i++) out[i] += s[i] * g;
  return out;
}

function noise(rng, n) {
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const v = rng.uniform(-1, 1);
    out[i] = v - prev; // 고음 위주의 잡음
    prev = v;
  }
  return out;
}

export function makeDrums(rng) {
  const len = (s) => Math.floor(s * SR);

  const kick = new Float32Array(len(0.35));
  let ph = 0;
  for (let i = 0; i < kick.length; i++) {
    const t = i / SR;
    ph += (50 + 110 * Math.exp(-t * 25)) / SR;
    kick[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 9);
  }

  const snare = new Float32Array(len(0.2));
  for (let i = 0; i < snare.length; i++) {
    const t = i / SR;
    snare[i] = (rng.uniform(-1, 1) * 0.7 + Math.sin(2 * Math.PI * 190 * t) * 0.4) * Math.exp(-t * 22);
  }

  const shaped = (dur, decay, gain) => {
    const s = noise(rng, len(dur));
    for (let i = 0; i < s.length; i++) s[i] *= Math.exp((-i / SR) * decay) * gain;
    return s;
  };

  return {
    kick,
    snare,
    hat: shaped(0.05, 70, 0.5),
    crash: shaped(1.6, 2.5, 0.4),
    openHat: shaped(0.4, 9, 0.4),
    ride: shaped(0.4, 12, 0.3),
  };
}

export function tom(freq) {
  const s = new Float32Array(Math.floor(0.4 * SR));
  let ph = 0;
  for (let i = 0; i < s.length; i++) {
    const t = i / SR;
    ph += (freq * (1 + Math.exp(-t * 20))) / SR;
    s[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 8);
  }
  return s;
}

export function addInto(buf, sig, t, gain) {
  const i0 = Math.floor(t * SR);
  const end = Math.min(buf.length, i0 + sig.length);
  for (let i = Math.max(0, i0); i < end; i++) buf[i] += sig[i - i0] * gain;
}

/** 큰 소리를 부드럽게 눌러서 -1~1 범위로 맞춘다. */
export function finalize(buf) {
  const sample = [];
  for (let i = 0; i < buf.length; i += 37) sample.push(Math.abs(buf[i]));
  sample.sort((a, b) => a - b);
  const level = sample[Math.floor(sample.length * 0.997)] || 1;
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] / (level * 1.4)) * 0.9;
  return buf;
}
