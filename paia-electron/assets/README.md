# Build assets

This directory holds the icons and metadata that `electron-builder` picks up
when packaging installers.

## Files needed for a real release

| File | Purpose | How to make it |
|---|---|---|
| `icon.svg` | Source vector logo (already here) | Edit by hand |
| `icon.png` | 512×512 PNG, used for Linux + as a fallback | Export from `icon.svg` (Inkscape: `inkscape icon.svg -o icon.png -w 512 -h 512`) |
| `icon.ico` | Windows multi-size .ico (16/24/32/48/64/128/256) | `magick convert icon.png -define icon:auto-resize=256,128,64,48,32,24,16 icon.ico` (ImageMagick) |
| `icon.icns` | macOS multi-size .icns | `mkdir icon.iconset && sips ... ` then `iconutil -c icns icon.iconset` (macOS only) — or use the `electron-icon-builder` npm package |
| `entitlements.mac.plist` | macOS hardened-runtime entitlements (created below) | Hand-written |

## Quick generation

If you have Node + ImageMagick installed, you can run:

```bash
npm install -g electron-icon-builder
electron-icon-builder --input=assets/icon.svg --output=assets --flatten
```

That single command produces `icon.png`, `icon.ico`, and `icon.icns`.

## Why placeholders are OK during dev

`electron-builder` will fall back to a default Electron icon if `icon.ico`
or `icon.icns` are missing. Dev builds work fine without them. The signed
release builds require real icons.
