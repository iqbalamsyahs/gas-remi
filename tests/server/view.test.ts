import { expect, test } from "vitest";
import type { Card, Rank } from "../../src/rules/cards";
import type { Board } from "../../server/room";
import { maskDiscard, revealedCloser } from "../../server/view";

function c(id: string): Card {
  return { id, rank: id.slice(0, -1) as Rank, suit: id.slice(-1) as Card["suit"] };
}

test("discarded jokers are shown face down: only the id remains", () => {
  const out = maskDiscard([c("6S"), c("9H"), c("6D")], "6");
  expect(out[0]).toEqual({ id: "6S", hidden: true });
  expect(out[1]).toEqual(c("9H"));
  expect(out[2]).toEqual({ id: "6D", hidden: true });
});

function boardWith(closedBy: number | "stock_empty" | null): Board {
  return {
    hands: [[c("2H")], [c("7C"), c("KD")], [], [c("9S")]],
    stock: [],
    discard: { cards: [], closedIndex: null },
    jokerRank: null,
    penalties: [0, 0, 0, 0],
    table: [[], [], [], []],
    laidPureSeri: [false, false, false, false],
    turn: 0,
    phase: "discard",
    drewFrom: null,
    result: closedBy === null ? null : { closedBy, bonus: 0, closingCard: null, cekihTarget: null, cekihPenalty: 0 },
  } as unknown as Board;
}

test("on a closing, the closer's whole hand is revealed to everyone", () => {
  const revealed = revealedCloser(boardWith(1), null);
  expect(revealed).toEqual({ seat: 1, groups: [[c("7C"), c("KD")]] });
});

test("the revealed hand follows the closer's arrangement", () => {
  const arrangement = { melds: [[c("KD")]], leftover: [c("7C")] };
  const revealed = revealedCloser(boardWith(1), [arrangement, arrangement, arrangement, arrangement]);
  expect(revealed).toEqual({ seat: 1, groups: [[c("KD")], [c("7C")]] });
});

test("no reveal when the round has no closer", () => {
  expect(revealedCloser(boardWith(null), null)).toBeNull();
  expect(revealedCloser(boardWith("stock_empty"), null)).toBeNull();
});
