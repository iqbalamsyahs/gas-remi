import { baseValue, type Card, type Rank } from "./cards";
import { classify } from "./combos";
import { pickableFromDiscard, pickupRefusal } from "./discard";
import { canPartition, removeCards } from "./partition";
import { hasPureSeri } from "./scoring";
import type { DiscardPile, PlayerId } from "./opening";

export interface RoundResult {
  closedBy: PlayerId | "stock_empty";
  bonus: number;
  closingCard: Card | null;
  // Pemain tercekih yang kena hukuman, dan nilainya (negatif). Null/0 jika tidak ada.
  cekihTarget: PlayerId | null;
  cekihPenalty: number;
}

export interface Cekih {
  caller: PlayerId;
  target: PlayerId;
}

export interface RoundState {
  hands: Card[][];
  stock: Card[];
  discard: DiscardPile;
  jokerRank: Rank | null;
  jokerCard?: Card | null;
  turn: PlayerId;
  phase: "draw" | "discard";
  drewFrom: "stock" | "discard" | null;
  laidPureSeri: boolean[];
  table: Card[][][];
  penalties: number[];
  result: RoundResult | null;
  cekih: Cekih[];
  discardOwner: Record<string, PlayerId>;
  pickedFromDiscard: boolean[];
  takenOwners: PlayerId[];
}

const CLOSED_FROM_STOCK_BONUS = 250;
const CEKIH_MULTIPLIER = 10;
const JOKER_PENALTY_MULTIPLIER = 10;
const NEXT_SEAT_COUNT = 4;

export function drawFromStock(state: RoundState, player: PlayerId): RoundState {
  assertTurn(state, player, "draw");
  const [drawn, ...stock] = state.stock;
  return {
    ...state,
    stock,
    hands: withHand(state, player, [...state.hands[player], drawn]),
    phase: "discard",
    drewFrom: "stock",
  };
}

// Syarat: pemain sudah pernah menurunkan seri murni di ronde ini.
// Kombinasi = kartu yang dituju + minimal dua kartu dari tangan.
// Kartu di atas kartu yang dituju tetap masuk tangan.
// Kartu yang diambil adalah target dan semua kartu di atasnya. Kartu target wajib masuk kombinasi.
// Kartu lain di atas target boleh ikut kombinasi (fromDiscard), sisanya masuk tangan.
// Kombinasi harus memakai minimal 2 kartu dari tangan.
export function pickFromDiscard(
  state: RoundState,
  player: PlayerId,
  target: Card,
  handCards: Card[],
  fromDiscard: Card[] = [],
): RoundState {
  assertTurn(state, player, "draw");
  const taken = pickableFromDiscard(state.discard, target);
  if (taken === null) throw new Error(pickupRefusal(state.discard, target));
  if (handCards.length < 2) throw new Error("INVALID_MELD");
  const above = taken.filter((card) => card.id !== target.id);
  if (!fromDiscard.every((card) => above.some((a) => a.id === card.id))) throw new Error("INVALID_MELD");
  const meld = [target, ...fromDiscard, ...handCards];
  const check = classify(meld, state.jokerRank);
  if (check.kind === "invalid") throw new Error("INVALID_MELD");
  // Pengambilan pertama di ronde harus sekaligus membentuk seri murni. Tris As tanpa joker juga seri murni.
  if (!state.laidPureSeri[player] && !check.pure) throw new Error("NEED_PURE_SERI");

  const remaining = [
    ...removeCards(state.hands[player], handCards),
    ...above.filter((card) => !fromDiscard.some((f) => f.id === card.id)),
  ];
  const table = state.table.map((melds, seat) => (seat === player ? [...melds, meld] : melds));
  const laidPureSeri = state.laidPureSeri.map((flag, seat) => (seat === player ? true : flag));
  const targetIndex = state.discard.cards.findIndex((card) => card.id === target.id);
  return {
    ...state,
    discard: { ...state.discard, cards: state.discard.cards.slice(0, targetIndex) },
    hands: withHand(state, player, remaining),
    table,
    laidPureSeri,
    phase: "discard",
    drewFrom: "discard",
    pickedFromDiscard: state.pickedFromDiscard.map((flag, seat) => (seat === player ? true : flag)),
    takenOwners: taken.map((card) => state.discardOwner[card.id]),
  };
}

