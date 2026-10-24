"use client";

import { useEffect, useRef, useState } from "react";
import type { Intent } from "../../server/room";
import type { PlayerView } from "../../server/view";
import { connectDiscord } from "../../src/client/discord";
import { messageForError } from "../../src/client/messages";
import { connectRoom, type RoomConnection } from "../../src/client/realtime";
import { Loading } from "./Loading";
import { Table } from "./Table";


export default function ActivityPage() {
  const [view, setView] = useState<PlayerView | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Layar loading: langkah masuk (1–3) dan detail teknis kalau gagal terhubung ke Discord.
  const [step, setStep] = useState(1);
  const [failure, setFailure] = useState<string | null>(null);
  const connection = useRef<RoomConnection | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      let session;
      try {
        session = await connectDiscord(setStep);
      } catch (err) {
        if (!cancelled) setFailure(err instanceof Error ? err.message : "Gagal terhubung ke Discord.");
        return;
      }
      if (cancelled) return;
      setStep(3);

      connection.current = connectRoom(session, {
        onView: (next) => {
          setView(next);
          setError(null);
        },
        onError: (message) => setError(messageForError(message)),
        onStatus: setStatus,
      });
    }

    void start();
    return () => {
      cancelled = true;
      connection.current?.close();
    };
  }, []);

  if (view === null) {
    return <Loading step={step} note={error ?? status} failure={failure} />;
  }

  function onIntent(intent: Intent) {
    if (!connection.current?.send(intent)) setError("Belum tersambung ke server, coba lagi.");
  }

  return <Table view={view} error={error ?? status} onIntent={onIntent} />;
}
