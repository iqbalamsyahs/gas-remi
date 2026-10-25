import { baseValue, type Card, type Rank } from "./cards";
import { canCallCekih } from "./cekih";
import type { PlayerId } from "./opening";
import { canPartition, removeCards } from "./partition";
import { subsets } from "./subsets";
import { canUseMelds, handArrangement, hasPureSeri } from "./scoring";
import { layDownPureSeri, pickFromDiscard, type RoundState } from "./turn";

// Bentuk intent yang sama dengan intent pemain di server. Disimpan di sini supaya strategi bot tidak bergantung server.
export type BotIntent =
  | { type: "draw_stock" }
  | { type: "pickup"; targetId: string; handIds: string[]; discardIds?: string[] }
  | { type: "lay_down"; cardIds: string[] }
  | { type: "discard"; cardId: string }
  | { type: "cekih"; target: number }
  | { type: "cekih_batal"; target: number };

// Strategi sederhana: ambil dari buangan kalau membentuk kombinasi, turunkan seri murni, cekih saat siap tutup,
// dan buang kartu sampah bernilai tertinggi (bukan joker). Kalau bisa tutup, bot tutup.
export function chooseBotPlay(round: RoundState, seat: PlayerId): BotIntent {
  if (round.phase === "draw") return pickupChoice(round, seat) ?? { type: "draw_stock" };
  return layChoice(round, seat) ?? cekihChoice(round, seat) ?? discardChoice(round, seat);
}

// Ambil dari buangan (dari atas ke bawah) kalau kartu target bersama 2-3 kartu tangan membentuk kombinasi sah.
// pickFromDiscard memvalidasi aturan lengkapnya, termasuk syarat seri murni dan kartu yang terblokir.
function pickupChoice(round: RoundState, seat: PlayerId): BotIntent | null {
  const hand = round.hands[seat];
  for (const target of [...round.discard.cards].reverse()) {
    for (const group of subsets(hand, 2, 3)) {
      try {
        pickFromDiscard(round, seat, target, group, []);
      } catch {
        continue;
      }
      return { type: "pickup", targetId: target.id, handIds: group.map((card) => card.id) };
    }
  }
  return null;
}

// Turunkan seri murni dari tangan kalau belum pernah diturunkan di ronde ini.
function layChoice(round: RoundState, seat: PlayerId): BotIntent | null {
  if (round.laidPureSeri[seat]) return null;
  for (const group of subsets(round.hands[seat], 3, 4)) {
    try {
      layDownPureSeri(round, seat, group);
    } catch {
      continue;
    }
    return { type: "lay_down", cardIds: group.map((card) => card.id) };
  }
  return null;
}

// Cekih ke pemain sebelumnya saat tangan sudah tinggal satu kartu lagi. Batalkan kalau syarat tidak lagi terpenuhi.
function cekihChoice(round: RoundState, seat: PlayerId): BotIntent | null {
  const mine = round.cekih.filter((c) => c.caller === seat);
  const ready = canCallCekih(round.hands[seat], round.jokerRank, round.laidPureSeri[seat]);
  if (mine.length > 0 && !ready) return { type: "cekih_batal", target: mine[0].target };
  if (mine.length === 0 && ready) return { type: "cekih", target: (seat + 3) % 4 };
  return null;
}

// Tutup kalau bisa. Kalau tidak, buang kartu bernilai tertinggi yang bukan joker, dan hindari kartu yang
// membuat pemain yang sudah mencekih bisa menutup.
function discardChoice(round: RoundState, seat: PlayerId): BotIntent {
  const hand = round.hands[seat];
  const closing = hand.find((card) => {
    const rest = removeCards(hand, [card]);
    return canPartition(rest, round.jokerRank) && (round.laidPureSeri[seat] || hasPureSeri(rest, round.jokerRank));
  });
  if (closing) return { type: "discard", cardId: closing.id };

  // Kartu terakhir cangkulan: buang joker gratis tanpa penalti, pilih joker yang tidak terpakai di kombinasi.
  if (round.drewFrom === "stock" && round.stock.length === 0) {
    const allowMelds = canUseMelds(hand, round.laidPureSeri[seat], round.jokerRank);
    const spare = handArrangement(hand, round.jokerRank, allowMelds).leftover.find((card) => isJoker(card, round.jokerRank));
    if (spare) return { type: "discard", cardId: spare.id };
  }

  const threats = round.cekih.filter((c) => c.target === seat).map((c) => c.caller);
  const nonJoker = hand.filter((card) => !isJoker(card, round.jokerRank));
  const pool = nonJoker.length > 0 ? nonJoker : hand;
  const safe = pool.filter((card) => !threats.some((caller) => enablesClose(round.hands[caller], card, round.jokerRank)));
  const candidates = safe.length > 0 ? safe : pool;
  const card = candidates.reduce((best, c) => (baseValue(c.rank) > baseValue(best.rank) ? c : best));
  return { type: "discard", cardId: card.id };
}

// Apakah pemain dengan tangan ini bisa menutup setelah mengambil kartu yang dibuang.
function enablesClose(hand: Card[], discarded: Card, jokerRank: Rank | null): boolean {
  const pool = [...hand, discarded];
  return pool.some((_, i) => canPartition(pool.filter((__, j) => j !== i), jokerRank));
}

function isJoker(card: Card, jokerRank: Rank | null): boolean {
  return jokerRank !== null && card.rank === jokerRank;
}
