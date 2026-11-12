import { describe, expect, test } from "vitest";
import { applyRound, nextFirstPlayer, type SessionState } from "../../src/rules/session";

function session(over: Partial<SessionState> = {}): SessionState {
  return { totals: [0, 0, 0, 0], target: 1000, rounds: 0, winner: null, ...over };
}

describe("applyRound overtake reset", () => {
  test("overtaken player resets to 0", () => {
    const state = session({ totals: [300, 250, 0, 0] });
    const next = applyRound(state, [0, 100, 0, 0]);
    // Sebelum: A=300, B=250. Sesudah tanpa reset: A=300, B=350. A tersalip.
    expect(next.totals).toEqual([0, 350, 0, 0]);
  });

  test("equal totals do not reset", () => {
    const state = session({ totals: [300, 300, 0, 0] });
    const next = applyRound(state, [0, 10, 0, 0]);
    // A tidak pernah lebih tinggi dari B sebelumnya, jadi tidak ada reset.
    expect(next.totals).toEqual([300, 310, 0, 0]);
  });

  test("equal totals after the round do not reset a player who was ahead", () => {
    const state = session({ totals: [300, 250, 0, 0] });
    const next = applyRound(state, [0, 50, 0, 0]);
    // Sekarang sama-sama 300: A tidak lagi lebih rendah, tidak ada reset.
    expect(next.totals).toEqual([300, 300, 0, 0]);
  });

  test("negative overtaken player does not reset", () => {
    const state = session({ totals: [-50, -100, 0, 0] });
    const next = applyRound(state, [0, 100, 0, 0]);
    // B=0 sekarang di atas A=-50. A tersalip, tapi skornya minus, jadi tidak direset.
    expect(next.totals).toEqual([-50, 0, 0, 0]);
  });

  test("overtaken player below 100 does not reset, at 100 does", () => {
    // A=99 tersalip B=150: di bawah 100, tidak direset.
    expect(applyRound(session({ totals: [99, 50, 0, 0] }), [0, 100, 0, 0]).totals).toEqual([99, 150, 0, 0]);
    // A=100 tersalip B=150: direset.
    expect(applyRound(session({ totals: [100, 50, 0, 0] }), [0, 100, 0, 0]).totals).toEqual([0, 150, 0, 0]);
  });
});

describe("applyRound winner and rounds", () => {
  test("increments rounds and leaves winner null below target", () => {
    const next = applyRound(session({ target: 1000 }), [10, 20, 30, 40]);
    expect(next.rounds).toBe(1);
    expect(next.winner).toBeNull();
  });

  test("player at or above target wins", () => {
    const state = session({ totals: [990, 0, 0, 0], target: 1000 });
    const next = applyRound(state, [10, 0, 0, 0]);
    expect(next.winner).toBe(0);
  });

  test("when two pass target, the higher total wins", () => {
    const state = session({ totals: [1005, 0, 1010, 0], target: 1000 });
    const next = applyRound(state, [0, 0, 0, 0]);
    expect(next.winner).toBe(2);
  });

  test("exact tie at the top goes to the lower seat", () => {
    const state = session({ totals: [1010, 0, 1010, 0], target: 1000 });
    const next = applyRound(state, [0, 0, 0, 0]);
    expect(next.winner).toBe(0);
  });
});

describe("nextFirstPlayer", () => {
  test("highest total goes first", () => {
    expect(nextFirstPlayer([300, 350, 100, 200])).toBe(1);
  });

  test("equal totals go to the lower seat", () => {
    expect(nextFirstPlayer([300, 350, 100, 350])).toBe(1);
  });
});
