/* ── IRL Race — Procedural Facade Atlas Generator ──
 *
 * Generates a 2048×2048 canvas texture atlas with environment-specific
 * architectural styles. Each tile is drawn procedurally using Canvas 2D.
 *
 * Atlas layout (8 cols × 4 rows = 32 tiles):
 *   Row 0: Window variants (lit, dark, blinds, curtain, AC, balcony, arched, modern)
 *   Row 1: Wall surface variants (stucco, plaster, siding, stone, brick-red, brick-brown, concrete, glass)
 *   Row 2: Ground floor variants (retail-A, retail-B, door-wood, door-glass, shopfront, lobby, garage, alley)
 *   Row 3: Trim/cap variants (cornice-ornate, cornice-modern, ledge, sill, parapet, roof-edge, rooftop, roof-dark)
 *
 * Alpha channel encodes emissive mask: 1.0 = window glass (can glow), 0.0 = opaque wall.
 */

import type { SceneryTheme } from './scene';

export const FACADE_ATLAS_SIZE = 2048;
export const FACADE_COLS = 8;
export const FACADE_ROWS = 4;
export const FACADE_TILE_W = FACADE_ATLAS_SIZE / FACADE_COLS;  // 256
export const FACADE_TILE_H = FACADE_ATLAS_SIZE / FACADE_ROWS;  // 512

/** Style palette derived from the scenery theme. */
interface FacadePalette {
  wallBase: string;
  wallAlt: string;
  wallAccent: string;
  windowFrame: string;
  windowGlass: string;
  windowGlassDark: string;
  windowSill: string;
  brickColor: string;
  brickMortar: string;
  doorColor: string;
  doorFrame: string;
  cornice: string;
  roofTop: string;
  awningColor: string;
  signColor: string;
}

/** Derive a palette from the scenery theme's building style. */
function paletteForStyle(style: string, theme: SceneryTheme): FacadePalette {
  // Convert theme building palette hex values to CSS
  const pal = theme.buildingPalette ?? [0x1a1a2e, 0x22223a, 0x2a2a45];
  const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

  const palettes: Record<string, FacadePalette> = {
    modern: {
      wallBase: '#404855', wallAlt: '#353d48', wallAccent: '#4a5568',
      windowFrame: '#2d3748', windowGlass: '#0a1628', windowGlassDark: '#060d1a',
      windowSill: '#4a5568', brickColor: '#5a4a40', brickMortar: '#6b5b51',
      doorColor: '#2d3748', doorFrame: '#4a5568',
      cornice: '#5a6577', roofTop: '#2d3748', awningColor: '#1a365d', signColor: '#e2e8f0',
    },
    adobe: {
      wallBase: '#c4956a', wallAlt: '#b8875e', wallAccent: '#d4a574',
      windowFrame: '#5a3a2a', windowGlass: '#1a1008', windowGlassDark: '#0d0804',
      windowSill: '#8b6545', brickColor: '#a0694a', brickMortar: '#c4956a',
      doorColor: '#4a2a1a', doorFrame: '#6b4530',
      cornice: '#8b6545', roofTop: '#a08060', awningColor: '#8b4513', signColor: '#f5e6d0',
    },
    beach_house: {
      wallBase: '#d4c5a0', wallAlt: '#c8b890', wallAccent: '#e0d4b4',
      windowFrame: '#4a6050', windowGlass: '#15200a', windowGlassDark: '#0a1005',
      windowSill: '#8a9a7a', brickColor: '#a09070', brickMortar: '#c4b090',
      doorColor: '#3a5040', doorFrame: '#5a7060',
      cornice: '#7a8a6a', roofTop: '#8a7a60', awningColor: '#2e8b57', signColor: '#fffff0',
    },
    cyberpunk: {
      wallBase: '#1a1a2e', wallAlt: '#16213e', wallAccent: '#0f3460',
      windowFrame: '#0a0a1a', windowGlass: '#0a0520', windowGlassDark: '#050210',
      windowSill: '#2a2a4e', brickColor: '#1a1a30', brickMortar: '#0a0a20',
      doorColor: '#0f3460', doorFrame: '#e94560',
      cornice: '#2a2a5e', roofTop: '#0a0a1a', awningColor: '#e94560', signColor: '#00ff88',
    },
    weathered: {
      wallBase: '#b0a080', wallAlt: '#a09070', wallAccent: '#c0b090',
      windowFrame: '#5a4a3a', windowGlass: '#181008', windowGlassDark: '#0c0804',
      windowSill: '#706050', brickColor: '#907060', brickMortar: '#a08070',
      doorColor: '#4a3a2a', doorFrame: '#6a5a4a',
      cornice: '#807060', roofTop: '#706050', awningColor: '#6b4226', signColor: '#e8dcc8',
    },
    chalet: {
      wallBase: '#8b7355', wallAlt: '#7a6245', wallAccent: '#9c8465',
      windowFrame: '#4a3525', windowGlass: '#120a05', windowGlassDark: '#090503',
      windowSill: '#5a4535', brickColor: '#6a5a4a', brickMortar: '#8a7a6a',
      doorColor: '#3a2515', doorFrame: '#5a4535',
      cornice: '#6a5a4a', roofTop: '#5a4a3a', awningColor: '#654321', signColor: '#f5deb3',
    },
    warehouse: {
      wallBase: '#4a4a52', wallAlt: '#3a3a42', wallAccent: '#5a5a62',
      windowFrame: '#2a2a32', windowGlass: '#0a0a12', windowGlassDark: '#050509',
      windowSill: '#3a3a42', brickColor: '#5a4a40', brickMortar: '#6a5a50',
      doorColor: '#2a2a32', doorFrame: '#4a4a52',
      cornice: '#5a5a62', roofTop: '#2a2a32', awningColor: '#4a4a52', signColor: '#c0c0c0',
    },
  };

  return palettes[style] ?? palettes.modern;
}

