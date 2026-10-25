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
  // Alarm keras sebelum suara "Main woy!!!".
  turn: [
    { freq: 880, ms: 120, type: "square", gain: 0.3 },
    { freq: 1175, ms: 120, type: "square", gain: 0.3 },
    { freq: 880, ms: 120, type: "square", gain: 0.3 },
    { freq: 1175, ms: 180, type: "square", gain: 0.3 },
  ],
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

// Jingle opening (sekitar 4 detik): melodi dan bass dimainkan bersamaan.
const OPENING_MELODY: Tone[] = [
  { freq: 392, ms: 150 },
  { freq: 523, ms: 150 },
  { freq: 659, ms: 150 },
  { freq: 784, ms: 150 },
  { freq: 0, ms: 150 },
  { freq: 659, ms: 150 },
  { freq: 784, ms: 450 },
  { freq: 880, ms: 150 },
  { freq: 784, ms: 150 },
  { freq: 698, ms: 150 },
  { freq: 659, ms: 150 },
  { freq: 587, ms: 300 },
  { freq: 392, ms: 300 },
  { freq: 523, ms: 150 },
  { freq: 659, ms: 150 },
  { freq: 784, ms: 150 },
  { freq: 1047, ms: 300 },
  { freq: 988, ms: 150 },
  { freq: 1047, ms: 600 },
].map((tone) => ({ ...tone, type: "triangle" as const, gain: 0.15 }));

const OPENING_BASS: Tone[] = [
  { freq: 131, ms: 600 },
  { freq: 196, ms: 750 },
  { freq: 175, ms: 600 },
  { freq: 196, ms: 600 },
  { freq: 131, ms: 750 },
  { freq: 196, ms: 150 },
  { freq: 131, ms: 600 },
].map((tone) => ({ ...tone, gain: 0.12 }));

function audio(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
}

// Menjadwalkan nada berurutan mulai dari waktu at, ke node tujuan.
function schedule(ctx: AudioContext, tones: Tone[], at: number, destination: AudioNode): void {
  for (const tone of tones) {
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
      osc.connect(gain).connect(destination);
      osc.start(at);
      osc.stop(end);
    }
    at = end;
  }
}

// Rekaman suara giliran, diputar setelah alarm. Dimuat sekali lalu disimpan.
const TURN_VOICE_URL = "/main-woy.ogg";
let turnVoice: Promise<AudioBuffer | null> | null = null;

function loadTurnVoice(ctx: AudioContext): Promise<AudioBuffer | null> {
  turnVoice ??= fetch(TURN_VOICE_URL)
    .then((res) => res.arrayBuffer())
    .then((data) => ctx.decodeAudioData(data))
    .catch(() => null);
  return turnVoice;
}

// Nada dibuat langsung dengan Web Audio. Browser baru mengizinkan suara setelah pemain klik halaman.
export function playSound(sound: Sound): void {
  if (isMuted()) return;
  const ctx = audio();
  if (ctx === null) return;
  const start = ctx.currentTime;
  schedule(ctx, TONES[sound], start, ctx.destination);
  if (sound !== "turn") return;
  const voiceAt = start + TONES.turn.reduce((sum, tone) => sum + tone.ms, 0) / 1000;
  void loadTurnVoice(ctx).then((buffer) => {
    if (buffer === null) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(Math.max(voiceAt, ctx.currentTime));
  });
}

// Browser menahan suara sampai pemain klik halaman. Nada yang sudah dijadwalkan baru terdengar setelah resumeAudio.
export function audioBlocked(): boolean {
  return context !== null && context.state !== "running";
}

export function resumeAudio(): void {
  void context?.resume().catch(() => {});
}

// Memutar jingle opening sekali. Mengembalikan fungsi untuk memudarkan dan menghentikannya (dipanggil saat meja tampil).
export function playOpening(): () => void {
  if (isMuted()) return () => {};
  const ctx = audio();
  if (ctx === null) return () => {};
  const master = ctx.createGain();
  master.connect(ctx.destination);
  schedule(ctx, OPENING_MELODY, ctx.currentTime, master);
  schedule(ctx, OPENING_BASS, ctx.currentTime, master);
  return () => {
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    setTimeout(() => master.disconnect(), 1000);
  };
}
