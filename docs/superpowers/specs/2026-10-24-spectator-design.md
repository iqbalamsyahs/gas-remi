# Penonton dan Pengganti Bot: Dokumen Desain

Tanggal: Oct 24, 2026 · @Ibang

## Tujuan

- Teman yang ikut membuka Activity bisa **menonton** tanpa ikut main.
- Orang yang masuk bisa **memilih** ikut main (kalau ada kursi) atau tetap menonton.
- Permainan **tidak berhenti** saat pemain keluar atau putus: kursinya diambil alih bot.

## Istilah

- **Pemain**: orang yang duduk di salah satu dari 4 kursi.
- **Penonton**: anggota instance Activity yang terhubung tetapi tidak duduk.
- **Kursi bisa diisi**: kursi kosong (`""`) saat status `waiting`, atau kursi bot (`bot:N`) di status apa pun selain `finished`/`cancelled`.

## Aturan

### 1. Masuk meja

1. Hanya anggota instance Activity (dari REST Discord) yang boleh terhubung, sama seperti sekarang.
2. Saat meja dibuat, hanya orang yang membuat meja (hello pertama) yang langsung duduk di kursi 1. Kursi lain kosong.
3. Orang lain yang terhubung masuk sebagai penonton.
4. Penonton melihat tombol **"Ikut main"** selama ada kursi bisa diisi. Menekannya mengisi kursi bisa diisi pertama (kursi kosong didahulukan, lalu kursi bot).
5. Mengisi kursi bot di tengah ronde berarti meneruskan tangan, meja, dan total poin kursi itu.
6. Orang yang sudah duduk lalu terhubung lagi (reload, tab baru) langsung kembali ke kursinya, seperti sekarang.

### 2. Keluar dari meja

1. Pemain bisa menekan **"Keluar dari meja"** kapan saja. Kursinya langsung menjadi bot (`bot:N`) dan profilnya dihapus. Pengecualian: saat `waiting`, kursinya menjadi kosong (`""`). Orang itu menjadi penonton.
2. Kalau pemain putus saat `opening`/`playing`, permainan dijeda seperti sekarang. Kalau dalam **60 detik** pemain itu tidak kembali, kursinya menjadi bot dan permainan lanjut. Sesi tidak lagi dibatalkan karena putus.
3. Waktu putus dicatat per kursi di semua status. Pemain yang putus saat penyusunan (`scoring`) tetap dikonfirmasi dengan usulan otomatis; kalau 60 detik belum kembali, kursinya juga diganti bot supaya ronde berikutnya tidak macet. Saat menunggu (`waiting`), kursi yang putus 60 detik dikosongkan. Beberapa pemain bisa putus bersamaan; meja tetap dijeda sampai semuanya kembali atau diganti bot.
4. **Jeda serah terima:** setiap kali kursi baru saja diambil alih bot (keluar sengaja atau putus 60 detik), bot di kursi itu menunggu **10 detik** sebelum langkah pertamanya, supaya penonton sempat menekan "Ikut main" dan meneruskan posisi itu. Bot di kursi lain tidak terpengaruh.
5. Pemain yang kembali setelah kursinya diganti bot masuk sebagai penonton. Ia bisa menekan "Ikut main" untuk mengambil kursi bot mana pun, termasuk kursinya sendiri.

### 3. Semua kursi bot

Kalau tidak ada satu pun kursi manusia, bot tidak dijalankan (tidak ada alarm). Bot lanjut setelah ada orang yang ikut main.

### 4. Reset game

Yang boleh reset adalah pemain manusia di kursi paling awal (bukan lagi selalu kursi 1). Reset tetap memakai kursi dan profil yang sama.

### 5. Tampilan penonton

- Penonton hanya menerima info publik: buangan (joker tertutup), kombinasi di meja, jumlah kartu tiap pemain, skor, riwayat, cekih aktif, dan tangan penutup saat penyusunan.
- Penonton tidak pernah menerima kartu tangan siapa pun, maupun susunan penyusunan pemain.
- UI penonton: label "Kamu menonton", keempat pemain tampil di daftar, tanpa tangan, tombol aksi, cekih, target, reset, maupun panel penyusunan. Popup joker tetap muncul.

## Perubahan teknis

### Room (`server/room.ts`)

