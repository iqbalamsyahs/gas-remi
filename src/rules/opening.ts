import { baseValue, type Card, type Rank } from "./cards";
import { HAND_SIZE } from "./deal";

export type PlayerId = 0 | 1 | 2 | 3;

// cards[0] = paling bawah (paling lama), cards[last] = paling atas (paling baru).
export interface DiscardPile {
  cards: Card[];
  closedIndex: number | null;
}

export interface OpeningState {
  hands: Card[][];
  stock: Card[];
  discard: DiscardPile;
  jokerRank: Rank | null;
  penalties: number[];
  // Kartu penentu joker (sudah keluar dari permainan). Ditampilkan sekali di popup joker.
  jokerCard?: Card | null;
}

const JOKER_PENALTY_MULTIPLIER = 10;

// Langkah 1 pembukaan: pemain mengambil satu kartu dari cangkulan dan melihatnya.
// Urutan giliran pembukaan dijaga pemanggil (room), karena pemain pertama tiap ronde bisa berbeda.
export function openingDraw(state: OpeningState, player: PlayerId): OpeningState {
  if (state.hands[player].length !== HAND_SIZE) throw new Error("ALREADY_DRAWN");
  const [drawn, ...stock] = state.stock;
  return {
    ...state,
    stock,
    hands: state.hands.map((h, seat) => (seat === player ? [...h, drawn] : h)),
  };
}

// Langkah 2 pembukaan: pemain membuang satu kartu dari tangannya (setelah openingDraw).
// Angka buangan pembukaan tidak boleh sama.
export function openingDiscard(state: OpeningState, player: PlayerId, card: Card): OpeningState {
  if (state.hands[player].length !== HAND_SIZE + 1) throw new Error("NOT_DRAWN");
  if (state.discard.cards.some((placed) => placed.rank === card.rank)) {
    throw new Error("DUPLICATE_OPENING_RANK");
  }
  const hand = state.hands[player];
  const index = hand.findIndex((held) => held.id === card.id);
  if (index === -1) throw new Error("CARD_NOT_IN_HAND");
  const hands = state.hands.map((h, seat) => (seat === player ? hand.filter((_, i) => i !== index) : h));
  return {
    ...state,
    hands,
    discard: { ...state.discard, cards: [...state.discard.cards, card] },
  };
}

// Setelah keempat pemain membuang, satu kartu diambil acak dari cangkulan sebagai penentu.
// Kartu penentu keluar dari permainan. Buangan pembukaan yang angkanya sama dengan joker
// membuat pembuangnya kena penalti dan kartu itu ditutup.
export function resolveJoker(state: OpeningState, rng: () => number): OpeningState {
  if (state.discard.cards.length !== 4) throw new Error("OPENING_INCOMPLETE");
  const stock = [...state.stock];
  const [penentu] = stock.splice(Math.floor(rng() * stock.length), 1);
  const jokerRank = penentu.rank;

  const penalties = [...state.penalties];
  let closedIndex: number | null = null;
  state.discard.cards.forEach((card, index) => {
    if (card.rank !== jokerRank) return;
    penalties[index] -= JOKER_PENALTY_MULTIPLIER * baseValue(card.rank);
    closedIndex = index;
  });

  return {
    ...state,
    stock,
    jokerRank,
    jokerCard: penentu,
    penalties,
    discard: { ...state.discard, closedIndex },
  };
}
