# Phone remote-control relay

Served by the server container at `https://<site>/remote/` (page) and `wss://<site>/remote/ws`
(socket). The desktop app connects out to it by default ("DeepCode server" connection), so a
phone can open the QR link from any network, with no firewall change on the computer.

The phone page is the desktop workbench running in the browser (like ZCode's own phone page);
`?lite=1` opens the older lightweight page.

## Where the files come from

Nothing large is committed here. The desktop repo builds the bundle (phone page + relay) and
publishes it as a release asset:

- workflow: `ALSRKAL/deepcode-desktop` → **Phone remote bundle** (`.github/workflows/remote-web.yml`),
  runs on every push to `main` that touches the web/ui/relay code, or by hand;
- script: `scripts/ci/build-remote-web.mjs` (same output locally and in CI).

`bundle.env` pins one release by URL and sha256. The Docker build (`../Dockerfile`, stage
`remote`) downloads it with `fetch-bundle.mjs`, **refuses it unless the sha256 matches**, and
extracts it to `/app/remote` (`relay.mjs` + `mobile/`).

## Updating

1. Run (or wait for) the **Phone remote bundle** workflow in the desktop repo.
2. Copy the two lines from the run's summary into `bundle.env`.
3. Commit, deploy on Render, then `infra/home/setup.sh update` on the home server.

Why not commit the files: the bundle is ~60 MB of minified third-party code. Committing it grew
the repo on every rebuild and the secret scanner flagged its minified identifiers as keys.
