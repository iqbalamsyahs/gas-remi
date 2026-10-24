import { DurableObject } from "cloudflare:workers";
import type { PlayerId } from "../src/rules/opening";
import { verifyDiscordUserId } from "../server/auth";
import { createRoom, Room, type Intent, type RoomOptions, type RoomSnapshot } from "../server/room";
import { viewFor } from "../server/view";
import { fetchProfile } from "../server/profile";

export interface Env {
  TABLE: DurableObjectNamespace<Table>;
  DISCORD_APPLICATION_ID: string;
  // Secret: wrangler secret put DISCORD_BOT_TOKEN
  DISCORD_BOT_TOKEN: string;
}

// Kursi tidak disimpan di attachment: selalu dicari dari room.seats, supaya tidak usang setelah meja dibuat ulang
// atau kursi berpindah. User yang tidak ada di kursi adalah penonton.
type Attachment = { userId: string };

type ClientMessage =
  | { type: "hello"; token: string; instanceId: string }
  | { type: "intent"; intent: Intent };

const ID_RE = /^[\w.:-]{1,200}$/;
const ROOM_OPTIONS: RoomOptions = { target: 1000, disconnectTimeoutMs: 60_000 };

function errorOf(err: unknown): string {
  return err instanceof Error ? err.message : "UNKNOWN";
}

function parseMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Partial<Extract<ClientMessage, { type: "hello" }>> & Partial<Extract<ClientMessage, { type: "intent" }>>;
  if (msg.type === "hello" && typeof msg.token === "string" && typeof msg.instanceId === "string") {
    return msg as Extract<ClientMessage, { type: "hello" }>;
  }
  if (msg.type === "intent" && typeof msg.intent === "object" && msg.intent !== null) {
    return msg as Extract<ClientMessage, { type: "intent" }>;
  }
  return null;
}

