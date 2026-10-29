import { baseValue, makeDeck, shuffle, type Card, type Rank } from "../src/rules/cards";
import type { Cekih } from "../src/rules/turn";
import { callCekih, cancelCekih } from "../src/rules/cekih";
import { chooseBotPlay } from "../src/rules/bot";
import { HAND_SIZE, deal } from "../src/rules/deal";
import {
  openingDiscard,
  openingDraw,
  resolveJoker,
  type DiscardPile,
  type OpeningState,
  type PlayerId,
} from "../src/rules/opening";
import {
  canUseMelds,
  cekihPenaltyOf,
  finalScores,
  handArrangement,
  loneValue,
  meldValue,
  validateArrangement,
  type Arrangement,
} from "../src/rules/scoring";
import { applyRound, nextFirstPlayer, type SessionState } from "../src/rules/session";
import {
  discardCard,
  drawFromStock,
  layDownPureSeri,
  pickFromDiscard,
  type RoundResult,
  type RoundState,
} from "../src/rules/turn";

// Intent memakai ID kartu, bukan objek kartu. Server mencari kartu dari tangan dan
// buangan miliknya sendiri, jadi klien tidak bisa memalsukan rank atau bunga.
export type Intent =
  | { type: "opening_draw" }
  | { type: "opening_discard"; cardId: string }
  | { type: "draw_stock" }
  // discardIds: kartu di atas target yang ikut dibentuk jadi kombinasi. Sisanya masuk tangan.
  | { type: "pickup"; targetId: string; handIds: string[]; discardIds?: string[] }
  | { type: "lay_down"; cardIds: string[] }
  | { type: "discard"; cardId: string }
  // Cekih: pemain tercekih boleh dibatalkan oleh pemain penyebut kapan saja sampai ronde selesai.
  | { type: "cekih"; target: number }
  | { type: "cekih_batal"; target: number }
  // Ditangani di worker (membuat ruang baru), bukan di Room.handle.
  | { type: "reset" }
  // Ditangani di worker: penonton ikut main, atau pemain keluar dan kursinya diambil alih bot.
  // seat opsional: kursi tertentu yang ingin diambil (kursi bot, atau kursi kosong saat menunggu).
  | { type: "sit"; seat?: number }
  | { type: "leave" }
  // Hanya saat fase penyusunan (status "scoring"): susunan kombinasi tangan lalu konfirmasi.
  | { type: "confirm"; melds: string[][] }
  // Hanya sebelum ronde pertama selesai. Target 100 sampai 5000.
  | { type: "set_target"; target: number }
  // Lanjutkan game: room master mengisi poin terakhir tiap kursi, hanya sebelum ada yang mengambil kartu.
  | { type: "set_totals"; totals: number[] }
  // Saat menunggu pemain: isi semua kursi kosong dengan bot.
  | { type: "add_bots" };

export const TARGET_MIN = 100;
export const TARGET_MAX = 5000;
export const TOTALS_LIMIT = 100_000;

// Skor satu ronde untuk ditampilkan sebagai riwayat. Totals adalah skor total setelah ronde itu.
export interface HistoryEntry {
  round: number;
  scores: number[];
  totals: number[];
}

// Profil pemain manusia per kursi. Bot tidak punya profil (ditampilkan dengan avatar bot).
export interface PlayerProfile {
  name: string;
  avatarUrl: string;
}

export type RoomStatus = "waiting" | "opening" | "playing" | "scoring" | "paused" | "cancelled" | "finished";

// Hasil satu pemain untuk ditampilkan: kombinasi (plus) dan sampah (minus).
export interface RoundDetail {
  melds: Card[][];
  meldValues: number[];
  leftover: Card[];
  leftoverValues: number[];
  // Penalti buang joker.
  penalty: number;
  // Bonus tutup: tutup tangan (+250/+500) atau tutup biasa (10x kartu penutup).
  bonus: number;
  // Penutup ronde ini tutup tangan.
  fromHand: boolean;
  // Bonus untuk penutup dan hukuman untuk pemain tercekih (negatif).
  cekihBonus: number;
  cekihPenalty: number;
  score: number;
}

