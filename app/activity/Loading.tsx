import { useEffect, useState, type CSSProperties } from "react";
import { audioBlocked, playOpening, resumeAudio } from "../../src/client/sound";
import styles from "./Table.module.css";

// Langkah masuk yang ditampilkan ke pemain. Detail teknisnya hanya muncul kalau gagal.
const STEPS = ["Menghubungkan ke Discord…", "Memeriksa akunmu…", "Menyiapkan meja…"];
const SUITS = [
  { symbol: "♠", red: false },
  { symbol: "♥", red: true },
  { symbol: "♦", red: true },
  { symbol: "♣", red: false },
];

// Layar masuk sampai tampilan meja pertama datang dari server. step 1–3, failure berisi detail teknis kalau gagal.
export function Loading({ step, note, failure }: { step: number; note: string; failure: string | null }) {
  // Jingle opening diputar saat loading tampil dan dipudarkan saat meja tampil (komponen ini hilang).
  // Kalau browser menahan suara, klik pertama di mana pun (atau tombol musik) memutarnya.
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const stop = playOpening();
    const check = setTimeout(() => setBlocked(audioBlocked()), 300);
    const unlock = () => {
      resumeAudio();
      setBlocked(false);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => {
      stop();
      clearTimeout(check);
      window.removeEventListener("pointerdown", unlock);
    };
  }, []);

  return (
    <main className={styles.loading}>
      <div className={styles.loadingFan} aria-hidden>
        {SUITS.map((suit, i) => (
          <span
            key={suit.symbol}
            className={`${styles.loadingCard} ${suit.red ? styles.red : ""}`}
            style={{ "--i": i } as CSSProperties}
          >
            {suit.symbol}
          </span>
        ))}
      </div>
      <h1 className={styles.loadingTitle}>Gas Remi</h1>
      {blocked && (
        <button type="button" className={styles.tool}>
          🔊 Putar musik
        </button>
      )}
      {failure === null ? (
        <>
          <p role="status">{STEPS[step - 1]}</p>
          <div className={styles.loadingBar}>
            <div style={{ transform: `scaleX(${step / STEPS.length})` }} />
          </div>
          {note && <p className={styles.label}>{note}</p>}
        </>
      ) : (
        <>
          <p role="alert">Gagal masuk ke meja.</p>
          <button type="button" onClick={() => location.reload()}>
            Coba lagi
          </button>
          <details className={styles.loadingDetail}>
            <summary>Detail</summary>
            {failure}
          </details>
        </>
      )}
    </main>
  );
}
