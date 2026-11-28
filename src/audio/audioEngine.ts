import { getWeaponCombatProfile } from '../data/equipmentData';
import { resolveAssetUrl } from '../art/hdAssets';
import { loadAudioPrefs, saveAudioPrefs } from '../game/saveSystem';
import {
  type ActiveModal,
  type AudioBusVolumes,
  type AudioPrefs,
  type EnemyMaterialSound,
  type EnemyTypeId,
  type GameEvent,
  type MaterialSound,
  type MusicTrackId,
  type SfxId,
  type SpellId,
  type StatusEffectId,
  type StorageAdapter,
  type TelegraphShape,
  type TerrainSurfaceId,
  type WeaponFamily,
} from '../game/types';
import {
  AUDIO_SFX_GROUPS,
  LEGACY_SFX_TO_GROUP,
  type AudioBusId,
  type AudioSfxCategory,
  type AudioSfxGroupId,
  getLegacySfxPath,
} from './audioManifest';
import {
  AudioVoicePool,
  VOICE_POOL_DEFAULT_CAPACITY,
  VOICE_PRIORITY,
  pickNonRepeatingVariantIndex,
} from './audioVoicePool';
import { LocalMusicPlayer } from './localMusic';
import { playProceduralSfx } from './sfxSynth';
import {
  SpatialAmbienceController,
  type SpatialAmbienceInput,
  computeSpatialPanGain,
} from './spatialAmbience';
import {
  WeatherAudioController,
  type WeatherAudioState,
  type WeatherAudioStatus,
} from './weatherAudio';

export type { WeatherAudioState, WeatherAudioStatus } from './weatherAudio';
export { AudioVoicePool, pickNonRepeatingVariantIndex } from './audioVoicePool';
export {
  computeSpatialPanGain,
  type SpatialAmbienceInput,
  type SpatialPanGain,
} from './spatialAmbience';

const DEFAULT_VOLUME = 0.85;
const DEFAULT_SFX_BUS_GAIN = 0.82;
const DEFAULT_BGM_BUS_GAIN = 0.24;
const DEFAULT_AMBIENCE_BUS_GAIN = 0.42;

const PITCH_CHAIN_WINDOW_MS = 1400;
const PITCH_CHAIN_MAX_STEPS = 8;
const PITCH_CHAIN_STEP_INCREMENT = 0.045;

// Correspondance entre SfxId et fichiers audio locaux enregistrés (public/assets/audio/sfx/*/)
export const LOCAL_SFX_FILES: Readonly<Record<SfxId, string>> = Object.fromEntries(
  (Object.keys(LEGACY_SFX_TO_GROUP) as SfxId[]).map((id) => [id, getLegacySfxPath(id)]),
) as Readonly<Record<SfxId, string>>;

const GROUP_TO_LEGACY_FALLBACK: Partial<Record<AudioSfxGroupId, SfxId>> = (() => {
  const map: Partial<Record<AudioSfxGroupId, SfxId>> = {};
  for (const [sfxId, groupId] of Object.entries(LEGACY_SFX_TO_GROUP) as [
    SfxId,
    AudioSfxGroupId,
  ][]) {
    if (!map[groupId]) {
      map[groupId] = sfxId;
    }
  }
  return map;
})();

export function resolveFallbackLegacySfx(groupId: AudioSfxGroupId): SfxId {
  const direct = GROUP_TO_LEGACY_FALLBACK[groupId];
  if (direct) return direct;

  if (groupId.startsWith('ui_')) {
    if (groupId.endsWith('_close')) return 'menu_close';
    if (groupId === 'ui_forge_upgrade') return 'special_interact';
    if (groupId === 'ui_portal_vortex') return 'spell_aegis_purr';
    return 'menu_open';
  }
  if (groupId.startsWith('impact_')) {
    return groupId === 'impact_blocked' ? 'spell_aegis_purr' : 'sword_hit';
  }
  if (groupId.startsWith('footstep_')) {
    return 'interact';
  }
  if (groupId.startsWith('monster_')) {
    return groupId.endsWith('_attack') ? 'sword_hit' : 'enemy_hurt';
  }
  if (groupId.startsWith('boss_')) {
    if (groupId.includes('rat')) return 'boss_rat_attack';
    if (groupId === 'boss_stagger_break') return 'crit_hit';
    return 'boss_roar';
  }
  if (groupId.startsWith('loot_')) {
    if (groupId === 'loot_victory_fanfare') return 'level_up';
    if (groupId === 'loot_item_drop') return 'special_interact';
    return 'coin_pickup';
  }
  if (groupId.startsWith('combat_')) {
    if (groupId === 'combat_perfect_dodge') return 'crit_hit';
    if (groupId === 'combat_low_hp_alert') return 'player_hurt';
    return 'dodge_whoosh';
  }
  if (groupId.startsWith('weapon_')) {
    if (groupId === 'weapon_staff_cast' || groupId === 'weapon_swing_frost') {
      return 'swing_staff';
    }
    if (groupId === 'weapon_swing_flame') return 'spell_flamepurr';
    if (groupId === 'weapon_swing_iron_heavy') return 'swing_dragon';
    if (groupId === 'weapon_bow_release') return 'dodge_whoosh';
    return 'swing_steel';
  }
  if (groupId.startsWith('status_')) {
    if (groupId.includes('burn')) return 'spell_fire';
    if (groupId.includes('chill')) return 'spell_ice';
    if (groupId.includes('shock')) return 'spell_lightning';
    if (groupId === 'status_purge') return 'spell_heal';
    if (groupId === 'status_stun_apply') return 'crit_hit';
    if (groupId === 'status_curse_apply') return 'boss_rat_attack';
    return 'sword_hit';
  }
  if (groupId.startsWith('ambient_')) {
    return groupId === 'ambient_crystal_hum' ? 'spell_heal' : 'interact';
  }
  return 'interact';
}

const PRELOAD_CATEGORY_ORDER: readonly AudioSfxCategory[] = [
  'ui',
  'weapons',
  'impacts',
  'footsteps',
  'combat',
  'loot',
  'monsters',
  'status',
  'ambient',
];

function getBrowserStorage(): StorageAdapter | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Mode privé ou stockage indisponible
  }
  return null;
}

function clamp01(value: number, fallback = DEFAULT_VOLUME): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function getAudioContextCtor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const win = globalThis as typeof globalThis & {
    webkitAudioContext?: new () => AudioContext;
  };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

export function mapSpellToSfx(spellId: SpellId | undefined): SfxId | null {
  switch (spellId) {
    case 'flamepurr':
      return 'spell_flamepurr';
    case 'lightnyan':
      return 'spell_lightnyan';
    case 'freezepaw':
      return 'spell_freezepaw';
    case 'healing_paw':
      return 'spell_healing_paw';
    case 'aegis_purr':
      return 'spell_aegis_purr';
    case 'pounce_dash':
      return 'spell_pounce_dash';
    case 'meteor_paw':
      return 'spell_meteor_paw';
    default:
      return null;
  }
}