- Intent baru:
  - `sit`: dikirim penonton. Ditangani lewat method `sit(userId)` (bukan `handle`), menggantikan pemakaian `claimBotSeat` di hello. Mengisi kursi bisa diisi, lalu `scheduleBot()`.
  - `leave`: dikirim pemain. Kursi menjadi `bot:N`, profil `null`. Kalau status `paused` karena kursi itu, permainan lanjut.
- `tick()`: pause yang habis waktunya mengganti kursi `pausedSeat` dengan bot lalu `resume()`, bukan `cancel()`.
- `scheduleBot()`: tidak menjadwalkan apa pun kalau semua kursi bot.
- Field baru `handoverUntil: (number | null)[]` per kursi, disimpan di snapshot. Diisi `now + 10_000` saat kursi diambil alih bot. `scheduleBot()` memakai waktu paling lambat antara jadwal biasa dan `handoverUntil` kursi yang bertindak. Dikosongkan saat kursi diisi manusia lagi.
- Status `waiting` bisa juga mulai lewat `add_bots` seperti sekarang.

### Worker (`worker/worker.ts`)

- `Attachment.seat` menjadi `PlayerId | null` (null = penonton).
- `createRoom` saat meja baru: kursi `[userId, "", "", ""]`. `seatsFrom` dan `TOO_MANY_PLAYERS` dihapus.
- Hello: kalau `userId` ada di kursi, duduk di kursi itu. Kalau tidak, jadi penonton (tidak ditolak).
- Intent dari penonton: hanya `sit` yang diterima. Yang lain dijawab error `SPECTATOR`. Setelah `sit` berhasil, attachment diperbarui dengan kursinya dan profil diambil.
- Intent `leave`: attachment diubah menjadi penonton.
- `webSocketClose` dari penonton tidak memanggil `disconnect`.
- Reset: cek "manusia di kursi paling awal" di worker.

### View (`server/view.ts`)

- `viewFor(room, seat: PlayerId | null)`. Untuk penonton: `you: null`, `hand: []`, `scoring.mine: null`.
- Field baru `canSit: boolean`: ada kursi bisa diisi.
- Field baru `canReset: boolean` per penerima.

### Klien (`app/activity/Table.tsx`, `src/client/messages.ts`)

- Semua pemakaian `view.you` menangani `null`.
- Tombol "Ikut main" (penonton, `canSit`) dan "Keluar dari meja" (pemain).
- Pesan error baru: `SPECTATOR`, `NO_SEAT`.

## Kasus tepi

- **Dua penonton menekan "Ikut main" bersamaan untuk kursi terakhir.** Durable Object memproses berurutan; yang kedua mendapat `NO_SEAT`.
- **Pemain keluar saat gilirannya.** Bot dijadwalkan dan mengambil giliran itu.
- **Pemain keluar saat `waiting`.** Kursinya menjadi kosong (`""`), bukan bot, supaya orang lain bisa duduk.
- **Pemain kursi 1 keluar.** Hak reset pindah ke manusia di kursi paling awal berikutnya. Kalau tidak ada manusia, tidak ada yang bisa reset sampai ada yang ikut main.
- **Orang yang sama membuka dua tab.** Tab lama ditutup, seperti sekarang.

## Pengujian

- `viewFor(room, null)` tidak berisi kartu tangan siapa pun dan `scoring.mine` null.
- `sit` mengisi kursi kosong lebih dulu, lalu kursi bot; menolak dengan `NO_SEAT` kalau penuh manusia.
- `leave` saat bermain mengubah kursi jadi bot dan bot mengambil giliran; saat `waiting` kursi jadi kosong.
- Pause yang habis waktunya mengganti kursi dengan bot dan status kembali ke sebelumnya.
- Setelah `leave` di giliran kursi itu, bot belum bertindak sebelum 10 detik; `sit` dalam jeda itu membuat bot tidak bertindak sama sekali.
- Semua kursi bot: `nextDeadline()` null.
- Skenario manual di Discord: 5 orang, satu menonton, satu keluar di tengah ronde, penonton mengambil kursinya.

## Di luar cakupan

- Daftar nama penonton di layar pemain.
- Link nonton dari luar Discord.
- Pemain yang kembali otomatis mendapat kursinya lagi.
