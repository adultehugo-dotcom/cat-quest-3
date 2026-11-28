// ============================================================================
// Contrats TypeScript centraux — Les Chroniques de Félingard
// Règle stricte : ZÉRO import de 'three', ZÉRO référence au DOM.
// ============================================================================

// --- Constantes globales partagées ---

export const SAVE_STORAGE_KEY = 'felingard_cat_quest_save_v1';
export const AUDIO_PREFS_STORAGE_KEY = 'felingard_audio_prefs_v1';
export const MYSTERY_CHEST_COST = 120;
export const MAX_PLAYER_LEVEL = 10;
export const MAX_SPELL_LEVEL = 5;
export const MAX_FORGE_UPGRADE_LEVEL = 3 as const;

export type ForgeUpgradeLevel = 0 | 1 | 2 | 3;

export const FORGE_UPGRADE_MULTIPLIERS: Readonly<Record<ForgeUpgradeLevel, number>> = {
  0: 1.0,
  1: 1.15,
  2: 1.32,
  3: 1.55,
};

export const ALL_EQUIP_SLOTS: readonly EquipSlot[] = [
  'weapon',
  'shield',
  'helmet',
  'armor',
  'cape',
];

export const OPTIONAL_EQUIP_SLOTS: readonly EquipSlot[] = [
  'shield',
  'cape',
];

export const STARTING_EQUIPMENT: Record<EquipSlot, string> = {
  weapon: 'sword_wood',
  shield: '',
  helmet: 'helm_bandana',
  armor: 'armor_tunic',
  cape: '',
};

// --- Types de base (Section 3 du cahier des charges) ---

export type Vec2 = { x: number; z: number };

export type ZoneId = 'overworld' | 'dungeon_ghost_cave' | 'dungeon_dragon_lair';

export type IslandId = 'felingard' | 'tropical' | 'mountain' | 'mystic' | 'wild' | 'archipelago';

export type BiomeId =
  | 'plains'
  | 'forest'
  | 'frost'
  | 'village'
  | 'tropical'
  | 'mountain'
  | 'mystic'
  | 'wild';

export type SpellId =
  | 'flamepurr'
  | 'lightnyan'
  | 'freezepaw'
  | 'healing_paw'
  | 'aegis_purr'
  | 'pounce_dash'
  | 'meteor_paw';
export type EquipSlot =
  | 'weapon'
  | 'shield'
  | 'helmet'
  | 'armor'
  | 'cape';
export type Rarity = 'common' | 'rare' | 'epic';

export type TelegraphShape = 'circle' | 'cone' | 'line' | 'ring';
export type TelegraphElement = 'physical' | 'frost' | 'fire' | 'poison' | 'spectral';
export type EnemySkillBehavior =
  | 'standard'
  | 'slime_splatter'
  | 'goblin_dagger_throw'
  | 'thorn_burst'
  | 'boomerang_bone'
  | 'ice_spikes_wave'
  | 'cheese_wheel'
  | 'toxic_miasma'
  | 'homing_orb'
  | 'spectral_scythe'
  | 'abyssal_fissure'
  | 'flame_jet_sweep'
  | 'meteor_rain'
  | 'thermal_shockwave'
  | 'inferno_cross';

export type ShipSlot =
  | 'coque'
  | 'puissance_canon'
  | 'cadence'
  | 'capacite_munitions'
  | 'rechargement'
  | 'patte_boost'
  | 'super_patte_canon'
  | 'patte_canon_magma'
  | 'patte_canon_electrique'
  | 'patte_canon_maudite'
  | 'redoutable_canard';

export type ShipBlueprint =
  | 'coque_cuirassée'
  | 'canon_foudre'
  | 'cadence_double'
  | 'grenier_munitions'
  | 'rechargement_rapide';

export type MaritimeEnemyType =
  | 'pi_rate_pyromane'
  | 'requin_gobelin'
  | 'oiseau_tempete'
  | 'kraken_de_chambre';

export type ShipMode =
  | 'parked'
  | 'boarding'
  | 'sailing'
  | 'docking'
  | 'disembarking';

export type SavedShipMode = 'parked' | 'sailing';

export type CoastKind = 'beach' | 'cliff' | 'rocks';

export type DisembarkRefusalReason =
  | 'too_far_from_shore'
  | 'inaccessible_cliff'
  | 'no_safe_spot'
  | 'not_in_overworld';

export interface ShipTransitionState {
  kind: 'boarding' | 'docking' | 'disembarking';
  elapsed: number;
  duration: number;
  targetIslandId: IslandId;
  shipStartPos: Vec2;
  shipTargetPos: Vec2;
  shipStartAngle: number;
  shipTargetAngle: number;
  heroStartPos: Vec2;
  heroStartY: number;
  heroTargetPos: Vec2;
  heroTargetY: number;
  companionStartPos: Vec2;
  companionStartY: number;
  companionTargetPos: Vec2;
  companionTargetY: number;
  arcHeight: number;
  landingPos?: Vec2;
}

export interface ShipDisembarkStatus {
  canDisembark: boolean;
  nearestIslandId: IslandId | null;
  coastDistance: number;
  coastKind: CoastKind;
  reason?: DisembarkRefusalReason;
  landingPos?: Vec2;
  shorePoint?: Vec2;
}

