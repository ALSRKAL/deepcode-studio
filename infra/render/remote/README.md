# Phone remote-control relay

Served by the server container at `https://<site>/remote/` (page) and `wss://<site>/remote/ws`
(socket). The desktop app connects out to it by default ("DeepCode server" connection), so a
phone can open the QR link from any network, with no firewall change on the computer.

Both files come from the desktop repo (`apps/desktop`) and must be refreshed when the phone
protocol changes:

```bash
# relay.mjs
cd apps/desktop/packages/relay && node build.mjs && cp dist/cli.mjs ../../../../infra/render/remote/relay.mjs
# mobile/: the phone page built with the /remote/ base (only mobile.html and the files it loads)
cd apps/desktop/packages/web && npx vite build --base /remote/ --outDir <tmp> --emptyOutDir --manifest
# then copy mobile.html and the closure of its entry in <tmp>/.vite/manifest.json into mobile/
```