export function mapSpellToSfxGroup(
  spellId: SpellId | undefined,
): AudioSfxGroupId | null {
  const sfx = mapSpellToSfx(spellId);
  return sfx ? LEGACY_SFX_TO_GROUP[sfx] : null;
}

export function mapWeaponToSwingSfx(weaponId: string | undefined): SfxId {
  switch (weaponId) {
    case 'sword_steel':
      return 'swing_steel';
    case 'staff_arcane':
      return 'swing_staff';
    case 'blade_dragon':
      return 'swing_dragon';
    case 'sword_wood':
    default:
      return 'swing_wood';
  }
}

export function mapWeaponToSfxGroups(
  weaponId: string | undefined,
  weaponFamily?: WeaponFamily,
  materialSound?: MaterialSound,
): { primary: AudioSfxGroupId; layer?: AudioSfxGroupId } {
  const profile = weaponId ? getWeaponCombatProfile(weaponId) : undefined;
  const family = weaponFamily ?? profile?.weaponFamily ?? 'sword';
  const material = materialSound ?? profile?.materialSound ?? 'wood';
  const materialSwingGroup =
    (`weapon_swing_${material}` as AudioSfxGroupId) in AUDIO_SFX_GROUPS
      ? (`weapon_swing_${material}` as AudioSfxGroupId)
      : 'weapon_swing_wood';

  switch (family) {
    case 'bow_crossbow':
      return { primary: 'weapon_bow_release' };
    case 'staff':
      return {
        primary: 'weapon_staff_cast',
        layer: materialSwingGroup,
      };
    case 'dagger_claws':
      return {
        primary: 'weapon_swing_dagger',
        layer: material === 'bone' ? 'weapon_swing_bone' : undefined,
      };
    case 'spear':
      return {
        primary: 'weapon_swing_spear',
        layer:
          material === 'bone' || material === 'iron_heavy'
            ? materialSwingGroup
            : undefined,
      };
    case 'axe_hammer':
    case 'sword':
    default:
      return { primary: materialSwingGroup };
  }
}

export function mapEnemyMaterialToImpactGroup(
  material?: EnemyMaterialSound,
): AudioSfxGroupId {
  switch (material) {
    case 'gelatinous':
      return 'impact_gelatinous';
    case 'flesh_fur':
      return 'impact_flesh_fur';
    case 'bone':
      return 'impact_bone';
    case 'stone_ice':
      return 'impact_stone_ice';
    case 'spectral':
      return 'impact_spectral';
    case 'dragon_scales':
      return 'impact_dragon_scales';
    default:
      return 'impact_generic';
  }
}

export function mapTerrainToFootstepGroup(
  terrain?: TerrainSurfaceId,
): AudioSfxGroupId {
  switch (terrain) {
    case 'sand':
      return 'footstep_sand';
    case 'rock':
      return 'footstep_rock';
    case 'snow_ice':
      return 'footstep_snow_ice';
    case 'wood_deck':
      return 'footstep_ship_wood';
    case 'dungeon_tiles':
      return 'footstep_dungeon_stone';
    case 'grass':
    default:
      return 'footstep_grass';
  }
}

export function mapMonsterTelegraphGroup(
  enemyTypeId?: EnemyTypeId,
): AudioSfxGroupId | null {
  switch (enemyTypeId) {
    case 'slime_yarn':
      return 'monster_slime_telegraph';
    case 'mouse_goblin':
      return 'monster_goblin_telegraph';
    case 'thorn_wolf':
      return 'monster_wolf_telegraph';
    case 'fishbone_skeleton':
      return 'monster_skeleton_telegraph';
    case 'frost_golem':
      return 'monster_golem_telegraph';
    case 'boss_rat_king':
      return 'boss_rat_telegraph';
    case 'boss_dragon_claw':
      return 'boss_dragon_telegraph';
    default:
      return null;
  }
}

export function mapMonsterAttackGroup(
  enemyTypeId?: EnemyTypeId,
  shape?: TelegraphShape,
  patternId?: string,
): AudioSfxGroupId | null {
  switch (enemyTypeId) {
    case 'slime_yarn':
      return 'monster_slime_attack';
    case 'mouse_goblin':
      return 'monster_goblin_attack';
    case 'thorn_wolf':
      return 'monster_wolf_attack';
    case 'fishbone_skeleton':
      return 'monster_skeleton_attack';
    case 'frost_golem':
      return 'monster_golem_attack';
    case 'boss_rat_king':
      return 'boss_rat_attack';
    case 'boss_dragon_claw':
      return shape === 'cone' ||
        patternId?.includes('flame') ||
        patternId?.includes('breath')
        ? 'boss_dragon_flame'
        : 'boss_dragon_slam';
    default:
      return null;
  }
}

export function mapModalToUiSfxGroup(
  modal: ActiveModal | 'inn' | 'bestiary',
  action: 'open' | 'close',
): AudioSfxGroupId | null {
  switch (modal) {
    case 'map':
      return action === 'open' ? 'ui_map_open' : 'ui_map_close';
    case 'inventory':
      return action === 'open' ? 'ui_inventory_open' : 'ui_inventory_close';
    case 'forge':
      return action === 'open' ? 'ui_forge_open' : 'ui_forge_close';
    case 'inn':
      return action === 'open' ? 'ui_inn_open' : 'ui_inn_close';
    case 'quests':
      return action === 'open' ? 'ui_quests_open' : 'ui_quests_close';
    case 'bestiary':
      return action === 'open' ? 'ui_bestiary_open' : 'ui_bestiary_close';
    case 'pause':
      return action === 'open' ? 'ui_menu_open' : 'ui_menu_close';
    default:
      return null;
  }
}

export function mapStatusToSfxGroup(
  statusId: StatusEffectId,
  kind: 'apply' | 'tick' | 'purge' = 'apply',
): AudioSfxGroupId {
  if (kind === 'purge') return 'status_purge';
  if (kind === 'tick') {
    if (statusId === 'burn') return 'status_burn_tick';
    if (statusId === 'poison') return 'status_poison_tick';
    if (statusId === 'bleed') return 'status_bleed_tick';
  }
  switch (statusId) {
    case 'burn':
      return 'status_burn_apply';
    case 'chill':
      return 'status_chill_apply';
    case 'poison':
      return 'status_poison_apply';
    case 'bleed':
      return 'status_bleed_apply';
    case 'stun':
      return 'status_stun_apply';
    case 'shock':
      return 'status_shock_apply';
    case 'curse':
    default:
      return 'status_curse_apply';
  }
}