export interface ShipState {
  mode: ShipMode;
  /** Synchronisé avec mode === 'sailing' || mode === 'docking' */
  isSailing: boolean;
  position: Vec2;
  /**
   * Cap canonique Three.js en radians autour de +Y (proue locale = -Z).
   * forward(angle) = (-sin(angle), -cos(angle)) ; right(angle) = (cos(angle), -sin(angle)).
   * Augmenter angle tourne à gauche (bâbord / CCW vu du dessus).
   */
  angle: number;
  vx: number;
  vz: number;
  /** Vitesse longitudinale signée (> 0 avant, < 0 marche arrière) */
  speed: number;
  /** Vitesse angulaire (rad/s : > 0 bâbord/gauche, < 0 tribord/droite) */
  angularVelocity: number;
  /** Angle normalisé du gouvernail [-1 (gauche) .. +1 (droite)] */
  rudder: number;
  /** Inclinaison latérale visuelle (rad) */
  roll: number;
  /** Tangage longitudinal visuel (rad) */
  pitch: number;
  /** Phase d'oscillation verticale sur l'eau */
  bobPhase: number;
  /** Décalage vertical de houle purement visuel */
  bobY: number;
  /** Intensité normalisée du sillage [0..1] */
  wakeIntensity: number;
  /** Temporisation obligatoire à v = 0 avant d'enclencher la marche arrière */
  reverseEngageTimer: number;
  isCollidingShore: boolean;
  nearestCoastIslandId: IslandId | null;
  dockedIslandId: IslandId | null;
  transition: ShipTransitionState | null;
  disembarkStatus: ShipDisembarkStatus;
  hullHp: number;
  maxHullHp: number;
  ammo: number;
  maxAmmo: number;
  reloadTimer: number;
  equippedBlueprints: Partial<Record<ShipSlot, ShipBlueprint>>;
  unlockedSlots: Record<ShipSlot, boolean>;
}

export interface SavedShipData {
  mode: SavedShipMode;
  position: Vec2;
  angle: number;
  dockedIslandId: IslandId | null;
  hullHp: number;
  maxHullHp: number;
  ammo: number;
  maxAmmo: number;
  equippedBlueprints: Partial<Record<ShipSlot, ShipBlueprint>>;
  unlockedSlots: Record<ShipSlot, boolean>;
}

export interface TelegraphZone {
  id: string;
  ownerId: string;
  shape: TelegraphShape;
  x: number;
  z: number;
  angle: number;        // radians dans le plan (x, z)
  radius: number;       // rayon (circle/cone/ring) ou longueur (line)
  innerRadius?: number; // pour 'ring'
  width?: number;       // largeur pour 'line'
  arcAngle?: number;    // ouverture en radians pour 'cone'
  elapsed: number;
  duration: number;     // temps avant impact
  damage: number;
  color?: string;
  resolved: boolean;
  patternId?: string;
  ownerTypeId?: EnemyTypeId;
  statusProc?: WeaponStatusProc;
  perfectDodged?: boolean;
  delaySec?: number;
  element?: TelegraphElement;
  skillBehavior?: EnemySkillBehavior;
  sweepProgress?: number;
  sweepStartAngle?: number;
  sweepEndAngle?: number;
}

export interface OwnedEquipment {
  id: string;
  level: number; // commence à 1, +1 à chaque doublon obtenu
  upgradeLevel: ForgeUpgradeLevel; // amélioration Forge de Kit-Chat (0 à +3)
}

export interface PlayerStats {
  atk: number;
  mag: number;
  def: number;
  critChance: number;
}

export interface PlayerState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  facingX: number; // -1 (gauche) ou 1 (droite) pour le sprite
  aimAngle: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  level: number;
  xp: number;
  xpToNext: number;
  gold: number;
  equipped: Record<EquipSlot, string>; // IDs d'équipement
  inventory: Record<string, OwnedEquipment>;
  spellLevels: Record<SpellId, number>; // 1 à 5
  spellCooldowns: Record<SpellId, number>;
  comboStep: 0 | 1 | 2;
  comboResetTimer: number;
  attackCooldown: number;
  attackAnimTimer: number;
  dodgeTimer: number;       // > 0 pendant la roulade
  dodgeCooldown: number;
  invulnTimer: number;      // > 0 pendant i-frames (roulade ou post-hit)
  hitFlashTimer: number;
  regenTimer: number;       // pour Soin-velours
  regenTickAccum: number;
  shieldHp?: number;        // bouclier temporaire (Égide de Ronron)
  shieldMaxHp?: number;
  shieldTimer?: number;
  hasRunicKey: boolean;
  stats: PlayerStats;
  // Champs auxiliaires optionnels pour la simulation/juice
  dodgeDirX?: number;
  dodgeDirZ?: number;
  knockbackVx?: number;
  knockbackVz?: number;
  lastMeleeAngle?: number;
  lastMeleeWeaponId?: string;
  /** Élévation monde Y (pont du bateau ou saut parabolique embarquement/débarquement) */
  elevationY?: number;
  /** Vrai lorsque le personnage se tient sur le pont du voilier */
  onShipDeck?: boolean;
  /** Effets de statut actifs (Phase 3) */
  activeStatuses?: ActiveStatusEffect[];
  /** Durée restante du bonus d'attaque +35 % après une esquive parfaite */
  perfectDodgeBuffTimer?: number;
}

export type EnemyTypeId =
  | 'slime_yarn'
  | 'mouse_goblin'
  | 'thorn_wolf'
  | 'fishbone_skeleton'
  | 'frost_golem'
  | 'boss_rat_king'
  | 'boss_dragon_claw';

export type EnemyAIState = 'idle' | 'chase' | 'windup' | 'recover' | 'staggered' | 'dead';