// ── Drawing helpers ──

function drawNoise(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, baseColor: string, intensity: number, rng: () => number) {
  ctx.fillStyle = baseColor;
  ctx.fillRect(x, y, w, h);
  for (let i = 0; i < w * h * 0.05; i++) {
    const px = x + rng() * w;
    const py = y + rng() * h;
    const v = Math.floor(128 + (rng() - 0.5) * intensity * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},0.08)`;
    ctx.fillRect(px, py, 2 + rng() * 3, 2 + rng() * 3);
  }
}

function drawBricks(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, brickColor: string, mortarColor: string, rng: () => number) {
  ctx.fillStyle = mortarColor;
  ctx.fillRect(x, y, w, h);
  const brickH = 12, brickW = 28, gap = 2;
  const rows = Math.ceil(h / (brickH + gap));
  const cols = Math.ceil(w / (brickW + gap));
  for (let r = 0; r < rows; r++) {
    const offsetX = (r % 2) * (brickW / 2 + gap / 2);
    for (let c = -1; c < cols + 1; c++) {
      const bx = x + c * (brickW + gap) + offsetX;
      const by = y + r * (brickH + gap);
      const v = 0.85 + rng() * 0.3;
      ctx.fillStyle = brickColor;
      ctx.globalAlpha = v;
      ctx.fillRect(bx, by, brickW, brickH);
    }
  }
  ctx.globalAlpha = 1;
}

function drawWindow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  pal: FacadePalette, variant: number, rng: () => number,
) {
  const centerX = x + w / 2;
  const centerY = y + h / 2;
  const winW = w * 0.55;
  const winH = h * 0.6;
  const winX = centerX - winW / 2;
  const winY = centerY - winH / 2 - h * 0.05;

  // Wall fill around window
  drawNoise(ctx, x, y, w, h, pal.wallBase, 0.15, rng);

  // Window sill
  ctx.fillStyle = pal.windowSill;
  ctx.fillRect(winX - 4, winY + winH, winW + 8, 6);

  // Window frame
  ctx.fillStyle = pal.windowFrame;
  ctx.fillRect(winX - 3, winY - 3, winW + 6, winH + 6);

  // Window glass — CRITICAL: this area must have alpha=1.0 for emissive
  const glassColor = variant % 2 === 0 ? pal.windowGlass : pal.windowGlassDark;
  ctx.fillStyle = glassColor;
  ctx.fillRect(winX, winY, winW, winH);

  // Mark glass region in alpha channel using a second pass later
  // We'll store window rects and fill alpha in a final pass

  // Variant-specific details
  switch (variant) {
    case 0: // Lit — warm interior hint
      ctx.fillStyle = 'rgba(255, 200, 100, 0.12)';
      ctx.fillRect(winX, winY, winW, winH);
      break;
    case 1: // Dark — reflective
      ctx.fillStyle = 'rgba(80, 120, 180, 0.08)';
      ctx.fillRect(winX, winY, winW, winH);
      break;
    case 2: // Blinds
      for (let i = 0; i < 6; i++) {
        const by = winY + (i / 6) * winH;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(200,200,190,0.4)' : 'rgba(160,160,150,0.3)';
        ctx.fillRect(winX, by, winW, winH / 6 - 1);
      }
      break;
    case 3: // Curtain
      ctx.fillStyle = 'rgba(180, 150, 120, 0.35)';
      ctx.fillRect(winX, winY, winW * 0.3, winH);
      ctx.fillRect(winX + winW * 0.7, winY, winW * 0.3, winH);
      break;
    case 4: // AC unit
      ctx.fillStyle = '#808888';
      ctx.fillRect(winX + winW * 0.15, winY + winH - 18, winW * 0.7, 18);
      ctx.strokeStyle = '#606868';
      ctx.lineWidth = 1;
      ctx.strokeRect(winX + winW * 0.15, winY + winH - 18, winW * 0.7, 18);
      break;
    case 5: // Balcony railing
      ctx.fillStyle = pal.windowSill;
      ctx.fillRect(winX - 6, winY + winH + 4, winW + 12, 3);
      // Railing posts
      for (let i = 0; i <= 4; i++) {
        ctx.fillRect(winX - 4 + i * ((winW + 8) / 4), winY + winH + 4, 2, 10);
      }
      // Bottom rail
      ctx.fillRect(winX - 6, winY + winH + 12, winW + 12, 2);
      break;
    case 6: { // Arched top
      ctx.fillStyle = pal.windowFrame;
      ctx.beginPath();
      ctx.arc(centerX, winY, winW / 2 + 3, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = glassColor;
      ctx.beginPath();
      ctx.arc(centerX, winY, winW / 2, Math.PI, 0);
      ctx.fill();
      break;
    }
    case 7: // Modern (full-height glass panel)
      ctx.fillStyle = glassColor;
      ctx.fillRect(winX - 4, winY - 10, winW + 8, winH + 20);
      // Thin mullion
      ctx.fillStyle = pal.windowFrame;
      ctx.fillRect(centerX - 1, winY - 10, 2, winH + 20);
      break;
  }

  // Return the glass region for alpha marking
  return { gx: winX, gy: winY, gw: winW, gh: winH };
}

/** Generate a procedural facade atlas canvas for the given environment style. */
export function generateFacadeAtlas(theme: SceneryTheme): HTMLCanvasElement {
  const style = theme.buildingStyle ?? 'modern';
  const pal = paletteForStyle(style, theme);

  const canvas = document.createElement('canvas');
  canvas.width = FACADE_ATLAS_SIZE;
  canvas.height = FACADE_ATLAS_SIZE;
  const ctx = canvas.getContext('2d')!;

  // Start with fully opaque (alpha = 1.0 everywhere for walls, we'll mark windows later)
  ctx.clearRect(0, 0, FACADE_ATLAS_SIZE, FACADE_ATLAS_SIZE);
  ctx.fillStyle = pal.wallBase;
  ctx.fillRect(0, 0, FACADE_ATLAS_SIZE, FACADE_ATLAS_SIZE);

  // Simple seeded RNG for deterministic generation
  let seed = 12345;
  const rng = () => { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647; };

  // Track all glass rects for alpha pass
  const glassRects: { x: number; y: number; w: number; h: number }[] = [];

  // ── Row 0: Window variants ──
  for (let col = 0; col < FACADE_COLS; col++) {
    const tx = col * FACADE_TILE_W;
    const ty = 0;
    const r = drawWindow(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, pal, col, rng);
    glassRects.push({ x: r.gx, y: r.gy, w: r.gw, h: r.gh });
  }

  // ── Row 1: Wall surface variants ──
  const wallStyles = [
    () => drawNoise(ctx, 0, 0, 0, 0, pal.wallBase, 0.2, rng),     // stucco
    () => drawNoise(ctx, 0, 0, 0, 0, pal.wallAlt, 0.15, rng),     // plaster
    () => {},  // siding
    () => {},  // stone
    () => drawBricks(ctx, 0, 0, 0, 0, pal.brickColor, pal.brickMortar, rng), // brick-red
    () => {},  // brick-brown
    () => {},  // concrete
    () => {},  // glass panel
  ];

  for (let col = 0; col < FACADE_COLS; col++) {
    const tx = col * FACADE_TILE_W;
    const ty = 1 * FACADE_TILE_H;

    switch (col) {
      case 0: // Stucco
        drawNoise(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, pal.wallBase, 0.2, rng);
        break;
      case 1: // Plaster
        drawNoise(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, pal.wallAlt, 0.15, rng);
        break;
      case 2: // Horizontal siding
        ctx.fillStyle = pal.wallAccent;
        ctx.fillRect(tx, ty, FACADE_TILE_W, FACADE_TILE_H);
        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 1;
        for (let sy = 0; sy < FACADE_TILE_H; sy += 16) {
          ctx.beginPath();
          ctx.moveTo(tx, ty + sy);
          ctx.lineTo(tx + FACADE_TILE_W, ty + sy);
          ctx.stroke();
        }
        drawNoise(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, 'transparent', 0.1, rng);
        break;
      case 3: // Stone
        drawNoise(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, pal.wallBase, 0.3, rng);
        // Large stone block lines
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 2;
        for (let sy = 0; sy < FACADE_TILE_H; sy += 40 + rng() * 20) {
          ctx.beginPath();
          ctx.moveTo(tx, ty + sy);
          ctx.lineTo(tx + FACADE_TILE_W, ty + sy);
          ctx.stroke();
        }
        for (let sx = 0; sx < FACADE_TILE_W; sx += 50 + rng() * 30) {
          ctx.beginPath();
          ctx.moveTo(tx + sx, ty);
          ctx.lineTo(tx + sx, ty + FACADE_TILE_H);
          ctx.stroke();
        }
        break;
      case 4: // Brick red
        drawBricks(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, pal.brickColor, pal.brickMortar, rng);
        break;
      case 5: // Brick brown
        drawBricks(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, '#6a5040', '#8a7060', rng);
        break;
      case 6: // Concrete panels
        drawNoise(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, '#606468', 0.1, rng);
        // Panel seams
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 1;
        for (let sy = 0; sy < FACADE_TILE_H; sy += FACADE_TILE_H / 3) {
          ctx.beginPath();
          ctx.moveTo(tx, ty + sy);
          ctx.lineTo(tx + FACADE_TILE_W, ty + sy);
          ctx.stroke();
        }
        break;
      case 7: // Glass curtain wall — this tile IS glass, mark as emissive
        ctx.fillStyle = pal.windowGlass;
        ctx.fillRect(tx, ty, FACADE_TILE_W, FACADE_TILE_H);
        // Thin mullion grid
        ctx.strokeStyle = pal.windowFrame;
        ctx.lineWidth = 2;
        for (let sy = 0; sy < FACADE_TILE_H; sy += 64) {
          ctx.beginPath();
          ctx.moveTo(tx, ty + sy);
          ctx.lineTo(tx + FACADE_TILE_W, ty + sy);
          ctx.stroke();
        }
        for (let sx = 0; sx < FACADE_TILE_W; sx += 64) {
          ctx.beginPath();
          ctx.moveTo(tx + sx, ty);
          ctx.lineTo(tx + sx, ty + FACADE_TILE_H);
          ctx.stroke();
        }
        glassRects.push({ x: tx, y: ty, w: FACADE_TILE_W, h: FACADE_TILE_H });
        break;
    }
  }

  // ── Row 2: Ground floor variants ──
  for (let col = 0; col < FACADE_COLS; col++) {
    const tx = col * FACADE_TILE_W;
    const ty = 2 * FACADE_TILE_H;
    const midX = tx + FACADE_TILE_W / 2;

    // Base wall
    drawNoise(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, pal.wallBase, 0.2, rng);

    switch (col) {
      case 0: // Retail A — large display window
      case 1: { // Retail B — double display window
        const winY1 = ty + FACADE_TILE_H * 0.3;
        const winH1 = FACADE_TILE_H * 0.55;
        if (col === 0) {
          // Single large window
          const winX1 = tx + 20;
          const winW1 = FACADE_TILE_W - 40;
          ctx.fillStyle = pal.windowFrame;
          ctx.fillRect(winX1 - 3, winY1 - 3, winW1 + 6, winH1 + 6);
          ctx.fillStyle = pal.windowGlass;
          ctx.fillRect(winX1, winY1, winW1, winH1);
          glassRects.push({ x: winX1, y: winY1, w: winW1, h: winH1 });
        } else {
          // Double windows with mullion
          const gap = 12;
          const winW1 = (FACADE_TILE_W - 40 - gap) / 2;
          ctx.fillStyle = pal.windowFrame;
          ctx.fillRect(tx + 17, winY1 - 3, FACADE_TILE_W - 34, winH1 + 6);
          ctx.fillStyle = pal.windowGlass;
          ctx.fillRect(tx + 20, winY1, winW1, winH1);
          ctx.fillRect(tx + 20 + winW1 + gap, winY1, winW1, winH1);
          glassRects.push({ x: tx + 20, y: winY1, w: winW1, h: winH1 });
          glassRects.push({ x: tx + 20 + winW1 + gap, y: winY1, w: winW1, h: winH1 });
        }
        // Awning
        ctx.fillStyle = pal.awningColor;
        ctx.fillRect(tx + 10, winY1 - 20, FACADE_TILE_W - 20, 16);
        break;
      }
      case 2: // Wood door
      case 3: { // Glass door
        const doorW = 60;
        const doorH = FACADE_TILE_H * 0.65;
        const doorX = midX - doorW / 2;
        const doorY = ty + FACADE_TILE_H - doorH;
        ctx.fillStyle = pal.doorFrame;
        ctx.fillRect(doorX - 4, doorY - 4, doorW + 8, doorH + 4);
        ctx.fillStyle = col === 2 ? pal.doorColor : pal.windowGlass;
        ctx.fillRect(doorX, doorY, doorW, doorH);
        if (col === 3) {
          glassRects.push({ x: doorX, y: doorY, w: doorW, h: doorH });
          // Door mullion
          ctx.fillStyle = pal.doorFrame;
          ctx.fillRect(midX - 1, doorY, 2, doorH);
        }
        // Door handle
        ctx.fillStyle = '#c0a050';
        ctx.fillRect(doorX + doorW - 12, doorY + doorH * 0.45, 4, 12);
        break;
      }
      case 4: { // Shopfront with awning and sign
        const winY1 = ty + FACADE_TILE_H * 0.35;
        const winH1 = FACADE_TILE_H * 0.5;
        const winX1 = tx + 15;
        const winW1 = FACADE_TILE_W - 30;
        ctx.fillStyle = pal.windowFrame;
        ctx.fillRect(winX1 - 3, winY1 - 3, winW1 + 6, winH1 + 6);
        ctx.fillStyle = pal.windowGlass;
        ctx.fillRect(winX1, winY1, winW1, winH1);
        glassRects.push({ x: winX1, y: winY1, w: winW1, h: winH1 });
        // Awning
        ctx.fillStyle = pal.awningColor;
        ctx.fillRect(tx + 8, winY1 - 25, FACADE_TILE_W - 16, 20);
        // Sign text area
        ctx.fillStyle = pal.signColor;
        ctx.fillRect(tx + 30, ty + 15, FACADE_TILE_W - 60, 28);
        ctx.fillStyle = pal.wallBase;
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SHOP', midX, ty + 35);
        break;
      }
      case 5: { // Lobby / revolving door
        const doorW = 80;
        const doorH = FACADE_TILE_H * 0.7;
        const doorX = midX - doorW / 2;
        const doorY = ty + FACADE_TILE_H - doorH;
        ctx.fillStyle = pal.doorFrame;
        ctx.fillRect(doorX - 6, doorY - 6, doorW + 12, doorH + 6);
        ctx.fillStyle = pal.windowGlass;
        ctx.fillRect(doorX, doorY, doorW, doorH);
        glassRects.push({ x: doorX, y: doorY, w: doorW, h: doorH });
        // Cross mullion (revolving door illusion)
        ctx.strokeStyle = pal.doorFrame;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(midX, doorY);
        ctx.lineTo(midX, doorY + doorH);
        ctx.moveTo(doorX, doorY + doorH / 2);
        ctx.lineTo(doorX + doorW, doorY + doorH / 2);
        ctx.stroke();
        break;
      }
      case 6: { // Garage roll-up
        const gW = FACADE_TILE_W * 0.7;
        const gH = FACADE_TILE_H * 0.65;
        const gX = midX - gW / 2;
        const gY = ty + FACADE_TILE_H - gH;
        ctx.fillStyle = '#5a5a62';
        ctx.fillRect(gX, gY, gW, gH);
        // Roll-up slats
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.lineWidth = 1;
        for (let sy = 0; sy < gH; sy += 8) {
          ctx.beginPath();
          ctx.moveTo(gX, gY + sy);
          ctx.lineTo(gX + gW, gY + sy);
          ctx.stroke();
        }
        break;
      }
      case 7: // Alley / blank wall
        drawNoise(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, pal.wallAlt, 0.25, rng);
        // Stain marks
        ctx.fillStyle = 'rgba(60,50,40,0.15)';
        ctx.fillRect(tx + rng() * 100, ty + FACADE_TILE_H * 0.4, 30 + rng() * 40, FACADE_TILE_H * 0.6);
        break;
    }
  }

  // ── Row 3: Trim/cap variants ──
  for (let col = 0; col < FACADE_COLS; col++) {
    const tx = col * FACADE_TILE_W;
    const ty = 3 * FACADE_TILE_H;

    switch (col) {
      case 0: // Cornice ornate
        drawNoise(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, pal.cornice, 0.1, rng);
        // Decorative molding lines
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(tx, ty + 20);
        ctx.lineTo(tx + FACADE_TILE_W, ty + 20);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.moveTo(tx, ty + 30);
        ctx.lineTo(tx + FACADE_TILE_W, ty + 30);
        ctx.stroke();
        // Dentil blocks
        for (let dx = 0; dx < FACADE_TILE_W; dx += 18) {
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(tx + dx, ty + 35, 10, 8);
        }
        break;
      case 1: // Cornice modern (clean line)
        drawNoise(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, pal.cornice, 0.08, rng);
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(tx, ty + 15, FACADE_TILE_W, 4);
        break;
      case 2: // Ledge (thin)
        drawNoise(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, pal.wallBase, 0.1, rng);
        ctx.fillStyle = pal.windowSill;
        ctx.fillRect(tx, ty + FACADE_TILE_H / 2 - 4, FACADE_TILE_W, 8);
        break;
      case 3: // Sill (stone)
        drawNoise(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, pal.windowSill, 0.15, rng);
        break;
      case 4: // Parapet cap
        drawNoise(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, pal.cornice, 0.12, rng);
        ctx.fillStyle = 'rgba(0,0,0,0.1)';
        ctx.fillRect(tx, ty + FACADE_TILE_H - 20, FACADE_TILE_W, 20);
        break;
      case 5: // Roof edge (metal)
        ctx.fillStyle = '#4a4a52';
        ctx.fillRect(tx, ty, FACADE_TILE_W, FACADE_TILE_H);
        // Metal rivets
        for (let rx = 0; rx < FACADE_TILE_W; rx += 30) {
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.beginPath();
          ctx.arc(tx + rx + 15, ty + FACADE_TILE_H / 2, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 6: // Rooftop (gravel)
        drawNoise(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, pal.roofTop, 0.3, rng);
        break;
      case 7: // Roof dark (tar)
        drawNoise(ctx, tx, ty, FACADE_TILE_W, FACADE_TILE_H, '#1a1a20', 0.1, rng);
        break;
    }
  }

  // ── Alpha pass: mark window glass regions ──
  // Set alpha=255 (opaque) for all pixels first (already done by fillRect above)
  // Then set alpha=0 for glass areas so the shader can detect windows for emissive
  // Wait — we want it the other way: alpha=0 for walls, alpha=255 for glass
  // Actually, the best approach: alpha=0 everywhere (walls don't glow),
  // alpha=255 for glass (windows CAN glow)
  
  // Get entire image data
  const imgData = ctx.getImageData(0, 0, FACADE_ATLAS_SIZE, FACADE_ATLAS_SIZE);
  const data = imgData.data;
  
  // First: set ALL alpha to 0 (no emissive)
  for (let i = 3; i < data.length; i += 4) {
    data[i] = 0;
  }
  
  // Then: set alpha=255 for glass rects (these CAN be emissive)
  for (const rect of glassRects) {
    const x0 = Math.max(0, Math.floor(rect.x));
    const y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(FACADE_ATLAS_SIZE, Math.ceil(rect.x + rect.w));
    const y1 = Math.min(FACADE_ATLAS_SIZE, Math.ceil(rect.y + rect.h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        data[(py * FACADE_ATLAS_SIZE + px) * 4 + 3] = 255;
      }
    }
  }
  
  ctx.putImageData(imgData, 0, 0);

  return canvas;
}
