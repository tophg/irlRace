#!/usr/bin/env node
/**
 * nb2-generate.mjs — Nano Banana 2 (Gemini 3.1 Flash Image) API wrapper
 * for generating game asset textures.
 *
 * Usage:
 *   node scripts/nb2-generate.mjs "<prompt>" <output.png> [--ref <reference.png>]
 *
 * Environment:
 *   GEMINI_API_KEY — API key for generativelanguage.googleapis.com
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent';

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

  const res = await fetch(`${API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API error ${res.status}: ${errText}`);
  }

  const json = await res.json();
  const candidates = json.candidates || [];
  for (const candidate of candidates) {
    for (const part of (candidate.content?.parts || [])) {
      if (part.inlineData) {
        return Buffer.from(part.inlineData.data, 'base64');
      }
    }
  }
  throw new Error('No image data in response');
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
