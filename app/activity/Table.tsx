"use client";

import {
  Children,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useCardMotion } from "./useCardMotion";
import type { Card, Rank } from "../../src/rules/cards";
import { canCallCekih, cekihTargets } from "../../src/rules/cekih";
import { classify, orderMeld } from "../../src/rules/combos";
import { MAX_PICKUP_FROM_TOP } from "../../src/rules/discard";
import { isMuted, playSound, setMuted, soundsFor } from "../../src/client/sound";
import type { PlayerId } from "../../src/rules/opening";
import type { Intent } from "../../server/room";
import type { PlayerInfo, PlayerView } from "../../server/view";
import styles from "./Table.module.css";

interface TableProps {
  view: PlayerView;
  error: string | null;
  onIntent: (intent: Intent) => void;
}

const SUIT_SYMBOL: Record<Card["suit"], string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const SUIT_ORDER: Card["suit"][] = ["S", "H", "D", "C"];
const RANK_ORDER = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function bySuitThenRank(a: Card, b: Card): number {
  return SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) || RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
}

// Posisi lawan di meja, urut giliran setelahmu. Penonton melihat empat kursi, jadi kursi keempat di bawah.
const SEAT_POSITIONS = ["left", "top", "right", "bottom"] as const;

const TARGET_PRESETS = [500, 1000, 1500, 2000];
// Selama masih giliranmu, pengingat berbunyi setiap selang waktu ini.
const TURN_REMINDER_MS = 30_000;
// Popup joker tertutup saat pemain klik OK, atau otomatis setelah sekian detik.
const JOKER_POPUP_SECONDS = 15;

// <dialog> bawaan: Esc menutup, fokus pindah ke dalam dan kembali ke tombol pembuka, latar tidak bisa diklik.
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.modal}
      aria-label={title}
      onClose={onClose}
      // Klik di luar kotak (backdrop) menutup modal.
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className={styles.modalHead}>
        <strong>{title}</strong>
        <button type="button" className={styles.tool} onClick={onClose}>
          Tutup
        </button>
      </div>
      {children}
    </dialog>
  );
}

// Contoh kartu di Cara main, ditulis "5H 6H 7H".
function ExampleCards({ cards }: { cards: string }) {
  return (
    <div className={styles.meld}>
      {cards.split(" ").map((code) => (
        <CardFace key={code} card={{ id: `ex-${code}`, rank: code.slice(0, -1) as Rank, suit: code.slice(-1) as Card["suit"] }} disabled />
      ))}
    </div>
  );
}

// Tab di modal Skor: hasil ronde terakhir dan riwayat total poin.
function ScoreTabs({
  current,
  hasResult,
  hasHistory,
  onSelect,
}: {
  current: "result" | "history";
  hasResult: boolean;
  hasHistory: boolean;
  onSelect: (panel: "result" | "history") => void;
}) {
  return (
    <div className={styles.presets} role="tablist">
      {hasResult && (
        <button type="button" role="tab" aria-selected={current === "result"} className={current === "result" ? styles.presetActive : styles.preset} onClick={() => onSelect("result")}>
          Ronde terakhir
        </button>
      )}
      {hasHistory && (
        <button type="button" role="tab" aria-selected={current === "history"} className={current === "history" ? styles.presetActive : styles.preset} onClick={() => onSelect("history")}>
          Riwayat
        </button>
      )}
    </div>
  );
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}

type DragProps = Pick<ButtonHTMLAttributes<HTMLButtonElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel">;

function CardFace({
  card,
  selected,
  onClick,
  disabled,
  fresh,
  ...drag
}: {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  // Kartu yang baru masuk ke tangan di giliran ini.
  fresh?: boolean;
} & DragProps) {
  const red = card.suit === "H" || card.suit === "D";
  return (
    <button
      type="button"
      className={`${styles.card} ${red ? styles.red : ""} ${selected ? styles.selected : ""}`}
      onClick={onClick}
      disabled={disabled}
      data-card-id={card.id}
      {...drag}
    >
      <span className={styles.corner}>
        {card.rank}
        <br />
        {SUIT_SYMBOL[card.suit]}
      </span>
      <span className={styles.center}>{SUIT_SYMBOL[card.suit]}</span>
      {fresh && <span className={styles.freshTag}>baru</span>}
      <span className={`${styles.corner} ${styles.cornerBottom}`}>
        {card.rank}
        <br />
        {SUIT_SYMBOL[card.suit]}
      </span>
    </button>
  );
}

