/* ── Hood Racer — Solid.js HUD ── */

import { createSignal, createEffect, onMount, Show } from 'solid-js';


// ── Shared Reactive State ──
// This state is updated externally by the hud.ts proxy functions
export const [speedMPH, setSpeedMPH] = createSignal(0);
export const [lapInfo, setLapInfo] = createSignal({ current: 1, total: 3 });
export const [positionInfo, setPositionInfo] = createSignal({ rank: 1, suffix: 'st' });
export const [isWrongWay, setIsWrongWay] = createSignal(false);
export const [timerText, setTimerText] = createSignal('0:00.000');
export const [isBoostActive, setIsBoostActive] = createSignal(false);
export const [nitroPct, setNitroPct] = createSignal(0);
export const [isNitroActive, setIsNitroActive] = createSignal(false);
export const [heatPct, setHeatPct] = createSignal(0);
export const [isEngineDead, setIsEngineDead] = createSignal(false);
export const [damageState, setDamageState] = createSignal({
  front: 100, rear: 100, left: 100, right: 100
});
export const [gapInfo, setGapInfo] = createSignal({ ahead: '', behind: '' });



export const RacingHUD = () => {

  const getNitroGradient = () => {
    const pct = nitroPct();
    if (pct > 70) return 'linear-gradient(90deg, #ff6600, #ff2200)';
    if (pct > 30) return 'linear-gradient(90deg, #0088ff, #ff6600)';
    return 'linear-gradient(90deg, #0044aa, #0088ff)';
  };

  const getHeatColor = () => {
    const h = heatPct();
    if (h > 90) return '#ff1100';
    if (h > 70) return '#ff6600';
    if (h > 50) return '#ffaa00';
    if (h > 30) return '#ffdd44';
    return '#44aaff';
  };

  const getDamageClass = (hp: number) => {
    if (hp > 60) return '';
    if (hp > 25) return 'dmg-yellow';
    return 'dmg-red';
  };

  // Position badge animation on rank change
  let positionEl: HTMLDivElement | undefined;
  let prevRank = 1;
  createEffect(() => {
    const rank = positionInfo().rank;
    if (rank !== prevRank && positionEl) {
      positionEl.classList.remove('position-changed');
      // Force reflow to restart animation
      void positionEl.offsetWidth;
      positionEl.classList.add('position-changed');
      setTimeout(() => positionEl?.classList.remove('position-changed'), 600);
    }
    prevRank = rank;
  });

  // ── Radial Speedometer Canvas ──
  let speedoCanvas: HTMLCanvasElement | undefined;
  const MAX_SPEED = 160;
  const ARC_START = Math.PI * 0.75;  // 7 o'clock
  const ARC_END = Math.PI * 2.25;   // 5 o'clock (240°)
  const ARC_RANGE = ARC_END - ARC_START;

  const drawSpeedo = (mph: number) => {
    if (!speedoCanvas) return;
    const ctx = speedoCanvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = speedoCanvas.clientWidth;
    const cssH = speedoCanvas.clientHeight;
    speedoCanvas.width = cssW * dpr;
    speedoCanvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = cssW / 2;
    const cy = cssH / 2;
    const R = Math.min(cx, cy) - 6;
    const ratio = Math.min(1, Math.max(0, mph / MAX_SPEED));
    const needleAngle = ARC_START + ratio * ARC_RANGE;

    ctx.clearRect(0, 0, cssW, cssH);

    // Background arc (dim)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, R, ARC_START, ARC_END);
    ctx.stroke();

    // Active arc with gradient
    if (mph > 0) {
      const grad = ctx.createConicGradient(ARC_START, cx, cy);
      grad.addColorStop(0, '#0088ff');          // blue at 0%
      grad.addColorStop(0.5, '#ff8800');         // orange at ~50%
      grad.addColorStop(0.75, '#ff4400');         // red-orange
      grad.addColorStop(1, '#ff1100');            // red at 100%
      ctx.strokeStyle = grad;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, R, ARC_START, needleAngle);
      ctx.stroke();

      // Glow on active arc
      ctx.shadowColor = ratio > 0.8 ? 'rgba(255,34,0,0.6)' : 'rgba(0,136,255,0.4)';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = ratio > 0.8 ? '#ff2200' : '#0088ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, Math.max(ARC_START, needleAngle - 0.3), needleAngle);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Tick marks
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${Math.max(8, R * 0.14)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let s = 0; s <= MAX_SPEED; s += 30) {
      const a = ARC_START + (s / MAX_SPEED) * ARC_RANGE;
      const isMajor = s % 60 === 0;
      const innerR = R - (isMajor ? 10 : 6);
      ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * innerR, cy + Math.sin(a) * innerR);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
      if (isMajor) {
        const labelR = R - 16;
        ctx.fillText(`${s}`, cx + Math.cos(a) * labelR, cy + Math.sin(a) * labelR);
      }
    }

    // Needle
    const needleLen = R - 14;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255,255,255,0.5)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(needleAngle) * needleLen, cy + Math.sin(needleAngle) * needleLen);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Center hub
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff6600';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Digital readout
    ctx.font = `bold ${Math.max(14, R * 0.32)}px sans-serif`;
    ctx.fillStyle = ratio > 0.9 ? '#ff4400' : '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${Math.round(mph)}`, cx, cy + 10);
    ctx.font = `${Math.max(8, R * 0.13)}px sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('MPH', cx, cy + 10 + Math.max(16, R * 0.35));
  };

  createEffect(() => {
    drawSpeedo(speedMPH());
  });

  return (
    <div class="hud">
      <div class="hud-timer" id="hud-timer">{timerText()}</div>
      <canvas class="hud-speedo-canvas" id="hud-speed" ref={speedoCanvas} />
      <div class="hud-lap" id="hud-lap">LAP {lapInfo().current}/{lapInfo().total}</div>
      <div
        class="hud-position"
        id="hud-position"
        ref={positionEl}
        classList={{ 'position-first': positionInfo().rank === 1 }}
        innerHTML={`${positionInfo().rank}<sup>${positionInfo().suffix}</sup>`}
      />
      
      <Show when={isWrongWay()}>
        <div class="hud-wrong-way" id="hud-wrong-way">WRONG WAY</div>
      </Show>

      <div classList={{ 'hud-boost': true, 'boost-active': isBoostActive() }} id="hud-boost">BOOST</div>
      
      <div classList={{ 'hud-nitro': true, 'nitro-burning': isNitroActive(), 'nitro-depleting': isNitroActive() && nitroPct() < 15 }} id="hud-nitro">
        <div class="hud-nitro-label">{isNitroActive() ? '⚡ NITROUS' : 'NITROUS'}</div>
        <div class="hud-nitro-track">
          <div 
            class="hud-nitro-fill" 
            id="hud-nitro-fill"
            style={{ 
              width: `${Math.max(0, Math.min(100, nitroPct()))}%`,
              background: isNitroActive() 
                ? nitroPct() < 15
                  ? 'linear-gradient(90deg, #ff2200, #ff4400, #ff0000)'
                  : 'linear-gradient(90deg, #00ccff, #4488ff, #8844ff)'
                : getNitroGradient(),
              "box-shadow": isNitroActive() 
                ? nitroPct() < 15
                  ? '0 0 20px rgba(255, 50, 50, 0.9), 0 0 40px rgba(255, 50, 50, 0.5), inset 0 0 8px rgba(255,100,100,0.3)'
                  : '0 0 16px rgba(68, 136, 255, 0.9), 0 0 32px rgba(68, 136, 255, 0.4)'
                : nitroPct() < 5 
                  ? '0 0 8px rgba(255, 50, 50, 0.6)' 
                  : 'none',
              animation: isNitroActive() 
                ? nitroPct() < 15
                  ? 'nitro-deplete-pulse 0.15s infinite alternate'
                  : 'nitro-burn-pulse 0.33s infinite alternate'
                : 'none',
              transition: 'box-shadow 0.2s, background 0.3s',
            }}
          />
        </div>
      </div>

      <div classList={{ 'hud-heat': true, 'heat-danger': heatPct() > 80, 'heat-dead': isEngineDead() }} id="hud-heat">
        <div class="hud-heat-label">
          {isEngineDead() ? '💀 ENGINE DEAD' : heatPct() > 90 ? '🔥 OVERHEAT!' : 'HEAT'}
        </div>
        <div class="hud-heat-track">
          <div 
            class="hud-heat-fill"
            id="hud-heat-fill"
            style={{
              width: `${Math.max(0, Math.min(100, heatPct()))}%`,
              background: getHeatColor(),
              "box-shadow": heatPct() > 80
                ? `0 0 12px ${getHeatColor()}, 0 0 24px ${getHeatColor()}55`
                : 'none',
              transition: 'width 0.1s, background 0.3s',
            }}
          />
        </div>
      </div>



      <div class="hud-damage" id="hud-damage">
        <div class={`dmg-zone dmg-front ${getDamageClass(damageState().front)}`} />
        <div class={`dmg-zone dmg-rear ${getDamageClass(damageState().rear)}`} />
        <div class={`dmg-zone dmg-left ${getDamageClass(damageState().left)}`} />
        <div class={`dmg-zone dmg-right ${getDamageClass(damageState().right)}`} />
        <div class="dmg-body" />
        {damageState().front < 30 && (
          <div class="dmg-warning" style="animation: dmg-flash 0.5s infinite alternate">⚠ ENGINE</div>
        )}
        {damageState().rear < 30 && (
          <div class="dmg-warning" style="animation: dmg-flash 0.5s infinite alternate">⚠ BRAKES</div>
        )}
        {(damageState().left < 30 || damageState().right < 30) && (
          <div class="dmg-warning" style="animation: dmg-flash 0.5s infinite alternate">⚠ HANDLING</div>
        )}
      </div>

      <div class="hud-gap" id="hud-gap" innerHTML={`${gapInfo().ahead}<br/>${gapInfo().behind}`} />
    </div>
  );
};