export interface PlayVariantOptions {
  gainScale?: number;
  pitchMultiplier?: number;
  pan?: number;
  distanceAtten?: number;
  x?: number;
  z?: number;
  maxRadius?: number;
  chainId?: 'coin' | 'xp';
  bypassInterval?: boolean;
  priority?: number;
  fadeOutTailSec?: number;
  rng?: () => number;
  nowMs?: number;
}

export interface ComputedVariantParams {
  groupId: AudioSfxGroupId;
  variantIndex: number;
  variantPath: string;
  durationSec: number;
  bus: 'sfx' | 'ambience';
  playbackRate: number;
  gain: number;
  pan: number | undefined;
  chainStep: number;
}

function getDefaultPriorityForGroup(groupId: AudioSfxGroupId): number {
  const cat = AUDIO_SFX_GROUPS[groupId].category;
  if (groupId.startsWith('boss_')) return VOICE_PRIORITY.BOSS;
  if (
    groupId === 'combat_player_hurt' ||
    groupId === 'combat_hero_death' ||
    groupId === 'combat_low_hp_alert' ||
    groupId === 'combat_perfect_dodge'
  ) {
    return VOICE_PRIORITY.PLAYER_CRITICAL;
  }
  switch (cat) {
    case 'ui':
      return VOICE_PRIORITY.UI;
    case 'combat':
      return VOICE_PRIORITY.SPELL;
    case 'monsters':
      return VOICE_PRIORITY.MONSTER;
    case 'weapons':
      return VOICE_PRIORITY.WEAPON;
    case 'impacts':
      return VOICE_PRIORITY.IMPACT;
    case 'loot':
      return VOICE_PRIORITY.LOOT;
    case 'footsteps':
      return VOICE_PRIORITY.FOOTSTEP;
    case 'ambient':
    default:
      return VOICE_PRIORITY.AMBIENT;
  }
}

/**
 * Moteur audio de production (Web Audio API) :
 * - Mixeur 4 bus (`master`, `music`, `sfx`, `ambience`) + `muted` persisté dans `felingard_audio_prefs_v1`
 * - Pool polyphonique `AudioVoicePool` (28 voix concurrentes, éviction prioritaire propre)
 * - `playVariant` anti-répétition + micro-variations pitch/gain + chaîne ascendante Or/XP
 * - Matrice d'impacts par matière ennemie, swings d'armes par famille/matière, attaques monstres 2 temps
 * - Musiques 8 pistes avec `boss_phase2`, `victory`, boost maritime et `duckMusic`
 * - Paysage sonore spatialisé (torches, forge, rivages, mouettes, cristaux)
 */
export class AudioEngine {
  private readonly storage: StorageAdapter | null;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private musicDuckGain: GainNode | null = null;
  private weatherGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private musicPlayer: LocalMusicPlayer | null = null;
  private weatherAudio: WeatherAudioController | null = null;
  private spatialAmbience: SpatialAmbienceController | null = null;

  private readonly sfxBuffers = new Map<string, AudioBuffer>();
  private readonly voicePool = new AudioVoicePool(VOICE_POOL_DEFAULT_CAPACITY);
  private readonly lastVariantByGroup = new Map<AudioSfxGroupId, number>();
  private readonly lastGroupTimestampMs = new Map<AudioSfxGroupId, number>();
  private readonly pitchChainState = new Map<
    'coin' | 'xp',
    { count: number; lastMs: number }
  >();

  private sfxPreloadStarted = false;
  private prefs: AudioPrefs;
  private desiredTheme: MusicTrackId | null = null;
  private lastWeatherState: WeatherAudioState | null = null;
  private listenerX = 0;
  private listenerZ = 0;
  private unlockListenersBound = false;
  private innCloseTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private readonly onFirstGesture = (): void => {
    this.unlock();
  };

  constructor(storage?: StorageAdapter) {
    this.storage = storage ?? getBrowserStorage();
    this.prefs = this.loadPrefs();
    this.bindUnlockListeners();
  }

  public isUnlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  public isMuted(): boolean {
    return this.prefs.muted;
  }

  public getVolume(): number {
    return this.prefs.master;
  }

  public getBusVolume(bus: AudioBusId): number {
    return this.prefs[bus];
  }

  public getBusVolumes(): AudioBusVolumes {
    return {
      master: this.prefs.master,
      music: this.prefs.music,
      sfx: this.prefs.sfx,
      ambience: this.prefs.ambience,
    };
  }

  public getPrefs(): AudioPrefs {
    return { ...this.prefs };
  }

  public getMusicTheme(): MusicTrackId | null {
    return this.desiredTheme;
  }

  public getLoadedSfxCount(): number {
    return this.sfxBuffers.size;
  }

  public getActiveVoiceCount(): number {
    return this.voicePool.getActiveCount();
  }

  public getVoicePool(): AudioVoicePool {
    return this.voicePool;
  }

  public getLastVariantIndex(groupId: AudioSfxGroupId): number | undefined {
    return this.lastVariantByGroup.get(groupId);
  }

  public getPitchChainCount(chainId: 'coin' | 'xp'): number {
    return this.pitchChainState.get(chainId)?.count ?? 0;
  }

