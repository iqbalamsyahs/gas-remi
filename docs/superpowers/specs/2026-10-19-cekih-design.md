# Aturan Cekih: Dokumen Desain

Tanggal: Oct 19, 2026 · @Ibang

## Tujuan

Menambahkan aturan "cekih": pemain yang tinggal satu kartu lagi untuk menutup tangan boleh memberi peringatan ke pemain lain. Pemain yang diperingatkan harus berhati-hati saat membuang. Kalau ia tetap membuang kartu yang dibutuhkan dan penutupan terjadi dengan cara tertentu, ia kena hukuman.

Aturan ini melengkapi `Spesifikasi Aturan Remi Indonesia.md`. Bagian yang berubah dicatat di "Perubahan dari spesifikasi".

## Istilah

- **Pemain cekih**: pemain yang menyebut cekih.
- **Pemain tercekih**: pemain yang menerima cekih.
- **Tutup tangan**: penutupan ketika pemain penutup tidak pernah mengambil kartu dari buangan di ronde itu. Pemain hanya mengambil dari cangkulan.
- **Tutup biasa**: penutupan ketika pemain penutup pernah mengambil kartu dari buangan di ronde itu.
- **Kartu penutup**: kartu terakhir yang dibuang pemain penutup saat menutup.

## Aturan

### 1. Syarat menyebut cekih

Pemain boleh menyebut cekih ke satu pemain lain, kapan saja di ronde, kalau tangannya tinggal satu kartu lagi untuk menutup. Secara formal, syarat ini terpenuhi jika ada kartu X dari 52 kartu (yang tidak ada di tangan) sehingga tangan setelah ditambah X bisa dibentuk seluruhnya menjadi kombinasi sah (seri, tris, atau keduanya dengan joker), atau tangan setelah ditambah X dikurangi satu kartu sendiri bisa dibentuk seluruhnya. Pada cara kedua, kartu yang dibuang adalah kartu penutup dari tangan sendiri. Pada cara pertama, kartu penutup adalah kartu buangan yang ikut diambil.

Pemain tidak boleh menyebut cekih ke dirinya sendiri, dan tidak boleh menyebut cekih kalau syaratnya tidak terpenuhi.

Pemain tercekih hanya boleh pemain sebelumnya atau pemain sebelumnya lagi (revisi 24 Okt 2026). Tangan yang jadi juga harus punya seri murni, sama seperti syarat tutup.

### 2. Pembatalan

Pemain cekih boleh membatalkan cekih kapan saja sampai ronde selesai. Setelah dibatalkan, pemain itu boleh menyebut cekih lagi kalau syaratnya terpenuhi.

### 3. Masa berlaku

Cekih aktif sampai ronde selesai, kecuali dibatalkan.

### 4. Beberapa cekih ke pemain yang sama

Kalau ada beberapa cekih aktif ke pemain tercekih yang sama, hanya cekih dari pemain penutup yang berlaku. Cekih dari pemain lain tidak mempengaruhi hukuman atau bonus.

### 5. Pengecekan ulang saat penutupan

Syarat cekih dicek lagi saat penutupan, bersama syarat tutup yang sudah ada (tangan sisa setelah kartu penutup dibuang harus bisa dibentuk seluruhnya menjadi kombinasi sah). Kalau saat penutupan syarat cekih tidak lagi berlaku, cekih itu tidak memberi bonus atau hukuman. Penutupan itu sendiri tetap sah kalau syarat tutup terpenuhi.

### 6. Bonus dan hukuman

Bonus dan hukuman hanya terjadi jika penutupan adalah **tutup biasa** dan semua syarat berikut terpenuhi:

1. Pemain penutup memiliki cekih aktif ke pemain T.
2. Kartu buangan yang dipakai membentuk kombinasi pada giliran penutupan termasuk kartu yang dibuang T. Kartu di atasnya yang hanya masuk tangan tidak dihitung (revisi 25 Okt 2026).

Kalau kedua syarat terpenuhi:
- Pemain penutup mendapat **+10× nilai kartu penutup**.
- Pemain T mendapat **−10× nilai kartu penutup**.

Nilai dasar kartu mengikuti tabel nilai di spesifikasi. Kartu penutup bernilai sama walaupun berupa joker, sesuai nilai dasarnya.

Hukuman dan bonus hanya dihitung sekali per penutupan.

### 7. Tutup tangan

Tutup tangan mendapat **+250**, sesuai spesifikasi. Cekih tidak mempengaruhi tutup tangan: tidak ada bonus tambahan dan tidak ada hukuman untuk pemain tercekih.

### 8. Tutup biasa tanpa cekih yang cocok

Tutup biasa tidak mendapat bonus apa pun kalau syarat pada aturan 6 tidak terpenuhi.

