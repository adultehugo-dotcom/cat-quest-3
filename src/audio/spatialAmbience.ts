import type { IslandId, Vec2, ZoneId } from '../game/types';
import { AUDIO_SFX_GROUPS, type AudioSfxGroupId } from './audioManifest';

export interface SpatialPanGain {
  pan: number;
  distanceAtten: number;
  distance: number;
}

export interface SpatialAmbienceInput {
  zoneId: ZoneId;
  islandId: IslandId;
  listenerX: number;
  listenerZ: number;
  torches?: readonly Vec2[];
  activeCrystals?: readonly Vec2[];
  forgeHearth?: Vec2 | null;
  shorePoint?: { x: number; z: number; signedDistance: number } | null;
  seaProximity: number;
  nightFactor: number;
  stormIntensity: number;
  rainIntensity: number;
  inCombat: boolean;
  isSailing: boolean;
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

/**
 * Calcule le panoramique stéréo [-0.85, 0.85] et l'atténuation de distance [0, 1]
 * pour un émetteur 2.5D par rapport aux coordonnées d'écoute du joueur.
 */
export function computeSpatialPanGain(
  listenerX: number,
  listenerZ: number,
  sourceX: number,
  sourceZ: number,
  maxRadius = 18,
): SpatialPanGain {
  const dx = sourceX - listenerX;
  const dz = sourceZ - listenerZ;
  const distance = Math.hypot(dx, dz);
  const pan = clamp(dx / 14, -0.85, 0.85);
  const linear = clamp(1 - distance / Math.max(0.001, maxRadius), 0, 1);
  const distanceAtten = Math.pow(linear, 1.6);
  return { pan, distanceAtten, distance };
}

interface SpatialLoopSlot {
  groupId: AudioSfxGroupId;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  panner: StereoPannerNode | null;
  activePath: string | null;
}

const GAIN_TAU_SPATIAL_SEC = 0.25;
const SEAGULL_MIN_INTERVAL_MS = 9000;
const SEAGULL_MAX_INTERVAL_MS = 16000;

export class SpatialAmbienceController {
  private readonly ctx: AudioContext;
  private readonly destination: AudioNode;
  private readonly getBuffer: (path: string) => AudioBuffer | undefined;

  private readonly torchSlots: [SpatialLoopSlot, SpatialLoopSlot];
  private readonly crystalSlot: SpatialLoopSlot;
  private readonly forgeSlot: SpatialLoopSlot;
  private readonly shoreSlot: SpatialLoopSlot;
  private readonly activeOneShotNodes = new Set<AudioNode>();

  private nextSeagullAtMs = 0;
  private seagullVariantToggle = 0;
  private disposed = false;

  constructor(
    ctx: AudioContext,
    ambienceBusGain: AudioNode,
    getBuffer: (path: string) => AudioBuffer | undefined,
  ) {
    this.ctx = ctx;
    this.destination = ambienceBusGain;
    this.getBuffer = getBuffer;

    this.torchSlots = [
      this.createSlot('ambient_torch_fire'),
      this.createSlot('ambient_torch_fire'),
    ];
    this.crystalSlot = this.createSlot('ambient_crystal_hum');
    this.forgeSlot = this.createSlot('ambient_forge_hearth');
    this.shoreSlot = this.createSlot('ambient_shore_surf');
  }

