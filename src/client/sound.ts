import type { PlayerView } from "../../server/view";

export type Sound = "turn" | "cekih" | "joker" | "round" | "win" | "card";

function myTurn(view: PlayerView): boolean {
  return (
    view.you !== null &&
    view.board !== null &&
    (view.status === "opening" || view.status === "playing") &&
    view.board.turn === view.you
  );
}

// Jumlah kartu yang terlihat berpindah: cangkulan, buangan, dan kombinasi di meja.
function cardsMoved(prev: PlayerView, next: PlayerView): boolean {
  const a = prev.board;
  const b = next.board;
  if (a === null || b === null) return false;
  return (
    a.stockCount !== b.stockCount ||
    a.discard.cards.length !== b.discard.cards.length ||
    a.table.flat().length !== b.table.flat().length
  );
}

// Suara yang dibunyikan untuk perubahan tampilan ini. Tampilan pertama tidak berbunyi.
// "card" hanya dibunyikan kalau tidak ada suara lain, supaya tidak menumpuk.
export function soundsFor(prev: PlayerView | null, next: PlayerView): Sound[] {
  if (prev === null) return [];
  const out: Sound[] = [];
  if (!myTurn(prev) && myTurn(next)) out.push("turn");
  const cekihAtMe = (v: PlayerView) => v.board?.cekih.filter((c) => c.target === v.you).map((c) => c.caller) ?? [];
  const before = cekihAtMe(prev);
  if (next.you !== null && cekihAtMe(next).some((caller) => !before.includes(caller))) out.push("cekih");
  if (!prev.board?.jokerRank && next.board?.jokerRank) out.push("joker");
  if (prev.status !== "scoring" && next.status === "scoring") out.push("round");
  if (prev.status !== "finished" && next.status === "finished") out.push("win");
  if (out.length === 0 && cardsMoved(prev, next)) out.push("card");
  return out;
}

// Nada per suara: frekuensi (0 = jeda), durasi, bentuk gelombang, dan kekerasan.
interface Tone {
  freq: number;
  ms: number;
  type?: OscillatorType;
  gain?: number;
}

const TONES: Record<Sound, Tone[]> = {
  turn: [{ freq: 660, ms: 140 }, { freq: 990, ms: 220 }],
  cekih: [
    { freq: 440, ms: 130, type: "square", gain: 0.12 },
    { freq: 0, ms: 70 },
    { freq: 440, ms: 130, type: "square", gain: 0.12 },
  ],
  joker: [{ freq: 1320, ms: 350, type: "triangle" }],
  round: [{ freq: 523, ms: 120 }, { freq: 659, ms: 120 }, { freq: 784, ms: 220 }],
  win: [
    { freq: 523, ms: 120 },
    { freq: 659, ms: 120 },
    { freq: 784, ms: 120 },
    { freq: 1047, ms: 360 },
  ],
  card: [{ freq: 1800, ms: 35, gain: 0.05 }],
};

const MUTE_KEY = "remi:muted";
let context: AudioContext | null = null;

// Pilihan mute disimpan per perangkat. Penyimpanan bisa diblokir, jadi selalu dibungkus try/catch.
export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Tidak tersimpan: hanya berlaku sampai halaman dimuat ulang.
  }
}

// Nada dibuat langsung dengan Web Audio, tanpa file audio. Browser baru mengizinkan suara setelah pemain klik halaman.
export function playSound(sound: Sound): void {
  if (isMuted() || typeof AudioContext === "undefined") return;
  context ??= new AudioContext();
  const ctx = context;
  if (ctx.state === "suspended") void ctx.resume();
  let at = ctx.currentTime;
  for (const tone of TONES[sound]) {
    const end = at + tone.ms / 1000;
    if (tone.freq > 0) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.type ?? "sine";
      osc.frequency.value = tone.freq;
      // Naik cepat lalu turun ke hampir nol supaya tidak ada bunyi "klik".
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(tone.gain ?? 0.2, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(end);
    }
    at = end;
  }
}
