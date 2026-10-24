# Penonton dan Pengganti Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anggota Activity bisa menonton atau memilih ikut main, dan kursi pemain yang keluar/putus diambil alih bot supaya permainan tidak berhenti.

**Architecture:** `Room` (engine meja, `server/room.ts`) mendapat method `sit`, `leave`, `canSit`, `firstHumanSeat`, jeda serah terima per kursi, dan pengganti bot saat pause habis. `viewFor` menerima kursi `null` untuk penonton. Worker menyimpan kursi `null` di attachment WebSocket untuk penonton dan meneruskan intent `sit`/`leave` ke `Room`. UI menyembunyikan aksi untuk penonton.

**Tech Stack:** TypeScript, Next.js 16 (client di `app/activity`), Cloudflare Durable Objects (`worker/worker.ts`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-spectator-design.md`

## Global Constraints

- Hanya anggota instance Activity (REST Discord) yang boleh terhubung.
- Jeda serah terima bot: **10 detik** (`HANDOVER_MS = 10_000`).
- Batas putus sebelum diganti bot: `disconnectTimeoutMs` yang sudah ada (60 detik di worker).
- Penonton tidak pernah menerima kartu tangan siapa pun.
- Kursi bot memakai ID `bot:${seat + 1}` (sama dengan `add_bots`).
- Bahasa UI dan komentar kode: Bahasa Indonesia, mengikuti gaya file yang ada.
- Opsi baru `RoomOptions.runAllBotTables?: boolean` hanya untuk tes soak (meja 4 bot); default `false` = meja tanpa manusia tidak menjalankan bot.
- Verifikasi tiap task: `pnpm test`, `pnpm lint`, `npx tsc --noEmit -p .`, dan `npx tsc --noEmit -p worker/tsconfig.json`.

## Review Focus

1. Penonton duduk di kursi bot yang langkahnya **sudah dijadwalkan** (bukan jeda serah terima): bot tidak boleh bergerak untuk manusia. → tes di Task 2.
2. Pemain lain keluar / penonton duduk **saat meja dijeda** karena kursi lain putus: jeda tetap untuk kursi yang putus. → tes di Task 1.
3. Snapshot lama di Durable Object **tanpa** `handoverUntil` tetap bisa di-restore dan `leave` berjalan. → tes di Task 2.
4. Pemain kursi 1 keluar: hak reset pindah ke manusia berikutnya; tanpa manusia, tidak ada yang bisa reset. → tes di Task 1.
5. Penonton mengirim intent selain `sit` (mis. `discard`) lewat WebSocket: ditolak `SPECTATOR`, state tidak berubah. → diperiksa manual di Task 5 (worker tidak punya unit test).

---

### Task 1: Room — duduk, keluar, dan hak reset

**Files:**
- Modify: `server/room.ts`
- Test: `tests/server/room.test.ts`

**Interfaces:**
- Produces:
  - `Room.sit(userId: string): PlayerId` — throw `"NO_SEAT"` kalau tidak ada kursi bisa diisi.
  - `Room.leave(seat: PlayerId): void` — throw `"NOT_SEATED"` kalau kursi itu bukan manusia.
  - `Room.canSit(): boolean`
  - `Room.firstHumanSeat(): PlayerId | null`
  - `Intent` bertambah `{ type: "sit" }` dan `{ type: "leave" }` (ditangani worker, bukan `Room.handle`).
  - `Room.claimBotSeat` dihapus.

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan helper dan tes ini di `tests/server/room.test.ts` (setelah `botRoom()`):

```ts
function waitingRoom(): Room {
  return createRoom(["u0", "", "", ""], {
    target: 1000,
    disconnectTimeoutMs: TIMEOUT_MS,
    rng: () => 0,
    botDelayMs: 10,
  });
}
```

Ganti tes `"a player joining a waiting room takes an empty seat"` dengan:

```ts
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
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `pnpm test tests/server/room.test.ts`
Expected: FAIL, `room.sit is not a function` / `room.leave is not a function`.

- [ ] **Step 3: Implementasi**

Di `server/room.ts`, tambahkan ke union `Intent` (setelah `{ type: "reset" }`):

```ts
  // Ditangani di worker: penonton ikut main, atau pemain keluar dan kursinya diambil alih bot.
  | { type: "sit" }
  | { type: "leave" }
```

Tambahkan konstanta di bawah `BOT_PREFIX`:

```ts
// Bot yang baru mengambil alih kursi menunggu selama ini sebelum langkah pertamanya, supaya penonton sempat ikut main.
export const HANDOVER_MS = 10_000;
```

Tambahkan field di class `Room` (di dekat `pausedSeat`):

```ts
  // Per kursi: bot yang baru mengambil alih baru boleh bertindak setelah waktu ini. Null jika tidak ada jeda.
  handoverUntil: (number | null)[] = [null, null, null, null];
```

Ganti method `claimBotSeat` seluruhnya dengan:

```ts
  // Penonton ikut main: kursi kosong saat menunggu didahulukan, lalu kursi bot (meneruskan tangan dan poinnya).
  sit(userId: string): PlayerId {
    const seat = this.openSeat();
    if (seat === null) throw new Error("NO_SEAT");
    this.seats[seat] = userId;
    this.handoverUntil[seat] = null;
    this.becomeOpeningIfFull();
    this.scheduleBot();
    return seat;
  }

  canSit(): boolean {
    return this.openSeat() !== null;
  }

  // Pemain keluar: kursinya jadi bot, atau kosong kalau meja masih menunggu pemain.
  leave(seat: PlayerId): void {
    const id = this.seats[seat];
    if (id === "" || id.startsWith(BOT_PREFIX)) throw new Error("NOT_SEATED");
    if (this.status === "waiting") {
      this.seats[seat] = "";
      this.profiles[seat] = null;
      return;
    }
    this.toBot(seat);
    if (this.status === "paused" && this.pausedSeat === seat) this.resume();
    if (this.status === "scoring") this.confirmScoring(seat, null);
    this.scheduleBot();
  }

  // Pemain manusia di kursi paling awal. Hanya dia yang boleh reset game.
  firstHumanSeat(): PlayerId | null {
    const seat = this.seats.findIndex((id) => id !== "" && !id.startsWith(BOT_PREFIX));
    return seat === -1 ? null : (seat as PlayerId);
  }

  private openSeat(): PlayerId | null {
    if (this.status === "finished" || this.status === "cancelled") return null;
    const empty = this.status === "waiting" ? this.seats.indexOf("") : -1;
    const seat = empty !== -1 ? empty : this.seats.findIndex((id) => id.startsWith(BOT_PREFIX));
    return seat === -1 ? null : (seat as PlayerId);
  }

  private toBot(seat: PlayerId): void {
    this.seats[seat] = `${BOT_PREFIX}${seat + 1}`;
    this.profiles[seat] = null;
    this.handoverUntil[seat] = this.now() + HANDOVER_MS;
  }
```

- [ ] **Step 4: Jalankan tes**

Run: `pnpm test tests/server/room.test.ts`
Expected: PASS. (Worker masih memanggil `claimBotSeat`; `npx tsc -p worker/tsconfig.json` baru bersih setelah Task 4.)

- [ ] **Step 5: Commit**

```bash
git add server/room.ts tests/server/room.test.ts
git commit -m "feat: room sit/leave, bot takes over a leaving seat, reset by first human"
```

---

### Task 2: Room — jeda serah terima, pause habis jadi bot, meja tanpa manusia

**Files:**
- Modify: `server/room.ts`
- Test: `tests/server/room.test.ts`

**Interfaces:**
- Consumes: `Room.sit`, `Room.leave`, `Room.firstHumanSeat`, `Room.handoverUntil`, `toBot` (Task 1).
- Produces:
  - `RoomSnapshot.handoverUntil?: (number | null)[]`
  - `RoomOptions.runAllBotTables?: boolean`
  - Pause yang habis tidak lagi membatalkan sesi; method privat `cancel()` dihapus.

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan helper:

```ts
function mixedRoom(): Room {
  return createRoom(["u0", "u1", "bot:3", "bot:4"], {
    target: 1000,
    disconnectTimeoutMs: TIMEOUT_MS,
    rng: () => 0,
    botDelayMs: 10,
  });
}
```

Ganti tes `"timeout cancels the session"` dengan:

```ts
test("timeout hands the disconnected seat to a bot and play continues", () => {
  const room = newRoom();
  room.disconnect(1);
  advance(room, TIMEOUT_MS + 100);
  expect(room.status).toBe("opening");
  expect(room.pausedSeat).toBeNull();
  expect(room.seats[1]).toBe("bot:2");
});
```

Tambahkan:

```ts
test("a bot that just took over waits 10 seconds before its first move", () => {
  const room = mixedRoom();
  room.leave(0);
  advance(room, 9_000);
  expect(room.board()!.hands[0].length).toBe(7);
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
```

Di tes `"an all-bot room keeps playing rounds without stalling"`, tambahkan `runAllBotTables: true` ke opsi `createRoom`.

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `pnpm test tests/server/room.test.ts`
Expected: FAIL pada tes timeout (`cancelled`), jeda serah terima, dan meja tanpa manusia.

- [ ] **Step 3: Implementasi**

`RoomOptions`, tambahkan:

```ts
  // Hanya untuk tes: meja yang semua kursinya bot tetap jalan. Di produksi bot berhenti kalau tidak ada manusia.
  runAllBotTables?: boolean;
```

`RoomSnapshot`, tambahkan:

```ts
  // Opsional: snapshot lama belum punya field ini.
  handoverUntil?: (number | null)[];
```

`Room.restore`, tambahkan sebelum `return room;`:

```ts
    room.handoverUntil = snapshot.handoverUntil ?? [null, null, null, null];
```

`snapshot()`, tambahkan:

```ts
      handoverUntil: [...this.handoverUntil],
```

Ganti `tick()`:

```ts
  // Dipanggil saat waktunya tiba: kursi yang terjeda terlalu lama diambil alih bot, lalu bot yang jatuh tempo dijalankan.
  tick(): void {
    const now = this.now();
    if (this.status === "paused" && this.pausedAt !== null && now - this.pausedAt >= this.options.disconnectTimeoutMs) {
      this.toBot(this.pausedSeat!);
      this.resume();
    }
    for (let i = 0; i < MAX_BOT_STEPS_PER_TICK && this.botDueAt !== null && this.botDueAt <= now; i++) {
      this.botDueAt = null;
      this.botAct();
    }
  }
```

Hapus method privat `cancel()`.

Ganti `scheduleBot()`:

```ts
  // Menjadwalkan langkah bot jika giliran saat ini milik kursi bot. Langkah dijalankan di tick berikutnya
  // setelah waktunya tiba, bukan dengan setTimeout. Bot yang baru mengambil alih menunggu jeda serah terima.
  private scheduleBot(): void {
    // Tanpa manusia di meja, bot tidak dijalankan sampai ada yang ikut main.
    if (this.firstHumanSeat() === null && !this.options.runAllBotTables) {
      this.botDueAt = null;
      return;
    }
    if (this.botDueAt !== null) return;
    const seat = this.actingSeat();
    if (seat === null || !this.seats[seat].startsWith(BOT_PREFIX)) return;
    const due = this.now() + (this.options.botDelayMs ?? 800);
    this.botDueAt = Math.max(due, this.handoverUntil[seat] ?? 0);
  }
```

- [ ] **Step 4: Jalankan tes**

Run: `pnpm test`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add server/room.ts tests/server/room.test.ts
git commit -m "feat: bot handover delay, timed-out seats go to bots, idle tables without humans"
```

---

### Task 3: View untuk penonton

**Files:**
- Modify: `server/view.ts`
- Test: `tests/server/room.test.ts`

**Interfaces:**
- Consumes: `Room.canSit()`, `Room.firstHumanSeat()` (Task 1).
- Produces:
  - `viewFor(room: Room, seat: PlayerId | null): PlayerView`
  - `PlayerView.you: PlayerId | null`
  - `PlayerView.canSit: boolean`, `PlayerView.canReset: boolean`

- [ ] **Step 1: Tulis tes yang gagal**

```ts
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
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `pnpm test tests/server/room.test.ts`
Expected: FAIL (`board.hands[null]` / `canReset` undefined).

- [ ] **Step 3: Implementasi**

Di `PlayerView`:

```ts
  // Null untuk penonton: tidak punya tangan dan tidak bisa bertindak.
  you: PlayerId | null;
  // Penonton bisa ikut main (ada kursi kosong saat menunggu atau kursi bot).
  canSit: boolean;
  // Penerima ini boleh reset game (pemain manusia di kursi paling awal).
  canReset: boolean;
```

Ganti signature dan bagian yang memakai `seat` di `viewFor`:

```ts
export function viewFor(room: Room, seat: PlayerId | null): PlayerView {
```

```ts
    scoring:
      room.status === "scoring"
        ? { confirmed: [...room.scoringConfirmed], mine: seat === null ? null : room.scoringArrangement?.[seat] ?? null }
        : null,
```

```ts
    hand: board && seat !== null ? board.hands[seat] : [],
    canSit: room.canSit(),
    canReset: seat !== null && seat === room.firstHumanSeat(),
```

- [ ] **Step 4: Jalankan tes**

Run: `pnpm test`
Expected: PASS. `npx tsc --noEmit -p .` akan melaporkan error di `app/activity/Table.tsx` (`view.you` bisa null); diperbaiki di Task 5.

- [ ] **Step 5: Commit**

```bash
git add server/view.ts tests/server/room.test.ts
git commit -m "feat: spectator view without hands, canSit and canReset flags"
```

---

### Task 4: Worker — penonton, sit, leave, reset

**Files:**
- Modify: `worker/worker.ts`

**Interfaces:**
- Consumes: `Room.sit`, `Room.leave`, `Room.firstHumanSeat`, `viewFor(room, PlayerId | null)`, `Intent` `sit`/`leave`.
- Produces: error code baru ke klien: `SPECTATOR`, `ALREADY_SEATED` (plus `NO_SEAT`, `NOT_SEATED` dari Room).

- [ ] **Step 1: Ubah tipe attachment**

```ts
// seat null = penonton.
type Attachment = { userId: string; seat: PlayerId | null };
```

Hapus fungsi `seatsFrom`.

- [ ] **Step 2: Routing pesan dan close**

Di `webSocketMessage`, ganti baris terakhir:

```ts
    await this.intent(ws, attachment, msg.intent);
```

Di `webSocketClose`:

```ts
    const attachment = ws.deserializeAttachment() as Attachment | null;
    // Penonton yang putus tidak menjeda permainan.
    if (attachment === null || attachment.seat === null) return;
```

- [ ] **Step 3: Ganti bagian hello setelah cek `INSTANCE_MISMATCH`**

Ganti semuanya dari `let room = await this.load();` sampai akhir method `hello` dengan:

```ts
    let room = await this.load();
    // Hanya anggota instance Activity yang boleh masuk, sebagai pemain maupun penonton.
    if (room === null || !room.seats.includes(userId)) {
      let members: string[];
      try {
        members = await this.instanceMembers(msg.instanceId);
      } catch (err) {
        return this.reject(ws, errorOf(err));
      }
      if (!members.includes(userId)) return this.reject(ws, "NOT_SEATED");
    }
    if (room === null || room.status === "finished" || room.status === "cancelled") {
      // Pembuat meja langsung duduk di kursi 1. Yang lain masuk sebagai penonton dan memilih ikut main.
      room = createRoom([userId, "", "", ""], ROOM_OPTIONS);
      await this.ctx.storage.put("instanceId", msg.instanceId);
    }
    room.tick();

    const index = room.seats.indexOf(userId);
    const seat = index === -1 ? null : (index as PlayerId);
    if (seat !== null) {
      // Profil diambil saat pertama kali duduk. Kalau belum ada (misal gagal sebelumnya), diambil ulang.
      if (room.profiles[seat] === null) room.setProfile(seat, await fetchProfile(userId, this.env.DISCORD_BOT_TOKEN));
      room.connect(seat);
    }
    ws.serializeAttachment({ userId, seat } satisfies Attachment);
    await this.commit(room);
  }
```

- [ ] **Step 4: Ganti method `intent`**

```ts
  private async intent(ws: WebSocket, attachment: Attachment, intent: Intent) {
    const loaded = await this.load();
    if (loaded === null) return ws.send(JSON.stringify({ type: "error", error: "ROOM_NOT_FOUND" }));
    const { seat } = attachment;
    // Penonton hanya boleh ikut main.
    if (seat === null && intent.type !== "sit") return ws.send(JSON.stringify({ type: "error", error: "SPECTATOR" }));
    // Reset membuat ruang baru dengan kursi yang sama (termasuk bot dan pemain yang sudah masuk).
    if (intent.type === "reset") {
      if (seat !== loaded.firstHumanSeat()) return ws.send(JSON.stringify({ type: "error", error: "RESET_NOT_ALLOWED" }));
      const next = createRoom([...loaded.seats], ROOM_OPTIONS);
      next.setProfiles(loaded.profiles);
      return this.commit(next);
    }
    const room = loaded;
    room.tick();
    let error: string | null = null;
    try {
      if (intent.type === "sit") {
        if (seat !== null) throw new Error("ALREADY_SEATED");
        const taken = room.sit(attachment.userId);
        ws.serializeAttachment({ ...attachment, seat: taken } satisfies Attachment);
        room.setProfile(taken, await fetchProfile(attachment.userId, this.env.DISCORD_BOT_TOKEN));
      } else if (intent.type === "leave") {
        room.leave(seat as PlayerId);
        ws.serializeAttachment({ ...attachment, seat: null } satisfies Attachment);
      } else {
        room.handle(seat as PlayerId, intent);
      }
    } catch (err) {
      error = errorOf(err);
    }
    // Commit tetap dijalankan walaupun intent ditolak, karena tick() bisa sudah mengubah state.
    await this.commit(room);
    if (error !== null) ws.send(JSON.stringify({ type: "error", error }));
  }
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p worker/tsconfig.json`
Expected: tanpa error.

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/worker.ts
git commit -m "feat: worker seats only the table creator, others spectate and may sit or leave"
```

---

### Task 5: UI penonton, ikut main, keluar, dan pesan error

**Files:**
- Modify: `app/activity/Table.tsx`
- Modify: `src/client/messages.ts`

**Interfaces:**
- Consumes: `PlayerView.you: PlayerId | null`, `PlayerView.canSit`, `PlayerView.canReset` (Task 3); intent `sit`/`leave` (Task 1).

- [ ] **Step 1: Pesan error**

Di `src/client/messages.ts`: hapus baris `TOO_MANY_PLAYERS`, ganti `RESET_NOT_ALLOWED`, dan tambahkan di bagian "Koneksi dan sesi":

```ts
  SPECTATOR: "Kamu sedang menonton. Klik \"Ikut main\" kalau ada kursi.",
  NO_SEAT: "Tidak ada kursi yang bisa diisi sekarang.",
  ALREADY_SEATED: "Kamu sudah duduk di meja.",
```

```ts
  RESET_NOT_ALLOWED: "Hanya pemain manusia di kursi paling awal yang bisa mereset game.",
```

- [ ] **Step 2: Variabel turunan di `Table`**

Tambahkan import:

```ts
import type { PlayerId } from "../../src/rules/opening";
```

Ganti blok cekih/konfirmasi (di bawah `const nameOf = ...`) menjadi:

```ts
  // Penonton tidak punya kursi: tanpa tangan dan tanpa aksi.
  const spectator = view.you === null;
  // Cekih: tombol hanya aktif kalau tangan sudah tinggal satu kartu lagi untuk tutup.
  const myCekih = board?.cekih.filter((c) => c.caller === view.you) ?? [];
  const cekihReady =
    board !== null &&
    view.you !== null &&
    view.status === "playing" &&
    canCallCekih(view.hand, board.jokerRank, board.laidPureSeri[view.you]);
  const allowedTargets = view.you === null ? [] : cekihTargets(view.you);
  const myConfirmed = scoringPhase && view.you !== null && view.scoring!.confirmed[view.you];
```

Ganti filter tombol cekih `allowedTargets.includes(seat as typeof view.you)` menjadi `allowedTargets.includes(seat as PlayerId)`.

- [ ] **Step 3: Konfirmasi dua klik untuk reset dan keluar**

Ganti `const [confirmReset, setConfirmReset] = useState(false);` dengan:

```ts
  // Aksi berisiko (reset, keluar) butuh dua klik. Kembali normal sendiri setelah beberapa detik.
  const [confirming, setConfirming] = useState<"reset" | "leave" | null>(null);
```

Ganti effect `confirmReset` dengan:

```ts
  useEffect(() => {
    if (confirming === null) return;
    const timer = setTimeout(() => setConfirming(null), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);
```

Ganti fungsi `resetClicked` dengan:

```ts
  function confirmThen(kind: "reset" | "leave") {
    if (confirming !== kind) {
      setConfirming(kind);
      return;
    }
    setConfirming(null);
    clearSelection();
    onIntent({ type: kind });
  }
```

- [ ] **Step 4: Sembunyikan bagian pemain untuk penonton**

- Kartu target: kondisi `view.rounds === 0 && ...` diawali `!spectator &&`.
- Panel "Menunggu pemain": tombol "Tambah bot" hanya dirender kalau `!spectator`.
- Notice penyusunan: kalau `spectator`, teksnya `Ronde selesai. Menunggu konfirmasi dari ${waiting}.`
- "Kombinasi yang kamu turunkan": kondisi menjadi `board && view.you !== null && board.table[view.you].length > 0 && !scoringPhase`, dan `<Melds melds={board.table[view.you]} />`.
- Bagian penyusunan/kartu tangan (`{scoringPhase && !myConfirmed ? ( ... ) : ( ... )}`): bungkus dengan `{!spectator && (...)}`.
- Bagian tombol cekih: kondisi `view.status === "playing"` menjadi `view.status === "playing" && !spectator`.

Tambahkan tepat setelah `{error && <p className={styles.error}>{error}</p>}`:

```tsx
      {spectator && (
        <section className={styles.targetCard}>
          <div className={styles.label}>Kamu menonton. Tangan pemain tidak terlihat.</div>
          {view.canSit && (
            <button type="button" className={styles.stock} onClick={() => onIntent({ type: "sit" })}>
              Ikut main
            </button>
          )}
        </section>
      )}
```

Ganti section tombol reset dengan:

```tsx
      <section className={styles.actions}>
        {!spectator && (
          <button type="button" className={styles.danger} onClick={() => confirmThen("leave")}>
            {confirming === "leave" ? "Klik lagi untuk keluar dari meja" : "Keluar dari meja"}
          </button>
        )}
        <button type="button" className={styles.reset} onClick={() => confirmThen("reset")} disabled={!view.canReset}>
          {!view.canReset ? "Reset game (hanya pemain manusia pertama)" : confirming === "reset" ? "Klik lagi untuk reset game" : "Reset game"}
        </button>
      </section>
```

- [ ] **Step 5: Verifikasi**

Run: `npx tsc --noEmit -p . && npx tsc --noEmit -p worker/tsconfig.json && pnpm lint && pnpm test && pnpm build`
Expected: semua bersih.

- [ ] **Step 6: Commit**

```bash
git add app/activity/Table.tsx src/client/messages.ts
git commit -m "feat: spectator UI with join and leave buttons"
```

---

### Task 6: Uji manual di Discord

**Files:** tidak ada perubahan kode (kecuali perbaikan dari temuan).

- [ ] **Step 1:** Deploy worker ke lingkungan uji (`pnpm worker:deploy`) dan jalankan klien seperti biasa. Minta izin pemilik repo sebelum deploy.
- [ ] **Step 2:** Orang A membuka Activity → duduk di kursi 1, status menunggu.
- [ ] **Step 3:** Orang B membuka Activity → melihat "Kamu menonton" dan tombol "Ikut main". Klik → duduk di kursi 2.
- [ ] **Step 4:** A klik "Tambah bot" → permainan mulai. Orang C membuka Activity → penonton, tidak melihat tangan siapa pun; tombol "Ikut main" ada (kursi bot).
- [ ] **Step 5:** Dari konsol devtools penonton C, kirim intent `discard` lewat koneksi yang ada → menerima pesan "Kamu sedang menonton..." dan meja tidak berubah (Review Focus 5).
- [ ] **Step 6:** B klik "Keluar dari meja" dua kali di gilirannya → kursi 2 jadi bot, bot menunggu ±10 detik. C klik "Ikut main" dalam jeda → C meneruskan tangan dan poin kursi 2.
- [ ] **Step 7:** C menutup Activity saat gilirannya → meja dijeda; setelah 60 detik kursi jadi bot dan permainan lanjut setelah ±10 detik.
- [ ] **Step 8:** A keluar dari meja → tombol reset pindah ke manusia di kursi paling awal berikutnya (Review Focus 4).
- [ ] **Step 9:** Semua manusia keluar → bot berhenti (tidak ada giliran bot berjalan). Satu orang klik "Ikut main" → permainan lanjut.
