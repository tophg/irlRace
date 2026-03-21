#!/usr/bin/env node
/**
 * NB2 Atlas Tile Generator — Uses Gemini Nano Banana 2 to generate atlas tiles.
 *
 * Usage:
 *   GEMINI_API_KEY=... node scripts/nb2-generate.mjs "<prompt>" <output.png> [--ref <reference.png>]
 *
 * Environment:
 *   GEMINI_API_KEY — API key for generativelanguage.googleapis.com
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

// ── Config ──
const MODEL = 'gemini-3.1-flash-image-preview'; // Nano Banana 2
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// ── Generate image via Gemini API ──
async function generateImage(apiKey, prompt, refImagePath) {
  const parts = [];

  // If reference image provided, include it as context for style continuity
  if (refImagePath && existsSync(refImagePath)) {
    const imgData = readFileSync(refImagePath).toString('base64');
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: imgData,
      },
    });
    parts.push({ text: `Reference image above shows the established style for this building column. Generate a NEW tile that matches the exact same materials, colors, textures, and architectural style. ${prompt}` });
  } else {
    parts.push({ text: prompt });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  const url = `${BASE_URL}/models/${MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await res.json();

  if (json.error) {
    throw new Error(json.error.message);
  }

  const imgPart = json.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!imgPart) {
    const textPart = json.candidates?.[0]?.content?.parts?.find(p => p.text);
    throw new Error(`No image returned. Text: ${textPart?.text?.slice(0, 100) ?? '(empty)'}`);
  }

  return Buffer.from(imgPart.inlineData.data, 'base64');
}

// ── CLI ──
const args = process.argv.slice(2);
const apiKey = process.env.GEMINI_API_KEY || args.find(a => a.startsWith('AIza'));

// Parse --ref flag
let refImagePath = null;
const refIdx = args.indexOf('--ref');
if (refIdx >= 0 && args[refIdx + 1]) {
  refImagePath = args[refIdx + 1];
}

// Filter out API key, --ref, and ref path from positional args
const positional = args.filter((a, i) =>
  !a.startsWith('AIza') &&
  a !== '--ref' &&
  (refIdx < 0 || i !== refIdx + 1)
);

const actualPrompt = positional[0];
const actualOutput = positional[1];

if (!apiKey || !actualPrompt || !actualOutput) {
  console.error('Usage: GEMINI_API_KEY=... node scripts/nb2-generate.mjs "<prompt>" <output.png> [--ref <reference.png>]');
  process.exit(1);
}

console.log(`🎨 Generating: ${actualPrompt.substring(0, 80)}...`);
console.log(`📁 Output: ${actualOutput}`);
if (refImagePath) console.log(`🔗 Reference: ${refImagePath}`);

try {
  const imgBuffer = await generateImage(apiKey, actualPrompt, refImagePath);
  mkdirSync(dirname(actualOutput), { recursive: true });
  writeFileSync(actualOutput, imgBuffer);
  console.log(`✓ Saved ${actualOutput} (${imgBuffer.length} bytes)`);
} catch (err) {
  console.error(`✗ Failed: ${err.message}`);
  process.exit(1);
}