export interface EnemyInstance {
  id: string;
  typeId: EnemyTypeId;
  name: string;
  level: number;
  x: number;
  z: number;
  homeX: number;
  homeZ: number;
  facingX: number;
  hp: number;
  maxHp: number;
  radius: number;
  state: EnemyAIState;
  stateTimer: number;
  attackCooldown: number;
  slowTimer: number;      // ralenti par Patte-givrée
  hitFlashTimer: number;
  phase: 1 | 2;           // pour Boss Dragon
  isBoss: boolean;
  respawnTimer: number;   // respawn overworld uniquement
  // Champs auxiliaires optionnels pour l'IA et le rendu
  vx?: number;
  vz?: number;
  knockbackVx?: number;
  knockbackVz?: number;
  attackPatternIndex?: number;
  activePatternId?: string;
  activeLungeAngle?: number;
  activeLungeDist?: number;
  aggroed?: boolean;
  // Phase 3 : Statuts & Posture/Stagger
  activeStatuses?: ActiveStatusEffect[];
  stagger?: number;
  maxStagger?: number;
  staggeredTimer?: number;
  staggerDecayDelay?: number;
  // Phase 4 : Projection de mort, intro boss & souffles continus
  deathTimer?: number;
  deathDuration?: number;
  introPlayed?: boolean;
  activeSweepStartAngle?: number;
  activeSweepEndAngle?: number;
  activeSweepElapsed?: number;
  activeSweepDuration?: number;
  activeSweepTickAccum?: number;
  activeSweepPatternId?: string;
}

export type QuestId = 'main_dragon_blood' | 'side_yarn_hunt' | 'side_lost_blade';
export type QuestStatus = 'available' | 'active' | 'completed';

export interface QuestProgress {
  id: QuestId;
  status: QuestStatus;
  stepIndex: number;
  counter: number; // ex: monstres tués
}

export type GameEventType =
  | 'melee_swing'
  | 'hit_enemy'
  | 'hit_player'
  | 'enemy_died'
  | 'enemy_telegraph'
  | 'footstep'
  | 'low_hp_alert'
  | 'spell_cast'
  | 'dodge_roll'
  | 'level_up'
  | 'chest_opened'
  | 'gold_pickup'
  | 'xp_pickup'
  | 'item_upgraded'
  | 'forge_upgraded'
  | 'equipment_purchased'
  | 'quest_updated'
  | 'quest_completed'
  | 'zone_transition'
  | 'player_rested'
  | 'boss_phase_two'
  | 'player_died'
  | 'victory'
  | 'heal_tick'
  | 'mp_gain'
  | 'telegraph_impact'
  | 'dialogue_started'
  | 'toast'
  | 'ship_boarding'
  | 'ship_boarded'
  | 'ship_docking'
  | 'ship_disembarked'
  | 'ship_refused'
  | 'chest_opening_start'
  | 'starfall_impact'
  | 'portal_enter'
  | 'portal_exit'
  | 'hero_death_start'
  | 'boss_attack_sfx'
  | 'perfect_dodge'
  | 'status_applied'
  | 'status_tick'
  | 'status_purged'
  | 'stagger_break'
  | 'loot_bounce'
  | 'loot_spawned'
  | 'enemy_projectile_spawned'
  | 'hazard_zone_spawned'
  | 'boss_cinematic_start'
  | 'boss_cinematic_stage'
  | 'boss_cinematic_end'
  | 'portal_vortex'
  | 'companion_chime'
  | 'decor_hit'
  | 'shore_splash';

export interface GameEvent {
  type: GameEventType;
  x?: number;
  z?: number;
  angle?: number;
  radius?: number;
  value?: number;
  text?: string;
  isCrit?: boolean;
  blocked?: boolean;
  absorbedByShield?: boolean;
  spellId?: SpellId;
  zoneId?: ZoneId;
  islandId?: IslandId;
  enemyId?: string;
  enemyTypeId?: EnemyTypeId;
  enemyMaterial?: EnemyMaterialSound;
  itemId?: string;
  itemLevel?: number;
  upgradeLevel?: ForgeUpgradeLevel;
  questId?: QuestId;
  comboStep?: 0 | 1 | 2;
  shape?: TelegraphShape;
  color?: string;
  accentColor?: string;
  toastVariant?: 'info' | 'warning';
  weaponId?: string;
  weaponFamily?: WeaponFamily;
  materialSound?: MaterialSound;
  terrain?: TerrainSurfaceId;
  patternId?: string;
  sfxId?: SfxId;
  targetX?: number;
  targetZ?: number;
  hitArc?: number;
  statusId?: StatusEffectId;
  attackShape?: WeaponAttackShape;
  startAngle?: number;
  endAngle?: number;
  activeSec?: number;
  windupSec?: number;
  element?: string;
  lootKind?: LootDropKind;
  hazardKind?: HazardZoneKind;
  projectileKind?: EnemyProjectileKind;
  cinematicKind?: CinematicKind;
  cinematicStage?: string;
  knockbackVx?: number;
  knockbackVz?: number;
  companionTargetKind?: 'chest' | 'quest';
  companionReactionKind?: CompanionReactionKind;
  propId?: string;
  propKind?: PropKind;
  decorMaterial?: DecorMaterialKind;
}

// --- Équipement & Styles Visuels ---

export type WeaponFamily =
  | 'sword'
  | 'axe_hammer'
  | 'dagger_claws'
  | 'spear'
  | 'staff'
  | 'bow_crossbow';

export type MaterialSound =
  | 'wood'
  | 'steel'
  | 'iron_heavy'
  | 'bone'
  | 'arcane'
  | 'draconic'
  | 'flame'
  | 'frost';