// Kursi dengan ID berawalan ini dikendalikan server (bot), bukan oleh pemain.
export const BOT_PREFIX = "bot:";

// Bot yang baru mengambil alih kursi menunggu selama ini sebelum langkah pertamanya, supaya penonton sempat ikut main.
export const HANDOVER_MS = 10_000;

export interface RoomOptions {
  target: number;
  disconnectTimeoutMs: number;
  rng?: () => number;
  now?: () => number;
  botDelayMs?: number;
  // Hanya untuk tes: meja yang semua kursinya bot tetap jalan. Di produksi bot berhenti kalau tidak ada manusia.
  runAllBotTables?: boolean;
}

// Seluruh state ruang dalam bentuk JSON. Disimpan di antara request karena serverless tidak menyimpan memori.
export interface RoomSnapshot {
  seats: string[];
  status: RoomStatus;
  session: SessionState;
  lastRoundScores: number[] | null;
  roundDetail: RoundDetail[] | null;
  scoringArrangement: Arrangement[] | null;
  scoringConfirmed: boolean[];
  history: HistoryEntry[];
  profiles: (PlayerProfile | null)[];
  pausedSeat: PlayerId | null;
  // Snapshot lama: waktu jeda. Diganti offlineSince.
  pausedAt?: number | null;
  // Per kursi: sejak kapan pemain terputus. Opsional karena snapshot lama belum punya.
  offlineSince?: (number | null)[];
  resumeStatus: RoomStatus;
  firstPlayer: PlayerId;
  opening: OpeningState | null;
  round: RoundState | null;
  botDueAt: number | null;
  // Opsional: snapshot lama belum punya field ini.
  handoverUntil?: (number | null)[];
}

// Papan ronde yang sedang berjalan, atau fase pembukaan (jika ronde belum mulai main).
export interface Board {
  hands: Card[][];
  stock: Card[];
  discard: DiscardPile;
  jokerRank: Rank | null;
  jokerCard: Card | null;
  penalties: number[];
  table: Card[][][];
  laidPureSeri: boolean[];
  turn: PlayerId;
  phase: "opening" | "draw" | "discard";
  drewFrom: "stock" | "discard" | null;
  result: RoundResult | null;
  cekih: Cekih[];
}

// Batas langkah bot per request. Bot hanya jalan saat jatuh tempo, jadi ini sekadar pengaman.
const MAX_BOT_STEPS_PER_TICK = 50;

export class Room {
  status: RoomStatus = "opening";
  roundDetail: RoundDetail[] | null = null;
  scoringArrangement: Arrangement[] | null = null;
  scoringConfirmed: boolean[] = [false, false, false, false];
  history: HistoryEntry[] = [];
  profiles: (PlayerProfile | null)[] = [null, null, null, null];
  session: SessionState;
  lastRoundScores: number[] | null = null;
  pausedSeat: PlayerId | null = null;
  // Per kursi: bot yang baru mengambil alih baru boleh bertindak setelah waktu ini. Null jika tidak ada jeda.
  handoverUntil: (number | null)[] = [null, null, null, null];
  // Per kursi: sejak kapan pemain manusia terputus. Lewat batas waktu, kursinya diambil alih bot (atau dikosongkan saat menunggu).
  offlineSince: (number | null)[] = [null, null, null, null];

  private readonly rng: () => number;
  private readonly now: () => number;
  private firstPlayer: PlayerId = 0;
  private opening: OpeningState | null = null;
  private round: RoundState | null = null;
  private resumeStatus: RoomStatus = "opening";
  private botDueAt: number | null = null;

  constructor(
    readonly seats: string[],
    private readonly options: RoomOptions,
  ) {
    if (seats.length !== 4) throw new Error("BAD_SEAT_COUNT");
    this.rng = options.rng ?? Math.random;
    this.now = options.now ?? Date.now;
    this.session = { totals: [0, 0, 0, 0], target: options.target, rounds: 0, winner: null };
    this.opening = this.newOpening();
    // Kursi kosong ("") berarti belum ada pemain. Permainan baru mulai setelah semua kursi terisi.
    this.status = seats.includes("") ? "waiting" : "opening";
    this.scheduleBot();
  }

