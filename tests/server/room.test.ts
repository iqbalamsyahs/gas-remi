import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRoom, Room } from "../../server/room";
import { viewFor } from "../../server/view";

const TIMEOUT_MS = 60_000;

function newRoom(): Room {
  // rng konstan membuat kocokan deterministik, jadi tes tidak bergantung pada urutan acak.
  return createRoom(["u0", "u1", "u2", "u3"], {
    target: 1000,
    disconnectTimeoutMs: TIMEOUT_MS,
    rng: () => 0,
  });
}

function botRoom(): Room {
  return createRoom(["u0", "bot:1", "bot:2", "bot:3"], {
    target: 1000,
    disconnectTimeoutMs: TIMEOUT_MS,
    rng: () => 0,
    botDelayMs: 10,
  });
}

function mixedRoom(): Room {
  return createRoom(["u0", "u1", "bot:3", "bot:4"], {
    target: 1000,
    disconnectTimeoutMs: TIMEOUT_MS,
    rng: () => 0,
    botDelayMs: 10,
  });
}

function waitingRoom(): Room {
  return createRoom(["u0", "", "", ""], {
    target: 1000,
    disconnectTimeoutMs: TIMEOUT_MS,
    rng: () => 0,
    botDelayMs: 10,
  });
}

// Maju waktu sambil menjalankan tick, seperti alarm Durable Object yang dipanggil saat tiba waktunya.
function advance(room: Room, ms: number): void {
  for (let t = 0; t < ms; t += 10) {
    vi.advanceTimersByTime(10);
    room.tick();
  }
}

