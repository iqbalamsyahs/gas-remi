# Remi Indonesia (Discord Activity)

Permainan kartu Remi Indonesia untuk 4 pemain di dalam Discord Activity. Aturan ada di `Spesifikasi Aturan Remi Indonesia.md`, dan keputusan desain ada di `docs/superpowers/specs/`.

## Arsitektur

- **Next.js di Vercel**: halaman Activity (`app/activity`) dan `/api/token` untuk menukar kode OAuth Discord.
- **Cloudflare Worker + Durable Object** (`worker/`): satu `Table` per peluncuran Activity (`instanceId`). State ruang disimpan di storage Durable Object, dan klien tersambung lewat WebSocket.
- **Logika permainan** (`src/rules/`, `server/room.ts`): murni TypeScript tanpa I/O, dipakai oleh Durable Object.

## Menjalankan di lokal

```bash
pnpm install
cp .env.example .env.local   # isi nilainya
pnpm dev                     # web di http://localhost:3000
pnpm worker:dev              # Worker di http://localhost:8788
pnpm test                    # tes logika ruang dan aturan
```

Di luar Discord, isi `NEXT_PUBLIC_WS_URL=ws://localhost:8788` di `.env.local`. Di dalam Discord, kosongkan variabel itu.

### Main tanpa Discord

Untuk cek tampilan dan main bareng bot tanpa membuka Discord:

```bash
pnpm worker:dev:local        # Worker di port 8787 dengan DEV_AUTH=1 (login tanpa Discord)
pnpm dev
```

Buka `http://localhost:3000/activity?dev=Nama`. Tab lain dengan `?dev=Nama2` duduk di meja yang sama. Tambahkan `&room=x` untuk meja terpisah. Tidak perlu `NEXT_PUBLIC_WS_URL`: mode dev otomatis memakai `ws://localhost:8787`. Kalau port itu terpakai, matikan Worker lain dulu. `DEV_AUTH` tidak ada di `wrangler.jsonc`, jadi Worker produksi tetap menolak login dev.

## Deploy

**Worker (Cloudflare)**

```bash
pnpm exec wrangler login
pnpm worker:deploy
pnpm worker:secret   # isi dengan bot token dari Developer Portal -> Bot
```

`DISCORD_APPLICATION_ID` ada di `worker/wrangler.jsonc`. Bot token wajib karena server memanggil REST Discord untuk memverifikasi peserta instance.

**Web (Vercel)**

Import repo ke Vercel, lalu isi environment variable: `NEXT_PUBLIC_DISCORD_CLIENT_ID`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`. Bot untuk testing tidak perlu env, cukup tekan tombol Tambah bot di dalam Activity.

**Discord Developer Portal** (Activities -> URL Mappings)

- Prefix `/` -> domain Vercel.
- Prefix `/ws` -> host Worker, misalnya `remi-room-server.<subdomain>.workers.dev` (tanpa `https://`).

## Batasan yang diketahui

- Bot hanya mengisi kursi kosong untuk testing. Bot tidak menggantikan pemain yang terputus.
- Bot tidak pernah mengambil dari buangan dan tidak pernah menurunkan kartu, jadi permainan dengan semua bot tidak akan mencapai target skor.
