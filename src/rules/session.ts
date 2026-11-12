import type { PlayerId } from "./opening";

export interface SessionState {
  totals: number[];
  target: number;
  rounds: number;
  winner: PlayerId | null;
}

// Skor ronde ditambahkan, lalu pemain yang tersalip direset ke 0, lalu pemenang
// dicek. Pemenang = skor tertinggi di antara yang sudah mencapai target.
export function applyRound(state: SessionState, roundScores: number[]): SessionState {
  const before = state.totals;
  const after = before.map((total, seat) => total + roundScores[seat]);
  const totals = after.map((total, seat) => (wasOvertaken(before, after, seat) ? 0 : total));

  return {
    ...state,
    totals,
    rounds: state.rounds + 1,
    winner: findWinner(totals, state.target),
  };
}

// Pemenang pertama untuk giliran berikutnya: skor tertinggi, seri diberikan ke kursi yang lebih kecil.
export function nextFirstPlayer(totals: number[]): PlayerId {
  let best = 0;
  for (let seat = 1; seat < totals.length; seat++) {
    if (totals[seat] > totals[best]) best = seat;
  }
  return best as PlayerId;
}

// Skor minimal supaya pemain yang tersalip direset ke 0.
const OVERTAKE_RESET_MIN = 100;

// Tersalip: sebelumnya lebih tinggi dari pemain lain, sekarang lebih rendah.
// Hanya direset kalau skornya (setelah ronde) minimal 100. Di bawah itu, termasuk minus, tidak direset.
function wasOvertaken(before: number[], after: number[], seat: number): boolean {
  if (after[seat] < OVERTAKE_RESET_MIN) return false;
  return before.some((other, otherSeat) => otherSeat !== seat && before[seat] > other && after[seat] < after[otherSeat]);
}

function findWinner(totals: number[], target: number): PlayerId | null {
  let winner: number | null = null;
  for (let seat = 0; seat < totals.length; seat++) {
    if (totals[seat] < target) continue;
    // Seri di puncak: kursi yang lebih kecil menang (keputusan kami, spesifikasi tidak mengatur).
    if (winner === null || totals[seat] > totals[winner]) winner = seat;
  }
  return winner as PlayerId | null;
}