  static restore(snapshot: RoomSnapshot, options: RoomOptions): Room {
    const room = new Room(snapshot.seats, options);
    room.status = snapshot.status;
    room.session = snapshot.session;
    room.lastRoundScores = snapshot.lastRoundScores;
    room.pausedSeat = snapshot.pausedSeat;
    room.resumeStatus = snapshot.resumeStatus;
    room.firstPlayer = snapshot.firstPlayer;
    room.opening = snapshot.opening;
    room.round = snapshot.round;
    room.botDueAt = snapshot.botDueAt;
    room.roundDetail = snapshot.roundDetail;
    room.scoringArrangement = snapshot.scoringArrangement;
    room.scoringConfirmed = snapshot.scoringConfirmed;
    room.history = snapshot.history;
    room.profiles = snapshot.profiles ?? [null, null, null, null];
    room.handoverUntil = snapshot.handoverUntil ?? [null, null, null, null];
    room.offlineSince = snapshot.offlineSince ?? [null, null, null, null];
    // Snapshot lama yang sedang dijeda hanya menyimpan waktu jeda untuk satu kursi.
    if (snapshot.offlineSince === undefined && snapshot.status === "paused" && snapshot.pausedSeat !== null) {
      room.offlineSince[snapshot.pausedSeat] = snapshot.pausedAt ?? room.now();
    }
    return room;
  }

  snapshot(): RoomSnapshot {
    return {
      seats: [...this.seats],
      status: this.status,
      session: this.session,
      lastRoundScores: this.lastRoundScores,
      pausedSeat: this.pausedSeat,
      resumeStatus: this.resumeStatus,
      firstPlayer: this.firstPlayer,
      opening: this.opening,
      round: this.round,
      botDueAt: this.botDueAt,
      roundDetail: this.roundDetail,
      scoringArrangement: this.scoringArrangement,
      scoringConfirmed: [...this.scoringConfirmed],
      history: this.history,
      profiles: [...this.profiles],
      handoverUntil: [...this.handoverUntil],
      offlineSince: [...this.offlineSince],
    };
  }

  // Waktu paling awal ketika tick() perlu dipanggil lagi (bot jalan atau batas putus habis). Null jika tidak ada.
  nextDeadline(): number | null {
    const closed = this.status === "finished" || this.status === "cancelled";
    const offlineEnds = closed
      ? []
      : this.offlineSince.filter((t): t is number => t !== null).map((t) => t + this.options.disconnectTimeoutMs);
    const candidates = [this.botDueAt, ...offlineEnds].filter((t): t is number => t !== null);
    return candidates.length === 0 ? null : Math.min(...candidates);
  }

  // Dipanggil saat waktunya tiba: kursi yang terputus terlalu lama diambil alih bot, lalu bot yang jatuh tempo dijalankan.
  tick(): void {
    const now = this.now();
    if (this.status !== "finished" && this.status !== "cancelled") {
      this.offlineSince.forEach((since, i) => {
        if (since === null || now - since < this.options.disconnectTimeoutMs) return;
        const seat = i as PlayerId;
        if (this.status === "waiting") {
          this.seats[seat] = "";
          this.profiles[seat] = null;
          this.offlineSince[seat] = null;
        } else {
          this.toBot(seat);
        }
      });
      this.updatePause();
    }
    for (let i = 0; i < MAX_BOT_STEPS_PER_TICK && this.botDueAt !== null && this.botDueAt <= now; i++) {
      this.botDueAt = null;
      this.botAct();
    }
  }

  // Koneksi pemain putus: dicatat per kursi. Pembukaan dan permainan terjeda sampai pemain kembali atau batas waktu habis.
  disconnect(seat: PlayerId): void {
    const id = this.seats[seat];
    if (id === "" || id.startsWith(BOT_PREFIX)) return;
    this.offlineSince[seat] ??= this.now();
    // Pemain yang putus saat penyusunan dikonfirmasi dengan usulan otomatis, supaya ronde tidak menggantung.
    if (this.status === "scoring") this.confirmScoring(seat, null);
    this.updatePause();
  }

  // Koneksi pemain tersambung lagi: meja lanjut kalau tidak ada lagi pemain yang terputus.
  connect(seat: PlayerId): void {
    this.offlineSince[seat] = null;
    this.updatePause();
  }

