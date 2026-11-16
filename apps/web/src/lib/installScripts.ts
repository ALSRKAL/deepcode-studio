/**
 * One-line installers served at /install.ps1 (Windows) and /install.sh (macOS, Linux).
 *
 * They download the newest stable installer from /api/v1/releases/latest, verify its
 * SHA-256 against the release record, and install it for the current user (no admin
 * rights). A file fetched by PowerShell or curl is a plain download the user asked a
 * shell to make, so the browser's "downloaded from the internet" prompts do not apply;
 * the integrity check here replaces them. Installers are NOT code-signed yet.
 */

export function windowsInstallScript(origin: string): string {
  return `# DeepCode Studio installer for Windows
#   irm ${origin}/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$origin = '${origin}'
Write-Host 'DeepCode Studio: finding the latest version...'
$r = Invoke-RestMethod "$origin/api/v1/releases/latest?platform=win&arch=x64&kind=exe"
$file = Join-Path $env:TEMP ("DeepCodeStudio-Setup-" + $r.version + ".exe")

Write-Host ("Downloading v" + $r.version + " (" + [math]::Round($r.sizeBytes / 1MB) + " MB)...")
Invoke-WebRequest -Uri $r.url -OutFile $file -UseBasicParsing

$hash = (Get-FileHash -Algorithm SHA256 $file).Hash.ToLower()
if ($hash -ne $r.sha256.ToLower()) {
  Remove-Item $file -Force
  throw 'Checksum mismatch: the download is corrupted or was altered. Nothing was installed.'
}

Write-Host 'Installing for the current user...'
Get-Process -Name 'DeepCode Studio' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process -FilePath $file -ArgumentList '/S', '/currentuser' -Wait
Remove-Item $file -Force

$exe = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs') -Filter 'DeepCode Studio.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) {
  Write-Host 'Done. Starting DeepCode Studio...'
  Start-Process $exe.FullName
} else {
  Write-Host 'Done. Open DeepCode Studio from the Start menu.'
}
`;
}

export function unixInstallScript(origin: string): string {
  return `#!/bin/sh
# DeepCode Studio installer for macOS and Linux
#   curl -fsSL ${origin}/install.sh | sh
set -eu
ORIGIN='${origin}'

case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac
case "$(uname -s)" in
  Darwin) PLATFORM=mac; KIND=zip ;;
  Linux) PLATFORM=linux; KIND=AppImage ;;
  *) echo "Unsupported system: $(uname -s). On Windows run: irm $ORIGIN/install.ps1 | iex" >&2; exit 1 ;;
esac

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
echo "DeepCode Studio: finding the latest version..."
INFO=$(curl -fsSL "$ORIGIN/api/v1/releases/latest?platform=$PLATFORM&arch=$ARCH&kind=$KIND")
field() { printf '%s' "$INFO" | sed -n "s/.*\\"$1\\":\\"\\{0,1\\}\\([^\\",}]*\\).*/\\1/p"; }
URL=$(field url); SHA=$(field sha256); VERSION=$(field version)
[ -n "$URL" ] && [ -n "$SHA" ] || { echo "No $PLATFORM $ARCH release is published yet." >&2; exit 1; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo "Downloading v$VERSION..."
curl -fL --progress-bar -o "$TMP/pkg" "$URL"
if command -v sha256sum >/dev/null 2>&1; then GOT=$(sha256sum "$TMP/pkg" | cut -d' ' -f1); else GOT=$(shasum -a 256 "$TMP/pkg" | cut -d' ' -f1); fi
[ "$GOT" = "$SHA" ] || { echo "Checksum mismatch: the download is corrupted or was altered. Nothing was installed." >&2; exit 1; }

if [ "$PLATFORM" = mac ]; then
  DEST=/Applications; [ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
  ditto -x -k "$TMP/pkg" "$TMP/app"
  APP=$(find "$TMP/app" -maxdepth 1 -name '*.app' | head -n 1)
  [ -n "$APP" ] || { echo "The archive has no app inside." >&2; exit 1; }
  rm -rf "$DEST/DeepCode Studio.app"
  mv "$APP" "$DEST/DeepCode Studio.app"
  # Local ad-hoc signature so Apple silicon runs the bundle; not a developer signature.
  codesign --force --deep --sign - "$DEST/DeepCode Studio.app" >/dev/null 2>&1 || true
  echo "Installed to $DEST/DeepCode Studio.app"
  open "$DEST/DeepCode Studio.app" || true
  exit 0
fi

DIR="$HOME/.local/share/deepcode-studio"; BIN="$HOME/.local/bin"
mkdir -p "$DIR" "$BIN" "$HOME/.local/share/applications"
APPIMAGE="$DIR/DeepCode-Studio.AppImage"
mv -f "$TMP/pkg" "$APPIMAGE"; chmod 755 "$APPIMAGE"
# Without FUSE 2 (default on newer Ubuntu) AppImages cannot mount; extract-and-run still
# works and keeps APPIMAGE set, so in-app updates keep working.
RUN_ENV=""
if ! ( (ldconfig -p 2>/dev/null || /sbin/ldconfig -p 2>/dev/null) | grep -q 'libfuse.so.2'); then RUN_ENV="env APPIMAGE_EXTRACT_AND_RUN=1 "; fi
printf '#!/bin/sh\\nexec %s"%s" --no-sandbox "$@"\\n' "$RUN_ENV" "$APPIMAGE" > "$BIN/deepcode-studio"
chmod 755 "$BIN/deepcode-studio"
cat > "$HOME/.local/share/applications/deepcode-studio.desktop" <<EOF
[Desktop Entry]
Name=DeepCode Studio
Comment=DeepCode Studio Desktop App
Exec="$BIN/deepcode-studio" %U
Terminal=false
Type=Application
Icon=deepcode-studio
Categories=Development;
MimeType=x-scheme-handler/deepcodestudio;
StartupWMClass=DeepCode Studio
EOF
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
command -v xdg-mime >/dev/null 2>&1 && xdg-mime default deepcode-studio.desktop x-scheme-handler/deepcodestudio || true
echo "Installed v$VERSION. Start it from the app menu or run: deepcode-studio"
(nohup "$BIN/deepcode-studio" >/dev/null 2>&1 &) || true
`;
}
