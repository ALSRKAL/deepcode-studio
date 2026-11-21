"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Sign-in state read in the browser (2026-11-21).
 *
 * Public pages (home, pricing) used to read the session on the server, which made every
 * visit a fresh render: the homepage served 11 req/s at 10 s latency under load. They now
 * render one cached version for everyone and swap the signed-in links here, after the page
 * loads. Server-rendered both branches stay plain links, so nothing breaks without JS.
 */
let sessionProbe: Promise<boolean> | null = null;

function probeSignedIn(): Promise<boolean> {
  sessionProbe ??= fetch("/api/auth/get-session", { credentials: "same-origin", cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((body: unknown) => Boolean(body && typeof body === "object" && "user" in body && (body as { user: unknown }).user))
    .catch(() => false);
  return sessionProbe;
}

export function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let live = true;
    void probeSignedIn().then((value) => {
      if (live) setSignedIn(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return signedIn;
}

/** Shows `signedIn` for a signed-in visitor, otherwise `signedOut` (the cached default). */
export function SignedInSwitch({ signedIn, signedOut }: { signedIn: ReactNode; signedOut: ReactNode }) {
  return <>{useSignedIn() ? signedIn : signedOut}</>;
}
