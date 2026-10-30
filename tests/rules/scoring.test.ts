import { expect, test } from "vitest";
import type { Card, Rank } from "../../src/rules/cards";
import { canUseMelds, handArrangement, scoreRound, seatScore, validateArrangement } from "../../src/rules/scoring";
import type { RoundState } from "../../src/rules/turn";

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
    phase: "discard",
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

test("valid cards add base value", () => {
  // Seri 3H 4H 5H di meja: 5 + 5 + 5 = 15.
  const s = round({ table: [[[c("3H"), c("4H"), c("5H")]], [], [], []] });
  expect(scoreRound(s)[0]).toBe(15);
});

test("non-combo cards subtract base value", () => {
  const s = round({ hands: [[c("KS")], [], [], []] });
  expect(scoreRound(s)[0]).toBe(-10);
});

test("joker in combo counts as the card it replaces", () => {
  // Seri 4H 5H + joker (berdiri untuk 6): 5 + 5 + 5 = 15.
  // Kombinasi joker plus hanya setelah seri murni diturunkan (laidPureSeri).
  const s = round({ hands: [[c("4H"), c("5H"), c("6D")], [], [], []], jokerRank: "6", laidPureSeri: [true, false, false, false] });
  expect(scoreRound(s)[0]).toBe(15);
});

test("leftover joker in hand is minus 10x", () => {
  const s = round({ hands: [[c("KS")], [], [], []], jokerRank: "K" });
  expect(scoreRound(s)[0]).toBe(-100);
});

test("closed bonus is added to the closer only", () => {
  const s = round({ result: { closedBy: 2, bonus: 250, closingCard: c("KC"), cekihTarget: null, cekihPenalty: 0, fromHand: true } });
  expect(scoreRound(s)).toEqual([0, 0, 250, 0]);
});

test("score may be negative", () => {
  const s = round({ hands: [[c("2C"), c("3D")], [], [], []] });
  expect(scoreRound(s)[0]).toBe(-10);
});

test("round penalties are included", () => {
  const s = round({ penalties: [-50, 0, 0, 0] });
  expect(scoreRound(s)[0]).toBe(-50);
});

test("validateArrangement accepts a legal split and returns the rest as leftover", () => {
  const hand = [c("2H"), c("3H"), c("4H"), c("9S")];
  const out = validateArrangement(hand, [[c("2H"), c("3H"), c("4H")]], null);
  expect(out).not.toBeNull();
  expect(out!.leftover.map((card) => card.id)).toEqual(["9S"]);
});

test("validateArrangement rejects invalid melds, duplicates, and foreign cards", () => {
  const hand = [c("2H"), c("3H"), c("4H"), c("9S")];
  expect(validateArrangement(hand, [[c("2H"), c("3H")]], null)).toBeNull();
  expect(validateArrangement(hand, [[c("2H"), c("3H"), c("4H")], [c("4H"), c("9S"), c("8S")]], null)).toBeNull();
  expect(validateArrangement(hand, [[c("2H"), c("3H"), c("5H")]], null)).toBeNull();
});

test("seatScore with the automatic arrangement matches scoreRound", () => {
  const s = round({
    hands: [[c("2H"), c("3H"), c("4H"), c("9S")], [], [], []],
    table: [[[c("7C"), c("7D"), c("7S")]], [], [], []],
  });
  const auto = handArrangement(s.hands[0], s.jokerRank, s.laidPureSeri[0]);
  expect(seatScore(s, 0, auto)).toBe(scoreRound(s)[0]);
});

test("joker meld in hand counts minus without a pure seri laid this round", () => {
  // Joker = 5. 3H 4H 5C (5C joker) adalah seri 3-4-5 dengan joker. Tanpa seri murni, semuanya minus.
  const hand = ["3H", "4H", "5C"].map(c);
  const without = round({ jokerRank: "5", hands: [hand, [], [], []], laidPureSeri: [false, false, false, false] });
  expect(scoreRound(without)[0]).toBe(-5 - 5 - 50);
});

test("joker meld in hand counts plus once a pure seri is laid this round", () => {
  const hand = ["3H", "4H", "5C"].map(c);
  const withPure = round({ jokerRank: "5", hands: [hand, [], [], []], laidPureSeri: [true, false, false, false] });
  expect(scoreRound(withPure)[0]).toBe(15);
});