// Mainkan seluruh pembukaan: tiap pemain mengambil lalu membuang kartu dengan angka unik.
function playOpening(room: Room): void {
  for (let seat = 0; seat < 4; seat++) {
    const p = seat as 0 | 1 | 2 | 3;
    room.handle(p, { type: "opening_draw" });
    const board = room.board()!;
    const used = new Set(board.discard.cards.map((card) => card.rank));
    const pick = viewFor(room, p).hand.find((card) => !used.has(card.rank))!;
    room.handle(p, { type: "opening_discard", cardId: pick.id });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("viewFor hides other hands", () => {
  const room = newRoom();
  const view = viewFor(room, 0);
  expect(view.hand.length).toBe(7);
  expect(view.hand.every((card) => typeof card.id === "string")).toBe(true);
  expect(view.handCounts).toEqual([7, 7, 7, 7]);
});

test("viewFor hides stock contents", () => {
  const room = newRoom();
  const view = viewFor(room, 0);
  expect(view.board!.stockCount).toBe(24);
  expect(view.board).not.toHaveProperty("stock");
});

test("out-of-turn intent is refused", () => {
  const room = newRoom();
  expect(() => room.handle(2, { type: "opening_draw" })).toThrow("NOT_YOUR_TURN");
});

test("unknown card id is refused", () => {
  const room = newRoom();
  room.handle(0, { type: "opening_draw" });
  expect(() => room.handle(0, { type: "opening_discard", cardId: "ZZ" })).toThrow("CARD_NOT_IN_HAND");
});

test("a disconnected player pauses the round", () => {
  const room = newRoom();
  room.disconnect(1);
  expect(room.status).toBe("paused");
  expect(room.pausedSeat).toBe(1);
  expect(() => room.handle(0, { type: "opening_draw" })).toThrow("PAUSED");
});

test("reconnecting within timeout resumes the round", () => {
  const room = newRoom();
  room.disconnect(1);
  advance(room, TIMEOUT_MS - 1000);
  room.connect(1);
  expect(room.status).toBe("opening");
  expect(room.pausedSeat).toBeNull();
  expect(() => room.handle(0, { type: "opening_draw" })).not.toThrow();
});

test("timeout hands the disconnected seat to a bot and play continues", () => {
  const room = newRoom();
  room.disconnect(1);
  advance(room, TIMEOUT_MS + 100);
  expect(room.status).toBe("opening");
  expect(room.pausedSeat).toBeNull();
  expect(room.seats[1]).toBe("bot:2");
});

test("a bot that just took over waits 10 seconds before its first move", () => {
  const room = mixedRoom();
  room.leave(0);
  advance(room, 9_000);
  expect(room.board()!.discard.cards.length).toBe(0);
  advance(room, 1_100);
  expect(room.board()!.discard.cards.length).toBeGreaterThan(0);
});

test("a spectator who sits during the handover delay keeps the bot from moving", () => {
  const room = mixedRoom();
  room.leave(0);
  advance(room, 5_000);
  expect(room.sit("u9")).toBe(0);
  advance(room, 10_000);
  expect(room.board()!.hands[0].length).toBe(7);
  expect(room.board()!.discard.cards.length).toBe(0);
});

test("sitting in a bot seat whose move is already scheduled stops that move", () => {
  // Pembukaan: u0 selesai, giliran bot:2 dijadwalkan 10 ms lagi. Penonton duduk sebelum itu.
  const room = botRoom();
  room.handle(0, { type: "opening_draw" });
  room.handle(0, { type: "opening_discard", cardId: viewFor(room, 0).hand[0].id });
  expect(room.sit("u9")).toBe(1);
  advance(room, 200);
  expect(room.board()!.discard.cards.length).toBe(1);
  expect(room.board()!.turn).toBe(1);
});

test("a table with no human seats does not run bots", () => {
  const room = mixedRoom();
  room.leave(0);
  room.leave(1);
  expect(room.nextDeadline()).toBeNull();
  // Penonton duduk di kursi 1 (giliran pembukaan), lalu menyelesaikan gilirannya: bot kursi 2 dijadwalkan lagi.
  expect(room.sit("u9")).toBe(0);
  room.handle(0, { type: "opening_draw" });
  room.handle(0, { type: "opening_discard", cardId: viewFor(room, 0).hand[0].id });
  expect(room.nextDeadline()).not.toBeNull();
});

test("an old snapshot without handoverUntil restores and leave still works", () => {
  const snapshot = JSON.parse(JSON.stringify(newRoom().snapshot()));
  delete snapshot.handoverUntil;
  const room = Room.restore(snapshot, { target: 1000, disconnectTimeoutMs: TIMEOUT_MS, rng: () => 0 });
  room.leave(3);
  expect(room.seats[3]).toBe("bot:4");
});

test("nextDeadline points at the pause timeout while paused", () => {
  const room = newRoom();
  const before = Date.now();
  room.disconnect(1);
  expect(room.nextDeadline()).toBe(before + TIMEOUT_MS);
});

test("finished opening starts play with the first player", () => {
  const room = newRoom();
  playOpening(room);
  expect(room.status).toBe("playing");
  expect(room.board()!.turn).toBe(0);
  expect(room.board()!.phase).toBe("draw");
});

test("room state survives a JSON round trip", () => {
  const room = newRoom();
  room.handle(0, { type: "opening_draw" });
  const stored = JSON.parse(JSON.stringify(room.snapshot()));
  const restored = Room.restore(stored, {
    target: 1000,
    disconnectTimeoutMs: TIMEOUT_MS,
    rng: () => 0,
  });
  expect(restored.board()).toEqual(room.board());
  expect(() => restored.handle(0, { type: "opening_discard", cardId: viewFor(restored, 0).hand[0].id })).not.toThrow();
});

test("bots complete the opening after the human", () => {
  const room = botRoom();
  room.handle(0, { type: "opening_draw" });
  const card = viewFor(room, 0).hand[0];
  room.handle(0, { type: "opening_discard", cardId: card.id });
  advance(room, 200);
  expect(room.status).toBe("playing");
  expect(room.board()!.turn).toBe(0);
});

// Bot hanya ambil dari cangkulan dan tidak pernah turun ke meja, jadi skornya tidak pernah
// mencapai target. Tes ini memastikan ronde terus berjalan (tidak macet), bukan sampai ada pemenang.
// Bot memakai strategi lengkap (ambil, turunkan, cekih, tutup), jadi ronde berakhir lebih cepat.
// Tes ini memastikan ronde terus berjalan dan tidak macet, bukan sampai ada pemenang.
test("an all-bot room keeps playing rounds without stalling", () => {
  const room = createRoom(["bot:1", "bot:2", "bot:3", "bot:4"], {
    target: 100_000,
    disconnectTimeoutMs: TIMEOUT_MS,
    rng: () => 0.5,
    botDelayMs: 1,
    runAllBotTables: true,
  });
  for (let step = 0; step < 20_000 && room.session.rounds < 5; step++) {
    vi.advanceTimersByTime(1);
    room.tick();
  }
  expect(["opening", "playing", "scoring"]).toContain(room.status);
  expect(room.session.rounds).toBeGreaterThanOrEqual(5);
}, 120_000);

test("bots take their turns and hand the turn back", () => {
  const room = botRoom();
  room.handle(0, { type: "opening_draw" });
  room.handle(0, { type: "opening_discard", cardId: viewFor(room, 0).hand[0].id });
  advance(room, 200);
  room.handle(0, { type: "draw_stock" });
  room.handle(0, { type: "discard", cardId: viewFor(room, 0).hand[0].id });
  advance(room, 200);
  expect(room.board()!.turn).toBe(0);
  expect(room.board()!.phase).toBe("draw");
});

test("joker is determined as soon as the first round ends", () => {
  const room = newRoom();
  playOpening(room);
  expect(room.board()!.jokerRank).not.toBeNull();
  expect(room.board()!.stock.length).toBe(19);
});

test("target can be set before the first round and is refused outside the range", () => {
  const room = newRoom();
  room.handle(0, { type: "set_target", target: 500 });
  expect(room.session.target).toBe(500);
  expect(() => room.handle(0, { type: "set_target", target: 99 })).toThrow("INVALID_TARGET");
  expect(() => room.handle(0, { type: "set_target", target: 5001 })).toThrow("INVALID_TARGET");
});

test("target locks after a round and each round is recorded in history", () => {
  const room = createRoom(["bot:1", "bot:2", "bot:3", "bot:4"], {
    target: 1000,
    disconnectTimeoutMs: TIMEOUT_MS,
    rng: () => 0.5,
    botDelayMs: 1,
    runAllBotTables: true,
  });
  for (let step = 0; step < 5_000 && room.session.rounds === 0; step++) {
    vi.advanceTimersByTime(1);
    room.tick();
  }
  expect(room.session.rounds).toBeGreaterThan(0);
  expect(room.history.length).toBe(room.session.rounds);
  expect(room.history[0].scores).toHaveLength(4);
  expect(() => room.handle(0, { type: "set_target", target: 500 })).toThrow("TARGET_LOCKED");
});

test("room waits for seats, bots fill empty seats, and play starts when full", () => {
  const room = createRoom(["u0", "", "", ""], {
    target: 1000,
    disconnectTimeoutMs: TIMEOUT_MS,
    rng: () => 0,
  });
  expect(room.status).toBe("waiting");
  expect(() => room.handle(0, { type: "opening_draw" })).toThrow("ROOM_NOT_STARTED");
  room.handle(0, { type: "add_bots" });
  expect(room.status).toBe("opening");
  expect(room.seats).toEqual(["u0", "bot:2", "bot:3", "bot:4"]);
});

test("a player joining a waiting room takes an empty seat", () => {
  const room = waitingRoom();
  expect(room.sit("u1")).toBe(1);
  expect(room.status).toBe("waiting");
  room.sit("u2");
  room.sit("u3");
  expect(room.status).toBe("opening");
});

test("sit takes a bot seat once the table is full, and refuses when all seats are human", () => {
  const room = waitingRoom();
  room.sit("u1");
  room.handle(0, { type: "add_bots" });
  expect(room.seats).toEqual(["u0", "u1", "bot:3", "bot:4"]);
  expect(room.sit("u2")).toBe(2);
  expect(room.sit("u3")).toBe(3);
  expect(room.canSit()).toBe(false);
  expect(() => room.sit("u4")).toThrow("NO_SEAT");
});

test("leaving a waiting room empties the seat", () => {
  const room = waitingRoom();
  room.sit("u1");
  room.setProfile(1, { name: "U1", avatarUrl: "" });
  room.leave(1);
  expect(room.seats[1]).toBe("");
  expect(room.profiles[1]).toBeNull();
});

test("leaving during play turns the seat into a bot", () => {
  const room = newRoom();
  room.leave(2);
  expect(room.seats[2]).toBe("bot:3");
  expect(room.canSit()).toBe(true);
  expect(() => room.leave(2)).toThrow("NOT_SEATED");
});

test("the paused player leaving resumes the game", () => {
  const room = newRoom();
  room.disconnect(1);
  room.leave(1);
  expect(room.status).toBe("opening");
  expect(room.pausedSeat).toBeNull();
});

test("another seat leaving or sitting while paused keeps the pause", () => {
  const room = newRoom();
  room.disconnect(1);
  room.leave(2);
  expect(room.sit("u9")).toBe(2);
  expect(room.status).toBe("paused");
  expect(room.pausedSeat).toBe(1);
});

test("reset belongs to the first human seat", () => {
  const room = newRoom();
  expect(room.firstHumanSeat()).toBe(0);
  room.leave(0);
  expect(room.firstHumanSeat()).toBe(1);
  room.leave(1);
  room.leave(2);
  room.leave(3);
  expect(room.firstHumanSeat()).toBeNull();
});

test("view labels empty seats, bots, and humans without a profile", () => {
  const room = createRoom(["u0", "", "bot:3", "bot:4"], {
    target: 1000,
    disconnectTimeoutMs: TIMEOUT_MS,
    rng: () => 0,
  });
  const { players } = viewFor(room, 0);
  expect(players[0]).toEqual({ kind: "human", name: "Pemain", avatarUrl: null });
  expect(players[1].kind).toBe("empty");
  expect(players[2]).toEqual({ kind: "bot", name: "Bot 3", avatarUrl: "/bot-avatar.svg" });
});

test("cekih intent is refused when hand is not one card short", () => {
  const room = newRoom();
  playOpening(room);
  expect(() => room.handle(0, { type: "cekih", target: 2 })).toThrow("CEKIH_NOT_ALLOWED");
});

test("cekih_batal intent is refused when no cekih exists", () => {
  const room = newRoom();
  playOpening(room);
  expect(() => room.handle(0, { type: "cekih_batal", target: 2 })).toThrow("CEKIH_NOT_FOUND");
});

test("view exposes active cekih on the board", () => {
  const room = newRoom();
  playOpening(room);
  expect(viewFor(room, 0).board!.cekih).toEqual([]);
});

test("a spectator view carries no hand cards of anyone", () => {
  const room = newRoom();
  const view = viewFor(room, null);
  expect(view.you).toBeNull();
  expect(view.hand).toEqual([]);
  expect(view.handCounts).toEqual([7, 7, 7, 7]);
  const json = JSON.stringify(view);
  expect(room.board()!.hands.flat().some((card) => json.includes(`"${card.id}"`))).toBe(false);
});

test("view tells who may sit and who may reset", () => {
  const room = newRoom();
  expect(viewFor(room, 0).canReset).toBe(true);
  expect(viewFor(room, 1).canReset).toBe(false);
  expect(viewFor(room, null).canReset).toBe(false);
  expect(viewFor(room, null).canSit).toBe(false);
  room.leave(2);
  expect(viewFor(room, null).canSit).toBe(true);
});

test("seatOf finds a user's seat from the seats, not from a stored attachment", () => {
  const room = newRoom();
  expect(room.seatOf("u2")).toBe(2);
  expect(room.seatOf("x")).toBeNull();
  room.leave(2);
  expect(room.seatOf("u2")).toBeNull();
});

test("two players dropping: both seats go to bots after the timeout and play resumes", () => {
  const room = newRoom();
  room.disconnect(1);
  room.disconnect(2);
  advance(room, TIMEOUT_MS + 100);
  expect(room.seats[1]).toBe("bot:2");
  expect(room.seats[2]).toBe("bot:3");
  expect(room.status).toBe("opening");
});

test("one of two dropped players returning keeps the pause for the other", () => {
  const room = newRoom();
  room.disconnect(1);
  room.disconnect(2);
  room.connect(1);
  expect(room.status).toBe("paused");
  expect(room.pausedSeat).toBe(2);
  room.connect(2);
  expect(room.status).toBe("opening");
});

test("a player dropping from a waiting room loses the seat only after the timeout", () => {
  const room = waitingRoom();
  room.sit("u1");
  room.disconnect(1);
  advance(room, TIMEOUT_MS - 1000);
  expect(room.seats[1]).toBe("u1");
  advance(room, 2000);
  expect(room.seats[1]).toBe("");
});

test("starting the game while a seated player is offline pauses for them", () => {
  const room = waitingRoom();
  room.sit("u1");
  room.disconnect(1);
  room.handle(0, { type: "add_bots" });
  expect(room.status).toBe("paused");
  expect(room.pausedSeat).toBe(1);
});

test("an old paused snapshot without offline times still times out to a bot", () => {
  const room = newRoom();
  room.disconnect(1);
  const snapshot = JSON.parse(JSON.stringify(room.snapshot()));
  delete snapshot.offlineSince;
  snapshot.pausedAt = Date.now();
  const restored = Room.restore(snapshot, { target: 1000, disconnectTimeoutMs: TIMEOUT_MS, rng: () => 0 });
  advance(restored, TIMEOUT_MS + 100);
  expect(restored.seats[1]).toBe("bot:2");
  expect(restored.status).toBe("opening");
});

test("with no human seated, a spectator may reset so the table cannot get stuck", () => {
  const room = newRoom();
  expect(room.canReset(0)).toBe(true);
  expect(room.canReset(null)).toBe(false);
  [0, 1, 2, 3].forEach((seat) => room.leave(seat as 0 | 1 | 2 | 3));
  expect(room.canReset(null)).toBe(true);
  expect(viewFor(room, null).canReset).toBe(true);
});

test("the room master continues a game: totals are set and the highest total plays first", () => {
  const room = newRoom();
  expect(() => room.handle(1, { type: "set_totals", totals: [100, 400, 200, 0] })).toThrow("TOTALS_LOCKED");
  room.handle(0, { type: "set_totals", totals: [100, 400, 200, 0] });
  expect(room.session.totals).toEqual([100, 400, 200, 0]);
  expect(room.board()!.turn).toBe(1);
});

test("totals are locked once someone has drawn in the opening", () => {
  const room = newRoom();
  room.handle(0, { type: "opening_draw" });
  expect(() => room.handle(0, { type: "set_totals", totals: [100, 0, 0, 0] })).toThrow("TOTALS_LOCKED");
});

test("totals must be four whole numbers", () => {
  const room = newRoom();
  expect(() => room.handle(0, { type: "set_totals", totals: [1.5, 0, 0, 0] })).toThrow("INVALID_TOTALS");
  expect(() => room.handle(0, { type: "set_totals", totals: [0, 0, 0] })).toThrow("INVALID_TOTALS");
});