// Baris kartu yang menumpuk otomatis: berjarak normal kalau muat, dan kartu saling menutupi hanya kalau ruangnya sempit.
function FitRow({ count, children, hand = false }: { count: number; children: ReactNode; hand?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Jarak antarkartu: 6px kalau muat, negatif (tumpuk) kalau ruangnya kurang.
  const [spacing, setSpacing] = useState(6);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const first = el.firstElementChild as HTMLElement | null;
      if (!first || count < 2) return setSpacing(6);
      setSpacing(Math.min(6, Math.floor((el.clientWidth - count * first.offsetWidth) / (count - 1))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [count]);
  return (
    <div ref={ref} className={styles.fitRow} data-hand={hand ? "" : undefined} data-zone={hand ? "hand" : undefined}>
      {Children.map(children, (child, i) => (
        <div className={styles.slot} style={{ marginLeft: i === 0 ? 0 : spacing }}>
          {child}
        </div>
      ))}
    </div>
  );
}

// Avatar pemain. Pemain tanpa foto memakai huruf awal, dan bot memakai avatar bot dari server.
function Avatar({ info, size = 22 }: { info: PlayerInfo; size?: number }) {
  if (info.avatarUrl === null) {
    return (
      <span className={styles.avatarFallback} style={{ width: size, height: size }}>
        {info.name.charAt(0)}
      </span>
    );
  }
  // Avatar dari CDN Discord, jadi tidak pakai komponen gambar Next.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.avatar} src={info.avatarUrl} alt="" width={size} height={size} />;
}

const TUTUP_TANGAN_NOTICE = "Ada yang tutup tangan: kartu semua pemain tidak dihitung, kecuali penalti joker.";

function Melds({ melds, jokerRank }: { melds: Card[][]; jokerRank: Rank | null }) {
  return (
    <div className={styles.row}>
      {melds.map((meld, i) => (
        <div key={i} className={styles.meld} data-zone="meld">
          {orderMeld(meld, jokerRank).map((card) => (
            <CardFace key={card.id} card={card} disabled />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Table({ view, error, onIntent }: TableProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pickupTarget, setPickupTarget] = useState<string | null>(null);
  // Urutan tampilan kartu di tangan. Hanya di klien, tidak dikirim ke server.
  const [order, setOrder] = useState<string[]>([]);
  const [pickupExtra, setPickupExtra] = useState<string[]>([]);
  // Tarik kartu tangan untuk mengubah urutannya. Kartu bergeser langsung saat pointer melewati kartu lain.
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  // Aksi berisiko (reset, keluar) butuh dua klik. Kembali normal sendiri setelah beberapa detik.
  const [confirming, setConfirming] = useState<"reset" | "leave" | null>(null);
  // Susunan kombinasi saat fase penyusunan. Null berarti belum diubah, jadi pakai usulan server.
  const [edit, setEdit] = useState<{ round: number; groups: string[][] } | null>(null);
  const [targetInput, setTargetInput] = useState("");
  const [panel, setPanel] = useState<"result" | "history" | "settings" | "continue" | "howto" | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  // Isian poin terakhir per kursi untuk "Lanjutkan game".
  const [totalsInput, setTotalsInput] = useState<string[]>([]);
  // Modal hasil ronde terbuka otomatis saat ronde baru selesai (jumlah ronde bertambah).
  const [seenRounds, setSeenRounds] = useState(view.rounds);
  if (view.rounds !== seenRounds) {
    setSeenRounds(view.rounds);
    if (view.roundDetail !== null) setPanel("result");
  }

  const board = view.board;
  const myTurn = board !== null && board.turn === view.you;
  const inOpening = board?.phase === "opening";
  const drawPhase = board?.phase === "draw";
  const discardPhase = board?.phase === "discard";
  // Buangan ronde terakhir saja, untuk modal hasil ronde.
  const lastDiscards = view.history.length > 0 ? view.history[view.history.length - 1].discards : [];
  // Pembukaan memakai status "opening", permainan memakai "playing". Keduanya boleh bertindak saat gilirannya.
  const playable = board !== null && (view.status === "opening" || view.status === "playing") && myTurn;
  // Kursi yang sedang giliran, untuk ditandai di layar semua pemain. Null di luar pembukaan dan permainan.
  const activeSeat = board !== null && (view.status === "opening" || view.status === "playing") ? board.turn : null;

  // Kartu yang baru masuk ke tangan selama giliranmu (dari cangkulan atau buangan), ditandai sampai giliran selesai.
  // Tangan yang diganti seluruhnya (ronde baru dibagikan) dan kartu di pembukaan tidak ditandai.
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const [prevHand, setPrevHand] = useState(() => view.hand.map((card) => card.id));
  const handKey = view.hand.map((card) => card.id);
  if (handKey.join() !== prevHand.join()) {
    setPrevHand(handKey);
    const added = handKey.filter((id) => !prevHand.includes(id));
    const kept = freshIds.filter((id) => handKey.includes(id));
    setFreshIds(myTurn && !inOpening && added.length < handKey.length ? [...kept, ...added] : []);
  } else if (!myTurn && freshIds.length > 0) {
    setFreshIds([]);
  }

  // Suara dibunyikan dari perubahan tampilan: giliran, cekih, joker, ronde selesai, dan gerakan kartu.
  const [muted, setMutedState] = useState(isMuted);
  // Gerak kartu antar zona (ambil, buang, turunkan meld) dianimasikan dari perubahan tampilan.
  useCardMotion(rootRef, view);
  const prevView = useRef<PlayerView | null>(null);
  useEffect(() => {
    const sounds = soundsFor(prevView.current, view);
    sounds.forEach(playSound);
    // Getar saat giliranmu tiba (Android; iPhone tidak mendukung vibrate).
    if (sounds.includes("turn")) navigator.vibrate?.(200);
    prevView.current = view;
  }, [view]);
  // Pengingat giliran: berbunyi tetap setiap 30 detik selama masih giliranmu.
  useEffect(() => {
    if (!playable) return;
    const timer = setInterval(() => playSound("reminder"), TURN_REMINDER_MS);
    return () => clearInterval(timer);
  }, [playable]);
  const scoringPhase = view.status === "scoring" && view.scoring !== null;
  const tutupTangan = board?.result?.fromHand ?? false;
  const emptySeats = view.seats.filter((seat) => seat === "").length;
  const nameOf = (seat: number) => view.players[seat]?.name ?? `P${seat + 1}`;
  // Opponents read in turn order starting after you (spectators start from seat 0).
  const seatOrder = view.handCounts.map((_, k) => ((view.you ?? -1) + 1 + k) % view.handCounts.length);
  const opponentSeats = seatOrder.filter((seat) => seat !== view.you);
  // Penonton tidak punya kursi: tanpa tangan dan tanpa aksi.
  const spectator = view.you === null;
  // Cekih: tombol hanya tampil kalau tangan sudah tinggal satu kartu lagi untuk tutup.
  const myCekih = board?.cekih.filter((c) => c.caller === view.you) ?? [];
  const cekihReady =
    board !== null &&
    view.you !== null &&
    view.status === "playing" &&
    canCallCekih(view.hand, board.jokerRank, board.laidPureSeri[view.you]);
  const allowedTargets =
    view.you === null ? [] : cekihTargets(view.you, view.hand, board?.jokerRank ?? null, board?.laidPureSeri[view.you] ?? false);
  const myConfirmed = scoringPhase && view.you !== null && view.scoring!.confirmed[view.you];
  const jokerRank = board?.jokerRank ?? null;

  // Joker diumumkan sekali saat ditentukan. Popup menutupi meja sampai pemain klik OK atau waktunya habis,
  // lalu tidak ditampilkan lagi: joker harus diingat pemain.
  const [jokerLeft, setJokerLeft] = useState(0);
  const [prevJoker, setPrevJoker] = useState(jokerRank);
  if (jokerRank !== prevJoker) {
    setPrevJoker(jokerRank);
    if (jokerRank !== null) setJokerLeft(JOKER_POPUP_SECONDS);
  }
  useEffect(() => {
    if (jokerLeft <= 0) return;
    const timer = setTimeout(() => setJokerLeft((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [jokerLeft]);

  // Momen tutup: kartu penutup dibalik besar di tengah meja sebentar, sekali per ronde.
  const closingCard = board?.result?.closingCard ?? null;
  const [closingShown, setClosingShown] = useState<string | null>(closingCard?.id ?? null);
  const [closingVisible, setClosingVisible] = useState(false);
  if (closingCard !== null && closingCard.id !== closingShown) {
    setClosingShown(closingCard.id);
    setClosingVisible(true);
  }
  useEffect(() => {
    if (!closingVisible) return;
    const timer = setTimeout(() => setClosingVisible(false), 2600);
    return () => clearTimeout(timer);
  }, [closingVisible]);

  useEffect(() => {
    if (confirming === null) return;
    const timer = setTimeout(() => setConfirming(null), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  // Kartu yang belum punya posisi (baru datang) ditaruh di belakang, sesuai urutan dari server.
  const handIds = [
    ...order.filter((id) => view.hand.some((card) => card.id === id)),
    ...view.hand.map((card) => card.id).filter((id) => !order.includes(id)),
  ];
  const hand = handIds.map((id) => view.hand.find((card) => card.id === id)!);

  // Penyusunan: kombinasi dari usulan server, atau dari hasil edit pemain di ronde ini.
  const serverGroups = (view.scoring?.mine?.melds ?? []).map((meld) => meld.map((card) => card.id));
  const groups = edit !== null && edit.round === view.rounds ? edit.groups : serverGroups;
  const groupedIds = groups.flat();
  const leftoverCards = view.hand.filter((card) => !groupedIds.includes(card.id));

  // Susunan sementara dikirim ke server untuk perkiraan skor. Dikirim setelah pemain berhenti mengubah sebentar.
  // Hanya setelah pemain mengubah susunan sendiri (edit !== null), supaya usulan server tidak memicu kirim ulang.
  const groupsKey = JSON.stringify(groups);
  const scoringOpen =
    view.status === "scoring" && view.scoring !== null && !spectator && !view.scoring.confirmed[view.you!] && edit !== null;
  const sendPreview = useRef(onIntent);
  useEffect(() => {
    sendPreview.current = onIntent;
  });
  useEffect(() => {
    if (!scoringOpen) return;
    const timer = setTimeout(
      () => sendPreview.current({ type: "scoring_preview", melds: JSON.parse(groupsKey) as string[][] }),
      300,
    );
    return () => clearTimeout(timer);
  }, [groupsKey, scoringOpen]);

  function setGroups(next: string[][]) {
    setEdit({ round: view.rounds, groups: next });
  }

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function clearSelection() {
    setSelected([]);
    setPickupTarget(null);
    setPickupExtra([]);
  }

  function send(intent: Intent) {
    onIntent(intent);
    clearSelection();
  }

  function handPointerDown(id: string, event: ReactPointerEvent<HTMLButtonElement>) {
    dragRef.current = { id, moved: false };
    justDragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const row = event.currentTarget.closest<HTMLElement>("[data-hand]");
    if (!row) return;
    const others = Array.from(row.querySelectorAll<HTMLElement>("[data-card-id]")).filter(
      (el) => el.dataset.cardId !== drag.id,
    );
    const at = others.findIndex((el) => {
      const box = el.getBoundingClientRect();
      return event.clientX < box.left + box.width / 2;
    });
    const next = handIds.filter((id) => id !== drag.id);
    next.splice(at === -1 ? others.length : at, 0, drag.id);
    if (next.some((id, i) => id !== handIds[i])) {
      drag.moved = true;
      setOrder(next);
    }
  }

  function handPointerUp() {
    justDragged.current = dragRef.current?.moved ?? false;
    dragRef.current = null;
  }

  // Klik kartu di buangan: kartu target dipilih dulu, lalu kartu di atasnya bisa ikut dibentuk jadi kombinasi.
  function discardClick(id: string, index: number) {
    const targetIndex = board?.discard.cards.findIndex((card) => card.id === pickupTarget) ?? -1;
    if (pickupTarget !== null && index > targetIndex) {
      setPickupExtra((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
      return;
    }
    setPickupTarget(pickupTarget === id ? null : id);
    setPickupExtra([]);
  }

  function confirmThen(kind: "reset" | "leave") {
    if (confirming !== kind) {
      setConfirming(kind);
      return;
    }
    setConfirming(null);
    clearSelection();
    setPanel(null);
    onIntent({ type: kind });
  }

  // Kartu yang bisa dipakai untuk menurunkan seri murni atau membuang.
  const canDiscard = discardPhase && playable && selected.length === 1;
  // Mengambil dari cangkulan: di pembukaan saat tangan masih 7 kartu, atau di awal giliran main.
  const canDraw =
    playable && (board?.stockCount ?? 0) > 0 && (drawPhase || (inOpening && view.hand.length === 7));
  // Cangkulan dirender di meja (desktop) dan di dok (HP); CSS menampilkan salah satunya.
  const deck =
    (board?.stockCount ?? 0) > 0 ? (
      <button
        type="button"
        className={`${styles.deck} ${canDraw ? styles.deckReady : ""}`}
        data-zone="stock"
        disabled={!canDraw}
        aria-label="Ambil kartu dari cangkulan"
        onClick={() => send(inOpening ? { type: "opening_draw" } : { type: "draw_stock" })}
      >
        <span className={styles.deckCount}>{board?.stockCount ?? 0}</span>
      </button>
    ) : (
      <span className={styles.label}>Cangkulan habis</span>
    );
  // Seri murni cukup sekali per ronde. Tangan tidak boleh kosong setelah menurunkan.
  const canLayDown = (drawPhase || discardPhase) && playable && selected.length >= 3 && selected.length < view.hand.length;
  // Kartu di atas target ikut masuk tangan kalau tidak dipilih untuk kombinasi. Tangan tidak boleh kosong setelah mengambil.
  const targetPos = board?.discard.cards.findIndex((card) => card.id === pickupTarget) ?? -1;
  const aboveTarget = targetPos === -1 ? 0 : (board?.discard.cards.length ?? 0) - targetPos - 1;
  const handLeftAfterPickup = view.hand.length - selected.length + (aboveTarget - pickupExtra.length);
  const canPickup = drawPhase && playable && pickupTarget !== null && selected.length >= 2 && handLeftAfterPickup >= 1;
  // Alasan tombol aksi yang sedang tidak bisa dipakai, supaya pemain tahu apa yang kurang.
  const laidThisRound = board !== null && view.you !== null && board.laidPureSeri[view.you];
  const actionHint = !playable
    ? null
    : drawPhase && pickupTarget !== null && !canPickup
      ? selected.length < 2
        ? "Pilih minimal 2 kartu dari tanganmu untuk dikombinasikan dengan kartu buangan."
        : "Tangan akan kosong setelah mengambil. Sisakan satu kartu untuk dibuang."
      : (drawPhase || discardPhase) && !inOpening && !laidThisRound && selected.length > 0 && !canLayDown
        ? selected.length < 3
          ? "Seri murni minimal 3 kartu."
          : "Tangan akan kosong setelah menurunkan. Sisakan satu kartu untuk dibuang."
        : null;

  // Kartu terpilih dari sampah bisa dijadikan kombinasi baru kalau sah.
  const selectedLeftover = leftoverCards.filter((card) => selected.includes(card.id));
  const canGroup = scoringPhase && !myConfirmed && selectedLeftover.length >= 3 &&
    classify(selectedLeftover, jokerRank).kind !== "invalid";
  // Satu baris status di dok bawah: apa yang harus kamu lakukan sekarang, atau giliran siapa.
  const turnLine = playable
    ? inOpening
      ? view.hand.length === 8
        ? "Giliranmu: buang satu kartu"
        : "Giliranmu: ambil dari cangkulan"
      : drawPhase
        ? "Giliranmu: ambil kartu"
        : "Giliranmu: buang satu kartu"
    : activeSeat !== null
      ? `Giliran ${nameOf(activeSeat)}`
      : null;
  const waiting = scoringPhase
    ? view.scoring!.confirmed.map((ok, seat) => (ok ? null : nameOf(seat))).filter(Boolean).join(", ")
    : "";

  return (
    <main ref={rootRef} className={styles.page}>
      {closingVisible && closingCard !== null && typeof board?.result?.closedBy === "number" && (
        <div className={styles.closingMoment} role="status" onClick={() => setClosingVisible(false)}>
          <div className={styles.closingFlip}>
            <CardFace card={closingCard} disabled />
          </div>
          <strong>
            {nameOf(board.result.closedBy)} {board.result.fromHand ? "tutup tangan!" : "tutup!"}
          </strong>
        </div>
      )}
      {jokerLeft > 0 && jokerRank !== null && (
        <div className={styles.modalBackdrop}>
          <div className={styles.jokerPopup} role="dialog" aria-label="Joker ditentukan">
            <div>Joker ronde ini: {jokerRank}</div>
            {board?.jokerCard && (
              <div className={styles.jokerCard}>
                <CardFace card={board.jokerCard} disabled />
                <span>Kartu penentu ditaruh tertutup di paling bawah buangan. Satu joker sudah keluar, tinggal tiga kartu {jokerRank} lagi.</span>
              </div>
            )}
            <div className={styles.label}>Ingat baik-baik, joker tidak ditampilkan lagi.</div>
            <button type="button" className={styles.stock} onClick={() => setJokerLeft(0)}>
              OK ({jokerLeft})
            </button>
          </div>
        </div>
      )}
      <header className={styles.header}>
        <div className={styles.round}>
          {/* rounds = ronde yang sudah selesai; selama main, tampilkan ronde yang sedang berjalan. */}
          <strong>Ronde {view.status === "finished" ? view.rounds : view.rounds + 1}</strong>
          <span>target {view.target}</span>
        </div>
      {/* Tiga tombol tetap, tidak muncul-hilang, supaya posisinya mudah dihafal. */}
      <div className={styles.toolbar}>
        <button type="button" className={styles.tool} onClick={() => setPanel("howto")}>
          <span aria-hidden className={styles.toolIcon}>?</span> Aturan
        </button>
        <button
          type="button"
          className={styles.tool}
          disabled={view.roundDetail === null && view.history.length === 0}
          onClick={() => setPanel(view.roundDetail !== null ? "result" : "history")}
        >
          <span aria-hidden className={styles.toolIcon}>≡</span> Skor
        </button>
        <button type="button" className={styles.tool} aria-label="Pengaturan" title="Pengaturan" onClick={() => setPanel("settings")}>
          <span aria-hidden className={styles.toolIcon}>⚙&#xFE0E;</span>
        </button>
      </div>
      </header>
      {/* Meja: lawan mengelilingi (kiri, atas, kanan sesuai urutan giliran setelahmu), cangkulan dan buangan di tengah. */}
      <section className={styles.table}>
        {opponentSeats.map((seat, i) => (
          <div key={seat} data-seat={seat} className={`${styles.opponent} ${styles[SEAT_POSITIONS[i]]}`}>
            <div className={`${styles.seatBox} ${seat === activeSeat ? styles.active : ""}`}>
              {seat === activeSeat && <span className={styles.turnTag}>giliran</span>}
              <div className={styles.playerRow}>
                <Avatar info={view.players[seat]} size={28} />
                <strong>{nameOf(seat)}</strong>
              </div>
              <span className={styles.seatStats}>
                <span className={styles.opponentCount}>{view.totals[seat]} poin</span>
                {view.pausedSeat === seat ? (
                  <span className={styles.opponentCount}>terputus</span>
                ) : view.seats[seat] === "" ? (
                  <span className={styles.opponentCount}>kosong</span>
                ) : (
                  // Kipas punggung kartu: jumlah kartu di tangan lawan, terbaca sekilas.
                  <span className={styles.handFan} aria-label={`${view.handCounts[seat]} kartu`}>
                    <span aria-hidden className={styles.fanBacks} />
                    {view.handCounts[seat]}
                  </span>
                )}
              </span>
              {spectator && view.canSit && (view.players[seat].kind === "bot" || (view.status === "waiting" && view.seats[seat] === "")) && (
                <button type="button" className={styles.sit} onClick={() => onIntent({ type: "sit", seat })}>
                  Duduk di sini
                </button>
              )}
              {board && board.table[seat].length > 0 && (
                <div className={styles.seatMelds}>
                  <Melds melds={board.table[seat]} jokerRank={board.jokerRank} />
                </div>
              )}
            </div>
          </div>
        ))}

        <div className={styles.felt}>
          <div className={styles.status} role="status">
            {view.status === "paused" && <p className={styles.notice}>Permainan dijeda, menunggu pemain kembali.</p>}
            {view.status === "cancelled" && <p className={styles.notice}>Sesi dibatalkan karena pemain tidak kembali.</p>}
            {view.status === "finished" && (
              <p className={styles.notice}>Pemenang: {nameOf(view.winner ?? 0)}</p>
            )}
            {scoringPhase && (
              <p className={styles.notice}>
                Ronde selesai. {myConfirmed || spectator ? `Menunggu konfirmasi dari ${waiting}.` : "Susun kombinasimu lalu konfirmasi."}
                {tutupTangan && ` ${TUTUP_TANGAN_NOTICE}`}
              </p>
            )}
            {error && <p className={styles.error}>{error}</p>}
            {board && board.cekih.length > 0 && (
              <p className={styles.notice}>
                Cekih aktif: {board.cekih.map((c) => `${nameOf(c.caller)} → ${nameOf(c.target)}`).join(", ")}
              </p>
            )}
            {board?.cekih
              .filter((c) => c.target === view.you)
              .map((c) => (
                <p key={`${c.caller}-${c.target}`} className={`${styles.notice} ${styles.cekihAlert}`}>
                  {nameOf(c.caller)} menyebut cekih ke kamu.
                </p>
              ))}
          </div>
          {view.status === "waiting" && (
            <section className={styles.targetCard}>
              <div className={styles.label}>Menunggu pemain. Kursi kosong: {emptySeats}</div>
              {!spectator && (
                <button type="button" className={styles.stock} onClick={() => onIntent({ type: "add_bots" })}>
                  Tambah bot ({emptySeats})
                </button>
              )}
            </section>
          )}
          {view.revealed !== null && view.status === "scoring" && (
            <section className={styles.detail}>
              <div className={styles.label}>Tangan {nameOf(view.revealed.seat)} (penutup), bisa dicek semua pemain</div>
              <Melds melds={view.revealed.groups} jokerRank={board?.jokerRank ?? null} />
            </section>
          )}
          <section className={styles.middle}>
            {/* Di HP cangkulan pemain pindah ke dok (dekat jempol); penonton tetap melihatnya di meja. */}
            <div className={`${styles.pile} ${spectator ? "" : styles.pileDocked}`}>
              <div className={styles.label}>Cangkulan</div>
              {deck}
              {canDraw && <div className={styles.label}>Klik untuk ambil</div>}
            </div>

            <div className={styles.discard}>
              <div className={styles.label}>Buangan</div>
              {playable && drawPhase && pickupTarget === null && (
                <div className={styles.label}>Kartu bertanda kuning bisa diambil.</div>
              )}
              {pickupTarget !== null && (
                <div className={styles.label}>Kartu di atas target boleh ikut dibentuk jadi kombinasi. Klik untuk memilih.</div>
              )}
              <div className={styles.row} data-zone="discard">
                {board?.discard.cards.map((card, index) => {
                  // Bisa diambil: maksimal 7 dari atas dan tidak di/bawah joker tertutup. Ditandai untuk semua pemain.
                  const pickable =
                    board.discard.cards.length - index <= MAX_PICKUP_FROM_TOP &&
                    (board.discard.closedIndex === null || index > board.discard.closedIndex);
                  return "hidden" in card ? (
                    <button key={card.id} type="button" className={`${styles.card} ${styles.faceDown}`} disabled>
                      <span className={styles.hiddenMark}>?</span>
                    </button>
                  ) : (
                    // Tanda baru muncul setelah joker ditentukan (putaran pertama selesai).
                    <span
                      key={card.id}
                      className={`${!inOpening && pickable ? styles.pickable : ""} ${board.result?.closingCard?.id === card.id ? styles.closing : ""}`}
                    >
                      <CardFace
                        card={card}
                        selected={pickupTarget === card.id || pickupExtra.includes(card.id)}
                        disabled={!playable || !drawPhase || !pickable}
                        onClick={() => discardClick(card.id, index)}
                      />
                      {board.result?.closingCard?.id === card.id && (
                        <span className={styles.closingTag}>{board.result.fromHand ? "Tutup tangan" : "Tutup"}</span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      </section>

      <div className={`${styles.dock} ${playable ? styles.dockActive : ""}`}>
        {!spectator && view.you !== null && (
          <div className={styles.dockHead}>
            <span className={styles.playerRow}>
              <Avatar info={view.players[view.you]} size={24} />
              <strong>{nameOf(view.you)}</strong>
              <span className={styles.opponentCount}>{view.totals[view.you]} poin</span>
            </span>
            {board && board.table[view.you].length > 0 && !scoringPhase && (
              <div className={styles.myMelds} aria-label="Kombinasi yang kamu turunkan">
                <Melds melds={board.table[view.you]} jokerRank={board.jokerRank} />
              </div>
            )}
            {turnLine && <span className={playable ? styles.turnLineMine : styles.turnLine}>{turnLine}</span>}
          </div>
        )}
        {actionHint && <p className={styles.hint}>{actionHint}</p>}

        {spectator ? null : scoringPhase && !myConfirmed ? (
          <section className={styles.hand}>
            <div className={styles.label}>Kombinasimu (kartu yang tidak masuk kombinasi dihitung minus)</div>
            {view.scorePreview && (
              <p className={styles.notice}>
                Perkiraan skor: {view.seats.map((_, seat) => `${nameOf(seat)} ${signed(view.scorePreview![seat])}`).join(" · ")}
              </p>
            )}
            {groups.map((group, index) => (
              <div key={index} className={styles.row}>
                {group.map((id) => {
                  const card = view.hand.find((c) => c.id === id)!;
                  return <CardFace key={id} card={card} disabled />;
                })}
                <button type="button" className={styles.tool} onClick={() => setGroups(groups.filter((_, i) => i !== index))}>
                  Lepas
                </button>
              </div>
            ))}
            <div className={styles.label}>Sampah</div>
            <FitRow count={leftoverCards.length}>
              {leftoverCards.map((card) => (
                <CardFace
                  key={card.id}
                  card={card}
                  selected={selected.includes(card.id)}
                  onClick={() => toggle(card.id)}
                />
              ))}
            </FitRow>
            <div className={styles.groupActions}>
              <button
                type="button"
                disabled={!canGroup}
                onClick={() => {
                  setGroups([...groups, selectedLeftover.map((card) => card.id)]);
                  clearSelection();
                }}
              >
                Jadikan kombinasi
              </button>
              <button type="button" onClick={() => onIntent({ type: "confirm", melds: groups })}>
                Konfirmasi susunan
              </button>
            </div>
          </section>
        ) : (
          <section className={styles.hand}>
            <div className={styles.label}>
              <span className={styles.dockDeck}>{deck}</span>
              Kartumu{" "}
              <button type="button" className={styles.tool} onClick={() => setOrder([...view.hand].sort(bySuitThenRank).map((card) => card.id))}>
                Urutkan
              </button>
            </div>
            <FitRow count={hand.length} hand>
              {hand.map((card) => (
                <CardFace
                  key={card.id}
                  card={card}
                  selected={selected.includes(card.id)}
                  fresh={freshIds.includes(card.id)}
                  onClick={() => {
                    if (justDragged.current) {
                      justDragged.current = false;
                      return;
                    }
                    if (playable) toggle(card.id);
                  }}
                  onPointerDown={(event) => handPointerDown(card.id, event)}
                  onPointerMove={handPointerMove}
                  onPointerUp={handPointerUp}
                  onPointerCancel={handPointerUp}
                />
              ))}
            </FitRow>
          </section>
        )}

        {/* Bar aksi: tetap di paling bawah, termasuk cekih. */}
        <section className={styles.actions}>
          {inOpening && playable && view.hand.length === 8 && (
            <button
              type="button"
              disabled={selected.length !== 1}
              onClick={() => send({ type: "opening_discard", cardId: selected[0] })}
            >
              Buang kartu terpilih
            </button>
          )}
          {drawPhase && playable && (
            <button
              type="button"
              disabled={!canPickup}
              onClick={() => send({ type: "pickup", targetId: pickupTarget!, handIds: selected, discardIds: pickupExtra })}
            >
              Ambil dari buangan
            </button>
          )}
          {(drawPhase || discardPhase) && playable && !inOpening && board && !board.laidPureSeri[view.you!] && (
            <button
              type="button"
              disabled={!canLayDown}
              onClick={() => send({ type: "lay_down", cardIds: selected })}
            >
              Turunkan seri murni
            </button>
          )}
          {discardPhase && playable && !inOpening && (
            <button
              type="button"
              disabled={!canDiscard}
              onClick={() => send({ type: "discard", cardId: selected[0] })}
            >
              Buang
            </button>
          )}
          {view.status === "playing" && !spectator && (
            <>
              {view.players.map((info, seat) =>
                !cekihReady || !allowedTargets.includes(seat as PlayerId) || info.kind === "empty" || myCekih.some((c) => c.target === seat) ? null : (
                  <button
                    key={seat}
                    type="button"
                    className={styles.cekih}
                    onClick={() => onIntent({ type: "cekih", target: seat })}
                  >
                    Cekih {info.name}
                  </button>
                ),
              )}
              {myCekih.map((c) => (
                <button
                  key={c.target}
                  type="button"
                  className={styles.danger}
                  onClick={() => onIntent({ type: "cekih_batal", target: c.target })}
                >
                  Batalkan cekih ke {nameOf(c.target)}
                </button>
              ))}
              {cekihReady && allowedTargets.length > 0 && (
                <span className={styles.hint}>Kamu tinggal butuh satu kartu lagi. Kartu itu diharapkan dari {nameOf(allowedTargets[0])}.</span>
              )}
            </>
          )}
        </section>
      </div>
      {panel === "result" && view.roundDetail !== null && (
        <Modal title="Skor" onClose={() => setPanel(null)}>
        <ScoreTabs current="result" hasResult hasHistory={view.history.length > 0} onSelect={setPanel} />
        <section className={styles.detail}>
          {view.roundDetail.some((detail) => detail.fromHand) && <p className={styles.notice}>{TUTUP_TANGAN_NOTICE}</p>}
          <div className={styles.resultGrid}>
            {view.roundDetail.map((detail, seat) => (
              <div key={seat} className={styles.resultSeat}>
                <div className={styles.resultHead}>
                  <span className={styles.playerRow}>
                    <Avatar info={view.players[seat]} />
                    <strong>{nameOf(seat)}</strong>
                  </span>
                  <span className={detail.score < 0 ? styles.minus : styles.plus}>{signed(detail.score)}</span>
                </div>
                {detail.melds.length > 0 && <div className={styles.resultSubtitle}>Kombinasi</div>}
                {detail.melds.map((meld, i) => (
                  <div key={i} className={styles.resultLine}>
                    <div className={styles.cards}>
                      {meld.map((card) => (
                        <CardFace key={card.id} card={card} disabled />
                      ))}
                    </div>
                    <span className={detail.meldValues[i] < 0 ? styles.minus : styles.plus}>{signed(detail.meldValues[i])}</span>
                  </div>
                ))}
                {detail.leftover.length > 0 && <div className={styles.resultSubtitle}>Sampah</div>}
                {detail.leftover.length > 0 && (
                  <div className={styles.cards}>
                    {detail.leftover.map((card, i) => (
                      <span key={card.id} className={styles.leftCard}>
                        <CardFace card={card} disabled />
                        <span className={styles.minus}>{signed(detail.leftoverValues[i])}</span>
                      </span>
                    ))}
                  </div>
                )}
                {detail.bonus !== 0 && <div className={styles.resultLine}>{detail.fromHand ? "Bonus tutup tangan" : "Bonus tutup"} <span className={styles.plus}>{signed(detail.bonus)}</span></div>}
                {!!detail.cekihBonus && <div className={styles.resultLine}>Bonus cekih <span className={styles.plus}>{signed(detail.cekihBonus)}</span></div>}
                {!!detail.cekihPenalty && <div className={styles.resultLine}>Hukuman cekih <span className={styles.minus}>{signed(detail.cekihPenalty)}</span></div>}
                {detail.penalty !== 0 && <div className={styles.resultLine}>Penalti joker <span className={styles.minus}>{signed(detail.penalty)}</span></div>}
              </div>
            ))}
          </div>
          {lastDiscards.length > 0 && (
            <>
              <div className={styles.resultSubtitle}>Buangan ronde ini</div>
              <div className={styles.cards}>
                {lastDiscards.map((d, i) => (
                  <span key={i} className={styles.discardCard}>
                    <CardFace card={d.card} disabled />
                    <span className={styles.discardWho}>{nameOf(d.seat)}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </section>
        </Modal>
      )}
      {panel === "howto" && (
        <Modal title="Cara main" onClose={() => setPanel(null)}>
          <div className={styles.howto}>
            <section>
              <h3>Giliranmu</h3>
              {/* Benar-benar urutan, jadi pakai nomor. */}
              <ol className={styles.howtoSteps}>
                <li>Ambil satu kartu dari cangkulan atau buangan.</li>
                <li>Turunkan kombinasi kalau mau.</li>
                <li>Buang satu kartu.</li>
              </ol>
            </section>
            <section>
              <h3>Kombinasi</h3>
              <div className={styles.howtoExamples}>
                <figure>
                  <ExampleCards cards="5H 6H 7H" />
                  <figcaption>
                    <strong>Seri</strong> 3 kartu atau lebih berurutan, sewarna.
                  </figcaption>
                </figure>
                <figure>
                  <ExampleCards cards="9S 9H 9D" />
                  <figcaption>
                    <strong>Tris</strong> 3–4 kartu nilai sama, beda warna.
                  </figcaption>
                </figure>
              </div>
              <p>
                <strong>Seri murni</strong> adalah seri tanpa joker. Turunkan sekali per ronde sebelum boleh mengambil dari buangan.
              </p>
            </section>
            <section>
              <h3>Ambil dari buangan</h3>
              <p>
                Kartu yang kamu tuju dan semua kartu di atasnya ikut terambil. Kartu itu harus jadi kombinasi dengan minimal 2 kartu dari tanganmu,
                dan tanganmu tidak boleh kosong setelahnya.
              </p>
            </section>
            <section>
              <h3>Joker</h3>
              <p>
                Ditentukan di awal ronde. Bisa menggantikan kartu apa pun, kecuali di seri murni. Membuang joker kena penalti.
              </p>
            </section>
            <section>
              <h3>Menutup ronde</h3>
              <p>
                <strong>Tutup</strong>: semua sisa kartumu sudah jadi kombinasi, lalu buang kartu terakhir.
              </p>
              <p>
                <strong>Tutup tangan</strong>: tutup tanpa pernah mengambil dari buangan. Bonus lebih besar.
              </p>
              <p>
                <strong>Cekih</strong>: saat tinggal butuh satu kartu, sebut cekih ke satu pemain. Kalau kartu penutupmu datang dari buangan dia, kamu
                dapat bonus dan dia kena hukuman.
              </p>
            </section>
            <section>
              <h3>Skor</h3>
              <p>
                Kombinasi dihitung <span className={styles.plus}>plus</span>, kartu sisa dihitung <span className={styles.minus}>minus</span>.
                Perkiraan skor tampil sebelum kamu konfirmasi susunan.
              </p>
            </section>
          </div>
        </Modal>
      )}
      {panel === "history" && view.history.length > 0 && (
        <Modal title="Skor" onClose={() => setPanel(null)}>
        <ScoreTabs current="history" hasResult={view.roundDetail !== null} hasHistory onSelect={setPanel} />
        <section className={styles.detail}>
          <div className={styles.label}>Total poin setelah tiap ronde</div>
          <table className={styles.history}>
            <thead>
              <tr>
                <th>Ronde</th>
                {view.seats.map((_, seat) => (
                  <th key={seat}>{nameOf(seat)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.history.map((entry) => (
                <tr key={entry.round}>
                  <td>{entry.round}</td>
                  {entry.totals.map((total, seat) => (
                    <td key={seat}>
                      {total} <span className={entry.scores[seat] < 0 ? styles.minus : styles.plus}>({signed(entry.scores[seat])})</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        </Modal>
      )}
      {panel === "settings" && (
        <Modal title="Pengaturan" onClose={() => setPanel(null)}>
          <div className={styles.settingsList}>
          <section className={styles.settingsRow}>
            <div className={styles.settingsHead}>
              <strong>Target poin</strong>
              <span className={styles.settingsValue}>{view.target}</span>
            </div>
            {spectator || view.rounds > 0 || view.status === "finished" || view.status === "cancelled" ? (
              <div className={styles.label}>
                {spectator ? "Hanya pemain yang bisa mengubah target." : "Terkunci setelah ronde pertama selesai."}
              </div>
            ) : (
              <>
                <div className={styles.presets}>
                  {TARGET_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      aria-pressed={preset === view.target}
                      className={preset === view.target ? styles.presetActive : styles.preset}
                      onClick={() => onIntent({ type: "set_target", target: preset })}
                    >
                      {preset}
                    </button>
                  ))}
                  {/* Angka lain: ketik lalu Enter, tombol Atur muncul setelah ada isinya. */}
                  <form
                    className={styles.presetCustom}
                    onSubmit={(event) => {
                      event.preventDefault();
                      onIntent({ type: "set_target", target: Number(targetInput) });
                      setTargetInput("");
                    }}
                  >
                    <input
                      type="number"
                      min={100}
                      max={5000}
                      step={50}
                      value={targetInput}
                      placeholder="Lain"
                      aria-label="Target poin lainnya"
                      onChange={(event) => setTargetInput(event.target.value)}
                    />
                    {targetInput !== "" && <button type="submit">Atur</button>}
                  </form>
                </div>
              </>
            )}
          </section>
          <label className={`${styles.settingsRow} ${styles.settingsHead} ${styles.switchRow}`}>
            <strong>Suara</strong>
            <input
              type="checkbox"
              role="switch"
              className={styles.switch}
              checked={!muted}
              onChange={() => {
                setMuted(!muted);
                setMutedState(!muted);
              }}
            />
          </label>
          {view.canSetTotals && (
            <button
              type="button"
              className={`${styles.settingsRow} ${styles.settingsHead} ${styles.settingsLink}`}
              onClick={() => {
                setTotalsInput(view.totals.map(String));
                setPanel("continue");
              }}
            >
              <strong>Lanjutkan game sebelumnya</strong>
              <span aria-hidden>›</span>
            </button>
          )}
          </div>
          {/* Aksi berisiko dipisah di bawah, berdampingan, perlu dua klik. */}
          {(!spectator || view.canReset) && (
            <div className={styles.dangerZone}>
              {!spectator && (
                <button type="button" className={styles.danger} onClick={() => confirmThen("leave")}>
                  {confirming === "leave" ? "Klik lagi untuk keluar" : "Keluar dari meja"}
                </button>
              )}
              {view.canReset && (
                <button type="button" className={styles.danger} onClick={() => confirmThen("reset")}>
                  {confirming === "reset" ? "Klik lagi untuk reset" : "Reset game"}
                </button>
              )}
            </div>
          )}
        </Modal>
      )}
      {panel === "continue" && view.canSetTotals && (
        <Modal title="Lanjutkan game" onClose={() => setPanel(null)}>
          <form
            className={styles.targetCard}
            onSubmit={(event) => {
              event.preventDefault();
              onIntent({ type: "set_totals", totals: totalsInput.map(Number) });
              setPanel(null);
            }}
          >
            <div className={styles.label}>Poin terakhir tiap pemain. Poin tertinggi main duluan.</div>
            {view.seats.map((_, seat) => (
              <label key={seat} className={`${styles.target} ${styles.playerRow}`}>
                <Avatar info={view.players[seat]} />
                <span>{nameOf(seat)}</span>
                <input
                  type="number"
                  step={1}
                  required
                  value={totalsInput[seat] ?? ""}
                  aria-label={`Poin ${nameOf(seat)}`}
                  onChange={(event) => setTotalsInput(totalsInput.map((v, i) => (i === seat ? event.target.value : v)))}
                />
              </label>
            ))}
            <button type="submit" className={styles.stock}>
              Simpan poin
            </button>
          </form>
        </Modal>
      )}
    </main>
  );
}
