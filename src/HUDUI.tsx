/* ── Hood Racer — Solid.js HUD ── */

import { createSignal, createEffect, onMount, onCleanup, Show } from 'solid-js';
import * as THREE from 'three';
import { RaceEngine } from './race-engine';

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
export const [damageState, setDamageState] = createSignal({
  front: 100, rear: 100, left: 100, right: 100
});
export const [gapInfo, setGapInfo] = createSignal({ ahead: '', behind: '' });

// Minimap imperative access
export let minimapCtx: CanvasRenderingContext2D | null = null;
export let minimapCanvasEl: HTMLCanvasElement | null = null;

export const RacingHUD = () => {
  let canvasRef: HTMLCanvasElement | undefined;

  onMount(() => {
    if (canvasRef) {
      minimapCanvasEl = canvasRef;
      minimapCtx = canvasRef.getContext('2d');
    }
  });

  onCleanup(() => {
    minimapCtx = null;
    minimapCanvasEl = null;
  });

  const getNitroGradient = () => {
    const pct = nitroPct();
    if (pct > 70) return 'linear-gradient(90deg, #ff6600, #ff2200)';
    if (pct > 30) return 'linear-gradient(90deg, #0088ff, #ff6600)';
    return 'linear-gradient(90deg, #0044aa, #0088ff)';
  };

  const getDamageClass = (hp: number) => {
    if (hp > 60) return '';
    if (hp > 25) return 'dmg-yellow';
    return 'dmg-red';
  };

  return (
    <div class="hud">
      <div class="hud-timer" id="hud-timer">{timerText()}</div>
      <div class="hud-speed" id="hud-speed">{speedMPH()}<span>MPH</span></div>
      <div class="hud-lap" id="hud-lap">LAP {lapInfo().current}/{lapInfo().total}</div>
      <div class="hud-position" id="hud-position" innerHTML={`${positionInfo().rank}<sup>${positionInfo().suffix}</sup>`} />
      
      <Show when={isWrongWay()}>
        <div class="hud-wrong-way" id="hud-wrong-way">WRONG WAY</div>
      </Show>

      <div classList={{ 'hud-boost': true, 'boost-active': isBoostActive() }} id="hud-boost">BOOST</div>
      
      <div class="hud-nitro" id="hud-nitro">
        <div class="hud-nitro-label">NITRO</div>
        <div class="hud-nitro-track">
          <div 
            class="hud-nitro-fill" 
            id="hud-nitro-fill"
            style={{ 
              width: `${Math.max(0, Math.min(100, nitroPct()))}%`,
              background: getNitroGradient(),
              "box-shadow": isNitroActive() ? '0 0 12px rgba(255, 100, 0, 0.8)' : 'none'
            }}
          />
        </div>
      </div>

      <canvas class="hud-minimap" id="hud-minimap" width="160" height="160" ref={canvasRef} />

      <div class="hud-damage" id="hud-damage">
        <div class={`dmg-zone dmg-front ${getDamageClass(damageState().front)}`} />
        <div class={`dmg-zone dmg-rear ${getDamageClass(damageState().rear)}`} />
        <div class={`dmg-zone dmg-left ${getDamageClass(damageState().left)}`} />
        <div class={`dmg-zone dmg-right ${getDamageClass(damageState().right)}`} />
        <div class="dmg-body" />
      </div>

      <div class="hud-gap" id="hud-gap" innerHTML={`${gapInfo().ahead}<br/>${gapInfo().behind}`} />
    </div>
  );
};