  handle(seat: PlayerId, intent: Intent): void {
    if (this.status === "paused") throw new Error("PAUSED");
    if (this.status === "cancelled" || this.status === "finished") throw new Error("ROOM_CLOSED");
    if (this.status === "waiting" && intent.type === "add_bots") this.addBots();
    else if (this.status === "waiting" && intent.type !== "set_target" && intent.type !== "set_totals") throw new Error("ROOM_NOT_STARTED");
    else if (intent.type === "set_target") this.setTarget(intent.target);
    else if (intent.type === "set_totals") this.setTotals(seat, intent.totals);
    else if (this.status === "scoring") this.handleScoring(seat, intent);
    else if (this.status === "opening") this.handleOpening(seat, intent);
    else this.handlePlay(seat, intent);
    this.scheduleBot();
  }

  board(): Board | null {
    if (this.round !== null) {
      const r = this.round;
      return {
        hands: r.hands,
        stock: r.stock,
        discard: r.discard,
        jokerRank: r.jokerRank,
        jokerCard: r.jokerCard ?? null,
        penalties: r.penalties,
        table: r.table,
        laidPureSeri: r.laidPureSeri,
        turn: r.turn,
        phase: r.phase,
        drewFrom: r.drewFrom,
        result: r.result,
        cekih: r.cekih,
      };
    }
    if (this.opening === null) return null;
    const o = this.opening;
    return {
      hands: o.hands,
      stock: o.stock,
      discard: o.discard,
      jokerRank: null,
      jokerCard: null,
      penalties: o.penalties,
      table: [[], [], [], []],
      laidPureSeri: [false, false, false, false],
      turn: this.openingOrder()[o.discard.cards.length],
      phase: "opening",
      drewFrom: null,
      result: null,
      cekih: [],
    };
  }

  // Meja dijeda selama ada pemain terputus di pembukaan atau permainan, dan lanjut setelah semuanya kembali atau diganti bot.
  private updatePause(): void {
    const offline = this.offlineSince.findIndex((t) => t !== null);
    if (this.status === "paused") {
      if (offline === -1) this.resume();
      else this.pausedSeat = offline as PlayerId;
    } else if (offline !== -1 && (this.status === "opening" || this.status === "playing")) {
      this.resumeStatus = this.status;
      this.status = "paused";
      this.pausedSeat = offline as PlayerId;
      this.botDueAt = null;
    }
  }

  private resume(): void {
    this.status = this.resumeStatus;
    this.pausedSeat = null;
    this.scheduleBot();
  }

  private handleOpening(seat: PlayerId, intent: Intent): void {
    const opening = this.opening!;
    if (intent.type === "opening_draw") {
      this.expectOpeningSeat(seat);
      this.opening = openingDraw(opening, seat);
    } else if (intent.type === "opening_discard") {
      this.expectOpeningSeat(seat);
      const card = findCard(opening.hands[seat], intent.cardId);
      this.opening = openingDiscard(opening, seat, card);
      if (this.opening.discard.cards.length === 4) this.startPlaying();
    } else {
      throw new Error("WRONG_PHASE");
    }
  }

  private handlePlay(seat: PlayerId, intent: Intent): void {
    const round = this.round!;
    switch (intent.type) {
      case "draw_stock":
        this.round = drawFromStock(round, seat);
        break;
      case "pickup": {
        const target = findCard(round.discard.cards, intent.targetId);
        const handCards = intent.handIds.map((id) => findCard(round.hands[seat], id));
        const fromDiscard = (intent.discardIds ?? []).map((id) => findCard(round.discard.cards, id));
        this.round = pickFromDiscard(round, seat, target, handCards, fromDiscard);
        break;
      }
      case "lay_down":
        this.round = layDownPureSeri(
          round,
          seat,
          intent.cardIds.map((id) => findCard(round.hands[seat], id)),
        );
        break;
      case "cekih":
        this.round = callCekih(round, seat, intent.target as PlayerId);
        break;
      case "cekih_batal":
        this.round = cancelCekih(round, seat, intent.target as PlayerId);
        break;
      case "discard":
        this.round = discardCard(round, seat, findCard(round.hands[seat], intent.cardId));
        break;
      default:
        throw new Error("WRONG_PHASE");
    }
    if (this.round.result !== null) this.endRound();
  }

