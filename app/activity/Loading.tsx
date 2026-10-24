import type { CSSProperties } from "react";
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
      {failure === null ? (
        <>
          <p role="status">{STEPS[step - 1]}</p>
          <div className={styles.loadingBar}>
            <div style={{ width: `${(step / STEPS.length) * 100}%` }} />
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
