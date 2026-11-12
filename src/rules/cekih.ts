import { makeDeck, type Card, type Rank } from "./cards";
import { classify } from "./combos";
import { canClose } from "./partition";
import { subsets } from "./subsets";
import type { PlayerId } from "./opening";
import type { RoundState } from "./turn";

// Tangan tinggal satu kartu lagi untuk tutup jika ada kartu X (tidak ada di tangan) sehingga setelah
// mengambilnya tangan bisa ditutup. Dua cara tutup:
// - kartu penutup adalah kartu buangan yang ikut diambil: tangan + X sudah bisa dipartisi seluruhnya;
// - kartu penutup adalah kartu sendiri: satu kartu c dibuang dari tangan + X, sisanya bisa dipartisi.
// Hanya X yang membentuk kombinasi sah dengan dua atau tiga kartu tangan yang perlu dicek (X tidak bisa dipakai lain).
// Seperti syarat tutup, tangan yang jadi harus punya seri murni (atau seri murni sudah diturunkan).
export function canCallCekih(hand: Card[], jokerRank: Rank | null, laidPureSeri = false): boolean {
  return cekihSource(hand, jokerRank, laidPureSeri) !== null;
}

// Dari mana kartu yang kurang datang:
// - "before_previous": dibuang pemain sebelum sebelumnya, dengan kartu pemain sebelumnya di atasnya.
//   Tangan + X bisa dipartisi seluruhnya, dan kartu sampah dari pemain sebelumnya jadi penutup.
// - "previous": dibuang pemain sebelumnya langsung, lalu satu kartu sampah di tangan jadi penutup.
// Null kalau tangan tidak bisa tutup dengan satu kartu lagi.
export type CekihSource = "before_previous" | "previous";

export function cekihSource(hand: Card[], jokerRank: Rank | null, laidPureSeri = false): CekihSource | null {
  const closes = (cards: Card[]) => canClose(cards, jokerRank, laidPureSeri);
  if (closes(hand)) return "previous";
  const held = new Set(hand.map((card) => card.id));
  const useful = makeDeck().filter((extra) => !held.has(extra.id) && formsMeldWithHand(extra, hand, jokerRank));
  let source: CekihSource | null = null;
  for (const extra of useful) {
    const pool = [...hand, extra];
    if (closes(pool)) return "before_previous";
    if (pool.some((_, i) => closes(pool.filter((__, j) => j !== i)))) source = "previous";
  }
  return source;
}

function formsMeldWithHand(extra: Card, hand: Card[], jokerRank: Rank | null): boolean {
  return subsets(hand, 2, 3).some((group) => classify([extra, ...group], jokerRank).kind !== "invalid");
}

// Cekih hanya ke satu pemain, sesuai sumber kartu yang kurang (lihat cekihSource).
export function cekihTargets(caller: PlayerId, hand: Card[], jokerRank: Rank | null, laidPureSeri = false): PlayerId[] {
  const previous = ((caller + 3) % 4) as PlayerId;
  const beforePrevious = ((caller + 2) % 4) as PlayerId;
  return [cekihSource(hand, jokerRank, laidPureSeri) === "before_previous" ? beforePrevious : previous];
}

export function callCekih(state: RoundState, caller: PlayerId, target: PlayerId): RoundState {
  if (state.result !== null) throw new Error("ROUND_OVER");
  if (caller === target) throw new Error("CEKIH_SELF");
  // Setelah cangkul/ambil buangan dan sebelum buang, tangan sedang lebih satu kartu: cekih tidak dihitung.
  if (state.turn === caller && state.phase === "discard") throw new Error("CEKIH_NOT_NOW");
  const allowed = cekihTargets(caller, state.hands[caller], state.jokerRank, state.laidPureSeri[caller]);
  if (!allowed.includes(target)) throw new Error("CEKIH_TARGET_NOT_ALLOWED");
  const exists = state.cekih.some((c) => c.caller === caller && c.target === target);
  if (exists) throw new Error("CEKIH_ALREADY_ACTIVE");
  if (!canCallCekih(state.hands[caller], state.jokerRank, state.laidPureSeri[caller])) throw new Error("CEKIH_NOT_ALLOWED");
  return { ...state, cekih: [...state.cekih, { caller, target }] };
}

export function cancelCekih(state: RoundState, caller: PlayerId, target: PlayerId): RoundState {
  if (state.result !== null) throw new Error("ROUND_OVER");
  const exists = state.cekih.some((c) => c.caller === caller && c.target === target);
  if (!exists) throw new Error("CEKIH_NOT_FOUND");
  return {
    ...state,
    cekih: state.cekih.filter((c) => !(c.caller === caller && c.target === target)),
  };
}
