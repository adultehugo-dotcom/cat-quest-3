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

export const ALL_EQUIP_SLOTS: readonly EquipSlot[] = [
  'weapon',
  'shield',
  'helmet',
  'armor',
  'boots',
  'gloves',
  'cape',
  'trinket',
];

export const OPTIONAL_EQUIP_SLOTS: readonly EquipSlot[] = [
  'shield',
  'boots',
  'gloves',
  'cape',
  'trinket',
];

export const STARTING_EQUIPMENT: Record<EquipSlot, string> = {
  weapon: 'sword_wood',
  shield: '',
  helmet: 'helm_bandana',
  armor: 'armor_tunic',
  boots: '',
  gloves: '',
  cape: '',
  trinket: '',
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
  | 'boots'
  | 'gloves'
  | 'cape'
  | 'trinket';
export type Rarity = 'common' | 'rare' | 'epic';

export type TelegraphShape = 'circle' | 'cone' | 'line' | 'ring';

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
}

export interface OwnedEquipment {
  id: string;
  level: number; // commence à 1, +1 à chaque doublon obtenu
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
  /** Élévation monde Y (pont du bateau ou saut parabolique embarquement/débarquement) */
  elevationY?: number;
  /** Vrai lorsque le personnage se tient sur le pont du voilier */
  onShipDeck?: boolean;
}

export type EnemyTypeId =
  | 'slime_yarn'
  | 'mouse_goblin'
  | 'thorn_wolf'
  | 'fishbone_skeleton'
  | 'frost_golem'
  | 'boss_rat_king'
  | 'boss_dragon_claw';

export type EnemyAIState = 'idle' | 'chase' | 'windup' | 'recover' | 'dead';

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
  | 'spell_cast'
  | 'dodge_roll'
  | 'level_up'
  | 'chest_opened'
  | 'item_upgraded'
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
  | 'ship_refused';

export interface GameEvent {
  type: GameEventType;
  x?: number;
  z?: number;
  angle?: number;
  radius?: number;
  value?: number;
  text?: string;
  isCrit?: boolean;
  spellId?: SpellId;
  zoneId?: ZoneId;
  islandId?: IslandId;
  enemyId?: string;
  enemyTypeId?: EnemyTypeId;
  itemId?: string;
  itemLevel?: number;
  questId?: QuestId;
  comboStep?: 0 | 1 | 2;
  shape?: TelegraphShape;
  color?: string;
  toastVariant?: 'info' | 'warning';
}

// --- Équipement & Styles Visuels ---

export type WeaponShape =
  | 'wood_sword'
  | 'steel_saber'
  | 'arcane_staff'
  | 'dragon_blade'
  | 'wood_shield'
  | 'knight_shield'
  | 'yarn_trinket';
export type HelmetShape = 'bandana' | 'knight_helm' | 'mage_hat' | 'dragon_crown';
export type ArmorShape = 'tunic' | 'mail' | 'star_robe' | 'dragon_plate';
export type BootsShape =
  | 'leather_boots'
  | 'iron_greaves'
  | 'arcane_slippers'
  | 'dragon_boots';
export type GlovesShape =
  | 'leather_gloves'
  | 'steel_gauntlets'
  | 'arcane_gloves'
  | 'dragon_gauntlets';
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
    | BootsShape
    | GlovesShape
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

export interface EquipmentDefinition {
  id: string;
  name: string;
  slot: EquipSlot;
  rarity: Rarity;
  description: string;
  baseStats: EquipmentStatBonuses;
  visualStyle: EquipmentVisualStyle;
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
  hasPhaseTwo?: boolean;
  phaseTwoThreshold?: number;
  phaseTwoSpeedMult?: number;
  phaseTwoDialogue?: string;
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

export type MusicTrackId = 'overworld' | 'dungeon' | 'boss';

export type SfxId =
  | 'sword_swing'
  | 'sword_hit'
  | 'crit_hit'
  | 'dodge_whoosh'
  | 'spell_fire'
  | 'spell_lightning'
  | 'spell_ice'
  | 'spell_heal'
  | 'player_hurt'
  | 'chest_open'
  | 'level_up'
  | 'coin_pickup'
  | 'meow_ui'
  | 'boss_roar';

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
  | 'fence';

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
}

export interface AudioPrefs {
  muted: boolean;
  volume: number; // 0 à 1
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
  | 'info';

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
}

export interface DodgeGhost {
  x: number;
  z: number;
  facingX: number;
  age: number;
  duration: number;
}

export interface CompanionState {
  x: number;
  z: number;
  bobPhase: number;
  /** Élévation monde Y (pont du bateau ou saut parabolique) */
  y?: number;
  /** Vrai lorsque le compagnon est embarqué sur le pont */
  onShipDeck?: boolean;
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
}
