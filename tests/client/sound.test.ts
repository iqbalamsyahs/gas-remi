import { expect, test } from "vitest";
import { soundsFor } from "../../src/client/sound";
import type { PlayerView, PublicBoard } from "../../server/view";

function view(over: Partial<PlayerView> = {}, board: Partial<PublicBoard> = {}): PlayerView {
  return {
    status: "playing",
    you: 0,
    board: {
      jokerRank: "5",
      stockCount: 19,
      discard: { cards: [], closedIndex: null },
      table: [[], [], [], []],
      turn: 1,
      cekih: [],
      ...board,
    },
    ...over,
  } as unknown as PlayerView;
}

test("no sounds on the first view", () => {
  expect(soundsFor(null, view())).toEqual([]);
});

test("the turn passing to you plays the turn sound instead of the card tick", () => {
  // Pemain sebelumnya membuang kartu (buangan bertambah) dan giliran pindah ke kamu.
  const before = view({}, { turn: 3 });
  const after = view({}, { turn: 0, discard: { cards: [{ id: "9H", rank: "9", suit: "H" }], closedIndex: null } });
  expect(soundsFor(before, after)).toEqual(["turn"]);
});

test("another player's card action plays a tick", () => {
  expect(soundsFor(view({}, { turn: 1 }), view({}, { turn: 1, stockCount: 18 }))).toEqual(["card"]);
});

test("nothing changed: no sound", () => {
  const v = view();
  expect(soundsFor(v, v)).toEqual([]);
});

test("joker determined, round over, and game over each have a sound", () => {
  expect(soundsFor(view({ status: "opening" }, { jokerRank: null, turn: 1 }), view({}, { turn: 1 }))).toEqual(["joker"]);
  expect(soundsFor(view(), view({ status: "scoring" }))).toEqual(["round"]);
  expect(soundsFor(view({ status: "scoring" }), view({ status: "finished" }))).toEqual(["win"]);
});

test("a new cekih at you plays the warning, a cekih at someone else does not", () => {
  expect(soundsFor(view(), view({}, { cekih: [{ caller: 3, target: 0 }] }))).toEqual(["cekih"]);
  expect(soundsFor(view(), view({}, { cekih: [{ caller: 3, target: 2 }] }))).toEqual([]);
});

test("a spectator never gets the turn or cekih sound", () => {
  const before = view({ you: null }, { turn: 3 });
  const after = view({ you: null }, { turn: 0, cekih: [{ caller: 3, target: 0 }], stockCount: 18 });
  expect(soundsFor(before, after)).toEqual(["card"]);
});
