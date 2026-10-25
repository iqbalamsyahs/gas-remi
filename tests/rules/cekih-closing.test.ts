import { expect, test } from "vitest";
import type { Card, Rank } from "../../src/rules/cards";
import { discardCard, pickFromDiscard, type RoundState } from "../../src/rules/turn";

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

// Penutupan contoh: A (0) cekih ke C (2). C membuang 8H, D (3) membuang KD.
// A mengambil 8H dengan tris 8 (8S, 8C), KD ikut terambil dan dibuang sebagai penutup.
function closingRound(): RoundState {
  return round({
    hands: [["2H", "3H", "4H", "9S", "9C", "9D", "8S", "8C"].map(c), [], ["5C"].map(c), ["KD"].map(c)],
    discard: { cards: [c("8H"), c("KD")], closedIndex: null },
    discardOwner: { "8H": 2, KD: 3 },
    cekih: [{ caller: 0, target: 2 }],
    laidPureSeri: [true, false, false, false],
    phase: "draw",
    turn: 0,
  });
}

test("tutup biasa with cekih: closer gets the tutup bonus plus +10x cekih, target gets -10x", () => {
  const picked = pickFromDiscard(closingRound(), 0, c("8H"), [c("8S"), c("8C")], []);
  const closed = discardCard(picked, 0, c("KD"));
  expect(closed.result?.closedBy).toBe(0);
  expect(closed.result?.bonus).toBe(200);
  expect(closed.result?.cekihTarget).toBe(2);
  expect(closed.result?.cekihPenalty).toBe(-100);
  expect(closed.penalties[2]).toBe(0);
});

test("tutup biasa without taking from the target: only the tutup bonus, no cekih penalty", () => {
  const s = closingRound();
  const withoutTarget = { ...s, discardOwner: { "8H": 1, KD: 3 } as RoundState["discardOwner"] };
  const picked = pickFromDiscard(withoutTarget, 0, c("8H"), [c("8S"), c("8C")], []);
  const closed = discardCard(picked, 0, c("KD"));
  expect(closed.result?.bonus).toBe(100);
  expect(closed.result?.cekihTarget).toBeNull();
  expect(closed.penalties[2]).toBe(0);
});

test("two players cekih the same target: only the closer's cekih counts", () => {
  // A (0) dan D (3) sama-sama cekih ke C (2). D yang menutup, jadi hukuman untuk C dari kartu penutup D.
  const s = round({
    hands: [["2H", "3H", "4H", "9S", "9C", "9D", "7S"].map(c), [], ["5C"].map(c), ["8S", "8C", "2D", "3D", "4D"].map(c)],
    discard: { cards: [c("8H"), c("KD")], closedIndex: null },
    discardOwner: { "8H": 2, KD: 3 },
    cekih: [
      { caller: 0, target: 2 },
      { caller: 3, target: 2 },
    ],
    laidPureSeri: [true, false, false, true],
    turn: 3,
    phase: "draw",
  });
  const picked = pickFromDiscard(s, 3, c("8H"), [c("8S"), c("8C")], []);
  const closed = discardCard(picked, 3, c("KD"));
  expect(closed.result?.closedBy).toBe(3);
  expect(closed.result?.cekihTarget).toBe(2);
  expect(closed.result?.cekihPenalty).toBe(-100);
  expect(closed.penalties[2]).toBe(0);
});

test("closing from stock after an earlier pickup is tutup biasa: no 250 and no cekih effect", () => {
  // Pernah mengambil dari buangan di giliran sebelumnya, lalu menutup dengan kartu dari cangkulan.
  const s = round({
    hands: [["2H", "3H", "4H", "9S", "9C", "9D"].map(c), [], [], []],
    stock: [c("KD")],
    phase: "draw",
    turn: 0,
    pickedFromDiscard: [true, false, false, false],
    cekih: [{ caller: 0, target: 2 }],
    laidPureSeri: [true, false, false, false],
  });
  const drawn = { ...s, hands: [[...s.hands[0], c("KD")], [], [], []], stock: [], phase: "discard" as const, drewFrom: "stock" as const };
  const closed = discardCard(drawn, 0, c("KD"));
  expect(closed.result?.closedBy).toBe(0);
  expect(closed.result?.bonus).toBe(100);
  expect(closed.result?.fromHand).toBe(false);
  expect(closed.result?.cekihTarget).toBeNull();
});

test("a cekih target's card that only goes into the hand does not trigger cekih", () => {
  // KD milik D (3) ada di atas 8H dan ikut terambil, tapi tidak masuk kombinasi. Hanya bonus tutup.
  const s = { ...closingRound(), cekih: [{ caller: 0 as const, target: 3 as const }] };
  const picked = pickFromDiscard(s, 0, c("8H"), [c("8S"), c("8C")], []);
  const closed = discardCard(picked, 0, c("KD"));
  expect(closed.result?.cekihTarget).toBeNull();
  expect(closed.result?.bonus).toBe(100);
});
