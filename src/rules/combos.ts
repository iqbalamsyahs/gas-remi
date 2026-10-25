import { baseValue, type Card, type Rank } from "./cards";

export type ComboKind = "seri" | "tris" | "invalid";

export interface Classification {
  kind: ComboKind;
  pure: boolean;
  values: number[];
}

const INVALID: Classification = { kind: "invalid", pure: false, values: [] };

// Seri hanya boleh berurutan di dua rentang ini; As tidak pernah masuk seri.
const LOW_RANGE: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10"];
const HIGH_RANGE: Rank[] = ["J", "Q", "K"];

export function classify(cards: Card[], jokerRank: Rank | null): Classification {
  if (cards.length < 3 || cards.length > 4) return INVALID;
  const isJoker = (card: Card) => jokerRank !== null && card.rank === jokerRank;
  const real = cards.filter((card) => !isJoker(card));
  return classifyTris(cards, real) ?? classifySeri(cards, real, isJoker) ?? INVALID;
}

// Urutan tampil kombinasi: seri dari angka terkecil dengan joker di posisi yang digantikannya,
// tris dengan joker di belakang. Kartu yang bukan kombinasi sah dikembalikan apa adanya.
export function orderMeld(cards: Card[], jokerRank: Rank | null): Card[] {
  const isJoker = (card: Card) => jokerRank !== null && card.rank === jokerRank;
  const real = cards.filter((card) => !isJoker(card));
  const jokers = cards.filter(isJoker);
  const kind = classify(cards, jokerRank).kind;
  if (kind === "tris") return [...real, ...jokers];
  if (kind !== "seri") return cards;
  for (const range of [LOW_RANGE, HIGH_RANGE]) {
    for (let start = 0; start + cards.length <= range.length; start++) {
      const window = range.slice(start, start + cards.length);
      if (!real.every((card) => window.includes(card.rank))) continue;
      return window.map((rank) => real.find((card) => card.rank === rank) ?? (jokers.shift() as Card));
    }
  }
  return cards;
}

function classifyTris(cards: Card[], real: Card[]): Classification | null {
  // Tris wajib punya minimal satu kartu asli; tiga joker sejenis tidak sah.
  if (real.length < 1) return null;
  const rank = real[0].rank;
  if (!real.every((card) => card.rank === rank)) return null;
  const value = baseValue(rank);
  const pure = real.length === cards.length && rank === "A";
  return { kind: "tris", pure, values: cards.map(() => value) };
}

function classifySeri(
  cards: Card[],
  real: Card[],
  isJoker: (card: Card) => boolean,
): Classification | null {
  // Tanpa kartu asli, joker sejenis tidak bisa membentuk seri.
  if (real.length < 1) return null;
  const suit = real[0].suit;
  if (!real.every((card) => card.suit === suit)) return null;
  if (new Set(real.map((card) => card.rank)).size !== real.length) return null;

  for (const range of [LOW_RANGE, HIGH_RANGE]) {
    for (let start = 0; start + cards.length <= range.length; start++) {
      const window = range.slice(start, start + cards.length);
      if (!real.every((card) => window.includes(card.rank))) continue;
      // Joker mengisi posisi window yang tidak ditempati kartu asli, sesuai urutan.
      const missing = window.filter((rank) => !real.some((card) => card.rank === rank));
      const values = cards.map((card) =>
        isJoker(card) ? baseValue(missing.shift() as Rank) : baseValue(card.rank),
      );
      return { kind: "seri", pure: real.length === cards.length, values };
    }
  }
  return null;
}
