// 페이지 시작: 게임을 만들고 HTML 도구 막대(곡 추가, 삭제, 이름)를 연결한다.
import { Game } from "./game.js";

const game = new Game(document.getElementById("game"));
if (new URLSearchParams(location.search).has("debug")) window.game = game; // 개발자 도구에서 확인용

const fileInput = document.getElementById("midi-file");
const deleteBtn = document.getElementById("delete-song");
const nameInput = document.getElementById("player-name");

nameInput.value = game.save.name;
nameInput.addEventListener("change", () => {
  game.setName(nameInput.value);
  nameInput.value = game.save.name;
});
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInput.blur(); });

fileInput.addEventListener("change", async () => {
  await game.addMidiFiles([...fileInput.files]);
  fileInput.value = "";
});

deleteBtn.addEventListener("click", () => {
  if (game.song.key !== "builtin" && confirm(`"${game.song.name}" 곡을 목록에서 지울까요?`)) game.deleteCurrentSong();
  else if (game.song.key === "builtin") game.showToast("기본 곡은 지울 수 없어요");
});

const syncDelete = () => { deleteBtn.disabled = game.song.key === "builtin"; };
game.onChange = syncDelete;
syncDelete();

// 파일 끌어다 놓기
const drop = document.getElementById("drop");
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