// Satu Durable Object per peluncuran Activity (instanceId). State ruang disimpan di storage,
// dan timer bot serta batas putus pakai alarm.
export class Table extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") return;
    const msg = parseMessage(raw);
    if (msg === null) return;
    const attachment = ws.deserializeAttachment() as Attachment | null;

    if (msg.type === "hello") {
      if (attachment === null) await this.hello(ws, msg);
      return;
    }
    if (attachment === null) return; // belum hello: intent diabaikan
    await this.intent(ws, attachment.userId, msg.intent);
  }

  async webSocketClose(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (attachment === null) return;
    const room = await this.load();
    if (room === null) return;
    // Penonton yang putus tidak menjeda permainan.
    const seat = room.seatOf(attachment.userId);
    if (seat === null) return;
    room.disconnect(seat);
    await this.commit(room);
  }

  async alarm() {
    const room = await this.load();
    if (room === null) return;
    room.tick();
    await this.commit(room);
  }

  private async hello(ws: WebSocket, msg: Extract<ClientMessage, { type: "hello" }>) {
    let userId: string;
    try {
      userId = await verifyDiscordUserId(msg.token);
    } catch {
      ws.close(4001, "INVALID_TOKEN");
      return;
    }

    // Dua tab dengan akun yang sama: tab lama ditutup. Attachment dikosongkan dulu supaya tidak memicu disconnect.
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      const otherAttachment = other.deserializeAttachment() as Attachment | null;
      if (otherAttachment?.userId === userId) {
        other.serializeAttachment(null);
        other.close(4002, "REPLACED_BY_OTHER_TAB");
      }
    }

    // Durable Object ini milik satu instanceId. Klien tidak boleh masuk dengan instanceId lain.
    const bound = await this.ctx.storage.get<string>("instanceId");
    if (bound !== undefined && bound !== msg.instanceId) return this.reject(ws, "INSTANCE_MISMATCH");

    // Semua fetch ke Discord dijalankan sebelum ruang dimuat. Selama fetch, Durable Object bisa memproses pesan lain,
    // jadi ruang yang dimuat sebelum fetch bisa sudah usang saat disimpan dan menimpa langkah pemain lain.
    const before = await this.load();
    // Hanya anggota instance Activity yang boleh masuk, sebagai pemain maupun penonton.
    if (before === null || !before.seats.includes(userId)) {
      let members: string[];
      try {
        members = await this.instanceMembers(msg.instanceId);
      } catch (err) {
        return this.reject(ws, errorOf(err));
      }
      if (!members.includes(userId)) return this.reject(ws, "NOT_SEATED");
    }
    const profile = await fetchProfile(userId, this.env.DISCORD_BOT_TOKEN);

    let room = await this.load();
    if (room === null || room.status === "finished" || room.status === "cancelled") {
      // Pembuat meja langsung duduk di kursi 1. Yang lain masuk sebagai penonton dan memilih ikut main.
      room = createRoom([userId, "", "", ""], ROOM_OPTIONS);
      await this.ctx.storage.put("instanceId", msg.instanceId);
    }
    room.tick();

    const seat = room.seatOf(userId);
    if (seat !== null) {
      // Profil diambil saat pertama kali duduk. Kalau belum ada (misal gagal sebelumnya), diisi ulang.
      if (room.profiles[seat] === null) room.setProfile(seat, profile);
      room.connect(seat);
    }
    ws.serializeAttachment({ userId } satisfies Attachment);
    await this.commit(room);
  }

  private async intent(ws: WebSocket, userId: string, intent: Intent) {
    // Profil diambil sebelum ruang dimuat, supaya tidak ada fetch di antara load dan commit (lihat hello).
    const profile = intent.type === "sit" ? await fetchProfile(userId, this.env.DISCORD_BOT_TOKEN) : null;
    const loaded = await this.load();
    if (loaded === null) return ws.send(JSON.stringify({ type: "error", error: "ROOM_NOT_FOUND" }));
    const seat = loaded.seatOf(userId);
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
        room.setProfile(room.sit(userId), profile!);
      } else if (intent.type === "leave") {
        room.leave(seat as PlayerId);
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

  private reject(ws: WebSocket, error: string) {
    ws.send(JSON.stringify({ type: "error", error }));
    ws.close(4003, error);
  }

  // Daftar user ID yang sedang terhubung ke instance ini, dari REST Discord (butuh bot token).
  private async instanceMembers(instanceId: string): Promise<string[]> {
    const url = `https://discord.com/api/v10/applications/${this.env.DISCORD_APPLICATION_ID}/activity-instances/${instanceId}`;
    const res = await fetch(url, { headers: { Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` } });
    if (!res.ok) throw new Error("INSTANCE_NOT_FOUND");
    const body = (await res.json()) as { users?: (string | { id: string })[] };
    return (body.users ?? []).map((u) => (typeof u === "string" ? u : u.id));
  }

  private async load(): Promise<Room | null> {
    const snapshot = await this.ctx.storage.get<RoomSnapshot>("room");
    return snapshot === undefined ? null : Room.restore(snapshot, ROOM_OPTIONS);
  }

  // Simpan state, kirim view ke tiap pemain, dan jadwalkan alarm berikutnya.
  private async commit(room: Room) {
    await this.ctx.storage.put("room", room.snapshot());
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (attachment === null) continue;
      ws.send(JSON.stringify({ type: "state", view: viewFor(room, room.seatOf(attachment.userId)) }));
    }
    const deadline = room.nextDeadline();
    if (deadline === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(deadline);
  }
}

const worker = {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const match = new URL(req.url).pathname.match(/^(?:\/ws)?\/room\/([^/]+)\/?$/);
    if (!match || !ID_RE.test(match[1])) {
      const pair = new WebSocketPair();
      pair[1].accept();
      pair[1].close(4003, "ROOM_NOT_FOUND");
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return env.TABLE.get(env.TABLE.idFromName(match[1])).fetch(req);
  },
};

export default worker;
