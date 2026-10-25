import { expect, test } from "vitest";
import type { Card, Rank } from "../../src/rules/cards";
import { chooseBotPlay } from "../../src/rules/bot";
import type { RoundState } from "../../src/rules/turn";

function c(id: string): Card {
  return { id, rank: id.slice(0, -1) as Rank, suit: id.slice(-1) as Card["suit"] };
}

function round(over: Partial<RoundState> = {}): RoundState {
  return {
    hands: [[], [], [], []],
    stock: [c("2C"), c("3C")],
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

test("bot takes a discard that completes a pure seri", () => {
  const s = round({
    hands: [["2H", "3H", "9S", "KD", "7C", "6D", "QC"].map(c), [], [], []],
    discard: { cards: [c("5C"), c("4H")], closedIndex: null },
  });
  const intent = chooseBotPlay(s, 0);
  expect(intent.type).toBe("pickup");
  expect(intent).toMatchObject({ targetId: "4H" });
});

test("bot lays down a pure seri in the discard phase", () => {
  const s = round({
    hands: [["2H", "3H", "4H", "KD", "QC", "7S", "9D"].map(c), [], [], []],
    phase: "discard",
    drewFrom: "stock",
  });
  const intent = chooseBotPlay(s, 0);
  expect(intent.type).toBe("lay_down");
  expect([...(intent as { cardIds: string[] }).cardIds].sort()).toEqual(["2H", "3H", "4H"]);
});

test("bot calls cekih when one card short and the seri is already laid", () => {
  const s = round({
    hands: [["2H", "3H", "4H", "9S", "9C", "9D", "8H", "8S"].map(c), [], [], []],
    phase: "discard",
    drewFrom: "stock",
    laidPureSeri: [true, false, false, false],
  });
  expect(chooseBotPlay(s, 0)).toEqual({ type: "cekih", target: 3 });
});

test("bot discards the highest non-joker leftover when it cannot close", () => {
  const s = round({
    hands: [["2H", "7C", "KD", "AS", "5D", "9S", "3C", "QH"].map(c), [], [], []],
    jokerRank: "9",
    phase: "discard",
    drewFrom: "stock",
    laidPureSeri: [true, false, false, false],
  });
  expect(chooseBotPlay(s, 0)).toEqual({ type: "discard", cardId: "AS" });
});

test("bot discards a spare joker for free after drawing the last stock card", () => {
  const s = round({
    hands: [["2H", "7C", "KD", "AS", "5D", "9S", "3C", "QH"].map(c), [], [], []],
    jokerRank: "9",
    phase: "discard",
    drewFrom: "stock",
    stock: [],
    laidPureSeri: [true, false, false, false],
  });
  expect(chooseBotPlay(s, 0)).toEqual({ type: "discard", cardId: "9S" });
});

test("bot closes by discarding the card that leaves a complete hand", () => {
  const s = round({
    hands: [["2H", "3H", "4H", "9S", "9C", "9D", "KD", "8S"].map(c), [], [], []],
    phase: "discard",
    drewFrom: "stock",
    laidPureSeri: [true, false, false, false],
  });
  expect(chooseBotPlay(s, 0)).toEqual({ type: "discard", cardId: "KD" });
});
