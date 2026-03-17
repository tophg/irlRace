/* ── Hood Racer — Custom Track Storage (localStorage persistence) ── */

import type { CustomTrackDef } from './types';

const STORAGE_KEY = 'hr-custom-tracks';

/** Retrieve all saved custom tracks. */
export function loadCustomTracks(): CustomTrackDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CustomTrackDef[];
  } catch {
    return [];
  }
}

/** Save a custom track (overwrites if same name exists). */
export function saveCustomTrack(def: CustomTrackDef) {
  const tracks = loadCustomTracks();
  const idx = tracks.findIndex(t => t.name === def.name);
  if (idx >= 0) {
    tracks[idx] = def;
  } else {
    tracks.push(def);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tracks));
}

/** Delete a custom track by name. */
export function deleteCustomTrack(name: string) {
  const tracks = loadCustomTracks().filter(t => t.name !== name);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tracks));
}

/** Export a track as a downloadable JSON file. */
export function exportTrackJSON(def: CustomTrackDef) {
  const json = JSON.stringify(def, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${def.name.replace(/\s+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Import a track from a JSON string. Returns null if invalid. */
export function importTrackJSON(json: string): CustomTrackDef | null {
  try {
    const obj = JSON.parse(json);
    if (!obj.name || !Array.isArray(obj.controlPoints) || obj.controlPoints.length < 4) {
      return null;
    }
    for (const p of obj.controlPoints) {
      if (typeof p.x !== 'number' || typeof p.z !== 'number') return null;
    }
    return {
      name: obj.name,
      controlPoints: obj.controlPoints,
      elevations: Array.isArray(obj.elevations) ? obj.elevations : undefined,
      ramps: Array.isArray(obj.ramps) ? obj.ramps : undefined,
      createdAt: obj.createdAt || Date.now(),
    };
  } catch {
    return null;
  }
}
