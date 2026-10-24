# Main di Browser dengan Kode Meja: Draf Desain

Tanggal: Oct 24, 2026 · @Ibang

Status: **draf, belum disetujui.** Ditunda dulu; lanjutkan dari review desain ini.

## Tujuan

- Gas Remi bisa dibuka di browser biasa, di luar Discord.
- Satu orang membuat meja dan mendapat kode; teman lain masuk dengan kode itu.
- Alur Discord Activity tetap seperti sekarang.

## Keputusan yang sudah diambil

- Identitas di browser: **tamu dengan nama**, tanpa login (opsi login Discord web ditolak untuk sekarang).

## Usulan (menunggu persetujuan)

### 1. Identitas tamu

- Browser membuat rahasia acak saat pertama dibuka dan menyimpannya di localStorage.
- Rahasia dikirim di hello; worker memakai `guest:` + SHA-256(rahasia) sebagai userId. Pemain lain hanya melihat hash, jadi tidak bisa menyamar. Reload kembali ke kursi yang sama.
- Tanpa kunci tanda tangan atau cookie. (Alternatif: token HMAC dari worker, sama aman tapi butuh secret baru.)
- Nama diketik sekali (1–20 karakter, di-trim), disimpan di localStorage. Avatar: huruf awal nama.

### 2. Kode meja

- 6 karakter dari 31 huruf/angka (tanpa O/0/I/1/L).
- **Buat meja:** klien membuat kode, hello mode `create`. Kalau sudah dipakai → `CODE_TAKEN`, klien coba kode lain. Pembuat duduk di kursi 1.
- **Masuk:** hello mode `join`. Meja belum ada → `ROOM_NOT_FOUND` ("Kode tidak ditemukan"). Yang tahu kode masuk sebagai penonton, lalu "Ikut main".
- Durable Object meja browser dinamai `kode:XXXXXX`, terpisah dari instanceId Discord. Aturan game, bot, penonton, reset tidak berubah.

### 3. Tampilan

- URL membawa `frame_id` → alur Discord. Tanpa `frame_id` → halaman lobi: kolom nama, **Buat meja**, kolom kode + **Masuk**.
- Link berbagi `/?meja=KODE` (query, bukan path baru, karena halaman root juga dibuka Discord).
- Toolbar meja: tombol salin kode/link.

### 4. Umur meja

- Meja tanpa koneksi selama 24 jam dihapus dari storage; kodenya mati.

## Di luar cakupan

- Kick pemain, daftar meja publik, login Discord di web.

## Titik sentuh di kode (dari penelusuran)

- `worker/worker.ts`: router `/room/<id>` sudah memetakan id → Durable Object; `hello` sekarang memverifikasi token Discord dan keanggotaan instance (`instanceMembers`) — perlu cabang tamu.
- `src/client/realtime.ts`: `roomUrl(instanceId)` dan pesan hello.
- `src/client/discord.ts`, `app/page.tsx` (root me-reexport `app/activity/page`).
- `server/profile.ts`: profil tamu `{ name, avatar: null }`.