export type EnemyMaterialSound =
  | 'gelatinous'
  | 'flesh_fur'
  | 'bone'
  | 'stone_ice'
  | 'spectral'
  | 'dragon_scales';

export type TerrainSurfaceId =
  | 'grass'
  | 'sand'
  | 'rock'
  | 'snow_ice'
  | 'wood_deck'
  | 'dungeon_tiles';

export type WeaponAttackShape = 'arc' | 'thrust_line' | 'cleave' | 'projectile';

export type StatusEffectId =
  | 'burn'
  | 'chill'
  | 'poison'
  | 'bleed'
  | 'stun'
  | 'shock'
  | 'curse';

export interface WeaponStatusProc {
  statusId: StatusEffectId;
  chance: number;
  durationSec: number;
  potency?: number;
}

export interface ActiveStatusEffect {
  id: StatusEffectId;
  remainingSec: number;
  durationSec: number;
  potency: number;
  tickAccum: number;
  sourceId?: string;
}

export interface AttackMetadata {
  weaponId: string;
  weaponFamily: WeaponFamily;
  materialSound: MaterialSound;
  attackShape: WeaponAttackShape;
  comboStep: 0 | 1 | 2;
  startAngle: number;
  endAngle: number;
  range: number;
  windupSec: number;
  activeSec: number;
  element?: string;
  color: string;
  accentColor: string;
}

export interface PlayerProjectile {
  id: string;
  projectileId: string;
  weaponId: string;
  weaponFamily: WeaponFamily;
  materialSound: MaterialSound;
  x: number;
  z: number;
  vx: number;
  vz: number;
  speed: number;
  radius: number;
  distanceTraveled: number;
  maxRange: number;
  damage: number;
  isCrit: boolean;
  knockback: number;
  staggerPower: number;
  hitstopSec: number;
  mpGain: number;
  comboStep: 0 | 1 | 2;
  statusProc?: WeaponStatusProc;
  canConsumePerfectDodgeBuff?: boolean;
  color: string;
  accentColor: string;
}

export type LootDropKind = 'gold' | 'xp';

export interface LootDrop {
  id: string;
  kind: LootDropKind;
  amount: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  collectDelay: number;
  bounces: number;
  magnetRange: number;
  magnetized: boolean;
}

export type EnemyProjectileKind =
  | 'dagger'
  | 'fishbone'
  | 'cheese_wheel'
  | 'spectral_orb'
  | 'spectral_scythe'
  | 'ember_bolt';

export interface EnemyProjectile {
  id: string;
  ownerId: string;
  ownerTypeId: EnemyTypeId;
  patternId?: string;
  kind: EnemyProjectileKind;
  x: number;
  z: number;
  startX: number;
  startZ: number;
  vx: number;
  vz: number;
  speed: number;
  radius: number;
  distanceTraveled: number;
  maxRange: number;
  age: number;
  maxAge: number;
  damage: number;
  element: TelegraphElement;
  color: string;
  accentColor: string;
  statusProc?: WeaponStatusProc;
  homingTurnRate?: number;
  isBoomerang?: boolean;
  returning?: boolean;
  hitPlayerOnOutbound?: boolean;
  hitPlayerOnInbound?: boolean;
  returnSpeed?: number;
  piercing?: boolean;
  spinAngle?: number;
}

export type HazardZoneKind =
  | 'slime_puddle'
  | 'thorn_patch'
  | 'toxic_miasma'
  | 'abyssal_fissure'
  | 'scorch_crater'
  | 'frost_patch';

export interface HazardZone {
  id: string;
  ownerId: string;
  ownerTypeId: EnemyTypeId;
  patternId?: string;
  kind: HazardZoneKind;
  x: number;
  z: number;
  radius: number;
  length?: number;
  width?: number;
  angle?: number;
  elapsed: number;
  duration: number;
  tickInterval: number;
  tickAccum: number;
  damagePerTick: number;
  slowFactor?: number;
  statusProc?: WeaponStatusProc;
  element: TelegraphElement;
  color: string;
}

export type CinematicKind = 'boss_intro' | 'boss_death';

export interface CinematicState {
  id: string;
  kind: CinematicKind;
  bossId: string;
  bossTypeId: EnemyTypeId;
  stage: string;
  stageIndex: number;
  elapsed: number;
  duration: number;
  maxDuration: number;
  focusX: number;
  focusZ: number;
  targetZoom: number;
  heatDistortion: number;
  lairBrighten: number;
  completed: boolean;
}

export type WeaponShape =
  | 'wood_sword'
  | 'steel_saber'
  | 'arcane_staff'
  | 'dragon_blade'
  | 'iron_axe'
  | 'frost_hammer'
  | 'lynx_claws'
  | 'viper_dagger'
  | 'bone_spear'
  | 'royal_halberd'
  | 'ember_staff'
  | 'hunter_bow'
  | 'storm_crossbow'
  | 'wood_shield'
  | 'knight_shield';
export type HelmetShape = 'bandana' | 'knight_helm' | 'mage_hat' | 'dragon_crown';
export type ArmorShape = 'tunic' | 'mail' | 'star_robe' | 'dragon_plate';
export type CapeShape =
  | 'traveler_cloak'
  | 'knight_mantle'
  | 'starlight_cape'
  | 'dragon_cape';

export interface EquipmentVisualStyle {
  shape:
    | WeaponShape
    | HelmetShape
    | ArmorShape
    | CapeShape;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  /** Effet lumineux explicitement localisé à cette pièce uniquement (jamais global) */
  luminous?: boolean;
  glowColor?: string;
}

