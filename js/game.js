// BEAT PAD 웹 버전 게임 본체
import { BuiltinSong, BEAT } from "./builtin.js";
import { MidiSong } from "./midi.js";
import { buildChart, DIFFS, CHART_VERSION } from "./chart.js";
import { Input, BTN } from "./input.js";
import { SR } from "./synth.js";
import { rankingEnabled, fetchTop, submitScore } from "./ranking.js";

export const W = 960, H = 720;
const LANE_W = 100, LANES_X = (W - LANE_W * 4) / 2, JUDGE_Y = 600, NOTE_H = 22;

const BG = "#121318", PANEL = "#20222a", TEXT = "#f0f0f0", MUTED = "#9698a5";
const ACCENT = "#78dcff", GOLD = "#f0c85a", GREEN = "#82e682", MISS_COLOR = "#e65a5a";
const LANE_COLORS = [[30, 136, 229], [67, 160, 71], [253, 216, 53], [229, 57, 53]];
const LANE_BTN = ["X", "A", "Y", "B"], LANE_ARROW = ["←", "↓", "↑", "→"];
const rgb = (c, k = 1, a = 1) => `rgba(${c.map((v) => Math.round(v * k)).join(",")},${a})`;
const FONT = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';

// 이름, 허용 오차(초), 점수 비율, 색
const JUDGES = [["PERFECT", 0.045, 1.0, ACCENT], ["GREAT", 0.09, 0.7, GREEN], ["GOOD", 0.135, 0.4, GOLD]];
const MISS_WINDOW = JUDGES[2][1];
const SPEEDS = [400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400];
const MENU_ITEMS = ["곡", "트랙", "난이도", "롱노트", "노트 속도", "싱크 보정", "진동", "랭킹 보기", "시작"];
const MENU_Y0 = 200, MENU_DY = 41;

const SAVE_KEY = "beatpad_save", SONGS_KEY = "beatpad_songs";

function rankFor(acc) {
  for (const [r, cut] of [["S", 95], ["A", 90], ["B", 80], ["C", 70]]) if (acc >= cut) return r;
  return "D";
}

function loadSave() {
  const def = { offset: 0, speed: 700, diff: 1, vibration: true, long: true, song: "builtin", parts: {}, best: {}, name: "" };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SAVE_KEY) || "{}") }; } catch { return def; }
}

