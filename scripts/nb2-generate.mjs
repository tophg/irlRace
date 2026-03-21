#!/usr/bin/env node
/**
 * nb2-generate.mjs — Nano Banana 2 (Gemini 3.1 Flash Image) API wrapper
 * for generating game asset textures.
 *
 * Usage:
 *   node scripts/nb2-generate.mjs <prompt> <outputPath> [--width W] [--height H]
 *
 * Environment:
 *   GEMINI_API_KEY — API key for generativelanguage.googleapis.com
 *   (can also be passed as first positional if starts with 'AIza')
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent';

async function generateImage(apiKey, prompt) {
  const body = {
    contents: [{
      parts: [{ text: prompt }],
    }],
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
const prompt = args.find(a => !a.startsWith('AIza') && !a.startsWith('-') && !a.startsWith('/'));
const outputPath = args.find((a, i) => i > 0 && !a.startsWith('AIza') && !a.startsWith('-'));

if (!apiKey || args.length < 2) {
  console.error('Usage: GEMINI_API_KEY=... node scripts/nb2-generate.mjs "<prompt>" <output.png>');
  process.exit(1);
}

const actualPrompt = args[0].startsWith('AIza') ? args[1] : args[0];
const actualOutput = args[0].startsWith('AIza') ? args[2] : args[1];

if (!actualPrompt || !actualOutput) {
  console.error('Usage: node scripts/nb2-generate.mjs "<prompt>" <output.png>');
  process.exit(1);
}

console.log(`🎨 Generating: ${actualPrompt.substring(0, 80)}...`);
console.log(`📁 Output: ${actualOutput}`);

try {
  const imgBuffer = await generateImage(apiKey, actualPrompt);
  mkdirSync(dirname(actualOutput), { recursive: true });
  writeFileSync(actualOutput, imgBuffer);
  console.log(`✓ Saved ${actualOutput} (${imgBuffer.length} bytes)`);
} catch (err) {
  console.error(`✗ Failed: ${err.message}`);
  process.exit(1);
}