  /**
   * Initialise ou reprend l'AudioContext (appelé automatiquement sur 1re interaction).
   */
  public unlock(): void {
    if (this.disposed) return;

    if (!this.ctx) {
      const Ctor = getAudioContextCtor();
      if (!Ctor) return;

      try {
        const ctx = new Ctor();
        const masterGain = ctx.createGain();
        const sfxGain = ctx.createGain();
        const bgmGain = ctx.createGain();
        const musicDuckGain = ctx.createGain();
        const weatherGain = ctx.createGain();
        const compressor = ctx.createDynamicsCompressor();

        compressor.threshold.setValueAtTime(-12, ctx.currentTime);
        compressor.knee.setValueAtTime(16, ctx.currentTime);
        compressor.ratio.setValueAtTime(4, ctx.currentTime);
        compressor.attack.setValueAtTime(0.005, ctx.currentTime);
        compressor.release.setValueAtTime(0.15, ctx.currentTime);

        sfxGain.gain.setValueAtTime(
          DEFAULT_SFX_BUS_GAIN * this.prefs.sfx,
          ctx.currentTime,
        );
        bgmGain.gain.setValueAtTime(
          DEFAULT_BGM_BUS_GAIN * this.prefs.music,
          ctx.currentTime,
        );
        musicDuckGain.gain.setValueAtTime(1.0, ctx.currentTime);
        weatherGain.gain.setValueAtTime(
          DEFAULT_AMBIENCE_BUS_GAIN * this.prefs.ambience,
          ctx.currentTime,
        );

        sfxGain.connect(masterGain);
        musicDuckGain.connect(bgmGain);
        bgmGain.connect(masterGain);
        weatherGain.connect(masterGain);
        masterGain.connect(compressor);
        compressor.connect(ctx.destination);

        this.ctx = ctx;
        this.masterGain = masterGain;
        this.sfxGain = sfxGain;
        this.bgmGain = bgmGain;
        this.musicDuckGain = musicDuckGain;
        this.weatherGain = weatherGain;
        this.compressor = compressor;
        this.musicPlayer = new LocalMusicPlayer(ctx, musicDuckGain);
        this.weatherAudio = new WeatherAudioController(ctx, weatherGain);
        this.spatialAmbience = new SpatialAmbienceController(
          ctx,
          weatherGain,
          (path) => this.sfxBuffers.get(path),
        );
        this.weatherAudio.startLoading();
        this.preloadLocalSfx();

        this.applyAllBusGains(true);
      } catch {
        return;
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx
        .resume()
        .then(() => {
          this.onContextRunning();
        })
        .catch(() => {
          // Le navigateur peut refuser hors geste direct ; on retentera au prochain geste
        });
    } else if (this.ctx && this.ctx.state === 'running') {
      this.onContextRunning();
    }
  }

  public toggleMute(): boolean {
    this.unlock();
    this.prefs.muted = !this.prefs.muted;
    this.applyAllBusGains(false);
    this.savePrefs();
    return this.prefs.muted;
  }

  public setMuted(muted: boolean): void {
    this.prefs.muted = muted;
    this.applyAllBusGains(false);
    this.savePrefs();
  }

  /**
   * Définit le volume global master (0..1) et synchronise `volume` (rétrocompatibilité).
   */
  public setVolume(volume: number): void {
    const clamped = clamp01(volume, DEFAULT_VOLUME);
    this.prefs.master = clamped;
    this.prefs.volume = clamped;
    if (clamped > 0 && this.prefs.muted) {
      this.prefs.muted = false;
    }
    this.applyAllBusGains(false);
    this.savePrefs();
  }

  /**
   * Définit le volume d'un bus du mixeur 4 bus (`master` | `music` | `sfx` | `ambience`).
   */
  public setBusVolume(bus: AudioBusId, value: number): void {
    const clamped = clamp01(value, bus === 'master' ? DEFAULT_VOLUME : 1);
    this.prefs[bus] = clamped;
    if (bus === 'master') {
      this.prefs.volume = clamped;
      if (clamped > 0 && this.prefs.muted) {
        this.prefs.muted = false;
      }
    }
    this.applyAllBusGains(false);
    this.savePrefs();
  }

  /**
   * Calcule les paramètres de variante (anti-répétition, micro-variation pitch/gain,
   * chaîne ascendante Or/XP, panoramique/atténuation) — 100 % testable sous Node.
   */
  public prepareVariantParams(
    groupId: AudioSfxGroupId,
    options?: PlayVariantOptions,
  ): ComputedVariantParams {
    const group = AUDIO_SFX_GROUPS[groupId];
    const rng = options?.rng ?? Math.random;
    const nowMs = options?.nowMs ?? Date.now();

    const lastIdx = this.lastVariantByGroup.get(groupId);
    const variantIndex = pickNonRepeatingVariantIndex(
      group.variants.length,
      lastIdx,
      rng,
    );
    this.lastVariantByGroup.set(groupId, variantIndex);

    const variant = group.variants[variantIndex] ?? group.variants[0];

    let chainStep = 0;
    let chainPitchBoost = 1.0;
    if (options?.chainId) {
      const prev = this.pitchChainState.get(options.chainId);
      if (prev && nowMs - prev.lastMs <= PITCH_CHAIN_WINDOW_MS) {
        chainStep = Math.min(PITCH_CHAIN_MAX_STEPS, prev.count + 1);
      } else {
        chainStep = 0;
      }
      this.pitchChainState.set(options.chainId, {
        count: chainStep,
        lastMs: nowMs,
      });
      chainPitchBoost = 1 + chainStep * PITCH_CHAIN_STEP_INCREMENT;
    }

    const pitchDelta = (rng() * 2 - 1) * group.pitchJitter;
    const gainDelta = (rng() * 2 - 1) * group.gainJitter;
    const playbackRate =
      (1 + pitchDelta) * (options?.pitchMultiplier ?? 1) * chainPitchBoost;

    let pan = options?.pan;
    let distanceAtten = options?.distanceAtten ?? 1;
    if (options?.x !== undefined && options?.z !== undefined) {
      const sp = computeSpatialPanGain(
        this.listenerX,
        this.listenerZ,
        options.x,
        options.z,
        options.maxRadius ?? 28,
      );
      if (pan === undefined) pan = sp.pan;
      if (options.distanceAtten === undefined) {
        distanceAtten = Math.max(0.18, sp.distanceAtten);
      }
    }

    const gain = Math.max(
      0,
      Math.min(
        1.4,
        group.defaultGain *
          (1 + gainDelta) *
          (options?.gainScale ?? 1) *
          distanceAtten,
      ),
    );

    return {
      groupId,
      variantIndex,
      variantPath: variant.path,
      durationSec: variant.durationSec,
      bus: group.bus,
      playbackRate,
      gain,
      pan: pan === undefined ? undefined : Math.max(-0.85, Math.min(0.85, pan)),
      chainStep,
    };
  }

  /**
   * Joue une variante d'un groupe SFX/ambience avec anti-répétition,
   * micro-variations, gestion polyphonique `AudioVoicePool` et fallback minimal.
   */
  public playVariant(
    groupId: AudioSfxGroupId,
    options?: PlayVariantOptions,
  ): ComputedVariantParams | null {
    if (this.disposed || this.prefs.muted || this.prefs.master <= 0.001) {
      return null;
    }
    const group = AUDIO_SFX_GROUPS[groupId];
    if (!group) return null;

    const busVol =
      group.bus === 'ambience' ? this.prefs.ambience : this.prefs.sfx;
    if (busVol <= 0.001) return null;

    const nowMs =
      options?.nowMs ??
      (typeof performance !== 'undefined' ? performance.now() : Date.now());

    if (!options?.bypassInterval && group.minIntervalMs > 0) {
      const prevMs = this.lastGroupTimestampMs.get(groupId) ?? -Infinity;
      if (nowMs - prevMs < group.minIntervalMs) {
        return null;
      }
      this.lastGroupTimestampMs.set(groupId, nowMs);
    }

    const params = this.prepareVariantParams(groupId, {
      ...options,
      nowMs,
    });

    if (!this.ctx || !this.sfxGain || this.ctx.state !== 'running') {
      return params;
    }

    const destNode =
      params.bus === 'ambience' && this.weatherGain
        ? this.weatherGain
        : this.sfxGain;
    const priority = options?.priority ?? getDefaultPriorityForGroup(groupId);
    const buffer = this.sfxBuffers.get(params.variantPath);

    if (!buffer) {
      // Filet de secours minimal Web Audio uniquement si le buffer n'est pas encore décodé
      const fallbackSfx = resolveFallbackLegacySfx(groupId);
      playProceduralSfx(this.ctx, destNode, fallbackSfx);
      return params;
    }

    const ctx = this.ctx;
    this.voicePool.acquireSlot(
      groupId,
      priority,
      params.durationSec,
      nowMs,
      (_voiceId, onEnded) => {
        try {
          const now = ctx.currentTime;
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.playbackRate.setValueAtTime(params.playbackRate, now);

          const gainNode = ctx.createGain();
          gainNode.gain.setValueAtTime(params.gain, now);

          if (options?.fadeOutTailSec && options.fadeOutTailSec > 0.02) {
            const dur = Math.max(0.1, buffer.duration / params.playbackRate);
            const fadeStart = Math.max(
              now + 0.02,
              now + dur - options.fadeOutTailSec,
            );
            gainNode.gain.setValueAtTime(params.gain, fadeStart);
            gainNode.gain.linearRampToValueAtTime(0.0001, now + dur);
          }

          let panner: StereoPannerNode | null = null;
          src.connect(gainNode);
          if (
            params.pan !== undefined &&
            typeof ctx.createStereoPanner === 'function'
          ) {
            panner = ctx.createStereoPanner();
            panner.pan.setValueAtTime(params.pan, now);
            gainNode.connect(panner);
            panner.connect(destNode);
          } else {
            gainNode.connect(destNode);
          }

          const cleanup = (): void => {
            onEnded();
            try {
              src.disconnect();
              gainNode.disconnect();
              panner?.disconnect();
            } catch {
              // Ignore
            }
          };

          src.onended = cleanup;
          src.start(now);

          return {
            stop: (fadeSec = 0.015) => {
              const t = ctx.currentTime;
              try {
                gainNode.gain.cancelScheduledValues(t);
                gainNode.gain.setValueAtTime(
                  Math.max(0.0001, gainNode.gain.value),
                  t,
                );
                gainNode.gain.linearRampToValueAtTime(0.0001, t + fadeSec);
                src.stop(t + fadeSec + 0.01);
              } catch {
                // Ignore
              }
            },
          };
        } catch {
          return null;
        }
      },
    );

    return params;
  }

  /**
   * Joue un SFX par ancien identifiant `SfxId` (délégué à `playVariant`).
   */
  public playSfx(name: SfxId, options?: PlayVariantOptions): void {
    const groupId = LEGACY_SFX_TO_GROUP[name];
    if (groupId) {
      this.playVariant(groupId, options);
      return;
    }
    if (
      !this.disposed &&
      !this.prefs.muted &&
      this.prefs.master > 0.001 &&
      this.ctx &&
      this.sfxGain &&
      this.ctx.state === 'running'
    ) {
      playProceduralSfx(this.ctx, this.sfxGain, name);
    }
  }

  /**
   * Joue les sons d'ouverture / fermeture douce d'interface.
   */
  public playUiScreenSfx(
    screen: ActiveModal | 'inn' | 'bestiary',
    action: 'open' | 'close',
  ): void {
    const groupId = mapModalToUiSfxGroup(screen, action);
    if (!groupId) return;
    this.playVariant(groupId, {
      gainScale: action === 'close' ? 0.76 : 1.0,
      pitchMultiplier: action === 'close' ? 0.96 : 1.0,
      priority: VOICE_PRIORITY.UI,
    });
  }

  /**
   * Atténuation musicale douce (`duckMusic`) lors d'événements narratifs ou majeurs.
   */
  public duckMusic(
    targetScale = 0.45,
    holdSec = 0.5,
    releaseSec = 0.65,
  ): void {
    if (this.disposed || !this.ctx || !this.musicDuckGain) return;
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const clampedTarget = Math.max(0.15, Math.min(1, targetScale));
    const attack = 0.05;
    const hold = Math.max(0.05, holdSec);
    const release = Math.max(0.1, releaseSec);
    const param = this.musicDuckGain.gain;
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(Math.max(0.15, param.value), now);
      param.linearRampToValueAtTime(clampedTarget, now + attack);
      param.setValueAtTime(clampedTarget, now + attack + hold);
      param.linearRampToValueAtTime(1.0, now + attack + hold + release);
    } catch {
      // Ignore si contexte en fermeture
    }
  }

