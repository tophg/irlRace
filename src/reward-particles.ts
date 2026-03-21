/* ── Reward Particles — Canvas-based particle overlay ──
 *
 * Lightweight 2D particle system for reward feedback VFX.
 * Single pooled canvas with additive blending, max 200 particles,
 * auto-pausing rAF loop when no particles are alive.
 *
 * Psychology: multi-sensory feedback amplifies dopamine response.
 * Particles add visceral quality that CSS alone cannot achieve.
 */

// ── Types ──

interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  alpha: number;
  gravity: number;
  drag: number;
  /** Optional rotation (radians) for shard-like particles */
  rotation: number;
  rotationSpeed: number;
  /** Shape: 'circle' | 'shard' | 'star' */
  shape: 'circle' | 'shard' | 'star';
}

// ── Pool ──

const MAX_PARTICLES = 200;
const _pool: Particle[] = [];

for (let i = 0; i < MAX_PARTICLES; i++) {
  _pool.push({
    alive: false, x: 0, y: 0, vx: 0, vy: 0,
    life: 0, maxLife: 1, size: 3, color: '#fff', alpha: 1,
    gravity: 0, drag: 0.98, rotation: 0, rotationSpeed: 0,
    shape: 'circle',
  });
}

function acquire(): Particle | null {
  for (const p of _pool) {
    if (!p.alive) { p.alive = true; return p; }
  }
  return null; // pool exhausted
}

// ── Canvas ──

let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;
let _rafId = 0;
let _running = false;
let _lastTime = 0;
let _resizeObs: ResizeObserver | null = null;

function ensureCanvas(): CanvasRenderingContext2D {
  if (_ctx && _canvas && _canvas.parentNode) return _ctx;
  _canvas = document.createElement('canvas');
  _canvas.className = 'reward-particles-canvas';
  _canvas.style.cssText = `
    position: fixed; inset: 0; z-index: 210;
    pointer-events: none; width: 100%; height: 100%;
  `;
  _canvas.width = window.innerWidth;
  _canvas.height = window.innerHeight;
  document.getElementById('ui-overlay')?.appendChild(_canvas);
  _ctx = _canvas.getContext('2d')!;

  // Handle resize (store ref for cleanup — audit fix #2)
  if (_resizeObs) _resizeObs.disconnect();
  _resizeObs = new ResizeObserver(() => {
    if (_canvas) {
      _canvas.width = window.innerWidth;
      _canvas.height = window.innerHeight;
    }
  });
  _resizeObs.observe(document.documentElement);

  return _ctx;
}

// ── Render Loop ──

function tick(now: number) {
  if (!_running) return;

  const dt = Math.min((now - _lastTime) / 1000, 0.05); // cap at 50ms
  _lastTime = now;

  const ctx = ensureCanvas();
  ctx.clearRect(0, 0, _canvas!.width, _canvas!.height);
  ctx.globalCompositeOperation = 'lighter'; // additive blending

  let anyAlive = false;

  for (const p of _pool) {
    if (!p.alive) continue;

    // Update
    p.life -= dt;
    if (p.life <= 0) { p.alive = false; continue; }

    anyAlive = true;
    p.vy += p.gravity * dt * 60; // gravity per-frame (60fps normalized)
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;
    p.rotation += p.rotationSpeed * dt * 60;

    // Alpha fade out in last 30% of life
    const lifeRatio = p.life / p.maxLife;
    p.alpha = lifeRatio < 0.3 ? lifeRatio / 0.3 : 1;

    // Draw
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(p.x, p.y);

    if (p.shape === 'shard') {
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size * 0.3, -p.size, p.size * 0.6, p.size * 2);
    } else if (p.shape === 'star') {
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      drawStar(ctx, 0, 0, 4, p.size, p.size * 0.4);
    } else {
      // circle with glow
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = p.size * 2;
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  if (anyAlive) {
    _rafId = requestAnimationFrame(tick);
  } else {
    _running = false;
    // Clear canvas when done
    ctx.clearRect(0, 0, _canvas!.width, _canvas!.height);
  }
}

function startLoop() {
  if (_running) return;
  _running = true;
  _lastTime = performance.now();
  _rafId = requestAnimationFrame(tick);
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outerR: number, innerR: number) {
  let rot = Math.PI / 2 * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerR);
  ctx.closePath();
  ctx.fill();
}

// ── Helpers ──

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// ── Public Emitters ──

/**
 * Currency sparkle burst from a point (mid-race reward).
 * 8–15 gold/cyan sparkles fountaining upward.
 */
export function emitCurrencyBurst(x: number, y: number, hue = 45) {
  const count = 8 + Math.floor(Math.random() * 8);
  for (let i = 0; i < count; i++) {
    const p = acquire();
    if (!p) break;
    p.x = x + rand(-10, 10);
    p.y = y;
    p.vx = rand(-2, 2);
    p.vy = rand(-4, -1.5);
    p.gravity = 0.08;
    p.drag = 0.97;
    p.life = p.maxLife = rand(0.5, 1.0);
    p.size = rand(2, 4);
    p.color = hsl(hue, 80, rand(55, 80));
    p.shape = 'star';
    p.rotation = rand(0, Math.PI * 2);
    p.rotationSpeed = rand(-0.05, 0.05);
  }
  startLoop();
}

/**
 * Expanding shockwave ring from center (combo ×3+).
 * Colored particles expanding outward in a ring.
 */
