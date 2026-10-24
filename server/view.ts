import type { Card, Rank } from "../src/rules/cards";
import type { PlayerId } from "../src/rules/opening";
import type { Cekih, RoundResult } from "../src/rules/turn";
import { BOT_PREFIX, type Board, type HistoryEntry, type Room, type RoomStatus, type RoundDetail } from "./room";
import type { Arrangement } from "../src/rules/scoring";

// Isi cangkulan dan tangan lawan tidak pernah dikirim; hanya jumlahnya.
// Kartu buangan yang tertutup (joker) hanya dikirim sebagai id. Angka dan bunganya tidak dikirim ke pemain lain.
export interface HiddenCard {
  id: string;
  hidden: true;
}

export type PublicCard = Card | HiddenCard;

export interface RevealedHand {
  seat: number;
  cards: Card[];
}

// Tangan pemain penutup (tutup atau tutup tangan) ditampilkan ke semua pemain. Null jika tidak ada penutup.
export function revealedCloser(board: Board | null): RevealedHand | null {
  if (board === null || board.result === null || typeof board.result.closedBy !== "number") return null;
  const seat = board.result.closedBy;
  return { seat, cards: board.hands[seat] };
}

export function maskDiscard(cards: Card[], jokerRank: Rank | null): PublicCard[] {
  return cards.map((card) => (jokerRank !== null && card.rank === jokerRank ? { id: card.id, hidden: true as const } : card));
}

export interface PublicBoard {
  jokerRank: Rank | null;
  jokerCard: Card | null;
  stockCount: number;
  discard: { cards: PublicCard[]; closedIndex: number | null };
  table: Card[][][];
  penalties: number[];
  laidPureSeri: boolean[];
  turn: PlayerId;
  phase: "opening" | "draw" | "discard";
  drewFrom: "stock" | "discard" | null;
  result: RoundResult | null;
  // Cekih aktif di ronde ini. Terlihat semua pemain agar permainan transparan.
  cekih: Cekih[];
}

// Informasi tampilan tiap kursi: nama, avatar, dan jenisnya.
export interface PlayerInfo {
  kind: "human" | "bot" | "empty";
  name: string;
  avatarUrl: string | null;
}

const BOT_AVATAR = "/bot-avatar.svg";

export interface PlayerView {
  players: PlayerInfo[];
  status: RoomStatus;
  // Null untuk penonton: tidak punya tangan dan tidak bisa bertindak.
  you: PlayerId | null;
  // Penonton bisa ikut main (ada kursi kosong saat menunggu atau kursi bot).
  canSit: boolean;
  // Penerima ini boleh reset game (pemain manusia di kursi paling awal, atau penonton kalau tidak ada manusia).
  canReset: boolean;
  seats: string[];
  target: number;
  totals: number[];
  rounds: number;
  winner: PlayerId | null;
  lastRoundScores: number[] | null;
  // Rincian kombinasi dan sampah tiap pemain untuk ronde terakhir.
  roundDetail: RoundDetail[] | null;
  // Riwayat skor per ronde, dari ronde pertama.
  history: HistoryEntry[];
  // Saat fase penyusunan: seluruh tangan pemain penutup, supaya bisa dicek semua pemain.
  revealed: RevealedHand | null;
  // Fase penyusunan: siapa yang sudah konfirmasi, dan susunan tangan kita sendiri.
  scoring: { confirmed: boolean[]; mine: Arrangement | null } | null;
  pausedSeat: PlayerId | null;
  board: PublicBoard | null;
  hand: Card[];
  handCounts: number[];
}

function playerInfo(room: Room, seat: number): PlayerInfo {
  const id = room.seats[seat];
  if (id === "") return { kind: "empty", name: "Kosong", avatarUrl: null };
  if (id.startsWith(BOT_PREFIX)) return { kind: "bot", name: `Bot ${seat + 1}`, avatarUrl: BOT_AVATAR };
  const profile = room.profiles[seat];
  return { kind: "human", name: profile?.name ?? "Pemain", avatarUrl: profile?.avatarUrl ?? null };
}

export function viewFor(room: Room, seat: PlayerId | null): PlayerView {
  const board = room.board();
  return {
    players: room.seats.map((_, i) => playerInfo(room, i)),
    status: room.status,
    you: seat,
    seats: room.seats,
    target: room.session.target,
    totals: room.session.totals,
    rounds: room.session.rounds,
    winner: room.session.winner,
    lastRoundScores: room.lastRoundScores,
    roundDetail: room.roundDetail,
    history: room.history,
    revealed: room.status === "scoring" ? revealedCloser(board) : null,
    scoring:
      room.status === "scoring"
        ? { confirmed: [...room.scoringConfirmed], mine: seat === null ? null : room.scoringArrangement?.[seat] ?? null }
        : null,
    pausedSeat: room.pausedSeat,
    board: board && {
      jokerRank: board.jokerRank,
      jokerCard: board.jokerCard,
      stockCount: board.stock.length,
      discard: { cards: maskDiscard(board.discard.cards, board.jokerRank), closedIndex: board.discard.closedIndex },
      table: board.table,
      penalties: board.penalties,
      laidPureSeri: board.laidPureSeri,
      turn: board.turn,
      phase: board.phase,
      drewFrom: board.drewFrom,
      result: board.result,
      cekih: board.cekih,
    },
    hand: board && seat !== null ? board.hands[seat] : [],
    canSit: room.canSit(),
    canReset: room.canReset(seat),
    handCounts: board ? board.hands.map((hand) => hand.length) : [0, 0, 0, 0],
  };
}
