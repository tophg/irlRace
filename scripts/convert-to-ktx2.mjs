/**
 * Convert facade atlas PNG/JPG files to KTX2 (Basis Universal) compressed textures.
 *
 * Usage:
 *   node scripts/convert-to-ktx2.mjs <input_dir_or_file> [--type diffuse|normal|emissive] [--out <output_path>]
 *
 * Examples:
 *   # Convert a single diffuse atlas
 *   node scripts/convert-to-ktx2.mjs public/buildings/facade_atlas_baghdad.jpg --type diffuse
 *
 *   # Convert a normal map atlas
 *   node scripts/convert-to-ktx2.mjs public/buildings/facade_atlas_baghdad_normal.png --type normal
 *
 *   # Convert ALL atlases in public/buildings/
 *   node scripts/convert-to-ktx2.mjs public/buildings/ --all
 *
 * KTX2 files are written next to the source with .ktx2 extension.
 */
import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { join, basename, dirname, extname } from 'path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const inputPath = args[0];
if (!inputPath) {
  console.error('Usage: node scripts/convert-to-ktx2.mjs <input_path> [--type diffuse|normal|emissive] [--all] [--out <output>]');
  process.exit(1);
}

const typeIdx = args.indexOf('--type');
const explicitType = typeIdx >= 0 ? args[typeIdx + 1] : null;
const outIdx = args.indexOf('--out');
const explicitOut = outIdx >= 0 ? args[outIdx + 1] : null;
const convertAll = args.includes('--all');

/**
 * Detect texture type from filename.
 */
function detectType(filename) {
  if (filename.includes('_normal')) return 'normal';
  if (filename.includes('_emissive')) return 'emissive';
  if (filename.includes('_mobile')) return 'mobile';
  return 'diffuse';
}

/**
 * Convert a single image file to KTX2.
 */
async function convertFile(inputFile, type, outputFile) {
  const name = basename(inputFile);
  console.log(`\n Converting: ${name} (type: ${type})`);

  // Read input and convert to PNG buffer (ktx2-encoder needs PNG)
  const inputBuffer = await readFile(inputFile);
  let pngBuffer;
  if (extname(inputFile).toLowerCase() === '.png') {
    pngBuffer = inputBuffer;
  } else {
    // Convert JPEG/other to PNG
    pngBuffer = await sharp(inputBuffer).png().toBuffer();
  }

  // Dynamically import ktx2-encoder (ESM)
  const { encodeToKTX2 } = await import('ktx2-encoder');

  // Configure encoding based on texture type
  /** @type {import('ktx2-encoder').IEncodeOptions} */
  const options = {
    isKTX2File: true,
    generateMipmap: true,
    enableDebug: false,
  };

  if (type === 'normal') {
    // Normal maps: ETC1S with normal map tuning
    // (UASTC fails on 4096×4096 in WASM encoder due to memory limits)
    options.isUASTC = false;
    options.isNormalMap = true;
    options.isPerceptual = false;
    options.isSetKTX2SRGBTransferFunc = false;
    options.qualityLevel = 220;     // high quality for directional data
    options.compressionLevel = 4;
  } else if (type === 'emissive') {
    // Emissive masks: ETC1S (high compression, simple mask data)
    options.isUASTC = false;
    options.qualityLevel = 128;
    options.compressionLevel = 4;
    options.isPerceptual = true;
    options.isSetKTX2SRGBTransferFunc = true;
  } else {
    // Diffuse: ETC1S with higher quality (best size/quality for color textures)
    options.isUASTC = false;
    options.qualityLevel = 192;
    options.compressionLevel = 4;
    options.isPerceptual = true;
    options.isSetKTX2SRGBTransferFunc = true;
  }

  // Need image decoder for Node.js
  options.imageDecoder = async (buffer) => {
    const { data, info } = await sharp(Buffer.from(buffer))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8Array(data) };
  };

  console.log(`  Encoding with ${options.isUASTC ? 'UASTC' : 'ETC1S'}...`);
  const startTime = Date.now();

  const ktx2Data = await encodeToKTX2(new Uint8Array(pngBuffer), options);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const inputSize = (inputBuffer.length / 1024 / 1024).toFixed(1);
  const outputSize = (ktx2Data.length / 1024 / 1024).toFixed(1);
  const ratio = ((1 - ktx2Data.length / inputBuffer.length) * 100).toFixed(0);

  console.log(`  ${inputSize} MB → ${outputSize} MB (${ratio}% smaller) in ${elapsed}s`);

  if (!outputFile) {
    // Default: same directory, .ktx2 extension
    // Strip _normal, _emissive suffixes from the base name for diffuse
    const dir = dirname(inputFile);
    const base = basename(inputFile).replace(/\.(png|jpg|jpeg)$/i, '.ktx2');
    outputFile = join(dir, base);
  }

  await writeFile(outputFile, Buffer.from(ktx2Data));
  console.log(`  ✅ Saved: ${outputFile}`);
}

// ── Main ──
async function main() {
  const st = await stat(inputPath);

  if (st.isDirectory() && convertAll) {
    // Convert all atlas files in directory
    const files = await readdir(inputPath);
    const atlasFiles = files.filter(f =>
      /^facade_atlas_.*\.(png|jpg|jpeg)$/i.test(f) &&
      !f.includes('_mobile') // skip mobile variants
    );

    console.log(`Found ${atlasFiles.length} atlas files to convert`);

    for (const file of atlasFiles.sort()) {
      const type = explicitType || detectType(file);
      await convertFile(join(inputPath, file), type, null);
    }
  } else if (st.isFile()) {
    const type = explicitType || detectType(basename(inputPath));
    await convertFile(inputPath, type, explicitOut || null);
  } else {
    console.error('Input must be a file or a directory with --all flag');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