export function layDownPureSeri(state: RoundState, player: PlayerId, cards: Card[]): RoundState {
  assertTurn(state, player);
  const check = classify(cards, state.jokerRank);
  // Seri murni: seri tanpa joker, atau tris As tanpa joker.
  if (!check.pure) throw new Error("NOT_PURE_SERI");
  const hand = removeCards(state.hands[player], cards);
  const laidPureSeri = state.laidPureSeri.map((flag, seat) => (seat === player ? true : flag));
  const table = state.table.map((melds, seat) => (seat === player ? [...melds, cards] : melds));
  return { ...state, hands: withHand(state, player, hand), laidPureSeri, table };
}

// Membuang satu kartu mengakhiri giliran. Jika sisa tangan membentuk kombinasi
// sah semua, kartu ini adalah penutup dan ronde langsung selesai.
export function discardCard(state: RoundState, player: PlayerId, card: Card): RoundState {
  assertTurn(state, player, "discard");
  const hand = removeCards(state.hands[player], [card]);
  const penalties = [...state.penalties];
  const isJoker = state.jokerRank !== null && card.rank === state.jokerRank;
  if (isJoker) penalties[player] -= JOKER_PENALTY_MULTIPLIER * baseValue(card.rank);

  const discard: DiscardPile = {
    cards: [...state.discard.cards, card],
    closedIndex: isJoker ? state.discard.cards.length : state.discard.closedIndex,
  };
  const next = {
    ...state,
    hands: withHand(state, player, hand),
    discard,
    penalties,
    discardOwner: { ...state.discardOwner, [card.id]: player },
    takenOwners: [],
  };

  const closed = checkClosed(state, player, card);
  // Hukuman cekih disimpan di result, terpisah dari penalti joker.
  if (closed) return { ...next, result: closed };
  if (state.stock.length === 0) {
    return { ...next, result: { closedBy: "stock_empty", bonus: 0, closingCard: null, cekihTarget: null, cekihPenalty: 0 } };
  }
  return {
    ...next,
    turn: ((player + 1) % NEXT_SEAT_COUNT) as PlayerId,
    phase: "draw",
    drewFrom: null,
  };
}

// Closed jika sisa tangan setelah kartu ini dibuang bisa dibagi habis menjadi kombinasi sah.
export function checkClosed(state: RoundState, player: PlayerId, card: Card): RoundResult | null {
  const rest = removeCards(state.hands[player], [card]);
  if (!canPartition(rest, state.jokerRank)) return null;
  // Menutup (tutup atau tutup tangan) harus punya seri murni: sudah diturunkan, atau ada di tangan.
  if (!state.laidPureSeri[player] && !hasPureSeri(rest, state.jokerRank)) return null;
  // Tutup tangan: tidak pernah mengambil dari buangan di ronde ini. Bonus 250, tanpa efek cekih.
  if (!state.pickedFromDiscard[player]) {
    return { closedBy: player, bonus: CLOSED_FROM_STOCK_BONUS, closingCard: card, cekihTarget: null, cekihPenalty: 0 };
  }
  // Tutup biasa: bonus dan hukuman hanya lewat cekih yang cocok.
  const target = matchingCekihTarget(state, player);
  if (target === null) {
    return { closedBy: player, bonus: 0, closingCard: card, cekihTarget: null, cekihPenalty: 0 };
  }
  const amount = CEKIH_MULTIPLIER * baseValue(card.rank);
  return { closedBy: player, bonus: amount, closingCard: card, cekihTarget: target, cekihPenalty: -amount };
}

// Pemain penutup harus punya cekih aktif ke pemain yang kartunya ikut diambil pada giliran ini.
// Hanya cekih milik pemain penutup yang dihitung.
function matchingCekihTarget(state: RoundState, closer: PlayerId): PlayerId | null {
  for (const { caller, target } of state.cekih) {
    if (caller === closer && state.takenOwners.includes(target)) return target;
  }
  return null;
}

function assertTurn(state: RoundState, player: PlayerId, phase?: "draw" | "discard"): void {
  if (state.result !== null) throw new Error("ROUND_OVER");
  if (state.turn !== player) throw new Error("NOT_YOUR_TURN");
  if (phase !== undefined && state.phase !== phase) throw new Error("WRONG_PHASE");
}

function withHand(state: RoundState, player: PlayerId, hand: Card[]): Card[][] {
  return state.hands.map((h, seat) => (seat === player ? hand : h));
}


// Apakah kartu ini bisa dibagi menjadi kombinasi sah (3–4 kartu) semuanya.
