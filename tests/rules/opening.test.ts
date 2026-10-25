import { expect, test } from "vitest";
import { makeDeck, type Card, type Rank } from "../../src/rules/cards";
import { deal } from "../../src/rules/deal";
import {
  openingDiscard,
  openingDraw,
  resolveJoker,
  type OpeningState,
} from "../../src/rules/opening";

function c(id: string): Card {
  return { id, rank: id.slice(0, -1) as Rank, suit: id.slice(-1) as Card["suit"] };
}

function state(hands: Card[][], stock: Card[]): OpeningState {
  return {
    hands,
    stock,
    discard: { cards: [], closedIndex: null },
    jokerRank: null,
    penalties: [0, 0, 0, 0],
  };
}

test("first-round discards must differ in rank", () => {
  // Pemain 0 membuang J, lalu pemain 1 mencoba membuang J juga.
  let s = state(
    [
      ["2S", "3S", "4S", "5S", "6S", "7S", "8S"].map(c),
      ["2H", "3H", "4H", "5H", "6H", "7H", "8H"].map(c),
      ["2D", "3D", "4D", "5D", "6D", "7D", "8D"].map(c),
      ["9S", "10S", "QS", "KS", "AS", "9H", "10H"].map(c),
    ],
    [c("JS"), c("JH"), c("6C"), c("7C"), c("8C")],
  );
  s = openingDiscard(openingDraw(s, 0), 0, c("JS"));
  expect(() => openingDiscard(openingDraw(s, 1), 1, c("JH"))).toThrow("DUPLICATE_OPENING_RANK");
});

test("penentu is removed and the other three of its rank become jokers", () => {
  // Mainkan putaran pembukaan penuh dari dek urut, dengan pilihan buang yang rankya unik.
  const deck = makeDeck();
  const { hands, stock } = deal(deck);
  let s = state(hands, stock);
  for (let p = 0; p < 4; p++) {
    s = openingDraw(s, p as 0 | 1 | 2 | 3);
    const used = new Set(s.discard.cards.map((card) => card.rank));
    const pick = s.hands[p].find((card) => !used.has(card.rank));
    s = openingDiscard(s, p as 0 | 1 | 2 | 3, pick!);
  }
  const before = s.stock.length;
  s = resolveJoker(s, () => 0);
  expect(s.jokerRank).not.toBeNull();
  expect(s.stock.length).toBe(before - 1);
  const everywhere = [...s.hands.flat(), ...s.stock, ...s.discard.cards];
  expect(everywhere.filter((card) => card.rank === s.jokerRank).length).toBe(3);
});

test("stock has 19 cards after opening", () => {
  const { hands, stock } = deal(makeDeck());
  let s = state(hands, stock);
  for (let p = 0; p < 4; p++) {
    s = openingDraw(s, p as 0 | 1 | 2 | 3);
    const used = new Set(s.discard.cards.map((card) => card.rank));
    const pick = s.hands[p].find((card) => !used.has(card.rank));
    s = openingDiscard(s, p as 0 | 1 | 2 | 3, pick!);
  }
  s = resolveJoker(s, () => 0);
  expect(s.stock.length).toBe(19);
});

test("joker discarded in opening penalizes discarder", () => {
  // Urutan buangan: 0=J, 1=10, 2=Q, 3=3. Penentu yang keluar adalah 10 (rank 10 jadi joker).
  const s: OpeningState = {
    hands: [[], [], [], []],
    stock: [c("10D"), c("9C")],
    discard: { cards: [c("JS"), c("10H"), c("QD"), c("3C")], closedIndex: null },
    jokerRank: null,
    penalties: [0, 0, 0, 0],
  };
  const out = resolveJoker(s, () => 0);
  expect(out.jokerRank).toBe("10");
  expect(out.penalties[1]).toBe(-50);
  expect(out.discard.closedIndex).toBe(1);
});

test("opening joker penalty goes to the seat that discarded it, not the discard position", () => {
  // Pemain pertama kursi 1. Buangan ke-2 (10H) dibuang kursi 2.
  const s: OpeningState = {
    hands: [[], [], [], []],
    stock: [c("10D"), c("KH")],
    discard: { cards: [c("JS"), c("10H"), c("QD"), c("3C")], closedIndex: null },
    jokerRank: null,
    penalties: [0, 0, 0, 0],
  };
  const out = resolveJoker(s, () => 0, 1);
  expect(out.penalties).toEqual([0, 0, -50, 0]);
});

test("discarded joker leaves two jokers in play", () => {
  // Penentu 10D keluar dari cangkulan (rng 0.5 memilih indeks 1). 10H dibuang di putaran pertama,
  // jadi tinggal 10S dan 10C yang masih bermain.
  const s: OpeningState = {
    hands: [[c("10S")], [c("10C")], [], []],
    stock: [c("9C"), c("10D"), c("KH")],
    discard: { cards: [c("JS"), c("10H"), c("QD"), c("3C")], closedIndex: null },
    jokerRank: null,
    penalties: [0, 0, 0, 0],
  };
  const out = resolveJoker(s, () => 0.5);
  expect(out.jokerRank).toBe("10");
  expect(out.stock.some((card) => card.id === "10D")).toBe(false);
  const jokersInPlay = [...out.hands.flat(), ...out.stock].filter((card) => card.rank === "10");
  expect(jokersInPlay.length).toBe(2);
});
