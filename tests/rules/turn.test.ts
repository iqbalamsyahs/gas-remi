import { expect, test } from "vitest";
import type { Card, Rank } from "../../src/rules/cards";
import {
  discardCard,
  drawFromStock,
  layDownPureSeri,
  pickFromDiscard,
  type RoundState,
} from "../../src/rules/turn";

function c(id: string): Card {
  return { id, rank: id.slice(0, -1) as Rank, suit: id.slice(-1) as Card["suit"] };
}

function round(over: Partial<RoundState> = {}): RoundState {
  return {
    hands: [[], [], [], []],
    stock: [],
    discard: { cards: [], closedIndex: null },
    jokerRank: null,
    turn: 0,
    phase: "draw",
    drewFrom: null,
    laidPureSeri: [false, false, false, false],
    table: [[], [], [], []],
    penalties: [0, 0, 0, 0],
    result: null,
    cekih: [],
    discardOwner: {},
    pickedFromDiscard: [false, false, false, false],
    takenOwners: [],
    ...over,
  };
}

const ids = (cards: Card[]) => cards.map((card) => card.id).sort();

test("draw from stock adds one card to hand and removes it from stock", () => {
  const s = round({ hands: [[c("2H")], [], [], []], stock: [c("2D"), c("3D")] });
  const out = drawFromStock(s, 0);
  expect(out.hands[0].length).toBe(2);
  expect(out.stock.length).toBe(1);
  expect(out.phase).toBe("discard");
  expect(out.drewFrom).toBe("stock");
});

test("first pickup must form a pure seri with the picked card", () => {
  // Joker = 5. 3H 4H 5H adalah seri sah, tapi memakai joker, jadi bukan seri murni dan pengambilan pertama ditolak.
  const s = round({
    jokerRank: "5",
    hands: [[c("3H"), c("5H")], [], [], []],
    discard: { cards: [c("AD"), c("4H"), c("9C"), c("2S")], closedIndex: null },
  });
  expect(() => pickFromDiscard(s, 0, c("4H"), [c("3H"), c("5H")])).toThrow("NEED_PURE_SERI");
});

test("first pickup can form a pure seri together with the picked card", () => {
  // Contoh pengguna: 2♥ dan 3♥ di tangan, 4♥ di buangan. Seri murni 2-3-4 ♥ turun sekaligus.
  const s = round({
    hands: [[c("2H"), c("3H"), c("9S")], [], [], []],
    discard: { cards: [c("AD"), c("4H"), c("9C")], closedIndex: null },
  });
  const out = pickFromDiscard(s, 0, c("4H"), [c("2H"), c("3H")]);
  expect(out.laidPureSeri[0]).toBe(true);
  expect(out.table[0].length).toBe(1);
  expect(ids(out.table[0][0])).toEqual(["2H", "3H", "4H"]);
  expect(out.phase).toBe("discard");
});

test("lay down pure seri, then pick up from discard in the same turn", () => {
  const s = round({
    hands: [[c("6S"), c("7S"), c("8S"), c("3H"), c("5H"), c("KD"), c("2D")], [], [], []],
    discard: { cards: [c("AD"), c("4H"), c("9C"), c("2S")], closedIndex: null },
  });
  const laid = layDownPureSeri(s, 0, [c("6S"), c("7S"), c("8S")]);
  const out = pickFromDiscard(laid, 0, c("4H"), [c("3H"), c("5H")]);
  expect(ids(out.hands[0])).toEqual(["2D", "2S", "9C", "KD"]);
  expect(out.table[0].length).toBe(2);
  expect(out.discard.cards.map((card) => card.id)).toEqual(["AD"]);
  expect(out.phase).toBe("discard");
  expect(out.drewFrom).toBe("discard");
});

test("wrong player cannot act", () => {
  const s = round({ hands: [[c("2H")], [], [], []], stock: [c("2D")] });
  expect(() => drawFromStock(s, 1)).toThrow("NOT_YOUR_TURN");
});

test("discarding a joker penalizes discarder 10x and closes the pile at that card", () => {
  const s = round({
    hands: [[c("2C"), c("3D"), c("7S"), c("9H"), c("QC"), c("AS"), c("KS"), c("4D")], [], [], []],
    jokerRank: "K",
    phase: "discard",
    drewFrom: "stock",
    discard: { cards: [c("JD")], closedIndex: null },
    stock: [c("2D")],
  });
  const out = discardCard(s, 0, c("KS"));
  expect(out.penalties[0]).toBe(-100);
  expect(out.discard.closedIndex).toBe(1);
});

test("closed from stock gives +250", () => {
  const s = round({
    hands: [[c("3H"), c("4H"), c("5H"), c("8S"), c("8H"), c("8D"), c("8C"), c("KC")], [], [], []],
    phase: "discard",
    drewFrom: "stock",
    stock: [c("2D")],
  });
  const out = discardCard(s, 0, c("KC"));
  expect(out.result).toEqual({ closedBy: 0, bonus: 250, closingCard: c("KC"), cekihTarget: null, cekihPenalty: 0, fromHand: true });
});

test("tutup tangan with a joker as the closing card gives +500 and no joker penalty", () => {
  const s = round({
    hands: [[c("3H"), c("4H"), c("5H"), c("8S"), c("8H"), c("8D"), c("8C"), c("KC")], [], [], []],
    jokerRank: "K",
    phase: "discard",
    drewFrom: "stock",
    stock: [c("2D")],
  });
  const out = discardCard(s, 0, c("KC"));
  expect(out.result?.bonus).toBe(500);
  expect(out.penalties[0]).toBe(0);
});

