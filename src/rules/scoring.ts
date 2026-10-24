import { baseValue, type Card, type Rank } from "./cards";
import { classify } from "./combos";
import { subsets } from "./subsets";
import type { RoundState } from "./turn";

const JOKER_PENALTY_MULTIPLIER = 10;

// Susunan kartu tangan: kombinasi (plus) dan sisanya yang jadi sampah (minus).
export interface Arrangement {
  melds: Card[][];
  leftover: Card[];
}

interface Best extends Arrangement {
  score: number;
  // Jumlah seri murni dan jumlah kartu joker yang dipakai di kombinasi. Dipakai untuk memecah nilai yang sama.
  pure: number;
  jokers: number;
}

// Susunan tangan dengan nilai terbaik. Dipakai sebagai usulan awal dan untuk bot.
// allowMelds: kombinasi di tangan hanya boleh plus kalau pemain punya seri murni. Kalau tidak, semua kartu jadi sampah.
export function handArrangement(hand: Card[], jokerRank: Rank | null, allowMelds: boolean): Arrangement {
  if (!allowMelds) return { melds: [], leftover: hand };
  const best = bestFrom(hand, jokerRank);
  return { melds: best.melds, leftover: best.leftover };
}

// Susunan yang dikirim pemain. Null jika ada kombinasi tidak sah, kartu tidak ada di tangan, atau kartu dipakai dua kali.
export function validateArrangement(hand: Card[], melds: Card[][], jokerRank: Rank | null): Arrangement | null {
  const used = new Set<string>();
  for (const meld of melds) {
    if (classify(meld, jokerRank).kind === "invalid") return null;
    for (const card of meld) {
      if (used.has(card.id) || !hand.some((h) => h.id === card.id)) return null;
      used.add(card.id);
    }
  }
  return { melds, leftover: hand.filter((card) => !used.has(card.id)) };
}

// Skor satu pemain untuk ronde ini dengan susunan tangan tertentu.
export function seatScore(state: RoundState, seat: number, arrangement: Arrangement): number {
  const onTable = state.table[seat].reduce((sum, meld) => sum + meldValue(meld, state.jokerRank), 0);
  const plus = arrangement.melds.reduce((sum, meld) => sum + meldValue(meld, state.jokerRank), 0);
  const minus = arrangement.leftover.reduce((sum, card) => sum + loneValue(card, state.jokerRank), 0);
  const bonus = state.result?.closedBy === seat ? state.result.bonus : 0;
  return onTable + plus + minus + state.penalties[seat] + bonus + cekihPenaltyOf(state, seat);
}

// Hukuman cekih untuk pemain tercekih (negatif), atau 0.
export function cekihPenaltyOf(state: RoundState, seat: number): number {
  return state.result?.cekihTarget === seat ? state.result.cekihPenalty : 0;
}

export function scoreRound(state: RoundState): number[] {
  const arrangements = state.hands.map((hand, seat) =>
    handArrangement(hand, state.jokerRank, canUseMelds(hand, state.laidPureSeri[seat], state.jokerRank)),
  );
  return finalScores(state, arrangements);
}

// Skor akhir ronde. Tutup tangan (tidak pernah mengambil dari buangan): penutup dapat bonus, yang lain 0,
// dan kartu tidak dihitung. Penalti joker tetap berlaku.
export function finalScores(state: RoundState, arrangements: Arrangement[]): number[] {
  const closer = state.result?.closedBy;
  if (typeof closer === "number" && !state.pickedFromDiscard[closer]) {
    // Penalti joker yang dibuang tetap berlaku.
    return state.hands.map((_, seat) => (seat === closer ? state.result!.bonus : 0) + state.penalties[seat]);
  }
  return arrangements.map((arrangement, seat) => seatScore(state, seat, arrangement));
}

export function meldValue(meld: Card[], jokerRank: Rank | null): number {
  return classify(meld, jokerRank).values.reduce((sum, value) => sum + value, 0);
}

export function loneValue(card: Card, jokerRank: Rank | null): number {
  const isJoker = jokerRank !== null && card.rank === jokerRank;
  return isJoker ? -JOKER_PENALTY_MULTIPLIER * baseValue(card.rank) : -baseValue(card.rank);
}

// Setiap kartu dipilih untuk masuk kombinasi (plus) atau jadi sampah (minus). Dicari dengan rekursi,
// tangan maksimal 8 kartu. Jika nilai sama, kartu dibiarkan sebagai sampah.
function bestFrom(hand: Card[], jokerRank: Rank | null): Best {
  if (hand.length === 0) return { score: 0, melds: [], leftover: [], pure: 0, jokers: 0 };
  const [first, ...rest] = hand;
  const alone = bestFrom(rest, jokerRank);
  let best: Best = {
    score: loneValue(first, jokerRank) + alone.score,
    melds: alone.melds,
    leftover: [first, ...alone.leftover],
    pure: alone.pure,
    jokers: alone.jokers,
  };
  for (const group of subsets(rest, 2, 3)) {
    const meld = [first, ...group];
    const check = classify(meld, jokerRank);
    if (check.kind === "invalid") continue;
    const remaining = rest.filter((card) => !group.includes(card));
    const inner = bestFrom(remaining, jokerRank);
    const candidate: Best = {
      score: meldValue(meld, jokerRank) + inner.score,
      melds: [meld, ...inner.melds],
      leftover: inner.leftover,
      pure: inner.pure + (check.pure ? 1 : 0),
      jokers: inner.jokers + meld.filter((card) => jokerRank !== null && card.rank === jokerRank).length,
    };
    if (isBetter(candidate, best)) best = candidate;
  }
  return best;
}

// Nilai lebih tinggi menang. Nilai sama: seri murni lebih banyak menang, lalu joker lebih sedikit.
function isBetter(a: Best, b: Best): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.pure !== b.pure) return a.pure > b.pure;
  return a.jokers < b.jokers;
}

// Kombinasi di tangan (seri, tris, atau dengan joker) dihitung plus kalau pemain sudah menurunkan seri murni,
// atau punya seri murni di tangan.
export function canUseMelds(hand: Card[], laidPureSeri: boolean, jokerRank: Rank | null): boolean {
  return laidPureSeri || hasPureSeri(hand, jokerRank);
}

// Seri murni (tanpa joker, termasuk tris As) di antara kartu tangan.
export function hasPureSeri(hand: Card[], jokerRank: Rank | null): boolean {
  return subsets(hand, 3, 4).some((group) => {
    const check = classify(group, jokerRank);
    return check.kind !== "invalid" && check.pure;
  });
}