  // Pembukaan selalu dimulai dari pemain pertama ronde, lalu berputar searah kursi.
  private openingOrder(): PlayerId[] {
    return [0, 1, 2, 3].map((i) => ((this.firstPlayer + i) % 4) as PlayerId);
  }

  private expectOpeningSeat(seat: PlayerId): void {
    const expected = this.openingOrder()[this.opening!.discard.cards.length];
    if (seat !== expected) throw new Error("NOT_YOUR_TURN");
  }

  private startPlaying(): void {
    const resolved = resolveJoker(this.opening!, this.rng, this.firstPlayer);
    this.round = {
      hands: resolved.hands,
      stock: resolved.stock,
      discard: resolved.discard,
      jokerRank: resolved.jokerRank,
      jokerCard: resolved.jokerCard,
      turn: this.firstPlayer,
      phase: "draw",
      drewFrom: null,
      laidPureSeri: [false, false, false, false],
      table: [[], [], [], []],
      penalties: resolved.penalties,
      result: null,
      cekih: [],
      discardOwner: Object.fromEntries(
        this.opening!.discard.cards.map((card, i) => [card.id, this.openingOrder()[i]]),
      ),
      pickedFromDiscard: [false, false, false, false],
      takenOwners: [],
    };
    this.opening = null;
    this.status = "playing";
  }

  // Ronde selesai: pemain menyusun tangannya dulu (usulan otomatis sebagai awal), lalu konfirmasi.
  private endRound(): void {
    const round = this.round!;
    this.status = "scoring";
    this.scoringArrangement = round.hands.map((hand, seat) =>
      handArrangement(hand, round.jokerRank, canUseMelds(hand, round.laidPureSeri[seat], round.jokerRank)),
    );
    this.scoringConfirmed = [false, false, false, false];
    this.seats.forEach((seatId, seat) => {
      if (seatId.startsWith(BOT_PREFIX)) this.scoringConfirmed[seat] = true;
    });
    this.finishIfAllConfirmed();
  }

  private setTarget(target: number): void {
    if (this.session.rounds > 0) throw new Error("TARGET_LOCKED");
    if (!Number.isInteger(target) || target < TARGET_MIN || target > TARGET_MAX) throw new Error("INVALID_TARGET");
    this.session = { ...this.session, target };
  }

  // Poin awal dari game sebelumnya. Pemain pertama ikut dihitung ulang dari poin tertinggi.
  private setTotals(seat: PlayerId, totals: number[]): void {
    if (!this.canSetTotals(seat)) throw new Error("TOTALS_LOCKED");
    const valid =
      Array.isArray(totals) &&
      totals.length === 4 &&
      totals.every((total) => Number.isInteger(total) && Math.abs(total) <= TOTALS_LIMIT);
    if (!valid) throw new Error("INVALID_TOTALS");
    this.session = { ...this.session, totals: [...totals] };
    this.firstPlayer = nextFirstPlayer(totals);
  }

  // Room master, sebelum ronde pertama dan sebelum ada yang mengambil kartu di pembukaan.
  canSetTotals(seat: PlayerId | null): boolean {
    if (seat === null || !this.canReset(seat) || this.session.rounds > 0) return false;
    if (this.status === "waiting") return true;
    const o = this.opening;
    return this.status === "opening" && o !== null && o.discard.cards.length === 0 && o.hands.every((h) => h.length === HAND_SIZE);
  }

  private handleScoring(seat: PlayerId, intent: Intent): void {
    if (intent.type !== "confirm") throw new Error("WRONG_PHASE");
    if (this.scoringConfirmed[seat]) throw new Error("ALREADY_CONFIRMED");
    const hand = this.round!.hands[seat];
    const melds = intent.melds.map((ids) => ids.map((id) => findCard(hand, id)));
    if (melds.length > 0 && !canUseMelds(hand, this.round!.laidPureSeri[seat], this.round!.jokerRank)) {
      throw new Error("MELD_NEEDS_PURE_SERI");
    }
    const arrangement = validateArrangement(hand, melds, this.round!.jokerRank);
    if (arrangement === null) throw new Error("INVALID_ARRANGEMENT");
    this.confirmScoring(seat, arrangement);
  }

