# AI Media Captions macOS Icon Pack

This package contains both current Apple-style source assets and the flattened
compatibility files required by Electron Builder.

## Included assets

- `AppIcon-1024.png`: unmasked 1024 x 1024 sRGB master for Apple tooling.
- `IconComposer-layers/`: separate opaque background and transparent foreground layers.
- `AppIcon.appiconset/`: unmasked macOS asset-catalog PNGs and `Contents.json`.
- `AppIcon.iconset/`: compatibility PNGs with a continuous rounded-square mask.
- `AI-Media-Captions.icns`: production icon used by Electron Builder.
- `AppIcon-legacy-1024.png`: flattened compatibility master with transparent corners.

The package uses `#4F378A` for the foreground and `#E9DDFF` for the background.
The source artwork is centered, uses clear edges, and keeps its primary content
away from the masked corners.

## Regenerate

Replace `assets/icons/macos/source/AppIcon-source.png`, then run:

```bash
npm run icons:macos
```

The command also updates `public/icon.icns`, which is referenced by the macOS
configuration in `package.json`.
