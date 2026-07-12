import { spawnSync } from 'node:child_process';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = path.join(projectRoot, 'assets', 'icons', 'macos');
const defaultSource = path.join(assetRoot, 'source', 'AppIcon-source.png');
const sourcePath = process.argv[2] ? path.resolve(process.argv[2]) : defaultSource;
const packageDir = path.join(assetRoot, 'AI-Media-Captions-macOS');
const iconsetDir = path.join(packageDir, 'AppIcon.iconset');
const appiconsetDir = path.join(packageDir, 'AppIcon.appiconset');
const layersDir = path.join(packageDir, 'IconComposer-layers');
const zipPath = path.join(assetRoot, 'AI-Media-Captions-macOS-Icon-Pack.zip');
const publicIcns = path.join(projectRoot, 'public', 'icon.icns');
const appBuilderBinary = path.join(
  projectRoot,
  'node_modules',
  'app-builder-bin',
  'mac',
  process.arch === 'arm64' ? 'app-builder_arm64' : 'app-builder_amd64',
);

const canvasSize = 1024;
const foregroundColor = { r: 0x4f, g: 0x37, b: 0x8a };
const backgroundColor = { r: 0xe9, g: 0xdd, b: 0xff };

const iconFiles = [
  { name: 'icon_16x16.png', pixels: 16, points: '16x16', scale: '1x' },
  { name: 'icon_16x16@2x.png', pixels: 32, points: '16x16', scale: '2x' },
  { name: 'icon_32x32.png', pixels: 32, points: '32x32', scale: '1x' },
  { name: 'icon_32x32@2x.png', pixels: 64, points: '32x32', scale: '2x' },
  { name: 'icon_128x128.png', pixels: 128, points: '128x128', scale: '1x' },
  { name: 'icon_128x128@2x.png', pixels: 256, points: '128x128', scale: '2x' },
  { name: 'icon_256x256.png', pixels: 256, points: '256x256', scale: '1x' },
  { name: 'icon_256x256@2x.png', pixels: 512, points: '256x256', scale: '2x' },
  { name: 'icon_512x512.png', pixels: 512, points: '512x512', scale: '1x' },
  { name: 'icon_512x512@2x.png', pixels: 1024, points: '512x512', scale: '2x' },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smoothstep = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

const createForeground = async () => {
  const { data, info } = await sharp(sourcePath)
    .resize(canvasSize, canvasSize, {
      fit: 'cover',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
    })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rgba = Buffer.alloc(canvasSize * canvasSize * 4);

  for (let pixel = 0; pixel < canvasSize * canvasSize; pixel += 1) {
    const sourceOffset = pixel * info.channels;
    const targetOffset = pixel * 4;
    const red = data[sourceOffset];
    const green = data[sourceOffset + 1];
    const blue = data[sourceOffset + 2];
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const alpha = 1 - smoothstep((luminance - 118) / 92);

    rgba[targetOffset] = foregroundColor.r;
    rgba[targetOffset + 1] = foregroundColor.g;
    rgba[targetOffset + 2] = foregroundColor.b;
    rgba[targetOffset + 3] = Math.round(alpha * 255);
  }

  return sharp(rgba, {
    raw: { width: canvasSize, height: canvasSize, channels: 4 },
  }).withMetadata({ density: 72 }).png({ compressionLevel: 9 }).toBuffer();
};

const createBackground = () => sharp({
  create: {
    width: canvasSize,
    height: canvasSize,
    channels: 3,
    background: backgroundColor,
  },
}).withMetadata({ density: 72 }).png({ compressionLevel: 9 }).toBuffer();

const createLegacyMask = () => {
  const rgba = Buffer.alloc(canvasSize * canvasSize * 4);
  const exponent = 5;
  const edgeWidth = 0.018;

  for (let y = 0; y < canvasSize; y += 1) {
    for (let x = 0; x < canvasSize; x += 1) {
      const nx = Math.abs((x + 0.5 - canvasSize / 2) / (canvasSize / 2));
      const ny = Math.abs((y + 0.5 - canvasSize / 2) / (canvasSize / 2));
      const boundary = nx ** exponent + ny ** exponent;
      const coverage = smoothstep((1 + edgeWidth / 2 - boundary) / edgeWidth);
      const offset = (y * canvasSize + x) * 4;

      rgba[offset] = 255;
      rgba[offset + 1] = 255;
      rgba[offset + 2] = 255;
      rgba[offset + 3] = Math.round(coverage * 255);
    }
  }

  return { buffer: rgba, raw: { width: canvasSize, height: canvasSize, channels: 4 } };
};

const resizeIcon = async (master, outputPath, pixels) => {
  let pipeline = sharp(master).resize(pixels, pixels, {
    fit: 'fill',
    kernel: sharp.kernel.lanczos3,
  });

  if (pixels <= 64) pipeline = pipeline.sharpen({ sigma: 0.45 });

  await pipeline.withMetadata({ density: 72 }).png({ compressionLevel: 9 }).toFile(outputPath);
};

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} failed with status ${result.status}`);
  }
};

await access(sourcePath);
await rm(packageDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(iconsetDir, { recursive: true });
await mkdir(appiconsetDir, { recursive: true });
await mkdir(layersDir, { recursive: true });

const foreground = await createForeground();
const background = await createBackground();
const master = await sharp(background)
  .composite([{ input: foreground }])
  .removeAlpha()
  .withMetadata({ density: 72 })
  .png({ compressionLevel: 9 })
  .toBuffer();
const legacyMask = createLegacyMask();
const legacyMaster = await sharp(master)
  .composite([{ input: legacyMask.buffer, raw: legacyMask.raw, blend: 'dest-in' }])
  .withMetadata({ density: 72 })
  .png({ compressionLevel: 9 })
  .toBuffer();

await writeFile(path.join(layersDir, 'Background-1024.png'), background);
await writeFile(path.join(layersDir, 'Foreground-1024.png'), foreground);
await writeFile(path.join(packageDir, 'AppIcon-1024.png'), master);
await writeFile(path.join(packageDir, 'AppIcon-legacy-1024.png'), legacyMaster);

for (const icon of iconFiles) {
  await resizeIcon(legacyMaster, path.join(iconsetDir, icon.name), icon.pixels);
  await resizeIcon(master, path.join(appiconsetDir, icon.name), icon.pixels);
}

const contents = {
  images: iconFiles.map((icon) => ({
    filename: icon.name,
    idiom: 'mac',
    scale: icon.scale,
    size: icon.points,
  })),
  info: { author: 'com.aipowered.mediacaptions', version: 1 },
};

await writeFile(
  path.join(appiconsetDir, 'Contents.json'),
  `${JSON.stringify(contents, null, 2)}\n`,
  'utf8',
);

const icnsPath = path.join(packageDir, 'AI-Media-Captions.icns');
const icnsBuildDir = path.join(packageDir, '.icns-build');
await mkdir(icnsBuildDir, { recursive: true });
run(appBuilderBinary, [
  'icon',
  `--input=${path.join(packageDir, 'AppIcon-legacy-1024.png')}`,
  '--format=icns',
  `--out=${icnsBuildDir}`,
]);
await copyFile(path.join(icnsBuildDir, 'icon.icns'), icnsPath);
await rm(icnsBuildDir, { recursive: true, force: true });
await copyFile(icnsPath, publicIcns);

const sourceCopy = path.join(packageDir, 'Source-1254.png');
await copyFile(sourcePath, sourceCopy);

const readmeSource = path.join(assetRoot, 'README.md');
await access(readmeSource);
await copyFile(readmeSource, path.join(packageDir, 'README.md'));

run('/usr/bin/ditto', [
  '-c',
  '-k',
  '--norsrc',
  '--noextattr',
  '--noqtn',
  '--noacl',
  '--keepParent',
  packageDir,
  zipPath,
]);

const icnsSize = (await readFile(icnsPath)).byteLength;
console.log(`Generated macOS icon package: ${packageDir}`);
console.log(`Generated Electron icon: ${publicIcns} (${Math.round(icnsSize / 1024)} KB)`);
console.log(`Generated archive: ${zipPath}`);