const toB64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); };
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export class Game {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext("2d");
    this.input = new Input();
    this.save = loadSave();
    if (!this.save.name) this.save.name = "PLAYER" + String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    this.songs = [new BuiltinSong()];
    try {
      for (const { name, data } of JSON.parse(localStorage.getItem(SONGS_KEY) || "[]")) this.songs.push(new MidiSong(name, fromB64(data)));
    } catch { /* 저장된 곡이 없거나 깨짐 */ }
    const idx = this.songs.findIndex((s) => s.key === this.save.song);
    this.songIdx = idx >= 0 ? idx : 0;

    this.state = "intro";
    this.menuIdx = MENU_ITEMS.length - 1;
    this.menuMsg = null;
    this.toast = null; // [메시지, 사라지는 시각]
    this.laneDown = [false, false, false, false];
    this.holding = new Map();
    this.actx = null;
    this.onChange = () => {}; // 곡 목록/이름이 바뀌면 HTML 쪽에 알림
    this.onSaveChange = () => {}; // 설정/기록이 바뀌면 계정에 저장하도록 알림
    this.user = null; // 로그인하면 { uid }

    this._setupCanvas();
    canvas.addEventListener("pointerdown", (e) => this._pointer(e, true));
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) canvas.addEventListener(type, (e) => this._pointer(e, false));
    addEventListener("keydown", (e) => { if (this.state === "intro" && e.target.tagName !== "INPUT") this.unlock(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden && this.state === "play") this.pause(performance.now() / 1000); });
    requestAnimationFrame(() => this.loop());
  }

  // ----- 화면 크기 -------------------------------------------------------

  _setupCanvas() {
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.cv.width = W * dpr;
      this.cv.height = H * dpr;
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    addEventListener("resize", fit);
  }

  _pointer(e, down) {
    const r = this.cv.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
    const t = e.timeStamp / 1000;
    if (!down) { this.input.pointerUp(e.pointerId, t); return; }
    e.preventDefault();
    if (this.state === "intro") { this.unlock(); return; }
    if (this.state === "play") {
      if (x > W - 90 && y < 120) { this.pause(t); return; }
      if (x >= LANES_X && x < LANES_X + LANE_W * 4 && y > 150) {
        this.cv.setPointerCapture?.(e.pointerId);
        this.input.pointerDown(e.pointerId, Math.floor((x - LANES_X) / LANE_W), t);
      }
      return;
    }
    // 메뉴 등에서는 버튼 이벤트로 바꿔서 같은 처리 경로를 탄다
    const btn = (val) => this.input.events.push({ t, kind: "btn", val });
    if (this.state === "menu") {
      const i = Math.round((y - MENU_Y0) / MENU_DY);
      if (i < 0 || i >= MENU_ITEMS.length || Math.abs(x - W / 2) > 330) return;
      this.menuIdx = i;
      const item = MENU_ITEMS[i];
      if (item === "시작" || item === "랭킹 보기") btn(BTN.A);
      else if (x < W / 2 - 60) btn(BTN.LEFT);
      else if (x > W / 2 + 60) btn(BTN.RIGHT);
      else btn(BTN.RIGHT);
    } else if (this.state === "pause") {
      btn(y < H / 2 + 60 ? BTN.A : BTN.B);
    } else if (this.state === "result") {
      if (this.submitState === "ready" && y > 560 && y < 640 && Math.abs(x - W / 2) < 200) btn(BTN.Y);
      else btn(BTN.A);
    } else if (this.state === "ranking") {
      if (x < W / 3) btn(BTN.LEFT);
      else if (x > (W * 2) / 3) btn(BTN.RIGHT);
      else if (y < 130) btn(BTN.Y);
      else btn(BTN.B);
    }
  }

  // ----- 오디오 ----------------------------------------------------------

  /** 브라우저는 클릭/키 입력이 있어야 소리를 켤 수 있다. */
  unlock() {
    if (this.actx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.actx = new AC({ latencyHint: "interactive" });
    this.state = "menu";
  }

  /** performance.now() 기준 시각 → 오디오 시계 기준 시각 (실제로 소리가 나는 시점에 맞춤) */
  ctxTimeAt(perfSec) {
    const a = this.actx;
    const ts = a.getOutputTimestamp ? a.getOutputTimestamp() : null;
    if (ts && ts.performanceTime > 0 && ts.contextTime > 0) return ts.contextTime + (perfSec * 1000 - ts.performanceTime) / 1000;
    return a.currentTime - (a.outputLatency || a.baseLatency || 0) - (performance.now() / 1000 - perfSec);
  }

  songTime(perfSec) {
    return this.ctxTimeAt(perfSec) - this.startAt - this.save.offset / 1000;
  }

  // ----- 유틸 ------------------------------------------------------------

  get song() { return this.songs[this.songIdx]; }

  partIdx(song = this.song) {
    const i = this.save.parts[song.key];
    return Number.isInteger(i) && i >= 0 && i < Math.max(1, song.parts.length) ? i : song.defaultPart;
  }

  boardId(diff = this.save.diff, long = this.save.long) {
    return `${this.song.boardId}_p${this.partIdx()}_${DIFFS[diff]}_${long ? "L" : "N"}_v${CHART_VERSION}`;
  }

  writeSave() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch { /* 저장 불가 */ }
    this.onSaveChange();
  }

  /** 계정에서 불러온 설정의 곡을 고른다. 이 기기에 없는 MIDI 곡이면 지금 곡을 그대로 둔다. */
  applySongFromSave() {
    const i = this.songs.findIndex((s) => s.key === this.save.song);
    if (i >= 0) this.songIdx = i;
    else this.save.song = this.song.key;
    this.onChange();
  }

  /** 로그인/로그아웃 됐을 때 main.js가 부른다. */
  setUser(user) {
    this.user = user;
    if (this.state === "result" && rankingEnabled) {
      if (user && this.submitState === "login") this.submitState = "ready";
      if (!user && this.submitState === "ready") this.submitState = "login";
    }
  }

  storeSongs() {
    const list = this.songs.filter((s) => s instanceof MidiSong).map((s) => ({ name: s.name, data: toB64(s.bytes) }));
    try { localStorage.setItem(SONGS_KEY, JSON.stringify(list)); return true; } catch { return false; }
  }

  showToast(msg, sec = 3) {
    this.toast = [msg, performance.now() / 1000 + sec];
  }

  setName(name) {
    this.save.name = name.trim().slice(0, 12) || this.save.name;
    this.writeSave();
  }

  async addMidiFiles(files) {
    let added = 0, lastIdx = null;
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const song = new MidiSong(f.name, bytes);
      const dup = this.songs.findIndex((s) => s.key === song.key);
      if (dup >= 0) { lastIdx = dup; continue; }
      this.songs.push(song);
      lastIdx = this.songs.length - 1;
      added++;
    }
    if (lastIdx !== null) { this.songIdx = lastIdx; this.save.song = this.song.key; this.writeSave(); }
    if (added && !this.storeSongs()) this.showToast("저장 공간이 부족해서 이 곡은 새로고침하면 사라져요", 5);
    else if (added) this.showToast(`곡 ${added}개를 추가했어요`);
    else if (lastIdx !== null) this.showToast("이미 있는 곡이에요");
    if (this.state === "intro") this.unlock();
    this.menuIdx = 0;
    this.onChange();
  }

  deleteCurrentSong() {
    if (!(this.song instanceof MidiSong)) { this.showToast("기본 곡은 지울 수 없어요"); return; }
    if (this.state !== "menu" && this.state !== "intro") return;
    this.songs.splice(this.songIdx, 1);
    this.songIdx = Math.max(0, this.songIdx - 1);
    this.save.song = this.song.key;
    this.storeSongs();
    this.writeSave();
    this.onChange();
  }

  // ----- 메인 루프 -------------------------------------------------------

  loop() {
    const now = performance.now() / 1000;
    const events = this.input.drain();
    for (const ev of events) {
      if (ev.kind === "lane") this.laneDown[ev.val] = true;
      else if (ev.kind === "lane_up") this.laneDown[ev.val] = false;
    }
    const upd = this["update_" + this.state];
    if (upd) upd.call(this, events, now);

    const g = this.g;
    g.fillStyle = BG;
    g.fillRect(0, 0, W, H);
    this["draw_" + this.state](now);
    if (this.toast && now < this.toast[1]) {
      g.fillStyle = "rgba(0,0,0,0.75)";
      g.fillRect(W / 2 - 300, 14, 600, 40);
      this.text(this.toast[0], 17, TEXT, W / 2, 34);
    }
    requestAnimationFrame(() => this.loop());
  }

  text(s, size, color, x, y, opt = {}) {
    const { align = "center", base = "middle", bold = false, alpha = 1, maxW = 0 } = opt;
    const g = this.g;
    g.font = `${bold ? "700 " : ""}${size}px ${FONT}`;
    s = String(s);
    if (maxW) while (s.length > 4 && g.measureText(s).width > maxW) s = s.slice(0, -2) + "…";
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = base;
    g.fillText(s, x, y);
    g.globalAlpha = 1;
  }

  roundRect(x, y, w, h, r, color) {
    const g = this.g;
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  }

  // ----- 첫 화면 ---------------------------------------------------------

  draw_intro(now) {
    this.text("BEAT PAD", 72, ACCENT, W / 2, H / 2 - 80, { bold: true });
    const blink = 0.55 + 0.45 * Math.sin(now * 4);
    this.text("화면을 클릭하거나 아무 키나 누르세요", 26, TEXT, W / 2, H / 2 + 20, { alpha: blink });
    this.text("브라우저 정책 때문에 첫 소리는 클릭이나 키보드로만 켤 수 있어요 (게임패드 버튼은 안 됨)", 15, MUTED, W / 2, H / 2 + 64);
    this.drawPadStatus();
  }

  // ----- 메뉴 ------------------------------------------------------------

  update_menu(events) {
    for (const { kind, val } of events) {
      if (kind !== "btn") continue;
      if (val & BTN.UP) this.menuIdx = (this.menuIdx + MENU_ITEMS.length - 1) % MENU_ITEMS.length;
      if (val & BTN.DOWN) this.menuIdx = (this.menuIdx + 1) % MENU_ITEMS.length;
      let d = (val & BTN.RIGHT ? 1 : 0) - (val & BTN.LEFT ? 1 : 0);
      d += (val & BTN.RB ? 5 : 0) - (val & BTN.LB ? 5 : 0);
      const item = MENU_ITEMS[this.menuIdx];
      if (d && item !== "시작" && item !== "랭킹 보기") this.changeSetting(item, d);
      if (val & (BTN.A | BTN.START)) {
        if (item === "랭킹 보기") this.openRanking();
        else this.startGame();
        return;
      }
    }
  }

  changeSetting(item, d) {
    const s = this.save, step = d > 0 ? 1 : -1;
    this.menuMsg = null;
    if (item === "곡") { this.songIdx = (this.songIdx + step + this.songs.length) % this.songs.length; s.song = this.song.key; this.onChange(); }
    else if (item === "트랙") { if (this.song.parts.length) s.parts[this.song.key] = (this.partIdx() + step + this.song.parts.length) % this.song.parts.length; }
    else if (item === "난이도") s.diff = (s.diff + step + DIFFS.length) % DIFFS.length;
    else if (item === "롱노트") s.long = !s.long;
    else if (item === "노트 속도") { const i = Math.max(0, SPEEDS.indexOf(s.speed)); s.speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + step))]; }
    else if (item === "싱크 보정") s.offset = Math.max(-300, Math.min(300, s.offset + d));
    else if (item === "진동") { s.vibration = !s.vibration; if (s.vibration) this.input.rumble(0.5, 0.5, 150); }
    this.writeSave();
  }

  bestKey() { return this.boardId(); }

  draw_menu(now) {
    const g = this.g, s = this.save, song = this.song;
    const beat = (now % BEAT) / BEAT, pulse = 30 * (1 - beat);
    this.text("BEAT PAD", 60, `rgb(${Math.min(255, 120 + pulse * 4)},200,255)`, W / 2, 80, { bold: true });
    LANE_COLORS.forEach((c, i) => {
      g.fillStyle = rgb(c);
      g.beginPath();
      g.arc(W / 2 - 105 + i * 70, 140, 11 + (i === Math.floor(now / BEAT) % 4 ? pulse / 6 : 0), 0, Math.PI * 2);
      g.fill();
    });

    let trackVal = "-";
    if (song.parts.length) trackVal = song.parts[this.partIdx()].label() + (this.partIdx() === song.defaultPart ? " · 자동" : "");
    const values = [`${this.songIdx + 1}/${this.songs.length}  ${song.name}`, trackVal, DIFFS[s.diff], s.long ? "켜짐" : "꺼짐",
      `${s.speed} px/s`, `${s.offset > 0 ? "+" : ""}${s.offset} ms`, s.vibration ? "켜짐" : "꺼짐",
      rankingEnabled ? "" : "Firebase 설정 필요", ""];
    MENU_ITEMS.forEach((name, i) => {
      const y = MENU_Y0 + i * MENU_DY, sel = i === this.menuIdx;
      if (sel) this.roundRect(W / 2 - 330, y - 19, 660, 38, 10, PANEL);
      if (name === "시작") this.text("▶ 시작", 24, sel ? ACCENT : TEXT, W / 2, y, { bold: true });
      else if (name === "랭킹 보기") {
        this.text("🏆 랭킹 보기", 19, sel ? ACCENT : TEXT, W / 2, y, { bold: sel });
        if (values[i]) this.text(values[i], 14, MUTED, W / 2 + 305, y, { align: "right" });
      } else {
        this.text(name, 19, sel ? TEXT : MUTED, W / 2 - 305, y, { align: "left" });
        this.text(sel ? `◀ ${values[i]} ▶` : values[i], 19, TEXT, W / 2 + 305, y, { align: "right", bold: sel, maxW: 500 });
      }
    });

    const msgY = MENU_Y0 + MENU_ITEMS.length * MENU_DY + 12;
    if (song.error) this.text(song.error, 16, MISS_COLOR, W / 2, msgY);
    else if (this.menuMsg) this.text(this.menuMsg, 16, MISS_COLOR, W / 2, msgY);
    else {
      const best = s.best[this.bestKey()];
      if (best) this.text(`내 최고 기록: ${best.score.toLocaleString()}점  ${best.acc.toFixed(1)}%  ${best.rank}${best.fc ? "  FULL COMBO" : ""}`, 17, GOLD, W / 2, msgY);
    }
    this.text("십자키 ↑↓ 항목 선택   ←→ 값 변경 (LB/RB: 싱크 ±5ms)   A 시작", 15, MUTED, W / 2, 634);
    this.text("레인: X(←) A(↓) Y(↑) B(→)   키보드: D F J K / 방향키, Enter 시작   화면 터치도 가능", 15, MUTED, W / 2, 658);
    if (!rankingEnabled) this.text("온라인 랭킹 꺼짐 (firebase-config.js 설정 필요)", 14, MUTED, W / 2, 682);
    else if (this.user) this.text(`로그인됨 · 닉네임 ${s.name} · 설정과 기록이 계정에 저장돼요`, 14, GREEN, W / 2, 682);
    else this.text("로그인하지 않음 · 랭킹 등록과 기기 간 동기화는 아래 'Google로 로그인' 후 가능해요", 14, MUTED, W / 2, 682);
    this.drawPadStatus();
  }

  drawPadStatus() {
    const ok = this.input.connected;
    this.text(ok ? "게임패드 연결됨" : "게임패드 없음 - 버튼을 한 번 누르면 인식돼요", 14, ok ? GREEN : MISS_COLOR, 12, H - 12, { align: "left" });
  }

  // ----- 랭킹 화면 -------------------------------------------------------

  /** 랭킹 화면은 메뉴 설정과 따로 난이도/롱노트 조합을 바꿔 가며 볼 수 있다. */
  openRanking() {
    this.state = "ranking";
    this.rankView = { diff: this.save.diff, long: this.save.long };
    this.loadRankView();
  }

  loadRankView() {
    const v = this.rankView;
    v.board = this.boardId(v.diff, v.long);
    v.rows = null;
    v.error = null;
    if (!rankingEnabled) { v.error = "firebase-config.js에 Firebase 설정을 넣으면 온라인 랭킹을 쓸 수 있어요."; return; }
    const board = v.board;
    fetchTop(board, 15)
      .then((rows) => { if (v.board === board) v.rows = rows; })
      .catch((e) => { if (v.board === board) v.error = "랭킹을 불러오지 못했어요: " + e.message; });
  }

  update_ranking(events) {
    const v = this.rankView;
    for (const { kind, val } of events) {
      if (kind !== "btn") continue;
      if (val & (BTN.LEFT | BTN.RIGHT)) {
        v.diff = (v.diff + (val & BTN.RIGHT ? 1 : DIFFS.length - 1)) % DIFFS.length;
        this.loadRankView();
      } else if (val & (BTN.Y | BTN.UP | BTN.DOWN)) {
        v.long = !v.long;
        this.loadRankView();
      } else if (val & (BTN.A | BTN.B | BTN.BACK | BTN.START)) {
        this.state = "menu";
        return;
      }
    }
  }

  draw_ranking() {
    const v = this.rankView;
    this.text("🏆 온라인 랭킹", 34, TEXT, W / 2, 46, { bold: true });
    this.text(this.song.name, 16, MUTED, W / 2, 82, { maxW: W - 80 });
    this.text(`◀  ${DIFFS[v.diff]}  ▶`, 22, ACCENT, W / 2 - 110, 116, { bold: true });
    this.text(`롱노트 ${v.long ? "켜짐" : "꺼짐"}`, 18, v.long ? TEXT : MUTED, W / 2 + 120, 116);
    this.drawBoard(v.rows, v.error, W / 2 - 300, 160, 600, 14);
    this.text("←→ 난이도   ↑↓ / Y 롱노트 켜짐·꺼짐   A / B 메뉴로   (터치: 왼쪽·오른쪽 끝 = 난이도, 위 = 롱노트)", 14, MUTED, W / 2, H - 30);
  }

  drawBoard(rows, error, x, y, w, maxRows) {
    if (error) { this.text(error, 16, MISS_COLOR, x + w / 2, y + 40, { maxW: w }); return; }
    if (!rows) { this.text("불러오는 중...", 18, MUTED, x + w / 2, y + 40); return; }
    if (!rows.length) { this.text("아직 기록이 없어요. 첫 기록을 남겨 보세요!", 17, MUTED, x + w / 2, y + 40); return; }
    const narrow = w < 400;
    rows.slice(0, maxRows).forEach((r, i) => {
      const yy = y + i * (narrow ? 30 : 34);
      if (this.user && r.id === this.user.uid) this.roundRect(x, yy - 14, w, 28, 6, "#2a3a48"); // 내 기록
      const color = i === 0 ? GOLD : i < 3 ? TEXT : MUTED;
      this.text(`${i + 1}`, narrow ? 15 : 18, color, x + 24, yy, { bold: i < 3 });
      this.text(r.name, narrow ? 15 : 18, color, x + 50, yy, { align: "left", maxW: narrow ? 110 : 220 });
      this.text(Number(r.score).toLocaleString(), narrow ? 15 : 18, color, x + w - (narrow ? 50 : 150), yy, { align: "right", bold: true });
      this.text(`${r.rank}${r.fc ? " FC" : ""}`, narrow ? 13 : 16, color, x + w - 8, yy, { align: "right" });
      if (!narrow) this.text(`${Number(r.acc).toFixed(1)}%`, 15, MUTED, x + w - 60, yy, { align: "right" });
    });
  }

  // ----- 플레이 ----------------------------------------------------------

  startGame() {
    const song = this.song;
    if (song.error) return;
    if (this.actx.state === "suspended") this.actx.resume();
    if (!song.buffer) {
      this.state = "loading";
      setTimeout(() => {
        const data = song.render();
        const ab = this.actx.createBuffer(1, data.length, SR);
        ab.copyToChannel(data, 0);
        song.buffer = ab;
        this.beginPlay();
      }, 60); // 로딩 화면이 먼저 그려지도록
      return;
    }
    this.beginPlay();
  }

  draw_loading() {
    this.text("소리 만드는 중...", 26, TEXT, W / 2, H / 2 - 10);
    this.text(this.song.name, 17, MUTED, W / 2, H / 2 + 30);
  }

  beginPlay() {
    const song = this.song;
    this.diff = DIFFS[this.save.diff];
    this.notes = buildChart(song.chartSource(this.partIdx()), this.diff, this.save.long);
    if (!this.notes.length) {
      this.menuMsg = "이 트랙으로는 노트를 만들 수 없어요. 다른 트랙을 골라 보세요.";
      this.state = "menu";
      return;
    }
    this.ptr = 0; // 머리 판정이 아직 안 끝난 첫 노트
    this.drawPtr = 0; // 화면에 그릴 수도 있는 첫 노트
    this.holding = new Map(); // 레인 → 누르고 있는 롱노트
    this.totalJudges = this.notes.length + this.notes.filter((n) => n.end !== null).length;
    this.counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
    this.combo = this.maxCombo = 0;
    this.scoreF = 0;
    this.errors = [];
    this.judge = null;
    this.particles = [];
    this.laneFlash = [-9, -9, -9, -9];
    this.nextHoldRumble = 0;
    const last = Math.max(...this.notes.map((n) => n.end ?? n.t));
    this.endTime = Math.max(last + 2, Math.min(song.length - 0.5, last + 6));

    const src = this.actx.createBufferSource();
    src.buffer = song.buffer;
    src.connect(this.actx.destination);
    this.startAt = this.actx.currentTime + 0.3;
    src.start(this.startAt);
    this.src = src;
    this.lastFrame = performance.now() / 1000;
    this.input.clear();
    this.state = "play";
  }

  pause(now) {
    if (this.state !== "play") return;
    this.pausedSongT = this.songTime(now);
    this.state = "pause";
    this.actx.suspend();
  }

  update_play(events, now) {
    for (const { t, kind, val } of events) {
      if (kind === "btn" && val & BTN.START) { this.pause(now); return; }
      if (kind === "lane") { this.laneFlash[val] = now; this.hit(val, this.songTime(t), now); }
      else if (kind === "lane_up" && this.holding.has(val)) this.release(val, this.songTime(t), now);
    }
    const st = this.songTime(now);
    const notes = this.notes;
    while (this.ptr < notes.length) {
      const n = notes[this.ptr];
      if (n.done) this.ptr++;
      else if (st - n.t > MISS_WINDOW) {
        n.done = true;
        this.register("MISS", now, null);
        if (n.end !== null) { n.hold = "missed"; this.register("MISS", now, null, true); } // 머리를 놓치면 끝도 MISS
        this.ptr++;
      } else break;
    }

    // 롱노트를 끝까지 누르고 있으면 성공
    for (const [lane, n] of [...this.holding]) {
      this.laneFlash[lane] = now;
      if (st >= n.end) this.release(lane, st, now);
      else if (Math.random() < 0.3)
        this.particles.push([LANES_X + lane * LANE_W + LANE_W / 2 + (Math.random() - 0.5) * 60, JUDGE_Y,
          (Math.random() - 0.5) * 120, -200 - Math.random() * 200, 0.6, LANE_COLORS[lane]]);
    }
    if (this.holding.size && this.save.vibration && now >= this.nextHoldRumble) {
      this.input.rumble(0.12, 0.12, 120);
      this.nextHoldRumble = now + 0.1;
    }

    while (this.drawPtr < this.ptr && (notes[this.drawPtr].end ?? notes[this.drawPtr].t) < st - 1) this.drawPtr++;

    const dt = Math.min(0.05, now - this.lastFrame);
    this.lastFrame = now;
    for (const p of this.particles) { p[0] += p[2] * dt; p[1] += p[3] * dt; p[3] += 900 * dt; p[4] -= dt * 2.2; }
    this.particles = this.particles.filter((p) => p[4] > 0);

    if (st > this.endTime) this.finish();
  }

  hit(lane, st, now) {
    for (let i = this.ptr; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t - st > MISS_WINDOW) break;
      if (n.done || n.lane !== lane) continue;
      const err = st - n.t;
      if (Math.abs(err) > MISS_WINDOW) continue;
      n.done = true;
      const j = JUDGES.find(([, win]) => Math.abs(err) <= win);
      this.register(j[0], now, err);
      this.burst(lane, j[0] === "PERFECT" ? 14 : 8);
      if (n.end !== null) { n.hold = "holding"; this.holding.set(lane, n); }
      return;
    }
  }

  /** 롱노트를 뗐을 때. 끝나기 직전(GOOD 범위)까지 버텼으면 성공. */
  release(lane, st, now) {
    const n = this.holding.get(lane);
    this.holding.delete(lane);
    if (st >= n.end - MISS_WINDOW) { n.hold = "ok"; this.register("PERFECT", now, null); this.burst(lane, 10); }
    else { n.hold = "broken"; this.register("MISS", now, null); }
  }

  burst(lane, count) {
    const x = LANES_X + lane * LANE_W + LANE_W / 2;
    for (let i = 0; i < count; i++)
      this.particles.push([x, JUDGE_Y, (Math.random() - 0.5) * 520, -150 - Math.random() * 370, 1, LANE_COLORS[lane]]);
  }

  register(name, now, err, quiet = false) {
    this.counts[name]++;
    let color = MISS_COLOR;
    if (name === "MISS") {
      this.combo = 0;
      if (!quiet && this.save.vibration) this.input.rumble(0.35, 0.35, 120);
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      const j = JUDGES.find(([n]) => n === name);
      this.scoreF += (1e6 / this.totalJudges) * j[2];
      if (err !== null) this.errors.push(err);
      color = j[3];
    }
    if (!quiet) this.judge = [name, color, now, err];
  }

  accuracy() {
    const judged = Object.values(this.counts).reduce((a, b) => a + b, 0);
    if (!judged) return 100;
    return (JUDGES.reduce((a, [n, , w]) => a + this.counts[n] * w, 0) / judged) * 100;
  }

  finish() {
    try { this.src.stop(); } catch { /* 이미 끝남 */ }
    const acc = this.accuracy(), score = Math.round(this.scoreF), fc = this.counts.MISS === 0;
    const avgErr = this.errors.length ? (this.errors.reduce((a, b) => a + b, 0) / this.errors.length) * 1000 : 0;
    const key = this.bestKey();
    const best = this.save.best[key];
    const newBest = !best || score > best.score;
    if (newBest) { this.save.best[key] = { score, acc: Math.round(acc * 100) / 100, rank: rankFor(acc), fc }; this.writeSave(); }
    this.result = { score, acc, rank: rankFor(acc), fc, avgErr, newBest, notes: this.totalJudges, counts: { ...this.counts }, maxCombo: this.maxCombo };
    // off: 랭킹 없음, login: 로그인 필요, ready: 등록 가능, sending, done, error
    this.submitState = !rankingEnabled ? "off" : this.user ? "ready" : "login";
    this.submitRes = null;
    this.resultBoard = { board: this.boardId(), rows: null, error: null };
    if (rankingEnabled) this.loadResultBoard();
    this.state = "result";
  }

  loadResultBoard() {
    const v = this.resultBoard;
    fetchTop(v.board, 10).then((rows) => { v.rows = rows; }).catch((e) => { v.error = "랭킹 오류: " + e.message; });
  }

  draw_play(now, stOverride = null) {
    const g = this.g, st = stOverride ?? this.songTime(now), speed = this.save.speed;

    g.fillStyle = "#181a21";
    g.fillRect(LANES_X, 0, LANE_W * 4, H);
    g.strokeStyle = "#2d303a";
    g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(LANES_X + i * LANE_W + 0.5, 0); g.lineTo(LANES_X + i * LANE_W + 0.5, H); g.stroke(); }

    // 마디선
    g.strokeStyle = "#323642";
    for (const bt of this.song.barTimes) {
      const y = JUDGE_Y - (bt - st) * speed;
      if (y < 0) break;
      if (y > JUDGE_Y) continue;
      g.beginPath(); g.moveTo(LANES_X, y); g.lineTo(LANES_X + LANE_W * 4, y); g.stroke();
    }

    // 누를 때 레인 빛
    for (let i = 0; i < 4; i++) {
      const age = now - this.laneFlash[i];
      if (age < 0.18) {
        const grad = g.createLinearGradient(0, JUDGE_Y - 260, 0, JUDGE_Y);
        grad.addColorStop(0, rgb(LANE_COLORS[i], 1, 0));
        grad.addColorStop(1, rgb(LANE_COLORS[i], 1, 0.45 * (1 - age / 0.18)));
        g.fillStyle = grad;
        g.fillRect(LANES_X + i * LANE_W, JUDGE_Y - 260, LANE_W, 260);
      }
    }

    // 판정선과 버튼
    g.fillStyle = "#c8c8d2";
    g.fillRect(LANES_X, JUDGE_Y - 1.5, LANE_W * 4, 3);
    for (let i = 0; i < 4; i++) {
      const cx = LANES_X + i * LANE_W + LANE_W / 2, cy = JUDGE_Y + 50;
      const pressed = now - this.laneFlash[i] < 0.08;
      g.beginPath(); g.arc(cx, cy, 24, 0, Math.PI * 2);
      g.fillStyle = pressed ? rgb(LANE_COLORS[i]) : PANEL; g.fill();
      g.lineWidth = 3; g.strokeStyle = rgb(LANE_COLORS[i]); g.stroke();
      this.text(LANE_BTN[i], 20, TEXT, cx, cy + 1, { bold: true });
      this.text(LANE_ARROW[i], 14, MUTED, cx, JUDGE_Y + 92);
    }

    // 노트
    for (let i = this.drawPtr; i < this.notes.length; i++) {
      const n = this.notes[i];
      let y = JUDGE_Y - (n.t - st) * speed;
      if (y < -NOTE_H) break;
      if (n.done && !["holding", "broken", "missed"].includes(n.hold)) continue;
      let color = rgb(LANE_COLORS[n.lane]);
      const x = LANES_X + n.lane * LANE_W + 6;
      if (n.end !== null) {
        let body;
        if (n.hold === "holding") { y = JUDGE_Y; body = rgb(LANE_COLORS[n.lane], 0.8); }
        else if (n.hold === "broken" || n.hold === "missed") color = body = "#464852";
        else body = rgb(LANE_COLORS[n.lane], 0.5);
        const tailY = JUDGE_Y - (n.end - st) * speed;
        if (tailY < y) {
          g.fillStyle = body;
          g.fillRect(x + 14, tailY, LANE_W - 40, y - tailY);
          this.roundRect(x + 6, tailY - 5, LANE_W - 24, 10, 5, color);
        }
      }
      this.roundRect(x, y - NOTE_H / 2, LANE_W - 12, NOTE_H, 7, color);
      this.roundRect(x + 7, y - NOTE_H / 2 + 7, LANE_W - 26, NOTE_H - 14, 3, "#fff");
    }

    // 파티클
    for (const [x, y, , , life, c] of this.particles) {
      g.fillStyle = rgb(c);
      g.beginPath(); g.arc(x, y, Math.max(1, 5 * life), 0, Math.PI * 2); g.fill();
    }

    // 콤보와 판정
    if (this.combo >= 3) {
      this.text(this.combo, 64, TEXT, W / 2, 260, { bold: true, alpha: 0.67 });
      this.text("COMBO", 18, MUTED, W / 2, 305);
    }
    if (this.judge) {
      const [name, color, t, err] = this.judge, age = now - t;
      if (age < 0.5) {
        this.text(name, 40 - Math.min(age, 0.08) * 100, color, W / 2, 400, { bold: true, alpha: 1 - age / 0.5 });
        if (err !== null && name !== "PERFECT") this.text(`${Math.round(Math.abs(err) * 1000)}ms ${err > 0 ? "늦음" : "빠름"}`, 16, MUTED, W / 2, 432);
      }
    }

    // HUD
    this.text(Math.round(this.scoreF).toLocaleString(), 30, TEXT, W - 20, 30, { align: "right", bold: true });
    this.text(`${this.accuracy().toFixed(2)}%`, 18, MUTED, W - 20, 64, { align: "right" });
    this.text("Ⅱ", 26, MUTED, W - 40, 100);
    this.text(this.diff, 20, ACCENT, 20, 28, { align: "left", bold: true });
    this.text(this.song.name, 15, MUTED, 20, 56, { align: "left", maxW: LANES_X - 40 });
    this.text(`최대 콤보 ${this.maxCombo}`, 15, MUTED, 20, 80, { align: "left" });
    const prog = Math.max(0, Math.min(1, st / this.endTime));
    g.fillStyle = PANEL; g.fillRect(0, 0, W, 5);
    g.fillStyle = ACCENT; g.fillRect(0, 0, W * prog, 5);
    this.text("Start / Esc: 일시정지", 14, MUTED, W - 12, H - 12, { align: "right" });
    this.drawPadStatus();
  }

  // ----- 일시정지 --------------------------------------------------------

  update_pause(events, now) {
    for (const { kind, val } of events) {
      if (kind !== "btn") continue;
      if (val & (BTN.START | BTN.A)) {
        this.actx.resume();
        this.state = "play";
        this.lastFrame = now;
        for (const lane of [...this.holding.keys()]) // 일시정지 중에 손을 뗀 롱노트
          if (!this.laneDown[lane]) this.release(lane, this.pausedSongT, now);
        return;
      }
      if (val & (BTN.B | BTN.BACK)) {
        try { this.src.stop(); } catch { /* 이미 끝남 */ }
        this.actx.resume();
        this.holding.clear();
        this.state = "menu";
        return;
      }
    }
  }

  draw_pause(now) {
    this.draw_play(now, this.pausedSongT);
    const g = this.g;
    g.fillStyle = "rgba(0,0,0,0.67)";
    g.fillRect(0, 0, W, H);
    this.text("일시정지", 48, TEXT, W / 2, H / 2 - 60, { bold: true });
    this.roundRect(W / 2 - 160, H / 2 - 10, 320, 50, 12, PANEL);
    this.text("계속 (A / Start / Enter)", 19, TEXT, W / 2, H / 2 + 15);
    this.roundRect(W / 2 - 160, H / 2 + 70, 320, 50, 12, PANEL);
    this.text("메뉴로 (B / Back / Backspace)", 19, MUTED, W / 2, H / 2 + 95);
  }

  // ----- 결과 ------------------------------------------------------------

  update_result(events) {
    for (const { kind, val } of events) {
      if (kind !== "btn") continue;
      if (val & BTN.Y && this.submitState === "ready") { this.submit(); continue; }
      if (val & (BTN.A | BTN.START | BTN.B)) { this.state = "menu"; return; }
    }
  }

  submit() {
    if (!this.user) { this.submitState = "login"; return; }
    this.submitState = "sending";
    const r = this.result;
    const entry = {
      name: this.save.name, score: r.score, acc: Math.round(r.acc * 100) / 100, rank: r.rank, fc: r.fc,
      maxCombo: r.maxCombo, song: this.song.name.slice(0, 80), diff: this.diff, long: this.save.long,
    };
    submitScore(this.resultBoard.board, this.user.uid, entry)
      .then((res) => { this.submitState = "done"; this.submitRes = res; this.loadResultBoard(); })
      .catch((e) => {
        this.submitState = "error";
        this.submitError = e.code === "permission-denied" ? "권한이 없어요. 보안 규칙을 새 버전으로 게시했는지 확인해 주세요." : e.message;
      });
  }

  draw_result() {
    const r = this.result;
    const cx = rankingEnabled ? 330 : W / 2;
    const rankColors = { S: "#ffd75a", A: GREEN, B: ACCENT, C: "#c8aaff", D: MISS_COLOR };
    this.text(`${this.song.name} · ${this.diff}`, 20, MUTED, cx, 50, { maxW: 560 });
    this.text(r.rank, 130, rankColors[r.rank], cx, 160, { bold: true });
    if (r.fc) this.text("FULL COMBO!", 24, "#ffd75a", cx, 250, { bold: true });
    this.text(r.score.toLocaleString(), 42, TEXT, cx, 300, { bold: true });
    if (r.newBest) this.text("내 최고 기록!", 17, "#ffd75a", cx, 336);
    let y = 372;
    for (const [name, , , color] of [...JUDGES, ["MISS", 0, 0, MISS_COLOR]]) {
      this.text(name, 19, color, cx - 140, y, { align: "left", bold: true });
      this.text(r.counts[name], 19, TEXT, cx + 140, y, { align: "right" });
      y += 28;
    }
    y += 12;
    this.text(`정확도 ${r.acc.toFixed(2)}%   최대 콤보 ${r.maxCombo} / ${r.notes}`, 18, TEXT, cx, y);
    y += 30;
    const e = r.avgErr;
    let hint = "타이밍이 정확해요!";
    if (Math.abs(e) >= 1) {
      hint = `평균 ${Math.round(Math.abs(e))}ms ${e > 0 ? "늦게" : "빠르게"} 눌렀어요`;
      if (Math.abs(e) >= 15) hint += ` → 싱크 보정 ${this.save.offset + Math.round(e)}ms 추천`;
    }
    this.text(hint, 15, MUTED, cx, y, { maxW: 600 });

    if (rankingEnabled) {
      const x0 = 640, w = 290;
      this.text("🏆 온라인 랭킹 TOP 10", 20, TEXT, x0 + w / 2, 60, { bold: true });
      this.drawBoard(this.resultBoard.rows, this.resultBoard.error, x0, 100, w, 10);
      const by = 600;
      const st = this.submitState, res = this.submitRes;
      if (st === "ready") {
        this.roundRect(W / 2 - 200, by - 26, 400, 52, 12, PANEL);
        this.text(`Y 버튼 / R 키 / 여기를 터치: "${this.save.name}"(으)로 랭킹 등록`, 17, ACCENT, W / 2, by, { maxW: 380 });
      } else if (st === "login") this.text("랭킹 등록은 로그인 후에 할 수 있어요 → 화면 아래 'Google로 로그인'", 16, MUTED, W / 2, by);
      else if (st === "sending") this.text("등록 중...", 18, MUTED, W / 2, by);
      else if (st === "done" && res.improved) this.text(res.pos ? `등록 완료! 현재 ${res.pos}위` : "등록 완료!", 20, GOLD, W / 2, by, { bold: true });
      else if (st === "done") this.text(`기존 기록(${res.best.toLocaleString()}점${res.pos ? `, ${res.pos}위` : ""})이 더 높아서 그대로 뒀어요`, 17, MUTED, W / 2, by);
      else if (st === "error") this.text("등록 실패: " + this.submitError, 15, MISS_COLOR, W / 2, by, { maxW: 800 });
    }
    this.text("A 버튼 / Enter / 터치: 메뉴로", 15, MUTED, W / 2, H - 28);
  }
}
