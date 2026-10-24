import { DiscordSDK } from "@discord/embedded-app-sdk";

export interface DiscordSession {
  // ID peluncuran Activity. Baru untuk setiap peluncuran, dan dipakai server untuk memverifikasi peserta.
  instanceId: string;
  accessToken: string;
}

// Alur: ready -> authorize (kode) -> tukar kode di server kita -> authenticate.
// onStep dipanggil dengan nomor langkah untuk layar loading (1 = Discord, 2 = akun). Teks langkah dipakai di pesan error.
// Error dari SDK sering berupa objek biasa, jadi langkah terakhir dan detailnya ikut dilaporkan.
export async function connectDiscord(onStep: (step: 1 | 2) => void): Promise<DiscordSession> {
  let step = "Memulai";
  const at = (message: string, n: 1 | 2) => {
    step = message;
    onStep(n);
  };

  try {
    const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
    if (!clientId) throw new Error("MISSING_CLIENT_ID");

    at("Menunggu handshake dengan Discord (ready)...", 1);
    const sdk = new DiscordSDK(clientId);
    await sdk.ready();

    at("Menunggu izin di Discord (authorize)...", 1);
    // Flow RPC tidak menerima redirect_uri di request. Redirect cukup terdaftar di OAuth2 -> Redirects.
    const { code } = await sdk.commands.authorize({
      client_id: clientId,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify"],
    });

    at("Menukar kode menjadi token...", 2);
    // Root mapping "/" di Developer Portal meneruskan /api/token ke server Next.
    const tokenResponse = await fetch("/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!tokenResponse.ok) throw new Error(`TOKEN_EXCHANGE_FAILED (HTTP ${tokenResponse.status})`);
    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    at("Autentikasi pengguna...", 2);
    const auth = await sdk.commands.authenticate({ access_token });

    return { instanceId: sdk.instanceId, accessToken: auth.access_token };
  } catch (err) {
    throw new Error(`${step} | ${describeError(err)}`);
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) return JSON.stringify(err);
  return String(err);
}