export interface EquipmentStatBonuses {
  atk?: number;
  mag?: number;
  def?: number;
  hp?: number;
  mp?: number;
  critChance?: number; // fraction décimale, ex: 0.03 pour +3%
}

export type WeaponAnimStyle =
  | 'wood_slash'
  | 'steel_thrust'
  | 'arcane_sweep'
  | 'dragon_cleave';

export interface WeaponCombatProfile {
  weaponId: string;
  weaponFamily: WeaponFamily;
  materialSound: MaterialSound;
  range: number;
  attackCooldown: number;
  windupSec: number;
  activeSec: number;
  arcAngleDeg: number;
  attackShape: WeaponAttackShape;
  comboSteps: number;
  comboMultipliers: readonly number[];
  critBonus: number;
  knockback: number;
  hitstopSec: number;
  staggerPower: number;
  projectileSpeed?: number;
  projectileId?: string;
  statusProc?: WeaponStatusProc;
  animStyle: WeaponAnimStyle;
  reach: number;
  reachFinisher: number;
  arcAngle: number;
  arcAngleFinisher: number;
  cooldownMult: number;
  damageMult: number;
  knockbackMult: number;
  dashMult: number;
  animDuration: number;
  swingSfx: SfxId;
  slashColor: string;
  slashAccent: string;
  sparkColor: string;
}

export interface EquipmentDefinition {
  id: string;
  name: string;
  slot: EquipSlot;
  rarity: Rarity;
  description: string;
  baseStats: EquipmentStatBonuses;
  visualStyle: EquipmentVisualStyle;
  weaponFamily?: WeaponFamily;
  materialSound?: MaterialSound;
  combatProfile?: WeaponCombatProfile;
  statusProc?: WeaponStatusProc;
  shopPrice?: number;
}

export interface MysteryChestResult {
  itemId: string;
  itemName: string;
  rarity: Rarity;
  isUpgrade: boolean;
  newLevel: number;
}

// --- Sorts ---

export type SpellGeometry =
  | 'circle_aoe'
  | 'line_pierce'
  | 'frost_nova'
  | 'self_heal'
  | 'self_shield'
  | 'mobility_dash'
  | 'target_meteor_aoe';

export interface SpellDefinition {
  id: SpellId;
  name: string;
  shortDesc: string;
  description: string;
  hotkeyLabel: string;
  geometry: SpellGeometry;
  mpCost: number;
  cooldown: number;        // secondes
  maxLevel: number;        // 5
  radius: number;          // rayon AoE ou longueur de ligne / portée de bond
  width?: number;          // largeur pour 'line_pierce' / 'mobility_dash'
  castRange?: number;      // portée de projection pour AoE ciblée
  baseMagMult: number;     // multiplicateur MAG au niveau 1
  magMultPerLevel: number; // incrément de multiplicateur par niveau au-delà du Niv. 1
  upgradeBaseCost: number; // coût upgrade = upgradeBaseCost * currentLevel
  slowFactor?: number;     // ex: 0.40 (ralentissement 40 %)
  slowDuration?: number;   // secondes
  instantHealPct?: number; // fraction de maxHp (ex: 0.25)
  regenTicks?: number;     // nombre de ticks de régénération (ex: 3)
  regenTickPct?: number;   // fraction de maxHp par tick (ex: 0.08)
  regenDuration?: number;  // durée totale de la régénération (ex: 3.0 s)
  shieldHpPct?: number;    // fraction de maxHp convertie en barrière (Égide)
  shieldDuration?: number; // durée de la barrière (secondes)
  dashIframes?: number;    // durée d'invulnérabilité pendant le bond
  color: string;
  secondaryColor: string;
}

// --- Bestiaire & Patterns d'Attaques Ennemies ---

export interface EnemyAttackPattern {
  id: string;
  name: string;
  shape: TelegraphShape;
  radius: number;           // rayon (circle/cone/ring) ou longueur (line)
  innerRadius?: number;     // pour 'ring'
  width?: number;           // pour 'line'
  arcAngle?: number;        // ouverture en radians pour 'cone'
  windupDuration: number;   // durée du télégraphe en secondes
  recoverDuration: number;  // pause post-attaque en secondes
  cooldown: number;         // recharge entre attaques en secondes
  damageMultiplier: number; // multiplicateur sur enemy.atk
  triggerRange: number;     // distance max pour déclencher l'attaque
  minRange?: number;        // distance min optionnelle
  targetAtPlayer?: boolean; // si vrai, centre le télégraphe sur la position du joueur
  multiCount?: number;      // nombre de zones simultanées (ex: 3 météores)
  multiCountPhase2?: number;// nombre de zones en phase 2 (ex: 5 météores)
  spreadRadius?: number;    // rayon de dispersion autour du joueur pour multiCount > 1
  lungeOnImpact?: boolean;  // si vrai, l'ennemi fonce vers l'avant à la résolution
  phaseMin?: 1 | 2;         // 2 si réservé à la phase 2
  color?: string;
  statusProc?: WeaponStatusProc;
  element?: TelegraphElement;
  skillBehavior?: EnemySkillBehavior;
  projectileSpeed?: number;
  projectileRadius?: number;
  projectileRange?: number;
  projectileCount?: number;
  projectileSpreadDeg?: number;
  homingTurnRate?: number;
  boomerangReturnSpeed?: number;
  hazardDurationSec?: number;
  hazardRadius?: number;
  hazardDamagePerSec?: number;
  hazardSlowFactor?: number;
  sequentialCount?: number;
  sequentialStepDelay?: number;
  sequentialStepDist?: number;
  sweepDurationSec?: number;
}