  public update(input: SpatialAmbienceInput, nowMs: number): void {
    if (this.disposed || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    // 1. Torches de donjon (2 plus proches)
    if (input.zoneId !== 'overworld' && input.torches && input.torches.length > 0) {
      const sorted = input.torches
        .map((t) => ({
          pos: t,
          spatial: computeSpatialPanGain(
            input.listenerX,
            input.listenerZ,
            t.x,
            t.z,
            14,
          ),
        }))
        .sort((a, b) => a.spatial.distance - b.spatial.distance);

      for (let i = 0; i < 2; i += 1) {
        const entry = sorted[i];
        if (entry && entry.spatial.distanceAtten > 0.01) {
          this.updateSlot(
            this.torchSlots[i],
            entry.spatial.distanceAtten * AUDIO_SFX_GROUPS.ambient_torch_fire.defaultGain,
            entry.spatial.pan,
            now,
          );
        } else {
          this.updateSlot(this.torchSlots[i], 0, 0, now);
        }
      }
    } else {
      this.updateSlot(this.torchSlots[0], 0, 0, now);
      this.updateSlot(this.torchSlots[1], 0, 0, now);
    }

    // 2. Cristal de soin actif (plus proche)
    if (
      input.zoneId !== 'overworld' &&
      input.activeCrystals &&
      input.activeCrystals.length > 0
    ) {
      let best: SpatialPanGain | null = null;
      for (const c of input.activeCrystals) {
        const sp = computeSpatialPanGain(input.listenerX, input.listenerZ, c.x, c.z, 11);
        if (!best || sp.distance < best.distance) {
          best = sp;
        }
      }
      if (best && best.distanceAtten > 0.01) {
        this.updateSlot(
          this.crystalSlot,
          best.distanceAtten * AUDIO_SFX_GROUPS.ambient_crystal_hum.defaultGain,
          best.pan,
          now,
        );
      } else {
        this.updateSlot(this.crystalSlot, 0, 0, now);
      }
    } else {
      this.updateSlot(this.crystalSlot, 0, 0, now);
    }

    // 3. Foyer de la Forge de Kit-Chat (Miaou-bourg / Félingard)
    if (
      input.zoneId === 'overworld' &&
      input.islandId === 'felingard' &&
      input.forgeHearth
    ) {
      const sp = computeSpatialPanGain(
        input.listenerX,
        input.listenerZ,
        input.forgeHearth.x,
        input.forgeHearth.z,
        16,
      );
      this.updateSlot(
        this.forgeSlot,
        sp.distanceAtten * AUDIO_SFX_GROUPS.ambient_forge_hearth.defaultGain,
        sp.pan,
        now,
      );
    } else {
      this.updateSlot(this.forgeSlot, 0, 0, now);
    }

    // 4. Ressac des rivages (côte proche en overworld)
    if (
      input.zoneId === 'overworld' &&
      !input.isSailing &&
      input.shorePoint &&
      input.shorePoint.signedDistance >= -22
    ) {
      const sp = computeSpatialPanGain(
        input.listenerX,
        input.listenerZ,
        input.shorePoint.x,
        input.shorePoint.z,
        24,
      );
      const calmScale = 1 - clamp(input.stormIntensity, 0, 1) * 0.35;
      this.updateSlot(
        this.shoreSlot,
        sp.distanceAtten *
          AUDIO_SFX_GROUPS.ambient_shore_surf.defaultGain *
          calmScale,
        sp.pan,
        now,
      );
    } else {
      this.updateSlot(this.shoreSlot, 0, 0, now);
    }

    // 5. Mouettes côtières / maritimes de beau temps diurne
    const seagullsAllowed =
      input.zoneId === 'overworld' &&
      !input.inCombat &&
      input.nightFactor < 0.45 &&
      input.stormIntensity < 0.15 &&
      input.rainIntensity < 0.15 &&
      input.seaProximity > 0.5;

    if (seagullsAllowed) {
      if (this.nextSeagullAtMs === 0) {
        this.nextSeagullAtMs = nowMs + 4500;
      } else if (nowMs >= this.nextSeagullAtMs) {
        const pan = input.shorePoint
          ? computeSpatialPanGain(
              input.listenerX,
              input.listenerZ,
              input.shorePoint.x,
              input.shorePoint.z,
              26,
            ).pan
          : (Math.random() * 2 - 1) * 0.55;
        this.playSeagullOneShot(pan, now);
        this.nextSeagullAtMs =
          nowMs +
          SEAGULL_MIN_INTERVAL_MS +
          Math.random() * (SEAGULL_MAX_INTERVAL_MS - SEAGULL_MIN_INTERVAL_MS);
      }
    } else {
      this.nextSeagullAtMs = 0;
    }
  }

  public dispose(): void {
    this.disposed = true;
    const allSlots = [
      this.torchSlots[0],
      this.torchSlots[1],
      this.crystalSlot,
      this.forgeSlot,
      this.shoreSlot,
    ];
    for (const slot of allSlots) {
      if (slot.source) {
        try {
          slot.source.stop();
        } catch {
          // Ignore
        }
        try {
          slot.source.disconnect();
        } catch {
          // Ignore
        }
        slot.source = null;
      }
      try {
        slot.gain.disconnect();
        slot.panner?.disconnect();
      } catch {
        // Ignore
      }
    }
    for (const node of this.activeOneShotNodes) {
      try {
        node.disconnect();
      } catch {
        // Ignore
      }
    }
    this.activeOneShotNodes.clear();
  }

  private createSlot(groupId: AudioSfxGroupId): SpatialLoopSlot {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    let panner: StereoPannerNode | null = null;
    if (typeof this.ctx.createStereoPanner === 'function') {
      panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(0, this.ctx.currentTime);
      gain.connect(panner);
      panner.connect(this.destination);
    } else {
      gain.connect(this.destination);
    }
    return {
      groupId,
      source: null,
      gain,
      panner,
      activePath: null,
    };
  }

  private updateSlot(
    slot: SpatialLoopSlot,
    targetGain: number,
    pan: number,
    now: number,
  ): void {
    const clampedGain = clamp(targetGain, 0, 1);
    if (clampedGain > 0.005 && !slot.source) {
      const path = AUDIO_SFX_GROUPS[slot.groupId].variants[0]?.path;
      const buf = path ? this.getBuffer(path) : undefined;
      if (buf) {
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(slot.gain);
        src.start(now);
        slot.source = src;
        slot.activePath = path;
      }
    }

    try {
      slot.gain.gain.setTargetAtTime(clampedGain, now, GAIN_TAU_SPATIAL_SEC);
      if (slot.panner) {
        slot.panner.pan.setTargetAtTime(clamp(pan, -0.85, 0.85), now, 0.12);
      }
    } catch {
      // Ignore si contexte en fermeture
    }
  }

  private playSeagullOneShot(pan: number, now: number): void {
    const variants = AUDIO_SFX_GROUPS.ambient_seagulls.variants;
    const idx = this.seagullVariantToggle % variants.length;
    this.seagullVariantToggle += 1;
    const path = variants[idx]?.path;
    const buf = path ? this.getBuffer(path) : undefined;
    if (!buf) return;

    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.setValueAtTime(0.95 + Math.random() * 0.1, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(
        AUDIO_SFX_GROUPS.ambient_seagulls.defaultGain * (0.85 + Math.random() * 0.2),
        now,
      );

      let panner: StereoPannerNode | null = null;
      src.connect(gain);
      if (typeof this.ctx.createStereoPanner === 'function') {
        panner = this.ctx.createStereoPanner();
        panner.pan.setValueAtTime(clamp(pan, -0.85, 0.85), now);
        gain.connect(panner);
        panner.connect(this.destination);
        this.activeOneShotNodes.add(panner);
      } else {
        gain.connect(this.destination);
      }

      this.activeOneShotNodes.add(src);
      this.activeOneShotNodes.add(gain);
      src.onended = () => {
        for (const n of [src, gain, panner]) {
          if (!n) continue;
          this.activeOneShotNodes.delete(n);
          try {
            n.disconnect();
          } catch {
            // Ignore
          }
        }
      };
      src.start(now);
    } catch {
      // Ignore
    }
  }
}
