import type { Intent } from "../../server/room";
import type { PlayerView } from "../../server/view";
import type { DiscordSession } from "./discord";

export type ServerMessage = { type: "state"; view: PlayerView } | { type: "error"; error: string };

export interface RoomHandlers {
  onView: (view: PlayerView) => void;
  onError: (error: string) => void;
  onStatus: (text: string) => void;
}

export interface RoomConnection {
  send: (intent: Intent) => boolean;
  close: () => void;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000];

// Di dalam Discord, koneksi lewat proxy /.proxy/ws (URL mapping "/ws" di Developer Portal).
// NEXT_PUBLIC_WS_URL dipakai saat dijalankan di luar Discord, misalnya ws://localhost:8787.
function roomUrl(instanceId: string): string {
  const id = encodeURIComponent(instanceId);
  // Mode dev (instanceId "dev-...") tanpa NEXT_PUBLIC_WS_URL: Worker lokal dari pnpm worker:dev:local.
  const base = process.env.NEXT_PUBLIC_WS_URL || (instanceId.startsWith("dev-") ? "ws://localhost:8787" : "");
  if (base) return `${base}/room/${id}`;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/.proxy/ws/room/${id}`;
}

// Kode 4001 (token tidak valid) dan 4002 (dibuka di tab lain) tidak disambung ulang otomatis.
const FATAL_STATUS: Record<number, string> = {
  4001: "Gagal masuk ke meja, token tidak valid.",
  4002: "Meja sedang dibuka di tab lain.",
};

export function connectRoom(session: DiscordSession, handlers: RoomHandlers): RoomConnection {
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let closed = false;

  function open() {
    const current = new WebSocket(roomUrl(session.instanceId));
    socket = current;
    current.onopen = () => {
      current.send(JSON.stringify({ type: "hello", token: session.accessToken, instanceId: session.instanceId }));
    };
    current.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMessage;
      attempt = 0;
      if (msg.type === "state") {
        handlers.onView(msg.view);
        handlers.onStatus("");
      } else {
        handlers.onError(msg.error);
      }
    };
    current.onclose = (ev) => {
      if (closed) return;
      if (FATAL_STATUS[ev.code] !== undefined) return handlers.onStatus(FATAL_STATUS[ev.code]);
      handlers.onStatus("Koneksi terputus, menyambung ulang...");
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt++;
      retry = setTimeout(open, delay);
    };
  }

  open();

  return {
    send(intent) {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify({ type: "intent", intent }));
      return true;
    },
    close() {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    },
  };
}
