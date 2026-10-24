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
import type { Card } from "../../src/rules/cards";
import { canCallCekih, cekihTargets } from "../../src/rules/cekih";
import { classify } from "../../src/rules/combos";
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

const TARGET_PRESETS = [500, 1000, 1500, 2000];
// Kalau giliranmu belum dimainkan selama ini, bunyi giliran diulang sekali.
const TURN_REMINDER_MS = 20_000;
// Popup joker tertutup saat pemain klik OK, atau otomatis setelah sekian detik.
const JOKER_POPUP_SECONDS = 15;

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className={styles.modalHead}>
          <strong>{title}</strong>
          <button type="button" className={styles.tool} onClick={onClose}>
            Tutup
          </button>
        </div>
        {children}
      </div>
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
      className={`${styles.card} ${red ? styles.red : ""} ${selected ? styles.selected : ""} ${fresh ? styles.fresh : ""}`}
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
    <div ref={ref} className={styles.fitRow} data-hand={hand ? "" : undefined}>
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

function Melds({ melds }: { melds: Card[][] }) {
  return (
    <div className={styles.row}>
      {melds.map((meld, i) => (
        <div key={i} className={styles.meld}>
          {meld.map((card) => (
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
  const [panel, setPanel] = useState<"result" | "history" | "target" | "settings" | null>(null);
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
  // Pembukaan memakai status "opening", permainan memakai "playing". Keduanya boleh bertindak saat gilirannya.
  const playable = board !== null && (view.status === "opening" || view.status === "playing") && myTurn;

  // Kartu yang baru masuk ke tangan selama giliranmu (dari cangkulan atau buangan), ditandai sampai giliran selesai.
  // Tangan yang diganti seluruhnya (ronde baru dibagikan) tidak ditandai.
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const [prevHand, setPrevHand] = useState(() => view.hand.map((card) => card.id));
  const handKey = view.hand.map((card) => card.id);
  if (handKey.join() !== prevHand.join()) {
    setPrevHand(handKey);
    const added = handKey.filter((id) => !prevHand.includes(id));
    const kept = freshIds.filter((id) => handKey.includes(id));
    setFreshIds(myTurn && added.length < handKey.length ? [...kept, ...added] : []);
  } else if (!myTurn && freshIds.length > 0) {
    setFreshIds([]);
  }

  // Suara dibunyikan dari perubahan tampilan: giliran, cekih, joker, ronde selesai, dan gerakan kartu.
  const [muted, setMutedState] = useState(isMuted);
  const prevView = useRef<PlayerView | null>(null);
  useEffect(() => {
    soundsFor(prevView.current, view).forEach(playSound);
    prevView.current = view;
  }, [view]);
  // Pengingat giliran. Timer mulai ulang setiap ada update, jadi hanya berbunyi kalau giliran didiamkan.
  useEffect(() => {
    if (!playable) return;
    const timer = setTimeout(() => playSound("turn"), TURN_REMINDER_MS);
    return () => clearTimeout(timer);
  }, [playable, view]);
  const scoringPhase = view.status === "scoring" && view.scoring !== null;
  const emptySeats = view.seats.filter((seat) => seat === "").length;
  const nameOf = (seat: number) => view.players[seat]?.name ?? `P${seat + 1}`;
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
  const canLayDown = (drawPhase || discardPhase) && playable && selected.length >= 3;
  const canPickup = drawPhase && playable && pickupTarget !== null && selected.length >= 2;

  // Kartu terpilih dari sampah bisa dijadikan kombinasi baru kalau sah.
  const selectedLeftover = leftoverCards.filter((card) => selected.includes(card.id));
  const canGroup = scoringPhase && !myConfirmed && selectedLeftover.length >= 3 &&
    classify(selectedLeftover, jokerRank).kind !== "invalid";
  const waiting = scoringPhase
    ? view.scoring!.confirmed.map((ok, seat) => (ok ? null : nameOf(seat))).filter(Boolean).join(", ")
    : "";

  return (
    <main className={styles.page}>
      {jokerLeft > 0 && jokerRank !== null && (
        <div className={styles.modalBackdrop}>
          <div className={styles.jokerPopup} role="dialog" aria-label="Joker ditentukan">
            <div>Joker ronde ini: {jokerRank}</div>
            {board?.jokerCard && (
              <div className={styles.jokerCard}>
                <CardFace card={board.jokerCard} disabled />
                <span>Kartu penentu (keluar dari permainan). Tiga kartu {jokerRank} lainnya jadi joker.</span>
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
        <div>Ronde {view.rounds}</div>
        <div className={styles.totals}>
          {view.seats.map((_, seat) => (
            <span key={seat} className={styles.playerRow + (seat === view.you ? " " + styles.me : "")}>
              <Avatar info={view.players[seat]} size={20} />
              {nameOf(seat)}: {view.totals[seat]}
              {view.pausedSeat === seat ? " (terputus)" : ""}
            </span>
          ))}
        </div>
      </header>

      <div className={styles.toolbar}>
        <button type="button" className={styles.tool} onClick={() => setPanel("target")}>
          🎯 Target {view.target}
        </button>
        {view.roundDetail !== null && (
          <button type="button" className={styles.tool} onClick={() => setPanel("result")}>
            Hasil ronde
          </button>
        )}
        {view.history.length > 0 && (
          <button type="button" className={styles.tool} onClick={() => setPanel("history")}>
            Riwayat poin
          </button>
        )}
        <button type="button" className={styles.tool} aria-label="Pengaturan" onClick={() => setPanel("settings")}>
          ⚙️
        </button>
      </div>
      {view.status === "paused" && <p className={styles.notice}>Permainan dijeda, menunggu pemain kembali.</p>}
      {view.status === "cancelled" && <p className={styles.notice}>Sesi dibatalkan karena pemain tidak kembali.</p>}
      {view.status === "finished" && (
        <p className={styles.notice}>Pemenang: {nameOf(view.winner ?? 0)}</p>
      )}
      {scoringPhase && (
        <p className={styles.notice}>
          Ronde selesai. {myConfirmed || spectator ? `Menunggu konfirmasi dari ${waiting}.` : "Susun kombinasimu lalu konfirmasi."}
        </p>
      )}
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
          <div className={styles.row}>
            {view.revealed.cards.map((card) => (
              <CardFace key={card.id} card={card} disabled />
            ))}
          </div>
        </section>
      )}
      {error && <p className={styles.error}>{error}</p>}
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

      <section className={styles.opponents}>
        {view.handCounts.map((count, seat) =>
          seat === view.you ? null : (
            <div key={seat} className={styles.opponent}>
              <div className={styles.playerRow}>
                <Avatar info={view.players[seat]} />
                <strong>{nameOf(seat)}</strong>
              </div>
              <span className={styles.opponentCount}>{view.seats[seat] === "" ? "kosong" : `${count} kartu`}</span>
              {board && board.table[seat].length > 0 && <Melds melds={board.table[seat]} />}
            </div>
          ),
        )}
      </section>

      <section className={styles.middle}>
        <div className={styles.pile}>
          <div className={styles.label}>Cangkulan</div>
          <button
            type="button"
            className={`${styles.deck} ${canDraw ? styles.deckReady : ""}`}
            disabled={!canDraw}
            aria-label="Ambil kartu dari cangkulan"
            onClick={() => send(inOpening ? { type: "opening_draw" } : { type: "draw_stock" })}
          >
            <span className={styles.deckCount}>{board?.stockCount ?? 0}</span>
          </button>
          {canDraw && <div className={styles.label}>Klik untuk ambil</div>}
        </div>

        <div className={styles.discard}>
          <div className={styles.label}>Buangan (klik kartu untuk ambil)</div>
          {pickupTarget !== null && (
            <div className={styles.label}>Kartu di atas target boleh ikut dibentuk jadi kombinasi. Klik untuk memilih.</div>
          )}
          <div className={styles.row}>
            {board?.discard.cards.map((card, index) =>
              "hidden" in card ? (
                <button key={card.id} type="button" className={`${styles.card} ${styles.faceDown}`} disabled>
                  ?
                </button>
              ) : (
                <CardFace
                  key={card.id}
                  card={card}
                  selected={pickupTarget === card.id || pickupExtra.includes(card.id)}
                  disabled={!playable || !drawPhase || (board.discard.closedIndex !== null && index <= board.discard.closedIndex)}
                  onClick={() => discardClick(card.id, index)}
                />
              ),
            )}
          </div>
        </div>
      </section>

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
        {(drawPhase || discardPhase) && playable && !inOpening && (
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
        {!playable && view.status !== "finished" && view.status !== "cancelled" && view.status !== "scoring" && view.status !== "waiting" && (
          <span className={styles.label}>
            Giliran {nameOf(board?.turn ?? 0)}
          </span>
        )}
      </section>

      {board && view.you !== null && board.table[view.you].length > 0 && !scoringPhase && (
        <section className={styles.hand}>
          <div className={styles.label}>Kombinasi yang kamu turunkan</div>
          <Melds melds={board.table[view.you]} />
        </section>
      )}

      {spectator ? null : scoringPhase && !myConfirmed ? (
        <section className={styles.hand}>
          <div className={styles.label}>Kombinasimu (kartu yang tidak masuk kombinasi dihitung minus)</div>
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

      {board && board.cekih.length > 0 && (
        <p className={styles.notice}>
          Cekih aktif: {board.cekih.map((c) => `${nameOf(c.caller)} → ${nameOf(c.target)}`).join(", ")}
        </p>
      )}
      {board?.cekih
        .filter((c) => c.target === view.you)
        .map((c) => (
          <p key={`${c.caller}-${c.target}`} className={styles.notice}>
            {nameOf(c.caller)} menyebut cekih ke kamu.
          </p>
        ))}
      {view.status === "playing" && !spectator && (
        <section className={styles.actions}>
          {view.players.map((info, seat) =>
            !allowedTargets.includes(seat as PlayerId) || info.kind === "empty" || myCekih.some((c) => c.target === seat) ? null : (
              <button
                key={seat}
                type="button"
                className={styles.cekih}
                disabled={!cekihReady}
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
        </section>
      )}
      {panel === "result" && view.roundDetail !== null && (
        <Modal title="Hasil ronde terakhir" onClose={() => setPanel(null)}>
                {(
        <section className={styles.detail}>
          <div className={styles.label}>Hasil ronde terakhir</div>
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
                {detail.bonus !== 0 && <div className={styles.resultLine}>Bonus tutup tangan <span className={styles.plus}>{signed(detail.bonus)}</span></div>}
                {!!detail.cekihBonus && <div className={styles.resultLine}>Bonus cekih <span className={styles.plus}>{signed(detail.cekihBonus)}</span></div>}
                {!!detail.cekihPenalty && <div className={styles.resultLine}>Hukuman cekih <span className={styles.minus}>{signed(detail.cekihPenalty)}</span></div>}
                {detail.penalty !== 0 && <div className={styles.resultLine}>Penalti joker <span className={styles.minus}>{signed(detail.penalty)}</span></div>}
              </div>
            ))}
          </div>
        </section>
      )}
        </Modal>
      )}
      {panel === "history" && view.history.length > 0 && (
        <Modal title="Riwayat poin" onClose={() => setPanel(null)}>
                {(
        <section className={styles.detail}>
          <div className={styles.label}>Riwayat poin (total setelah ronde)</div>
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
      )}
        </Modal>
      )}
      {panel === "target" && (
        <Modal title="Target poin" onClose={() => setPanel(null)}>
          <section className={styles.targetCard}>
            <div className={styles.label}>Target poin: {view.target}</div>
            {spectator || view.rounds > 0 || view.status === "finished" || view.status === "cancelled" ? (
              <div className={styles.label}>
                {spectator ? "Hanya pemain yang bisa mengubah target." : "Target terkunci setelah ronde pertama selesai."}
              </div>
            ) : (
              <>
                <div className={styles.presets}>
                  {TARGET_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={preset === view.target ? styles.presetActive : styles.preset}
                      onClick={() => onIntent({ type: "set_target", target: preset })}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <form
                  className={styles.target}
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
                    placeholder="Lainnya"
                    aria-label="Target poin lainnya"
                    onChange={(event) => setTargetInput(event.target.value)}
                  />
                  <button type="submit" disabled={targetInput === ""}>
                    Atur
                  </button>
                </form>
              </>
            )}
          </section>
        </Modal>
      )}
      {panel === "settings" && (
        <Modal title="Pengaturan" onClose={() => setPanel(null)}>
          <div className={`${styles.actions} ${styles.settings}`}>
            <button
              type="button"
              className={styles.stock}
              onClick={() => {
                setMuted(!muted);
                setMutedState(!muted);
              }}
            >
              {muted ? "🔇 Suara mati" : "🔊 Suara nyala"}
            </button>
            {!spectator && (
              <button type="button" className={styles.danger} onClick={() => confirmThen("leave")}>
                {confirming === "leave" ? "Klik lagi untuk keluar dari meja" : "Keluar dari meja"}
              </button>
            )}
            {view.canReset ? (
              <button type="button" className={styles.reset} onClick={() => confirmThen("reset")}>
                {confirming === "reset" ? "Klik lagi untuk reset game" : "Reset game"}
              </button>
            ) : (
              <div className={styles.label}>Reset game hanya bisa dilakukan pemain manusia di kursi paling awal.</div>
            )}
          </div>
        </Modal>
      )}
    </main>
  );
}
