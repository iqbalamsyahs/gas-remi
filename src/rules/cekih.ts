import { makeDeck, type Card, type Rank } from "./cards";
import { classify } from "./combos";
import { canPartition } from "./partition";
import { hasPureSeri } from "./scoring";
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
  const closes = (cards: Card[]) =>
    canPartition(cards, jokerRank) && (laidPureSeri || hasPureSeri(cards, jokerRank));
  if (closes(hand)) return true;
  const held = new Set(hand.map((card) => card.id));
  const useful = makeDeck().filter((extra) => !held.has(extra.id) && formsMeldWithHand(extra, hand, jokerRank));
  return useful.some((extra) => {
    const pool = [...hand, extra];
    if (closes(pool)) return true;
    return pool.some((_, i) => closes(pool.filter((__, j) => j !== i)));
  });
}

function formsMeldWithHand(extra: Card, hand: Card[], jokerRank: Rank | null): boolean {
  return subsets(hand, 2, 3).some((group) => classify([extra, ...group], jokerRank).kind !== "invalid");
}

// Cekih hanya boleh ke pemain sebelumnya dan sebelumnya lagi.
export function cekihTargets(caller: PlayerId): PlayerId[] {
  return [((caller + 3) % 4) as PlayerId, ((caller + 2) % 4) as PlayerId];
}

export function callCekih(state: RoundState, caller: PlayerId, target: PlayerId): RoundState {
  if (state.result !== null) throw new Error("ROUND_OVER");
  if (caller === target) throw new Error("CEKIH_SELF");
  if (!cekihTargets(caller).includes(target)) throw new Error("CEKIH_TARGET_NOT_ALLOWED");
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
