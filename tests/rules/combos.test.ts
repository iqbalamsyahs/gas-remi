import { expect, test } from "vitest";
import type { Card, Rank } from "../../src/rules/cards";
import { classify, orderMeld } from "../../src/rules/combos";

function c(id: string): Card {
  return { id, rank: id.slice(0, -1) as Rank, suit: id.slice(-1) as Card["suit"] };
}

test("seri 3-4-5 same suit is valid and pure", () => {
  const r = classify([c("3H"), c("4H"), c("5H")], null);
  expect(r.kind).toBe("seri");
  expect(r.pure).toBe(true);
});

test("seri across ranges is invalid", () => {
  const r = classify([c("9C"), c("10C"), c("JC")], null);
  expect(r.kind).toBe("invalid");
});

test("As cannot be in a seri", () => {
  const r = classify([c("QD"), c("KD"), c("AD")], null);
  expect(r.kind).toBe("invalid");
});

test("tris of 8s is valid and not pure", () => {
  const r = classify([c("8S"), c("8H"), c("8D")], "5");
  expect(r.kind).toBe("tris");
  expect(r.pure).toBe(false);
});

test("tris of As with no joker is pure", () => {
  const r = classify([c("AS"), c("AH"), c("AD")], null);
  expect(r.kind).toBe("tris");
  expect(r.pure).toBe(true);
});

test("tris of Ks is never pure", () => {
  const r = classify([c("KS"), c("KH"), c("KD")], null);
  expect(r.kind).toBe("tris");
  expect(r.pure).toBe(false);
});

test("joker fills a seri gap and takes the value of the card it replaces", () => {
  const r = classify([c("4H"), c("5H"), c("6D")], "6");
  expect(r.kind).toBe("seri");
  expect(r.pure).toBe(false);
  expect(r.values).toEqual([5, 5, 5]);
});

test("joker cannot be used as its own real card", () => {
  const r = classify([c("4H"), c("5H"), c("6H")], "5");
  expect(r.kind).toBe("seri");
  expect(r.pure).toBe(false);
});

test("three jokers of one rank cannot form a tris", () => {
  const r = classify([c("10S"), c("10H"), c("10D")], "10");
  expect(r.kind).toBe("invalid");
});

test("orderMeld sorts a seri and puts the joker where it fills in", () => {
  const ids = (cards: Card[]) => cards.map((card) => card.id);
  expect(ids(orderMeld([c("7D"), c("AC"), c("10D"), c("8D")], "A"))).toEqual(["7D", "8D", "AC", "10D"]);
  expect(ids(orderMeld([c("5S"), c("8S"), c("8H")], "5"))).toEqual(["8S", "8H", "5S"]);
});