  // arrangement null = pakai usulan otomatis yang sudah ada.
  private confirmScoring(seat: PlayerId, arrangement: Arrangement | null): void {
    if (this.scoringConfirmed[seat]) return;
    if (arrangement !== null) this.scoringArrangement![seat] = arrangement;
    this.scoringConfirmed[seat] = true;
    this.finishIfAllConfirmed();
  }

  private finishIfAllConfirmed(): void {
    if (this.status !== "scoring" || !this.scoringConfirmed.every(Boolean)) return;
    this.finishRound();
  }

  private finishRound(): void {
    const round = this.round!;
    const arrangements = this.scoringArrangement!;
    const scores = finalScores(round, arrangements);
    this.roundDetail = arrangements.map((arrangement, seat) => {
      const result = round.result?.closedBy === seat ? round.result : null;
      // Bagian bonus dari cekih dipisah supaya tampil di baris sendiri.
      const cekihBonus = result && result.cekihTarget !== null ? -result.cekihPenalty : 0;
      return {
        melds: [...round.table[seat], ...arrangement.melds],
        meldValues: [...round.table[seat], ...arrangement.melds].map((meld) => meldValue(meld, round.jokerRank)),
        leftover: arrangement.leftover,
        leftoverValues: arrangement.leftover.map((card) => loneValue(card, round.jokerRank)),
        penalty: round.penalties[seat],
        bonus: (result?.bonus ?? 0) - cekihBonus,
        fromHand: result?.fromHand ?? false,
        cekihBonus,
        cekihPenalty: cekihPenaltyOf(round, seat),
        score: scores[seat],
      };
    });
    this.lastRoundScores = scores;
    this.session = applyRound(this.session, scores);
    this.history = [...this.history, { round: this.session.rounds, scores, totals: this.session.totals }];
    this.round = null;
    this.scoringArrangement = null;
    this.scoringConfirmed = [false, false, false, false];
    if (this.session.winner !== null) {
      this.status = "finished";
      return;
    }
    this.firstPlayer = nextFirstPlayer(this.session.totals);
    this.opening = this.newOpening();
    this.status = "opening";
    this.updatePause();
  }

  private newOpening(): OpeningState {
    const { hands, stock } = deal(shuffle(makeDeck(), this.rng));
    return {
      hands,
      stock,
      discard: { cards: [], closedIndex: null },
      jokerRank: null,
      penalties: [0, 0, 0, 0],
    };
  }

  setProfile(seat: PlayerId, profile: PlayerProfile): void {
    this.profiles[seat] = profile;
  }

  setProfiles(profiles: (PlayerProfile | null)[]): void {
    this.profiles = [...profiles];
  }