test("discarding a joker after drawing the last stock card has no penalty", () => {
  const s = round({
    hands: [[c("2H"), c("KS")], [], [], []],
    jokerRank: "K",
    phase: "discard",
    drewFrom: "stock",
    stock: [],
  });
  const out = discardCard(s, 0, c("KS"));
  expect(out.penalties[0]).toBe(0);
  expect(out.result?.closedBy).toBe("stock_empty");
});

// Tutup biasa tanpa cekih: bonus 10x nilai kartu penutup.
test("closed after a discard pickup without cekih gives +10x the closing card", () => {
  const s = round({
    hands: [[c("3H"), c("4H"), c("5H"), c("8S"), c("8H"), c("8D"), c("8C"), c("KC")], [], [], []],
    phase: "discard",
    drewFrom: "discard",
    stock: [c("2D")],
    pickedFromDiscard: [true, false, false, false],
  });
  const out = discardCard(s, 0, c("KC"));
  expect(out.result?.bonus).toBe(100);
});

test("discard that empties the stock ends the round with no bonus", () => {
  const s = round({
    hands: [[c("2C"), c("3D"), c("7S"), c("9H"), c("QC"), c("AS"), c("4D"), c("6H")], [], [], []],
    phase: "discard",
    drewFrom: "stock",
    stock: [],
  });
  const out = discardCard(s, 0, c("6H"));
  expect(out.result).toEqual({ closedBy: "stock_empty", bonus: 0, closingCard: null, cekihTarget: null, cekihPenalty: 0, fromHand: false });
});

test("two aces in hand can take an ace from discard as a pure tris", () => {
  // Tris As tanpa joker dihitung seri murni, jadi boleh jadi pengambilan pertama.
  const s = round({
    hands: [[c("AS"), c("AH"), c("9S")], [], [], []],
    discard: { cards: [c("AD"), c("AC")], closedIndex: null },
  });
  const out = pickFromDiscard(s, 0, c("AD"), [c("AS"), c("AH")]);
  expect(out.laidPureSeri[0]).toBe(true);
  expect(out.table[0].length).toBe(1);
});

test("cards above the target can join the meld, the rest go to hand", () => {
  // Discard: AD (target, index 0), AC di atasnya. Keduanya masuk tris As bersama dua As di tangan.
  const s = round({
    hands: [[c("AS"), c("AH"), c("9S")], [], [], []],
    discard: { cards: [c("AD"), c("AC"), c("9C")], closedIndex: null },
  });
  const out = pickFromDiscard(s, 0, c("AD"), [c("AS"), c("AH")], [c("AC")]);
  expect(ids(out.table[0][0])).toEqual(["AC", "AD", "AH", "AS"]);
  expect(out.discard.cards.length).toBe(0);
  // 9C ikut terambil karena di atas target, tapi tidak masuk kombinasi, jadi masuk tangan.
  expect(ids(out.hands[0])).toEqual(["9C", "9S"]);
});

test("discarding records the discarder as owner of that card", () => {
  const s = round({
    hands: [[c("2H"), c("9S")], [], [], []],
    phase: "discard",
    drewFrom: "stock",
  });
  const out = discardCard(s, 0, c("9S"));
  expect(out.discardOwner["9S"]).toBe(0);
});

test("pickup marks the player and records owners of the taken cards", () => {
  const s = round({
    hands: [[c("2H"), c("3H"), c("9S")], [], [], []],
    discard: { cards: [c("AD"), c("4H"), c("9C")], closedIndex: null },
    discardOwner: { AD: 1, "4H": 2, "9C": 3 },
    laidPureSeri: [true, false, false, false],
  });
  const out = pickFromDiscard(s, 0, c("4H"), [c("2H"), c("3H")]);
  expect(out.pickedFromDiscard[0]).toBe(true);
  expect(out.takenOwners).toEqual([2, 3]);
});

test("pickup from deeper than seven cards is refused as too deep, not as blocked", () => {
  const pile = Array.from({ length: 9 }, (_, i) => c(`${i + 2}S`));
  const s = round({
    hands: [[c("QH"), c("QD"), c("3H")], [], [], []],
    discard: { cards: pile, closedIndex: null },
    laidPureSeri: [true, false, false, false],
  });
  expect(() => pickFromDiscard(s, 0, c("2S"), [c("QH"), c("QD")])).toThrow("PICKUP_TOO_DEEP");
});

test("closing without any pure seri is refused", () => {
  // Joker = 9. 8H 8S 9D(joker) + KD: tris dengan joker, tanpa seri murni. Tidak boleh menutup.
  const s = round({
    hands: [[c("8H"), c("8S"), c("9D"), c("KD")], [], [], []],
    stock: [c("2C")],
    jokerRank: "9",
    phase: "discard",
    drewFrom: "stock",
  });
  expect(discardCard(s, 0, c("KD")).result).toBeNull();
});

test("closing with a pure seri in hand is allowed", () => {
  const s = round({
    hands: [[c("2H"), c("3H"), c("4H"), c("8H"), c("8S"), c("9D"), c("KD")], [], [], []],
    stock: [c("2C")],
    jokerRank: "9",
    phase: "discard",
    drewFrom: "stock",
  });
  expect(discardCard(s, 0, c("KD")).result?.closedBy).toBe(0);
});