test("tris in hand counts minus without a pure seri", () => {
  // 8S 8C 8D tanpa seri murni (di meja maupun di tangan): semua kartu minus.
  const hand = ["8S", "8C", "8D"].map(c);
  const s = round({ hands: [hand, [], [], []] });
  expect(scoreRound(s)[0]).toBe(-15);
  expect(handArrangement(hand, null, false).melds).toEqual([]);
});

test("cekih penalty is scored for the target, separate from joker penalties", () => {
  const s = round({
    result: { closedBy: 0, bonus: 100, closingCard: c("KD"), cekihTarget: 2, cekihPenalty: -100, fromHand: false },
    pickedFromDiscard: [true, false, false, false],
  });
  expect(scoreRound(s)).toEqual([100, 0, -100, 0]);
  expect(s.penalties).toEqual([0, 0, 0, 0]);
});

test("pure seri in hand counts plus", () => {
  const hand = ["3H", "4H", "5H"].map(c);
  const s = round({ jokerRank: "9", hands: [hand, [], [], []], laidPureSeri: [false, false, false, false] });
  expect(scoreRound(s)[0]).toBe(15);
});

test("joker meld counts plus when the hand holds a pure seri, without laying it down", () => {
  // Joker = 5. Tangan punya seri murni 2S 3S 4S (15) dan kombinasi joker 3H 4H 5C (15). Keduanya plus.
  const hand = ["2S", "3S", "4S", "3H", "4H", "5C"].map(c);
  const s = round({ jokerRank: "5", hands: [hand, [], [], []], laidPureSeri: [false, false, false, false] });
  expect(scoreRound(s)[0]).toBe(30);
});

test("tutup tangan: the closer gets 250 and everyone else gets 0, no card scoring", () => {
  // Tutup dari cangkulan saja (tidak pernah mengambil dari buangan): hanya +250 untuk penutup.
  const s = round({
    hands: [[c("2H"), c("3H"), c("4H"), c("KS")], [c("7C"), c("KD")], [], []],
    result: { closedBy: 0, bonus: 250, closingCard: c("KS"), cekihTarget: null, cekihPenalty: 0, fromHand: true },
    pickedFromDiscard: [false, false, false, false],
    penalties: [0, -50, 0, 0],
  });
  // Penalti joker yang dibuang tetap berlaku walaupun ada yang tutup tangan.
  expect(scoreRound(s)).toEqual([250, -50, 0, 0]);
});

test("the arrangement prefers a pure seri over a joker seri when the joker count ties", () => {
  // Joker = 6. 7C 8C 9C adalah seri murni. 4D 4S 6D(joker) 6H(joker): 789+6 dan 44+6+6 bernilai sama,
  // tetapi susunan yang memakai seri murni 789 harus dipilih.
  const hand = ["6D", "6H", "4D", "4S", "7C", "8C", "9C"].map(c);
  const arr = handArrangement(hand, "6", true);
  expect(arr.melds.some((meld) => meld.map((card) => card.id).sort().join(",") === "7C,8C,9C")).toBe(true);
});

test("tie in score: the arrangement prefers the pure seri 2C 3C 4C 5C over a joker seri", () => {
  // Joker = K. 3S 3H 3C 2C 4C 5C KD(joker). 3S 3H K + 2C 3C 4C 5C sama-sama bernilai 35, tetapi seri murni dipilih.
  const hand = ["3S", "3H", "3C", "2C", "4C", "5C", "KD"].map(c);
  const arr = handArrangement(hand, "K", true);
  expect(arr.melds.some((meld) => meld.map((card) => card.id).sort().join(",") === "2C,3C,4C,5C")).toBe(true);
});

test("joker meld counts minus when the only pure seri borrows a card from another meld", () => {
  // Joker = A. 3H 4H 5H murni hanya kalau 3H tidak dipakai di tris 3S 3H AD. Susunan terbaik 3S 3H AD + 4H 5H AC 7H
  // tidak punya seri murni. Susunan dengan seri murni: 3H 4H 5H + 7H AC AD, 3S jadi sampah.
  const hand = ["3S", "AD", "3H", "7H", "4H", "AC", "5H"].map(c);
  const arr = handArrangement(hand, "A", false);
  expect(arr.melds.map((meld) => meld.map((card) => card.id).sort().join(","))).toEqual(["3H,4H,5H", "7H,AC,AD"]);
  expect(canUseMelds([["3S", "3H", "AD"].map(c), ["4H", "5H", "AC", "7H"].map(c)], false, "A")).toBe(false);
});
