import { useLayoutEffect, useRef, type RefObject } from "react";
import type { PlayerView } from "../../server/view";

// Zona tempat kartu bisa berpindah. Kartu yang pindah antar zona ini dianimasikan.
const ZONES = new Set(["hand", "discard", "meld", "stock"]);

const FLY_MS = 250;
const FLIP_MS = 400;
const STAGGER_MS = 60;
const GLOW_MS = 600;
const GHOST_MS = 400;

type Snapshot = {
  cards: Map<string, { rect: DOMRect; zone: string }>;
  stock: DOMRect | null;
  rounds: number;
  stockCount: number;
  handCounts: number[];
};

// Animasi gerak kartu saat diambil, dibuang, dan diturunkan jadi meld. Posisi tiap kartu dicatat di setiap
// perubahan tampilan, lalu kartu yang pindah zona terbang dari posisi lama ke posisi baru (FLIP).
// Kartu dari cangkulan atau buangan dibalik. Meld baru diberi kilau. Aksi lawan (kartu tidak terlihat)
// dianimasikan dari kursinya: buangan terbang dari kursi ke buangan, ambil dari cangkulan memunculkan kartu belakang.
// Tidak mengubah state.
export function useCardMotion(rootRef: RefObject<HTMLElement | null>, view: PlayerView): void {
  const prev = useRef<Snapshot | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const old = prev.current;
    const next: Snapshot = {
      cards: new Map(),
      stock: visibleStock(root)?.getBoundingClientRect() ?? null,
      rounds: view.rounds,
      stockCount: view.board?.stockCount ?? 0,
      handCounts: [...view.handCounts],
    };
    prev.current = next;
    // Render pertama belum punya posisi lama. Ronde baru (kartu dibagikan ulang) tidak dianimasikan.
    if (!old || old.rounds !== view.rounds) {
      root.querySelectorAll<HTMLElement>("[data-card-id]").forEach((el) => {
        next.cards.set(el.dataset.cardId!, { rect: el.getBoundingClientRect(), zone: el.closest<HTMLElement>("[data-zone]")?.dataset.zone ?? "" });
      });
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Lawan yang jumlah kartunya berkurang membuang kartu, dan yang bertambah mengambil dari cangkulan.
    const discarder = view.handCounts.findIndex((count, seat) => seat !== view.you && count < old.handCounts[seat]);
    const drawer = view.handCounts.findIndex((count, seat) => seat !== view.you && count > old.handCounts[seat]);

    let stagger = 0;
    const glowed = new Set<Element>();
    root.querySelectorAll<HTMLElement>("[data-card-id]").forEach((el) => {
      const id = el.dataset.cardId!;
      const zone = el.closest<HTMLElement>("[data-zone]")?.dataset.zone ?? "";
      const rect = el.getBoundingClientRect();
      next.cards.set(id, { rect, zone });
      if (reduced) return;

      const before = old.cards.get(id);
      const moved = before !== undefined && before.zone !== zone && ZONES.has(before.zone) && ZONES.has(zone);
      const drawn = before === undefined && zone === "hand" && old.stock !== null;

      // Kartu baru di meld (atau pindah ke meld) memunculkan kilau di meldnya.
      const meldEl = el.closest<HTMLElement>('[data-zone="meld"]');
      if (zone === "meld" && meldEl && !glowed.has(meldEl) && (moved || before === undefined)) {
        glowed.add(meldEl);
        meldEl.animate(
          [
            { boxShadow: "0 0 0 0 rgba(255, 215, 0, 0)" },
            { boxShadow: "0 0 16px 4px rgba(255, 215, 0, 0.85)" },
            { boxShadow: "0 0 0 0 rgba(255, 215, 0, 0)" },
          ],
          { duration: GLOW_MS, delay: FLY_MS, easing: "ease-in-out" },
        );
      }

      // Buangan lawan baru: terbang dari kursi lawan yang jumlah kartunya berkurang.
      if (before === undefined && zone === "discard" && discarder !== -1) {
        const seat = root.querySelector<HTMLElement>(`[data-seat="${discarder}"]`);
        if (seat) fly(el, seat.getBoundingClientRect(), rect, false, stagger++ * STAGGER_MS);
        return;
      }

      if (!moved && !drawn) return;
      const from = moved ? before!.rect : old.stock!;
      const fromDeckOrPile = moved ? before!.zone === "discard" || before!.zone === "stock" : true;
      fly(el, from, rect, fromDeckOrPile, stagger++ * STAGGER_MS);
    });

    // Lawan mengambil dari cangkulan: kartu belakang terbang dari cangkulan ke kursinya.
    const deck = old.stock;
    const seat = drawer !== -1 ? root.querySelector<HTMLElement>(`[data-seat="${drawer}"]`) : null;
    if (!reduced && seat && deck && next.stockCount < old.stockCount) {
      ghostCard(deck, seat.getBoundingClientRect(), visibleStock(root));
    }
  }, [rootRef, view]);
}

// Titik tengah elemen, dipakai supaya kartu dari kursi yang ukurannya berbeda tetap pas.
function center(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function fly(el: HTMLElement, from: DOMRect, to: DOMRect, flip: boolean, delay: number): void {
  const a = center(from);
  const b = center(to);
  const offset = `translate(${a.x - b.x}px, ${a.y - b.y}px)`;
  const rest = "translate(0px, 0px)";
  if (flip) {
    el.animate(
      [
        { transform: `${offset} perspective(600px) rotateY(180deg)` },
        { transform: `${rest} perspective(600px) rotateY(0deg)` },
      ],
      { duration: FLIP_MS, delay, easing: "ease-out", fill: "backwards" },
    );
  } else {
    el.animate([{ transform: offset }, { transform: rest }], {
      duration: FLY_MS,
      delay,
      easing: "ease-out",
      fill: "backwards",
    });
  }
}

// Cangkulan ada di meja (desktop) dan di dok (HP); ambil yang sedang tampil.
function visibleStock(root: HTMLElement): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>('[data-zone="stock"]')].find((el) => el.offsetParent !== null) ?? null;
}

// Kartu belakang sementara dari cangkulan ke kursi lawan. Dihapus setelah animasi selesai.
// Motif belakang disalin dari cangkulan supaya sama dengan tema CSS (ghost ada di luar scope CSS module).
function ghostCard(from: DOMRect, to: DOMRect, deckEl: HTMLElement | null): void {
  const ghost = document.createElement("div");
  const back = deckEl ? getComputedStyle(deckEl) : null;
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    borderRadius: "6px",
    backgroundColor: back?.backgroundColor ?? "#1f5e5b",
    backgroundImage: back?.backgroundImage ?? "none",
    backgroundSize: back?.backgroundSize ?? "auto",
    border: "2px solid #fff",
    boxSizing: "border-box",
    pointerEvents: "none",
    zIndex: "1000",
  });
  document.body.appendChild(ghost);
  const a = center(from);
  const b = center(to);
  const anim = ghost.animate(
    [
      { transform: "translate(0px, 0px)", opacity: 1 },
      { transform: `translate(${b.x - a.x}px, ${b.y - a.y}px)`, opacity: 0 },
    ],
    { duration: GHOST_MS, easing: "ease-in-out" },
  );
  anim.onfinish = () => ghost.remove();
}