export function emitComboShockwave(hue = 30) {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const count = 24;
  for (let i = 0; i < count; i++) {
    const p = acquire();
    if (!p) break;
    const angle = (i / count) * Math.PI * 2;
    const speed = rand(3, 6);
    p.x = cx;
    p.y = cy;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.gravity = 0;
    p.drag = 0.96;
    p.life = p.maxLife = rand(0.4, 0.7);
    p.size = rand(2, 3.5);
    p.color = hsl(hue, 85, rand(55, 75));
    p.shape = 'circle';
    p.rotation = 0;
    p.rotationSpeed = 0;
  }
  startLoop();
}

/**
 * Golden rain across viewport (jackpot roll).
 * 40+ gold sparkles falling/swirling for ~2s.
 */
export function emitJackpotRain() {
  const w = window.innerWidth;
  const count = 45;
  for (let i = 0; i < count; i++) {
    const p = acquire();
    if (!p) break;
    p.x = rand(0, w);
    p.y = rand(-50, -200);
    p.vx = rand(-1, 1);
    p.vy = rand(1.5, 3.5);
    p.gravity = 0.04;
    p.drag = 0.99;
    p.life = p.maxLife = rand(1.5, 2.5);
    p.size = rand(2.5, 5);
    const goldHue = rand(35, 55);
    p.color = hsl(goldHue, 90, rand(55, 70));
    p.shape = Math.random() > 0.5 ? 'star' : 'circle';
    p.rotation = rand(0, Math.PI * 2);
    p.rotationSpeed = rand(-0.03, 0.03);
  }
  startLoop();
}

/**
 * Broken glass shards (combo break — loss aversion).
 * Red/orange shards shattering outward from a point.
 */
export function emitBrokenGlass(x: number, y: number) {
  const count = 12;
  for (let i = 0; i < count; i++) {
    const p = acquire();
    if (!p) break;
    const angle = (i / count) * Math.PI * 2 + rand(-0.3, 0.3);
    const speed = rand(2, 5);
    p.x = x;
    p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.gravity = 0.12;
    p.drag = 0.95;
    p.life = p.maxLife = rand(0.4, 0.8);
    p.size = rand(3, 6);
    p.color = hsl(rand(0, 20), 80, rand(45, 60));
    p.shape = 'shard';
    p.rotation = rand(0, Math.PI * 2);
    p.rotationSpeed = rand(-0.15, 0.15);
  }
  startLoop();
}

/**
 * XP stream particles flowing from source toward target (post-race).
 * Tiny "+" particles that drift in an arc.
 */
export function emitXPStream(fromX: number, fromY: number, toX: number, toY: number) {
  const count = 8;
  for (let i = 0; i < count; i++) {
    const p = acquire();
    if (!p) break;
    const t = i / count;
    p.x = fromX + rand(-15, 15);
    p.y = fromY + rand(-5, 5);
    // Velocity aimed at target with some randomness
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const speed = dist / (60 * rand(0.6, 1.0)); // arrive in ~0.6-1s
    p.vx = (dx / dist) * speed + rand(-0.5, 0.5);
    p.vy = (dy / dist) * speed + rand(-0.5, 0.5);
    p.gravity = 0;
    p.drag = 1.0; // no drag — constant velocity
    p.life = p.maxLife = rand(0.5, 0.9);
    p.size = rand(1.5, 3);
    p.color = hsl(200, 70, 75); // light blue
    p.shape = 'circle';
    p.rotation = 0;
    p.rotationSpeed = 0;
  }
  startLoop();
}

/**
 * Full-screen starburst (level up — crowning moment).
 * 60+ gold particles radiating outward from center.
 */
export function emitLevelBurst() {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const count = 60;
  for (let i = 0; i < count; i++) {
    const p = acquire();
    if (!p) break;
    const angle = (i / count) * Math.PI * 2 + rand(-0.1, 0.1);
    const speed = rand(3, 8);
    p.x = cx + rand(-5, 5);
    p.y = cy + rand(-5, 5);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.gravity = 0.02;
    p.drag = 0.97;
    p.life = p.maxLife = rand(0.8, 1.5);
    p.size = rand(2, 5);
    const goldHue = rand(35, 55);
    p.color = hsl(goldHue, 90, rand(55, 75));
    p.shape = Math.random() > 0.6 ? 'star' : 'circle';
    p.rotation = rand(0, Math.PI * 2);
    p.rotationSpeed = rand(-0.04, 0.04);
  }
  startLoop();
}

/**
 * Achievement confetti shower from top edge.
 * Multi-colored confetti falling down.
 */
export function emitAchievementConfetti() {
  const w = window.innerWidth;
  const count = 30;
  const colors = [0, 45, 120, 200, 280, 330]; // rainbow hues
  for (let i = 0; i < count; i++) {
    const p = acquire();
    if (!p) break;
    p.x = rand(w * 0.1, w * 0.9);
    p.y = rand(-30, -100);
    p.vx = rand(-1.5, 1.5);
    p.vy = rand(1, 3);
    p.gravity = 0.06;
    p.drag = 0.99;
    p.life = p.maxLife = rand(1.2, 2.0);
    p.size = rand(3, 6);
    p.color = hsl(colors[i % colors.length], 80, rand(55, 70));
    p.shape = 'shard';
    p.rotation = rand(0, Math.PI * 2);
    p.rotationSpeed = rand(-0.08, 0.08);
  }
  startLoop();
}

// ── Cleanup ──

export function destroyParticles() {
  if (_rafId) cancelAnimationFrame(_rafId);
  _running = false;
  _rafId = 0;
  _lastTime = 0; // audit fix #13: prevent huge dt on restart
  for (const p of _pool) p.alive = false;
  if (_resizeObs) { _resizeObs.disconnect(); _resizeObs = null; } // audit fix #2
  _canvas?.remove();
  _canvas = null;
  _ctx = null;
}
