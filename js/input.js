// 입력: 게임패드(Gamepad API), 키보드, 터치/마우스를 같은 이벤트로 바꾼다.
// 이벤트: { t: performance.now() 기준 초, kind: "lane" | "lane_up" | "btn", val }

export const BTN = {
  UP: 0x0001, DOWN: 0x0002, LEFT: 0x0004, RIGHT: 0x0008,
  START: 0x0010, BACK: 0x0020, LB: 0x0100, RB: 0x0200,
  A: 0x1000, B: 0x2000, X: 0x4000, Y: 0x8000,
};

// 표준 매핑(Xbox 패드) 버튼 번호 → 비트
const PAD_MAP = [
  [0, BTN.A], [1, BTN.B], [2, BTN.X], [3, BTN.Y], [4, BTN.LB], [5, BTN.RB],
  [8, BTN.BACK], [9, BTN.START], [12, BTN.UP], [13, BTN.DOWN], [14, BTN.LEFT], [15, BTN.RIGHT],
];
export const LANE_MASKS = [BTN.LEFT | BTN.X, BTN.DOWN | BTN.A, BTN.UP | BTN.Y, BTN.RIGHT | BTN.B];

const KEY_LANES = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };
const KEY_BTNS = {
  ArrowLeft: BTN.LEFT, ArrowRight: BTN.RIGHT, ArrowUp: BTN.UP, ArrowDown: BTN.DOWN,
  Enter: BTN.A, Space: BTN.A, Backspace: BTN.B, Escape: BTN.START, PageUp: BTN.LB, PageDown: BTN.RB,
  KeyR: BTN.Y, // 결과 화면에서 랭킹 등록
};

export class Input {
  constructor() {
    this.events = [];
    this.padIndex = null;
    this.padName = "";
    this.prevButtons = 0;
    this.prevLanes = 0;
    this.keysDown = new Set();
    this.pointerLanes = new Map(); // pointerId → lane

    addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT") return; // 이름 입력칸에서 친 키는 무시
      if (e.repeat) { if (KEY_LANES[e.code] !== undefined || KEY_BTNS[e.code]) e.preventDefault(); return; }
      const t = e.timeStamp / 1000;
      if (KEY_LANES[e.code] !== undefined) {
        this.keysDown.add(e.code);
        this.events.push({ t, kind: "lane", val: KEY_LANES[e.code] });
      }
      if (KEY_BTNS[e.code]) this.events.push({ t, kind: "btn", val: KEY_BTNS[e.code] });
      if (KEY_LANES[e.code] !== undefined || KEY_BTNS[e.code]) e.preventDefault();
    });
    addEventListener("keyup", (e) => {
      if (KEY_LANES[e.code] !== undefined && this.keysDown.delete(e.code))
        this.events.push({ t: e.timeStamp / 1000, kind: "lane_up", val: KEY_LANES[e.code] });
    });
    addEventListener("gamepadconnected", (e) => { if (this.padIndex === null) this._usePad(e.gamepad); });
    addEventListener("gamepaddisconnected", (e) => { if (e.gamepad.index === this.padIndex) this.padIndex = null; });

    // 게임패드는 이벤트가 없어서 직접 자주 읽는다 (화면 갱신보다 촘촘하게)
    setInterval(() => this.poll(), 2);
  }

  _usePad(gp) {
    this.padIndex = gp.index;
    this.padName = gp.id;
  }

  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = this.padIndex !== null ? pads[this.padIndex] : null;
    if (!gp) {
      this.padIndex = null;
      gp = [...pads].find((p) => p && p.connected);
      if (gp) this._usePad(gp);
    }
    let buttons = 0;
    if (gp) for (const [i, bit] of PAD_MAP) if (gp.buttons[i] && gp.buttons[i].pressed) buttons |= bit;
    const t = performance.now() / 1000;
    let lanes = 0;
    LANE_MASKS.forEach((m, i) => { if (buttons & m) lanes |= 1 << i; });
    const pressed = buttons & ~this.prevButtons;
    if (pressed) this.events.push({ t, kind: "btn", val: pressed });
    for (let i = 0; i < 4; i++) {
      if ((lanes & ~this.prevLanes) >> i & 1) this.events.push({ t, kind: "lane", val: i });
      else if ((this.prevLanes & ~lanes) >> i & 1) this.events.push({ t, kind: "lane_up", val: i });
    }
    this.prevButtons = buttons;
    this.prevLanes = lanes;
  }

  /** 화면 터치/클릭으로 레인 누르기 (game.js가 좌표를 레인으로 바꿔서 부른다) */
  pointerDown(id, lane, t) {
    this.pointerLanes.set(id, lane);
    this.events.push({ t, kind: "lane", val: lane });
  }

  pointerUp(id, t) {
    if (!this.pointerLanes.has(id)) return;
    this.events.push({ t, kind: "lane_up", val: this.pointerLanes.get(id) });
    this.pointerLanes.delete(id);
  }

  drain() {
    this.poll();
    const ev = this.events.sort((a, b) => a.t - b.t);
    this.events = [];
    return ev;
  }

  clear() {
    this.poll();
    this.events = [];
  }

  get connected() {
    return this.padIndex !== null;
  }

  rumble(strong, weak, ms) {
    const gp = this.padIndex !== null ? navigator.getGamepads()[this.padIndex] : null;
    const act = gp && gp.vibrationActuator;
    if (!act || !act.playEffect) return;
    act.playEffect("dual-rumble", { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }
}