  /**
   * Définit le thème musical actif avec crossfade fluide.
   */
  public setMusicTheme(theme: MusicTrackId | null, fadeSeconds = 1.35): void {
    if (this.disposed) return;
    this.desiredTheme = theme;
    if (this.musicPlayer && this.ctx && this.ctx.state === 'running') {
      this.musicPlayer.setTheme(theme, fadeSeconds);
    }
  }

  /**
   * Met à jour les ambiances météo & maritimes (mer, vent, pluie, oiseaux).
   */
  public updateWeatherAmbience(state: WeatherAudioState, dt: number): void {
    if (this.disposed) return;
    this.lastWeatherState = { ...state };
    if (this.weatherAudio && this.ctx && this.ctx.state === 'running') {
      this.weatherAudio.update(state, dt);
    }
  }

  /**
   * Met à jour les coordonnées d'écoute et les boucles spatialisées (torches, forge, rivages, cristaux, mouettes).
   */
  public updateSpatialAmbience(input: SpatialAmbienceInput): void {
    if (this.disposed) return;
    this.listenerX = input.listenerX;
    this.listenerZ = input.listenerZ;
    if (this.spatialAmbience && this.ctx && this.ctx.state === 'running') {
      const nowMs =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      this.spatialAmbience.update(input, nowMs);
    }
  }

  public triggerThunder(intensity = 1.0): void {
    if (
      this.disposed ||
      this.prefs.muted ||
      this.prefs.master <= 0.001 ||
      this.prefs.ambience <= 0.001
    ) {
      return;
    }
    if (!this.ctx || !this.weatherAudio || this.ctx.state !== 'running') {
      return;
    }
    if (this.lastWeatherState && !this.lastWeatherState.inOverworld) {
      return;
    }
    this.weatherAudio.triggerThunder(intensity);
  }

  public getWeatherAudioStatus(): WeatherAudioStatus {
    if (!this.weatherAudio) {
      return {
        loadedTracks: [],
        fallbackTracks: [],
        activeGains: { ocean: 0, wind: 0, rain: 0, birds: 0 },
        thunderCount: 0,
      };
    }
    return this.weatherAudio.getStatus();
  }

