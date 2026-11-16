import { env } from "@/lib/env";
import { unixInstallScript } from "@/lib/installScripts";

/** curl -fsSL <origin>/install.sh | sh */
export function GET(): Response {
  return new Response(unixInstallScript(env.APP_URL.replace(/\/$/, "")), {
    headers: { "content-type": "text/x-shellscript; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
