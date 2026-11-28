import type { AudioSfxGroupId } from './audioManifest';

export const VOICE_POOL_MIN_VOICES = 24;
export const VOICE_POOL_MAX_VOICES = 32;
export const VOICE_POOL_DEFAULT_CAPACITY = 28;

export const VOICE_PRIORITY = {
  FOOTSTEP: 1,
  AMBIENT: 2,
  LOOT: 4,
  IMPACT: 5,
  WEAPON: 6,
  MONSTER: 7,
  SPELL: 8,
  UI: 9,
  PLAYER_CRITICAL: 10,
  BOSS: 11,
} as const;

export interface PooledVoiceHandle {
  readonly id: number;
  readonly groupId: AudioSfxGroupId;
  readonly priority: number;
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
  stop: (fadeSec?: number) => void;
}

/**
 * Sélectionne un index de variante aléatoire sans jamais répéter
 * deux fois de suite le même index quand `variantCount >= 2`.
 */
export function pickNonRepeatingVariantIndex(
  variantCount: number,
  lastIndex: number | undefined,
  rng: () => number = Math.random,
): number {
  if (variantCount <= 1) return 0;
  const r = Math.max(0, Math.min(0.9999999, rng()));
  if (lastIndex === undefined || lastIndex < 0 || lastIndex >= variantCount) {
    return Math.floor(r * variantCount);
  }
  const offset = Math.floor(r * (variantCount - 1));
  return (lastIndex + 1 + offset) % variantCount;
}

/**
 * Pool polyphonique borné (24–32 voix concurrentes) avec éviction
 * prioritaire propre (plus ancienne voix de plus faible priorité).
 */
export class AudioVoicePool {
  private readonly maxVoices: number;
  private readonly active = new Map<number, PooledVoiceHandle>();
  private nextId = 1;

  constructor(maxVoices: number = VOICE_POOL_DEFAULT_CAPACITY) {
    this.maxVoices = Math.max(
      VOICE_POOL_MIN_VOICES,
      Math.min(VOICE_POOL_MAX_VOICES, Math.floor(maxVoices)),
    );
  }

  public getMaxVoices(): number {
    return this.maxVoices;
  }

  public getActiveCount(): number {
    return this.active.size;
  }

  public getActiveVoices(): readonly PooledVoiceHandle[] {
    return Array.from(this.active.values());
  }

  public pruneExpired(nowMs: number): number {
    let pruned = 0;
    for (const [id, voice] of this.active) {
      if (nowMs >= voice.expiresAtMs) {
        this.active.delete(id);
        pruned += 1;
      }
    }
    return pruned;
  }

  public acquireSlot(
    groupId: AudioSfxGroupId,
    priority: number,
    durationSec: number,
    nowMs: number,
    createVoice: (voiceId: number, onEnded: () => void) => Omit<PooledVoiceHandle, 'id' | 'groupId' | 'priority' | 'startedAtMs' | 'expiresAtMs'> | null,
  ): PooledVoiceHandle | null {
    this.pruneExpired(nowMs);

    if (this.active.size >= this.maxVoices) {
      let evictCandidate: PooledVoiceHandle | null = null;
      for (const voice of this.active.values()) {
        if (
          !evictCandidate ||
          voice.priority < evictCandidate.priority ||
          (voice.priority === evictCandidate.priority &&
            voice.startedAtMs < evictCandidate.startedAtMs)
        ) {
          evictCandidate = voice;
        }
      }

      if (!evictCandidate || evictCandidate.priority > priority) {
        return null;
      }

      this.active.delete(evictCandidate.id);
      try {
        evictCandidate.stop(0.015);
      } catch {
        // Ignore si déjà arrêtée
      }
    }

    const voiceId = this.nextId++;
    const safeDurationMs = Math.max(60, Math.round(durationSec * 1000) + 80);
    const onEnded = (): void => {
      this.active.delete(voiceId);
    };

    const created = createVoice(voiceId, onEnded);
    if (!created) return null;

    const handle: PooledVoiceHandle = {
      id: voiceId,
      groupId,
      priority,
      startedAtMs: nowMs,
      expiresAtMs: nowMs + safeDurationMs,
      stop: created.stop,
    };
    this.active.set(voiceId, handle);
    return handle;
  }

  public release(voiceId: number): void {
    this.active.delete(voiceId);
  }

  public clear(): void {
    for (const voice of this.active.values()) {
      try {
        voice.stop(0.01);
      } catch {
        // Ignore
      }
    }
    this.active.clear();
  }
}
