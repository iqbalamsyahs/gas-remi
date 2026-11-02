import { useLayoutEffect, useRef, type RefObject } from "react";

// Zona tempat kartu bisa berpindah. Kartu yang pindah antar zona ini dianimasikan.
const ZONES = new Set(["hand", "discard", "meld", "stock"]);

const FLY_MS = 250;
const FLIP_MS = 400;
const STAGGER_MS = 60;
const GLOW_MS = 600;

type Snapshot = {
  cards: Map<string, { rect: DOMRect; zone: string }>;
  stock: DOMRect | null;
};

// Animasi gerak kartu saat diambil, dibuang, dan diturunkan jadi meld. Posisi tiap kartu dicatat di setiap
// perubahan tampilan, lalu kartu yang pindah zona terbang dari posisi lama ke posisi baru (FLIP).
// Kartu dari cangkulan atau buangan dibalik. Meld baru diberi kilau. Tidak mengubah state.
export function useCardMotion(rootRef: RefObject<HTMLElement | null>, view: unknown): void {
  const prev = useRef<Snapshot | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const old = prev.current;
    const next: Snapshot = { cards: new Map(), stock: null };
    next.stock = root.querySelector<HTMLElement>('[data-zone="stock"]')?.getBoundingClientRect() ?? null;
    prev.current = next;
    // Render pertama belum punya posisi lama, jadi tidak ada yang dianimasikan.
    if (!old) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

      if (!moved && !drawn) return;
      const from = moved ? before!.rect : old.stock!;
      const fromDeckOrPile = moved ? before!.zone === "discard" || before!.zone === "stock" : true;
      fly(el, from, rect, fromDeckOrPile, stagger++ * STAGGER_MS);
    });
  }, [rootRef, view]);
}

function fly(el: HTMLElement, from: DOMRect, to: DOMRect, flip: boolean, delay: number): void {
  const offset = `translate(${from.left - to.left}px, ${from.top - to.top}px)`;
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