## Perubahan dari spesifikasi

- **Dihapus**: bonus "mengambil dari buangan +10× nilai kartu penutup" di bagian "Akhir ronde & perhitungan skor".
- **Diganti**: bonus tutup biasa hanya terjadi lewat cekih (aturan 6).
- **Tetap**: tutup tangan +250, dan aturan pengambilan dari buangan.

Spesifikasi `Spesifikasi Aturan Remi Indonesia.md` perlu diperbarui setelah desain ini disetujui.

## Perubahan teknis

### Engine (`src/rules/`, `server/room.ts`)

- Ronde menyimpan:
  - daftar cekih aktif: `{ caller, target }`
  - pemilik setiap kartu buangan: `discardOwner[cardId] = seat`
  - per pemain, apakah pernah mengambil dari buangan di ronde ini
  - kartu yang diambil pada giliran penutupan dan pemilik buangannya
- Intent baru:
  - `cekih` dengan `target`: validasi syarat aturan 1, lalu tambahkan ke daftar aktif.
  - `cekih_batal` dengan `target`: hapus dari daftar aktif.
- Saat penutupan (`checkClosed` dan penghitungan skor):
  - Tentukan tutup tangan atau tutup biasa dari status pengambilan pemain penutup.
  - Untuk tutup biasa, cek aturan 6 dan hitung bonus atau hukuman.
  - Bonus dan hukuman disimpan di `RoundResult` dan `penalties`, lalu ikut dihitung di skor.

### Tampilan (`app/activity/Table.tsx`)

- Tombol "Cekih" untuk setiap pemain lain, hanya aktif kalau syarat aturan 1 terpenuhi.
- Pemberitahuan ke pemain tercekih: "{nama} menyebut cekih ke kamu."
- Pemain cekih melihat tombol "Batalkan cekih" untuk setiap cekih miliknya.
- Daftar cekih aktif terlihat oleh semua pemain agar permainan transparan.

### Server (Worker)

- Intent `cekih` dan `cekih_batal` diteruskan ke engine seperti intent lain.
- Tidak ada perubahan pada alur koneksi atau penyimpanan.

## Kasus tepi

- **Cekih disebut lalu penutupan terjadi lewat pemain lain tanpa cekih.** Tidak ada hukuman, dan tidak ada bonus karena pemain penutup tidak punya cekih ke pemain T.
- **Pemain tercekih membuang kartu yang tidak dibutuhkan.** Cekih tetap aktif. Penutupan pemain cekih tetap diproses sesuai aturan 6 kalau syaratnya terpenuhi.
- **Pemain cekih tidak bisa menutup lagi di giliran berikutnya.** Cekih tetap aktif sampai ronde selesai, tetapi tidak memberi bonus atau hukuman kalau penutupan tidak terjadi.
- **Cangkulan habis tanpa penutupan.** Tidak ada bonus atau hukuman cekih. Skor dihitung seperti biasa.
- **Pemain yang membatalkan cekih lalu menyebutnya lagi** dicek ulang syaratnya setiap kali disebut.

## Pengujian

- Unit engine:
  - syarat menyebut cekih: benar untuk contoh 2-3-4♥, 9-9-9, 8-8 dengan X = 8, dan salah jika tangan terlalu jauh dari tutup
  - pembatalan menghapus cekih dan bisa disebut lagi
  - beberapa cekih ke pemain yang sama: hanya cekih penutup yang dihitung
  - tutup biasa dengan cekih yang cocok: bonus +10× untuk penutup, −10× untuk T
  - tutup tangan: +250, tanpa efek cekih
  - tutup biasa tanpa kartu dari T: tidak ada bonus atau hukuman
  - pengecekan ulang saat penutupan: cekih yang tidak lagi valid tidak memberi bonus atau hukuman
- Skenario manual dengan 4 pemain sungguhan (setelah deploy).

## Di luar cakupan

- Cekih berulang atau cekih dengan aturan yang berbeda untuk setiap ronde.
- Pemberitahuan suara atau notifikasi di luar Activity.

## Asumsi yang perlu ditinjau

1. Syarat "tinggal satu kartu lagi" memakai definisi formal di aturan 1, dengan X dari 52 kartu. Kalau ada kartu yang tidak mungkin dimiliki pemain, misalnya kartu yang sudah terlihat di buangan, perlu dipersempit.
2. Bonus pemain penutup juga memakai syarat kartu dari T yang sama dengan hukuman. Ini diambil dari jawaban Anda bahwa bonus cekih "berlaku ketika sebut cekih". Kalau bonus berlaku tanpa syarat kartu dari T, aturan 6 perlu diubah.
3. Pemain tercekih tidak dibatasi berapa kali bisa menerima cekih dalam satu ronde.
