import type { Card, Rank } from "./cards";
import { classify } from "./combos";
import { subsets } from "./subsets";

export function canPartition(cards: Card[], jokerRank: Rank | null): boolean {
  if (cards.length === 0) return true;
  const [first, ...rest] = cards;
  for (const group of subsets(rest, 2, 3)) {
    const meld = [first, ...group];
    if (classify(meld, jokerRank).kind === "invalid") continue;
    if (canPartition(removeCards(rest, group), jokerRank)) return true;
  }
  return false;
}

// Bisa ditutup: habis dipartisi, dan (kalau belum menurunkan seri murni) salah satu kombinasinya seri murni.
// Seri murni harus jadi bagian partisi itu sendiri, bukan sekadar ada di tangan sambil memakai kartu kombinasi lain.
export function canClose(cards: Card[], jokerRank: Rank | null, laidPureSeri: boolean): boolean {
  if (laidPureSeri) return canPartition(cards, jokerRank);
  return subsets(cards, 3, 4).some(
    (group) => classify(group, jokerRank).pure && canPartition(removeCards(cards, group), jokerRank),
  );
}

export function removeCards(hand: Card[], cards: Card[]): Card[] {
  const out = [...hand];
  for (const card of cards) {
    const index = out.findIndex((held) => held.id === card.id);
    if (index === -1) throw new Error("CARD_NOT_IN_HAND");
    out.splice(index, 1);
  }
  return out;
}