export interface EnemyDefinition {
  typeId: EnemyTypeId;
  name: string;
  level: number;
  maxHp: number;
  atk: number;
  speed: number;
  xpReward: number;
  goldReward: number;
  radius: number;
  aggroRange: number;
  leashRange: number;
  isBoss: boolean;
  isMiniBoss?: boolean;
  maxStagger?: number;
  hasPhaseTwo?: boolean;
  phaseTwoThreshold?: number;
  phaseTwoSpeedMult?: number;
  phaseTwoDialogue?: string;
  materialSound: EnemyMaterialSound;
  spriteScale: number;
  primaryColor: string;
  accentColor: string;
  patterns: EnemyAttackPattern[];
}

// --- Monde, Murs, Coffres, Pièges, Interactions & Donjons ---

export interface WallRect {
  id?: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height?: number;
}

export type ChestTier = 'wood' | 'rare' | 'epic' | 'golden';

export interface ChestLootConfig {
  gold: number;
  guaranteedItemId?: string;
  rarityWeights?: Record<Rarity, number>;
  grantsRunicKey?: boolean;
  questId?: QuestId;
}

export interface ChestDef {
  id: string;
  zoneId: ZoneId;
  x: number;
  z: number;
  tier: ChestTier;
  label: string;
  lockedUntilBossDefeated?: EnemyTypeId;
  loot: ChestLootConfig;
}

export interface ChestInstance {
  id: string;
  zoneId: ZoneId;
  x: number;
  z: number;
  tier: ChestTier;
  label: string;
  opened: boolean;
  opening?: boolean;
  openingProgress?: number;
  locked: boolean;
  lockedUntilBossDefeated?: EnemyTypeId;
  loot: ChestLootConfig;
}

export type InteractableType =
  | 'inn'
  | 'quest_board'
  | 'forge'
  | 'npc'
  | 'chest'
  | 'dungeon_entrance'
  | 'dungeon_exit'
  | 'healing_crystal'
  | 'ship_board'
  | 'ship_disembark';

export interface Interactable {
  id: string;
  type: InteractableType;
  label: string;
  x: number;
  z: number;
  radius: number;
  zoneId: ZoneId;
  targetZoneId?: ZoneId;
  targetSpawn?: Vec2;
  recommendedLevel?: number;
  requiresRunicKey?: boolean;
  npcId?: string;
  chestId?: string;
  crystalId?: string;
  destinationIslandId?: IslandId;
  disabled?: boolean;
}

export interface TrapDef {
  id: string;
  x: number;
  z: number;
  radius: number;
  interval: number;
  initialDelay: number;
  windupDuration: number;
  damage: number;
}

export interface TrapInstance extends TrapDef {
  timer: number;
}

export interface HealingCrystalDef {
  id: string;
  x: number;
  z: number;
  label: string;
}

export interface HealingCrystalInstance extends HealingCrystalDef {
  used: boolean;
}

export interface EnemySpawnDef {
  id: string;
  typeId: EnemyTypeId;
  x: number;
  z: number;
  levelOverride?: number;
}

export interface DungeonPortalDef {
  id: string;
  label: string;
  shortLabel: string;
  x: number;
  z: number;
  radius: number;
  targetZoneId: ZoneId;
  targetSpawn: Vec2;
  recommendedLevel?: number;
  requiresRunicKey?: boolean;
}

export interface DungeonRoomDef {
  id: string;
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  isBossArena?: boolean;
}

export type MusicTrackId =
  | 'menu'
  | 'overworld'
  | 'maritime'
  | 'dungeon'
  | 'combat'
  | 'boss'
  | 'boss_phase2'
  | 'victory';

export type SfxId =
  | 'sword_swing'
  | 'swing_wood'
  | 'swing_steel'
  | 'swing_staff'
  | 'swing_dragon'
  | 'sword_hit'
  | 'crit_hit'
  | 'enemy_hurt'
  | 'dodge_whoosh'
  | 'spell_fire'
  | 'spell_lightning'
  | 'spell_ice'
  | 'spell_heal'
  | 'spell_flamepurr'
  | 'spell_lightnyan'
  | 'spell_freezepaw'
  | 'spell_healing_paw'
  | 'spell_aegis_purr'
  | 'spell_pounce_dash'
  | 'spell_meteor_paw'
  | 'spell_meteor_fall'
  | 'player_hurt'
  | 'chest_creak'
  | 'chest_open'
  | 'level_up'
  | 'coin_pickup'
  | 'menu_open'
  | 'menu_close'
  | 'map_open'
  | 'npc_talk'
  | 'interact'
  | 'special_interact'
  | 'meow_ui'
  | 'boss_roar'
  | 'boss_dragon_flame'
  | 'boss_dragon_slam'
  | 'boss_rat_attack'
  | 'hero_death';

export interface DungeonDefinition {
  id: Exclude<ZoneId, 'overworld'>;
  name: string;
  subtitle: string;
  recommendedLevel: number;
  width: number;
  depth: number;
  theme: 'ghost_cave' | 'dragon_lair';
  floorColor: string;
  floorAccentColor: string;
  wallColor: string;
  ambientLightColor: number;
  ambientLightIntensity: number;
  playerSpawn: Vec2;
  exitPortal: DungeonPortalDef;
  rooms: DungeonRoomDef[];
  walls: WallRect[];
  torches: Vec2[];
  pillars: Vec2[];
  spawns: EnemySpawnDef[];
  chests: ChestDef[];
  traps: TrapDef[];
  healingCrystals: HealingCrystalDef[];
  props?: WorldProp[];
  bossTypeId: EnemyTypeId;
  bossArenaCenter: Vec2;
  musicTrack: MusicTrackId;
}