  /**
   * Traduit un lot d'événements de simulation en effets sonores, couches critiques/matière,
   * chaînes Or/XP, télégraphes 2 temps, pas au sol et ducking musical.
   */
  public handleEvents(events: readonly GameEvent[]): void {
    if (this.disposed || events.length === 0) return;

    let playedChest = false;
    let playedLevelUp = false;
    let playedVictory = false;
    let playedNpc = false;
    let playedSpecial = false;

    for (const ev of events) {
      switch (ev.type) {
        case 'melee_swing': {
          const swing = mapWeaponToSfxGroups(
            ev.weaponId,
            ev.weaponFamily,
            ev.materialSound,
          );
          this.playVariant(swing.primary, {
            x: ev.x,
            z: ev.z,
            priority: VOICE_PRIORITY.WEAPON,
          });
          if (swing.layer) {
            this.playVariant(swing.layer, {
              x: ev.x,
              z: ev.z,
              gainScale: 0.45,
              priority: VOICE_PRIORITY.WEAPON - 1,
            });
          }
          break;
        }
        case 'hit_enemy': {
          const impactGroup = mapEnemyMaterialToImpactGroup(ev.enemyMaterial);
          this.playVariant(impactGroup, {
            x: ev.x,
            z: ev.z,
            priority: VOICE_PRIORITY.IMPACT,
          });
          if (ev.isCrit) {
            this.playVariant('impact_crit', {
              x: ev.x,
              z: ev.z,
              priority: VOICE_PRIORITY.IMPACT + 1,
            });
          }
          if (ev.blocked || ev.absorbedByShield) {
            this.playVariant('impact_blocked', {
              x: ev.x,
              z: ev.z,
              priority: VOICE_PRIORITY.IMPACT + 1,
            });
          }
          this.playVariant('monster_hurt', {
            x: ev.x,
            z: ev.z,
            gainScale: 0.58,
            priority: VOICE_PRIORITY.MONSTER - 1,
          });
          break;
        }
        case 'hit_player': {
          const isShieldedOrBlocked = Boolean(
            ev.blocked || ev.absorbedByShield || ev.spellId === 'aegis_purr',
          );
          if (isShieldedOrBlocked) {
            this.playVariant('impact_blocked', {
              x: ev.x,
              z: ev.z,
              priority: VOICE_PRIORITY.PLAYER_CRITICAL,
            });
            if (!ev.blocked && (ev.value ?? 0) > 0) {
              this.playVariant('combat_player_hurt', {
                x: ev.x,
                z: ev.z,
                priority: VOICE_PRIORITY.PLAYER_CRITICAL,
              });
            }
          } else if (ev.value === undefined || ev.value > 0) {
            this.playVariant('combat_player_hurt', {
              x: ev.x,
              z: ev.z,
              priority: VOICE_PRIORITY.PLAYER_CRITICAL,
            });
          }
          break;
        }
        case 'enemy_telegraph': {
          const tgGroup = mapMonsterTelegraphGroup(ev.enemyTypeId);
          if (tgGroup) {
            this.playVariant(tgGroup, {
              x: ev.x,
              z: ev.z,
              priority: ev.enemyTypeId?.startsWith('boss_')
                ? VOICE_PRIORITY.BOSS
                : VOICE_PRIORITY.MONSTER,
            });
          }
          break;
        }
        case 'telegraph_impact': {
          const atkGroup = mapMonsterAttackGroup(
            ev.enemyTypeId,
            ev.shape,
            ev.patternId,
          );
          if (atkGroup) {
            this.playVariant(atkGroup, {
              x: ev.x,
              z: ev.z,
              priority: ev.enemyTypeId?.startsWith('boss_')
                ? VOICE_PRIORITY.BOSS
                : VOICE_PRIORITY.MONSTER,
            });
          }
          break;
        }
        case 'footstep':
          this.playVariant(mapTerrainToFootstepGroup(ev.terrain), {
            priority: VOICE_PRIORITY.FOOTSTEP,
          });
          break;
        case 'low_hp_alert':
          this.playVariant('combat_low_hp_alert', {
            priority: VOICE_PRIORITY.PLAYER_CRITICAL,
          });
          break;
        case 'gold_pickup':
          this.playVariant('loot_coin_pickup', {
            chainId: 'coin',
            x: ev.x,
            z: ev.z,
            priority: VOICE_PRIORITY.LOOT,
          });
          break;
        case 'xp_pickup':
          this.playVariant('loot_xp_pickup', {
            chainId: 'xp',
            x: ev.x,
            z: ev.z,
            priority: VOICE_PRIORITY.LOOT,
          });
          break;
        case 'enemy_died':
          if (ev.enemyTypeId === 'boss_rat_king') {
            this.playVariant('boss_rat_death', {
              x: ev.x,
              z: ev.z,
              priority: VOICE_PRIORITY.BOSS,
            });
            this.duckMusic(0.35, 0.85, 0.9);
          } else if (ev.enemyTypeId === 'boss_dragon_claw') {
            this.playVariant('boss_dragon_death', {
              x: ev.x,
              z: ev.z,
              priority: VOICE_PRIORITY.BOSS,
            });
            this.duckMusic(0.32, 1.0, 1.0);
          } else {
            this.playVariant('monster_death', {
              x: ev.x,
              z: ev.z,
              priority: VOICE_PRIORITY.MONSTER,
            });
          }
          break;
        case 'enemy_projectile_spawned': {
          const atkGroup = mapMonsterAttackGroup(
            ev.enemyTypeId,
            ev.shape,
            ev.patternId,
          );
          if (atkGroup) {
            this.playVariant(atkGroup, {
              x: ev.x,
              z: ev.z,
              priority: ev.enemyTypeId?.startsWith('boss_')
                ? VOICE_PRIORITY.BOSS
                : VOICE_PRIORITY.MONSTER,
            });
          }
          break;
        }
        case 'boss_cinematic_start':
          if (ev.cinematicKind === 'boss_intro') {
            if (ev.enemyTypeId === 'boss_dragon_claw') {
              this.playVariant('boss_dragon_roar', {
                x: ev.x,
                z: ev.z,
                priority: VOICE_PRIORITY.BOSS,
              });
            } else {
              this.playVariant('boss_rat_telegraph', {
                x: ev.x,
                z: ev.z,
                priority: VOICE_PRIORITY.BOSS,
              });
            }
            this.duckMusic(0.45, 0.7, 0.9);
          }
          break;
        case 'boss_cinematic_stage':
          if (ev.enemyTypeId === 'boss_dragon_claw') {
            if (ev.cinematicStage === 'inferno_roar') {
              this.playVariant('boss_dragon_roar', { x: ev.x, z: ev.z, priority: VOICE_PRIORITY.BOSS });
            } else if (ev.cinematicStage === 'double_shockwave') {
              this.playVariant('boss_dragon_slam', { x: ev.x, z: ev.z, priority: VOICE_PRIORITY.BOSS });
            } else if (ev.cinematicStage === 'lair_brighten') {
              this.playVariant('loot_victory_fanfare', { priority: VOICE_PRIORITY.BOSS });
            }
          }
          break;
        case 'spell_cast': {
          const group = mapSpellToSfxGroup(ev.spellId);
          if (group) {
            this.playVariant(group, {
              x: ev.x,
              z: ev.z,
              priority: VOICE_PRIORITY.SPELL,
            });
          }
          break;
        }
        case 'starfall_impact':
          this.playVariant('combat_spell_meteor_fall', {
            x: ev.x,
            z: ev.z,
            priority: VOICE_PRIORITY.SPELL,
          });
          break;
        case 'dodge_roll':
          this.playVariant('combat_dodge_whoosh', {
            priority: VOICE_PRIORITY.WEAPON,
          });
          break;
        case 'level_up':
          if (!playedLevelUp) {
            this.playVariant('loot_level_up', {
              priority: VOICE_PRIORITY.PLAYER_CRITICAL,
            });
            this.duckMusic(0.38, 0.7, 0.8);
            playedLevelUp = true;
          }
          break;
        case 'chest_opening_start':
          this.playVariant('loot_chest_creak', {
            x: ev.x,
            z: ev.z,
            priority: VOICE_PRIORITY.LOOT,
          });
          break;
        case 'chest_opened':
          if (!playedChest) {
            this.playVariant('loot_chest_open', {
              x: ev.x,
              z: ev.z,
              fadeOutTailSec: 0.22,
              priority: VOICE_PRIORITY.UI,
            });
            this.duckMusic(0.5, 0.45, 0.65);
            playedChest = true;
          }
          break;
        case 'forge_upgraded':
        case 'item_upgraded':
          if (!playedSpecial) {
            this.playVariant('ui_forge_upgrade', {
              priority: VOICE_PRIORITY.UI,
            });
            playedSpecial = true;
          }
          break;
        case 'equipment_purchased':
          if (!playedSpecial) {
            this.playVariant('ui_interact', {
              priority: VOICE_PRIORITY.UI,
            });
            playedSpecial = true;
          }
          break;
        case 'quest_updated':
          if (!playedSpecial) {
            this.playVariant('ui_special_interact', {
              priority: VOICE_PRIORITY.UI,
            });
            playedSpecial = true;
          }
          break;
        case 'quest_completed':
          if (!playedLevelUp) {
            this.playVariant('loot_level_up', {
              priority: VOICE_PRIORITY.UI,
            });
            this.duckMusic(0.42, 0.6, 0.7);
            playedLevelUp = true;
          }
          break;
        case 'player_rested':
          if (!playedSpecial) {
            this.playUiScreenSfx('inn', 'open');
            if (this.innCloseTimeoutId !== null) {
              clearTimeout(this.innCloseTimeoutId);
            }
            this.innCloseTimeoutId = setTimeout(() => {
              this.innCloseTimeoutId = null;
              if (!this.disposed) {
                this.playUiScreenSfx('inn', 'close');
              }
            }, 950);
            playedSpecial = true;
          }
          break;
        case 'dialogue_started':
          if (!playedNpc) {
            this.playVariant('ui_npc_talk', {
              priority: VOICE_PRIORITY.UI,
            });
            this.duckMusic(0.62, 0.35, 0.5);
            playedNpc = true;
          }
          break;
        case 'portal_enter':
          if (!playedSpecial) {
            this.playVariant('ui_special_interact', {
              x: ev.x,
              z: ev.z,
              gainScale: 0.65,
              priority: VOICE_PRIORITY.UI,
            });
            playedSpecial = true;
          }
          break;
        case 'portal_vortex':
          this.playVariant('ui_portal_vortex', {
            x: ev.x,
            z: ev.z,
            priority: VOICE_PRIORITY.UI,
          });
          break;
        case 'companion_chime':
          this.playVariant('ui_special_interact', {
            x: ev.x,
            z: ev.z,
            gainScale: 0.42,
            pitchMultiplier: 1.14,
            priority: VOICE_PRIORITY.UI,
          });
          break;
        case 'decor_hit':
          if (ev.decorMaterial === 'stone' || ev.decorMaterial === 'crystal') {
            this.playVariant('impact_prop_stone', {
              x: ev.x,
              z: ev.z,
              gainScale: ev.decorMaterial === 'crystal' ? 0.56 : 0.72,
              priority: VOICE_PRIORITY.IMPACT,
            });
          } else {
            this.playVariant('impact_prop_wood', {
              x: ev.x,
              z: ev.z,
              gainScale: ev.decorMaterial === 'foliage' ? 0.48 : 0.74,
              priority: VOICE_PRIORITY.IMPACT,
            });
          }
          break;
        case 'shore_splash':
          this.playVariant('footstep_water_shore', {
            x: ev.x,
            z: ev.z,
            gainScale: 0.58,
            priority: VOICE_PRIORITY.FOOTSTEP,
          });
          break;
        case 'boss_phase_two':
          this.playVariant('boss_dragon_roar', {
            x: ev.x,
            z: ev.z,
            priority: VOICE_PRIORITY.BOSS,
          });
          this.duckMusic(0.45, 0.7, 0.85);
          break;
        case 'boss_attack_sfx':
          if (ev.sfxId) {
            this.playSfx(ev.sfxId, {
              x: ev.x,
              z: ev.z,
              priority: VOICE_PRIORITY.BOSS,
            });
          }
          break;
        case 'hero_death_start':
        case 'player_died':
          this.playVariant('combat_hero_death', {
            priority: VOICE_PRIORITY.PLAYER_CRITICAL,
          });
          break;
        case 'victory':
          if (!playedVictory) {
            this.playVariant('loot_victory_fanfare', {
              priority: VOICE_PRIORITY.BOSS,
            });
            this.duckMusic(0.42, 0.8, 0.9);
            playedVictory = true;
          }
          break;
        case 'ship_boarding':
        case 'ship_disembarked':
          if (!playedSpecial) {
            this.playVariant('combat_dodge_whoosh', {
              priority: VOICE_PRIORITY.UI,
            });
            playedSpecial = true;
          }
          break;
        case 'ship_boarded':
        case 'ship_refused':
          if (!playedSpecial) {
            this.playVariant('ui_meow', {
              priority: VOICE_PRIORITY.UI,
            });
            playedSpecial = true;
          }
          break;
        case 'zone_transition':
        case 'portal_exit':
        case 'heal_tick':
        case 'mp_gain':
        case 'toast':
        case 'ship_docking':
        case 'loot_spawned':
          break;
        case 'perfect_dodge':
          this.playVariant('combat_perfect_dodge', {
            x: ev.x,
            z: ev.z,
            priority: VOICE_PRIORITY.PLAYER_CRITICAL,
          });
          break;
        case 'status_applied':
          if (ev.statusId) {
            this.playVariant(mapStatusToSfxGroup(ev.statusId, 'apply'), {
              x: ev.x,
              z: ev.z,
              gainScale: 0.85,
              priority: VOICE_PRIORITY.SPELL,
            });
          }
          break;
        case 'status_tick':
          if (ev.statusId) {
            this.playVariant(mapStatusToSfxGroup(ev.statusId, 'tick'), {
              x: ev.x,
              z: ev.z,
              gainScale: 0.72,
              priority: VOICE_PRIORITY.IMPACT,
            });
          }
          break;
        case 'status_purged':
          this.playVariant('status_purge', {
            x: ev.x,
            z: ev.z,
            priority: VOICE_PRIORITY.PLAYER_CRITICAL,
          });
          break;
        case 'stagger_break':
          this.playVariant('boss_stagger_break', {
            x: ev.x,
            z: ev.z,
            priority: VOICE_PRIORITY.BOSS,
          });
          break;
        case 'loot_bounce':
          this.playVariant('loot_item_drop', {
            x: ev.x,
            z: ev.z,
            gainScale: 0.55,
            priority: VOICE_PRIORITY.LOOT,
          });
          break;
      }
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.unbindUnlockListeners();
    if (this.innCloseTimeoutId !== null) {
      clearTimeout(this.innCloseTimeoutId);
      this.innCloseTimeoutId = null;
    }
    this.voicePool.clear();
    if (this.musicPlayer) {
      this.musicPlayer.dispose();
      this.musicPlayer = null;
    }
    if (this.weatherAudio) {
      this.weatherAudio.dispose();
      this.weatherAudio = null;
    }
    if (this.spatialAmbience) {
      this.spatialAmbience.dispose();
      this.spatialAmbience = null;
    }
    this.sfxBuffers.clear();
    this.lastVariantByGroup.clear();
    this.lastGroupTimestampMs.clear();
    this.pitchChainState.clear();
    this.lastWeatherState = null;
    for (const node of [
      this.sfxGain,
      this.musicDuckGain,
      this.bgmGain,
      this.weatherGain,
      this.masterGain,
      this.compressor,
    ]) {
      if (node) {
        try {
          node.disconnect();
        } catch {
          // Ignore
        }
      }
    }
    this.masterGain = null;
    this.sfxGain = null;
    this.bgmGain = null;
    this.musicDuckGain = null;
    this.weatherGain = null;
    this.compressor = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => {
        // Ignore
      });
      this.ctx = null;
    }
  }

  private preloadLocalSfx(): void {
    if (
      this.disposed ||
      this.sfxPreloadStarted ||
      !this.ctx ||
      typeof fetch !== 'function'
    ) {
      return;
    }
    this.sfxPreloadStarted = true;

    const orderedPaths: string[] = [];
    const seen = new Set<string>();
    for (const cat of PRELOAD_CATEGORY_ORDER) {
      for (const group of Object.values(AUDIO_SFX_GROUPS)) {
        if (group.category !== cat) continue;
        for (const variant of group.variants) {
          if (!seen.has(variant.path)) {
            seen.add(variant.path);
            orderedPaths.push(variant.path);
          }
        }
      }
    }

    const ctx = this.ctx;
    void (async () => {
      const BATCH_SIZE = 8;
      for (let i = 0; i < orderedPaths.length; i += BATCH_SIZE) {
        if (this.disposed) return;
        const batch = orderedPaths.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (relPath) => {
            try {
              const res = await fetch(resolveAssetUrl(relPath));
              if (!res.ok || this.disposed) return;
              const arr = await res.arrayBuffer();
              if (this.disposed || arr.byteLength < 64) return;
              const decoded = await new Promise<AudioBuffer | null>((resolve) => {
                try {
                  const p = ctx.decodeAudioData(
                    arr.slice(0),
                    (b) => resolve(b),
                    () => resolve(null),
                  );
                  if (p && typeof p.then === 'function') {
                    p.then(
                      (b) => resolve(b),
                      () => resolve(null),
                    );
                  }
                } catch {
                  resolve(null);
                }
              });
              if (decoded && !this.disposed) {
                this.sfxBuffers.set(relPath, decoded);
              }
            } catch {
              // Filet de secours sfxSynth conservé proprement
            }
          }),
        );
      }
    })();
  }

  private onContextRunning(): void {
    this.unbindUnlockListeners();
    this.applyAllBusGains(false);
    if (this.musicPlayer && this.desiredTheme !== null) {
      this.musicPlayer.setTheme(this.desiredTheme, 1.1);
    }
    if (this.weatherAudio) {
      if (this.lastWeatherState) {
        this.weatherAudio.update(this.lastWeatherState, 0.016);
      } else {
        this.weatherAudio.syncCurrentState();
      }
    }
  }

  private applyBusGainNode(
    node: GainNode | null,
    target: number,
    immediate: boolean,
  ): void {
    if (!this.ctx || !node) return;
    const now = this.ctx.currentTime;
    const gainParam = node.gain;
    try {
      gainParam.cancelScheduledValues(now);
      if (immediate) {
        gainParam.setValueAtTime(target, now);
      } else {
        gainParam.setValueAtTime(gainParam.value, now);
        gainParam.linearRampToValueAtTime(target, now + 0.04);
      }
    } catch {
      // Ignore si contexte fermé
    }
  }

  private applyAllBusGains(immediate: boolean): void {
    const masterTarget = this.prefs.muted ? 0 : this.prefs.master;
    this.applyBusGainNode(this.masterGain, masterTarget, immediate);
    this.applyBusGainNode(
      this.bgmGain,
      DEFAULT_BGM_BUS_GAIN * this.prefs.music,
      immediate,
    );
    this.applyBusGainNode(
      this.sfxGain,
      DEFAULT_SFX_BUS_GAIN * this.prefs.sfx,
      immediate,
    );
    this.applyBusGainNode(
      this.weatherGain,
      DEFAULT_AMBIENCE_BUS_GAIN * this.prefs.ambience,
      immediate,
    );
  }

  private bindUnlockListeners(): void {
    if (this.unlockListenersBound || typeof window === 'undefined') return;
    this.unlockListenersBound = true;
    window.addEventListener('pointerdown', this.onFirstGesture, { passive: true });
    window.addEventListener('keydown', this.onFirstGesture, { passive: true });
  }

  private unbindUnlockListeners(): void {
    if (!this.unlockListenersBound || typeof window === 'undefined') return;
    this.unlockListenersBound = false;
    window.removeEventListener('pointerdown', this.onFirstGesture);
    window.removeEventListener('keydown', this.onFirstGesture);
  }

  private loadPrefs(): AudioPrefs {
    return loadAudioPrefs(this.storage);
  }

  private savePrefs(): void {
    saveAudioPrefs(this.prefs, this.storage);
  }
}