  // Penonton ikut main: kursi kosong saat menunggu didahulukan, lalu kursi bot (meneruskan tangan dan poinnya).
  sit(userId: string, wanted?: number): PlayerId {
    const seat = wanted === undefined ? this.openSeat() : this.isOpen(wanted) ? (wanted as PlayerId) : null;
    if (seat === null) throw new Error("NO_SEAT");
    this.seats[seat] = userId;
    this.handoverUntil[seat] = null;
    this.offlineSince[seat] = null;
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
      this.offlineSince[seat] = null;
      return;
    }
    this.toBot(seat);
    this.updatePause();
    if (this.status === "scoring") this.confirmScoring(seat, null);
    this.scheduleBot();
  }

  // Kursi milik user ini, dari daftar kursi saat ini. Null untuk penonton.
  seatOf(userId: string): PlayerId | null {
    const seat = this.seats.indexOf(userId);
    return seat === -1 ? null : (seat as PlayerId);
  }

  // Pemain manusia di kursi paling awal. Hanya dia yang boleh reset game.
  firstHumanSeat(): PlayerId | null {
    const seat = this.seats.findIndex((id) => id !== "" && !id.startsWith(BOT_PREFIX));
    return seat === -1 ? null : (seat as PlayerId);
  }

  // Reset milik pemain manusia di kursi paling awal. Tanpa manusia di meja, penonton yang boleh reset (seat null).
  canReset(seat: PlayerId | null): boolean {
    return this.firstHumanSeat() === seat;
  }

  private openSeat(): PlayerId | null {
    if (this.status === "finished" || this.status === "cancelled") return null;
    const empty = this.status === "waiting" ? this.seats.indexOf("") : -1;
    const seat = empty !== -1 ? empty : this.seats.findIndex((id) => id.startsWith(BOT_PREFIX));
    return seat === -1 ? null : (seat as PlayerId);
  }

  // Kursi ini bisa diambil penonton: kursi bot, atau kursi kosong saat menunggu.
  private isOpen(seat: number): boolean {
    if (this.status === "finished" || this.status === "cancelled") return false;
    const id = this.seats[seat];
    if (id === undefined) return false;
    return id.startsWith(BOT_PREFIX) || (id === "" && this.status === "waiting");
  }

  private toBot(seat: PlayerId): void {
    this.seats[seat] = `${BOT_PREFIX}${seat + 1}`;
    this.profiles[seat] = null;
    this.handoverUntil[seat] = this.now() + HANDOVER_MS;
    this.offlineSince[seat] = null;
  }

  private addBots(): void {
    this.seats.forEach((seat, i) => {
      if (seat === "") this.seats[i] = `${BOT_PREFIX}${i + 1}`;
    });
    this.becomeOpeningIfFull();
  }

  private becomeOpeningIfFull(): void {
    if (this.status !== "waiting" || this.seats.includes("")) return;
    this.status = "opening";
    this.updatePause();
    this.scheduleBot();
  }

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

  private botAct(): void {
    if (this.status !== "opening" && this.status !== "playing") return;
    const seat = this.actingSeat();
    // Kursi bisa sudah diambil pemain sungguhan sejak jadwal bot dibuat.
    if (seat === null || !this.seats[seat].startsWith(BOT_PREFIX)) return;
    try {
      this.handle(seat, this.chooseBotIntent(seat));
    } catch {
      // Langkah utama ditolak: coba langkah paling aman. Kalau tetap gagal, sesi menunggu, tidak dipaksa.
      try {
        this.handle(seat, this.fallbackBotIntent(seat));
      } catch {
        // Tidak ada langkah sah.
      }
    }
  }

  private chooseBotIntent(seat: PlayerId): Intent {
    if (this.status === "opening") {
      const hand = this.opening!.hands[seat];
      if (hand.length === HAND_SIZE) return { type: "opening_draw" };
      const used = new Set(this.opening!.discard.cards.map((card) => card.rank));
      const card = mostValuable(hand.filter((c) => !used.has(c.rank))) ?? hand[0];
      return { type: "opening_discard", cardId: card.id };
    }
    return chooseBotPlay(this.round!, seat);
  }

  // Langkah cadangan kalau strategi utama ditolak: ambil cangkulan, lalu buang kartu bernilai tertinggi.
  private fallbackBotIntent(seat: PlayerId): Intent {
    if (this.status !== "playing" || this.round === null) return this.chooseBotIntent(seat);
    const round = this.round;
    if (round.phase === "draw") return { type: "draw_stock" };
    const hand = round.hands[seat];
    const card = mostValuable(hand.filter((c) => !isJoker(c, round.jokerRank))) ?? hand[0];
    return { type: "discard", cardId: card.id };
  }

  private actingSeat(): PlayerId | null {
    if (this.status === "opening") return this.openingOrder()[this.opening!.discard.cards.length];
    if (this.status === "playing") return this.round!.turn;
    return null;
  }
}

export function createRoom(seats: string[], options: RoomOptions): Room {
  return new Room(seats, options);
}

function findCard(cards: Card[], id: string): Card {
  const card = cards.find((c) => c.id === id);
  if (card === undefined) throw new Error("CARD_NOT_IN_HAND");
  return card;
}

function isJoker(card: Card, jokerRank: Rank | null): boolean {
  return jokerRank !== null && card.rank === jokerRank;
}

function mostValuable(cards: Card[]): Card | undefined {
  return cards.reduce<Card | undefined>(
    (best, card) => (best === undefined || baseValue(card.rank) > baseValue(best.rank) ? card : best),
    undefined,
  );
}