// --- Overworld Data ---

export type PropKind =
  | 'oak_tree'
  | 'twisted_tree'
  | 'snow_pine'
  | 'rock'
  | 'snow_rock'
  | 'flower_patch'
  | 'mushroom'
  | 'house_cat'
  | 'signpost'
  | 'fence'
  | 'bush'
  | 'barrel';

export type DecorMaterialKind = 'wood' | 'stone' | 'foliage' | 'crystal';

export interface WorldProp {
  id: string;
  kind: PropKind;
  x: number;
  z: number;
  scale: number;
  collidable: boolean;
  colliderRadius?: number;
}

export interface BuildingDef {
  id: string;
  kind: 'inn' | 'forge' | 'quest_board' | 'house';
  name: string;
  x: number;
  z: number;
  interactX: number;
  interactZ: number;
  colliderRadius: number;
  interactableType?: 'inn' | 'forge' | 'quest_board';
  interactLabel?: string;
}

export interface NpcDef {
  id: string;
  name: string;
  portraitId: SpeakerPortraitId;
  x: number;
  z: number;
  radius: number;
  interactLabel: string;
}

export interface EnemyCampDef {
  id: string;
  biome: BiomeId;
  centerX: number;
  centerZ: number;
  spawns: EnemySpawnDef[];
}

export interface MapLabelDef {
  text: string;
  x: number;
  z: number;
  rotation?: number;
  size?: 'large' | 'medium' | 'small';
  style?: 'land' | 'village' | 'sea';
}

