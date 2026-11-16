import { env } from "@/lib/env";
import { windowsInstallScript } from "@/lib/installScripts";

/** irm <origin>/install.ps1 | iex */
export function GET(): Response {
  return new Response(windowsInstallScript(env.APP_URL.replace(/\/$/, "")), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
