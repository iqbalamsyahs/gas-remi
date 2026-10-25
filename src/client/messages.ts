// Kode error dari server diubah jadi kalimat yang bisa dibaca pemain.
const MESSAGES: Record<string, string> = {
  // Koneksi dan sesi
  NOT_ENOUGH_PLAYERS: "Menunggu 4 pemain di Activity ini...",
  NOT_SEATED: "Kamu tidak terdaftar sebagai pemain di sesi ini.",
  SPECTATOR: "Kamu sedang menonton. Klik \"Ikut main\" kalau ada kursi.",
  NO_SEAT: "Tidak ada kursi yang bisa diisi sekarang.",
  ALREADY_SEATED: "Kamu sudah duduk di meja.",
  INVALID_TOKEN: "Login Discord tidak valid. Buka ulang Activity.",
  INSTANCE_NOT_FOUND: "Sesi Activity tidak ditemukan. Buka ulang Activity dari voice channel.",
  INSTANCE_MISMATCH: "Kamu membuka sesi yang berbeda. Buka ulang Activity.",
  ROOM_NOT_FOUND: "Sesi belum dimulai.",
  ROOM_CLOSED: "Sesi ini sudah selesai.",
  PAUSED: "Permainan sedang dijeda, menunggu pemain yang terputus kembali.",

  // Giliran dan aksi umum
  NOT_YOUR_TURN: "Belum giliranmu.",
  WRONG_PHASE: "Aksi ini tidak bisa dilakukan sekarang.",
  CARD_NOT_IN_HAND: "Kartu itu tidak ada di tanganmu.",
  ROUND_OVER: "Ronde ini sudah selesai.",

  // Pembukaan
  ALREADY_DRAWN: "Kamu sudah mengambil kartu. Sekarang pilih kartu untuk dibuang.",
  NOT_DRAWN: "Ambil kartu dari cangkulan dulu sebelum membuang.",
  DUPLICATE_OPENING_RANK: "Angka itu sudah dibuang pemain lain di putaran pertama. Pilih kartu dengan angka lain.",
  OPENING_INCOMPLETE: "Pembukaan belum selesai.",

  // Ambil dan turunkan
  PICKUP_BLOCKED: "Kartu itu tidak bisa diambil, karena terhalang joker yang dibuang.",
  PICKUP_TOO_DEEP: "Kartu itu terlalu dalam di buangan. Hanya 7 kartu teratas yang bisa diambil.",
  CARD_NOT_IN_PILE: "Kartu itu tidak ada di buangan.",
  NEED_PURE_SERI: "Pengambilan pertama harus membentuk seri murni (bunga sama, tanpa joker).",
  INVALID_MELD: "Kartu yang dipilih tidak membentuk kombinasi yang sah.",
  NOT_PURE_SERI: "Yang bisa diturunkan ke meja hanya seri murni.",

  // Penyusunan dan skor
  INVALID_ARRANGEMENT: "Susunan kombinasi tidak sah. Periksa lagi kombinasinya.",
  MELD_NEEDS_PURE_SERI: "Kombinasi hanya dihitung plus kalau kamu punya seri murni (sudah diturunkan atau ada di tangan).",
  ALREADY_CONFIRMED: "Kamu sudah konfirmasi susunan.",

  // Cekih
  CEKIH_SELF: "Kamu tidak bisa menyebut cekih ke dirimu sendiri.",
  CEKIH_NOT_ALLOWED: "Belum bisa menyebut cekih. Tanganmu belum tinggal satu kartu lagi untuk tutup.",
  CEKIH_NOT_FOUND: "Tidak ada cekih ke pemain itu yang bisa dibatalkan.",
  CEKIH_ALREADY_ACTIVE: "Cekih ke pemain itu sudah aktif.",
  CEKIH_TARGET_NOT_ALLOWED: "Cekih hanya bisa ke pemain sebelummu dan sebelumnya lagi.",

  // Reset
  TOTALS_LOCKED: "Poin hanya bisa diisi room master sebelum ada yang mengambil kartu.",
  INVALID_TOTALS: "Poin harus bilangan bulat antara -100000 dan 100000.",
  RESET_NOT_ALLOWED: "Hanya pemain manusia di kursi paling awal yang bisa mereset game.",

  // Target
  TARGET_LOCKED: "Target tidak bisa diubah setelah ronde pertama selesai.",
  INVALID_TARGET: "Target harus antara 100 dan 5000.",
};

const FALLBACK = "Aksi tidak bisa dilakukan sekarang. Coba lagi.";

export function messageForError(code: string): string {
  return MESSAGES[code] ?? FALLBACK;
}