export interface SafeZoneRect {
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface OverworldData {
  halfSize: number;
  playerStart: Vec2;
  villageSafeZone: SafeZoneRect;
  buildings: BuildingDef[];
  npcs: NpcDef[];
  dungeonPortals: DungeonPortalDef[];
  camps: EnemyCampDef[];
  chests: ChestDef[];
  props: WorldProp[];
  mapLabels: MapLabelDef[];
}

// --- Quêtes & Dialogues ---

export type SpeakerPortraitId =
  | 'miaou_sprit'
  | 'mayor_moustache'
  | 'kit_chat'
  | 'innkeeper'
  | 'hero'
  | 'boss_rat_king'
  | 'boss_dragon_claw';

export interface DialogueLine {
  speaker: string;
  portraitId: SpeakerPortraitId;
  text: string;
}

export type DialogueAction =
  | 'none'
  | 'complete_act1'
  | 'open_forge'
  | 'open_quest_board'
  | 'trigger_victory';

export interface DialogueState {
  active: boolean;
  lines: DialogueLine[];
  currentIndex: number;
  onCompleteAction?: DialogueAction;
}

export type QuestObjectiveType =
  | 'talk_npc'
  | 'kill_enemy'
  | 'open_chest'
  | 'defeat_boss';

export interface QuestReward {
  xp: number;
  gold: number;
  itemId?: string;
}

export interface QuestStepDef {
  id: string;
  title: string;
  description: string;
  objectiveType: QuestObjectiveType;
  targetId: string;
  requiredCount: number;
  targetZoneId: ZoneId;
  targetPos: Vec2;
  overworldPortalPos?: Vec2;
  stepReward?: QuestReward; // versé lors de la validation d'une étape intermédiaire
  onCompleteDialogue?: DialogueLine[];
}

export interface QuestDefinition {
  id: QuestId;
  title: string;
  isMain: boolean;
  recommendedLevel: number;
  summary: string;
  steps: QuestStepDef[];
  completionReward: QuestReward; // versé à la complétion finale de la quête
  acceptDialogue?: DialogueLine[];
}

export interface QuestTargetMarker {
  questId: QuestId;
  label: string;
  zoneId: ZoneId;
  x: number;
  z: number;
  isPortalRedirect: boolean;
}

// --- Entrées, Sauvegarde, Audio & Textes Flottants ---

export interface InputState {
  moveX: number;
  moveZ: number;
  attackPressed: boolean;
  attackHeld: boolean;
  dodgePressed: boolean;
  interactPressed: boolean;
  spellPressed: Record<SpellId, boolean>;
  aimWorldPos: Vec2 | null;
  usingPointerAim: boolean;
  toggleInventoryPressed: boolean;
  toggleMapPressed: boolean;
  pausePressed: boolean;
  confirmPressed: boolean;
}

export interface RunStats {
  playTimeSec: number;
  enemiesDefeated: number;
  chestsOpened: number;
}

export interface SavedPlayerData {
  level: number;
  xp: number;
  gold: number;
  hp: number;
  mp: number;
  equipped: Record<EquipSlot, string>;
  inventory: Record<string, OwnedEquipment>;
  spellLevels: Record<SpellId, number>;
  hasRunicKey: boolean;
  position?: Vec2;
}

export type WildlifeDensity = 'low' | 'normal' | 'high';

export interface GameOptions {
  wildlifeDensity: WildlifeDensity;
}

export interface SaveData {
  version: 1 | 2;
  timestamp: number;
  islandId?: IslandId;
  player: SavedPlayerData;
  ship?: SavedShipData;
  quests: Record<QuestId, QuestProgress>;
  trackedQuestId: QuestId | null;
  openedChestIds: string[];
  defeatedBossIds: EnemyTypeId[];
  runStats: RunStats;
  options?: Partial<GameOptions>;
}

export interface AudioBusVolumes {
  master: number; // 0 à 1 (synchronisé avec volume)
  music: number; // 0 à 1
  sfx: number; // 0 à 1
  ambience: number; // 0 à 1
}

export interface AudioPrefs extends AudioBusVolumes {
  muted: boolean;
  volume: number; // 0 à 1 (alias rétrocompatible de master)
}

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type FloatingTextStyle =
  | 'damage'
  | 'crit'
  | 'spell_fire'
  | 'spell_lightning'
  | 'spell_ice'
  | 'heal'
  | 'mp'
  | 'xp'
  | 'gold'
  | 'player_damage'
  | 'level_up'
  | 'info'
  | 'status_burn'
  | 'status_poison'
  | 'status_bleed'
  | 'perfect_dodge'
  | 'stagger_break'
  | 'status_purge';

export interface FloatingTextEvent {
  id: string;
  x: number;
  y: number;
  z: number;
  text: string;
  style: FloatingTextStyle;
  age: number;
  duration: number;
}

// --- Effets visuels simulés & État Global du Jeu ---

export type ScreenMode = 'title' | 'playing' | 'paused' | 'defeat' | 'victory';
export type ActiveModal = 'none' | 'inventory' | 'map' | 'quests' | 'forge' | 'pause';

export interface ActiveSpellEffect {
  id: string;
  spellId: SpellId;
  x: number;
  z: number;
  angle: number;
  radius: number;
  width?: number;
  elapsed: number;
  duration: number;
  targetX?: number;
  targetZ?: number;
  waveCount?: number;
  wavesTriggered?: number;
  waveInterval?: number;
  starSeeds?: number[];
  spellDamage?: number;
  spellCritChance?: number;
}

export interface PendingInteractionState {
  interactableId: string;
  targetX: number;
  targetZ: number;
  standX: number;
  standZ: number;
  elapsed: number;
  maxDuration: number;
}

export interface OpeningChestState {
  chestId: string;
  elapsed: number;
  duration: number;
  x: number;
  z: number;
}

export interface PortalTransitionState {
  phase: 'entering' | 'exiting';
  elapsed: number;
  duration: number;
  maxDuration?: number;
  vortexEmitted?: boolean;
  portalX: number;
  portalZ: number;
  exitTargetX: number;
  exitTargetZ: number;
  targetZoneId: ZoneId;
  targetSpawn: Vec2;
}

export interface DeathSequenceState {
  elapsed: number;
  duration: number;
  x: number;
  z: number;
  completed: boolean;
}

export interface DodgeGhost {
  x: number;
  z: number;
  facingX: number;
  age: number;
  duration: number;
}

export type CompanionMode =
  | 'follow'
  | 'guide_chest'
  | 'guide_quest'
  | 'react_crit'
  | 'react_dodge'
  | 'react_victory';

export type CompanionReactionKind = 'crit' | 'perfect_dodge' | 'boss_victory';

export interface CompanionState {
  x: number;
  z: number;
  bobPhase: number;
  /** Élévation monde Y (pont du bateau ou saut parabolique) */
  y?: number;
  /** Vrai lorsque le compagnon est embarqué sur le pont */
  onShipDeck?: boolean;
  mode?: CompanionMode;
  guideTargetX?: number;
  guideTargetZ?: number;
  guideKind?: 'chest' | 'quest' | null;
  guidePulse?: number;
  reactionKind?: CompanionReactionKind | null;
  reactionTimer?: number;
  reactionDuration?: number;
}

export interface GameState {
  screen: ScreenMode;
  activeModal: ActiveModal;
  zoneId: ZoneId;
  islandId: IslandId; // île actuellement explorée (par défaut 'felingard')
  time: number;
  hitstopTimer: number;
  screenShake: number;
  transitionTimer: number;
  transitionFade: number;
  player: PlayerState;
  companion: CompanionState;
  ship: ShipState;
  enemies: EnemyInstance[];
  telegraphs: TelegraphZone[];
  chests: ChestInstance[];
  traps: TrapInstance[];
  healingCrystals: HealingCrystalInstance[];
  activeSpellEffects: ActiveSpellEffect[];
  dodgeGhosts: DodgeGhost[];
  interactables: Interactable[];
  nearestInteractable: Interactable | null;
  quests: Record<QuestId, QuestProgress>;
  trackedQuestId: QuestId | null;
  questTarget: QuestTargetMarker | null;
  openedChestIds: string[];
  defeatedBossIds: EnemyTypeId[];
  dialogue: DialogueState;
  runStats: RunStats;
  events: GameEvent[];
  activeBossId: string | null;
  victoryShown: boolean;
  inVillage: boolean;
  pendingInteraction?: PendingInteractionState | null;
  openingChest?: OpeningChestState | null;
  portalTransition?: PortalTransitionState | null;
  deathSequence?: DeathSequenceState | null;
  inCombat?: boolean;
  combatMusicTimer?: number;
  // Phase 3 : TimeScale, Esquive Parfaite, PV Bas, Métadonnées d'attaque, Projectiles & Butin physique
  timeScale: number;
  perfectDodgeTimer: number;
  lowHpActive: boolean;
  lowHpIntensity: number;
  lastAttackMeta: AttackMetadata | null;
  playerProjectiles: PlayerProjectile[];
  lootDrops: LootDrop[];
  // Phase 4 : Projectiles ennemis, zones persistantes & cinématiques de boss
  enemyProjectiles: EnemyProjectile[];
  hazardZones: HazardZone[];
  cinematic: CinematicState | null;
  playedBossIntros: EnemyTypeId[];
  // Phase 5 : Options (densité de faune)
  options: GameOptions;
}
