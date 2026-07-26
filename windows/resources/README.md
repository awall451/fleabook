# Launcher resources

The Windows executable's icon, version block and manifest are linked in from
`windows/launcher/resource_windows_amd64.syso`, which is **committed**. The Go
toolchain picks up any `.syso` in the package directory by filename — there is
no build step and no import.

It is committed rather than generated so the build stays hermetic: packaging
needs Go, Node and `makensis`, and not also a resource compiler and an image
toolchain.

## Regenerating it

Needed after changing the icon, the manifest, or the version in `package.json`
(`versioninfo.json` carries its own copy — they drift silently otherwise).

```sh
go install github.com/josephspurrier/goversioninfo/cmd/goversioninfo@latest
cd windows/resources
goversioninfo -o ../launcher/resource_windows_amd64.syso versioninfo.json
```

## Regenerating the icon

`fleabook.ico` is rendered from `src/lib/assets/favicon.svg` — the same mark the
web UI uses, so change the SVG and re-render rather than editing the `.ico`.
It carries 16/24/32/48/64/128/256px, which is what Explorer, the taskbar and the
Alt-Tab switcher pick between.

```sh
node -e '
  const sharp = require("sharp");
  for (const s of [16, 24, 32, 48, 64, 128, 256])
    sharp("src/lib/assets/favicon.svg", { density: 384 })
      .resize(s, s).png().toFile(`/tmp/icon-${String(s).padStart(3, "0")}.png`);
'
convert /tmp/icon-*.png windows/resources/fleabook.ico   # ImageMagick
```

## Why the manifest says what it says

- `dpiAware=true` (system DPI aware) rather than PerMonitorV2: go-webview2's
  window procedure does not handle `WM_DPICHANGED`, so declaring per-monitor
  awareness would leave the window the wrong physical size after a drag onto a
  differently-scaled monitor. See the comment in `fleabook.manifest`.
- `asInvoker`: Fleabook installs per-user and writes only to `%LOCALAPPDATA%`.
  It must never raise a UAC prompt.
