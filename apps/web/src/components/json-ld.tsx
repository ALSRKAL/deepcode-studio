import { headers } from "next/headers";

/**
 * JSON-LD must carry the same per-request CSP nonce as Next's own scripts.
 * Dynamic public pages read it from the middleware request header; the script
 * is escaped so a `</script>` inside data cannot break out.
 */
export async function JsonLd({ data }: { data: Record<string, unknown> | Array<Record<string, unknown>> }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
