// Generated & calibrated by scripts/fetch_studio_assets.mjs via ffprobe 8.1.2
// ZERO 'three' imports and ZERO DOM references — 100% Node/Vitest safe.
import type { MusicTrackId, SfxId } from '../game/types';

export type AudioBusId = 'master' | 'music' | 'sfx' | 'ambience';

export type AudioSfxCategory =
  | 'weapons'
  | 'impacts'
  | 'footsteps'
  | 'monsters'
  | 'ui'
  | 'status'
  | 'combat'
  | 'loot'
  | 'ambient';

export const AUDIO_SFX_CATEGORIES: readonly AudioSfxCategory[] = [
  'weapons',
  'impacts',
  'footsteps',
  'monsters',
  'ui',
  'status',
  'combat',
  'loot',
  'ambient',
] as const;

export type AudioSfxGroupId =
  | 'weapon_swing_wood'
  | 'weapon_swing_steel'
  | 'weapon_swing_iron_heavy'
  | 'weapon_swing_bone'
  | 'weapon_swing_arcane'
  | 'weapon_swing_draconic'
  | 'weapon_swing_flame'
  | 'weapon_swing_frost'
  | 'weapon_swing_dagger'
  | 'weapon_swing_spear'
  | 'weapon_bow_release'
  | 'weapon_staff_cast'
  | 'impact_generic'
  | 'impact_gelatinous'
  | 'impact_flesh_fur'
  | 'impact_bone'
  | 'impact_stone_ice'
  | 'impact_spectral'
  | 'impact_dragon_scales'
  | 'impact_crit'
  | 'impact_blocked'
  | 'impact_prop_wood'
  | 'impact_prop_stone'
  | 'footstep_grass'
  | 'footstep_sand'
  | 'footstep_rock'
  | 'footstep_snow_ice'
  | 'footstep_ship_wood'
  | 'footstep_dungeon_stone'
  | 'footstep_water_shore'
  | 'monster_hurt'
  | 'monster_death'
  | 'monster_slime_telegraph'
  | 'monster_slime_attack'
  | 'monster_goblin_telegraph'
  | 'monster_goblin_attack'
  | 'monster_wolf_telegraph'
  | 'monster_wolf_attack'
  | 'monster_skeleton_telegraph'
  | 'monster_skeleton_attack'
  | 'monster_golem_telegraph'
  | 'monster_golem_attack'
  | 'boss_rat_telegraph'
  | 'boss_rat_attack'
  | 'boss_rat_death'
  | 'boss_dragon_roar'
  | 'boss_dragon_telegraph'
  | 'boss_dragon_flame'
  | 'boss_dragon_slam'
  | 'boss_dragon_death'
  | 'boss_stagger_break'
  | 'ui_menu_open'
  | 'ui_menu_close'
  | 'ui_map_open'
  | 'ui_map_close'
  | 'ui_inventory_open'
  | 'ui_inventory_close'
  | 'ui_forge_open'
  | 'ui_forge_close'
  | 'ui_forge_upgrade'
  | 'ui_inn_open'
  | 'ui_inn_close'
  | 'ui_quests_open'
  | 'ui_quests_close'
  | 'ui_bestiary_open'
  | 'ui_bestiary_close'
  | 'ui_npc_talk'
  | 'ui_interact'
  | 'ui_special_interact'
  | 'ui_meow'
  | 'ui_portal_vortex'
  | 'status_burn_apply'
  | 'status_burn_tick'
  | 'status_chill_apply'
  | 'status_poison_apply'
  | 'status_poison_tick'
  | 'status_bleed_apply'
  | 'status_bleed_tick'
  | 'status_stun_apply'
  | 'status_shock_apply'
  | 'status_curse_apply'
  | 'status_purge'
  | 'combat_dodge_whoosh'
  | 'combat_perfect_dodge'
  | 'combat_player_hurt'
  | 'combat_hero_death'
  | 'combat_low_hp_alert'
  | 'combat_spell_flamepurr'
  | 'combat_spell_lightnyan'
  | 'combat_spell_freezepaw'
  | 'combat_spell_healing_paw'
  | 'combat_spell_aegis_purr'
  | 'combat_spell_pounce_dash'
  | 'combat_spell_meteor_paw'
  | 'combat_spell_meteor_fall'
  | 'loot_chest_creak'
  | 'loot_chest_open'
  | 'loot_coin_pickup'
  | 'loot_xp_pickup'
  | 'loot_item_drop'
  | 'loot_level_up'
  | 'loot_victory_fanfare'
  | 'ambient_torch_fire'
  | 'ambient_forge_hearth'
  | 'ambient_shore_surf'
  | 'ambient_seagulls'
  | 'ambient_crystal_hum';

export type AudioMusicCategoryId = MusicTrackId | 'boss_phase2' | 'victory';

export type AudioWeatherCategoryId =
  | 'ocean_waves'
  | 'wind_gale'
  | 'rain_storm'
  | 'thunder_clap'
  | 'birds_day';

export interface AudioVariantEntry {
  readonly path: string;
  readonly durationSec: number;
}

export interface AudioSfxGroupEntry {
  readonly id: AudioSfxGroupId;
  readonly category: AudioSfxCategory;
  readonly bus: 'sfx' | 'ambience';
  readonly loop: boolean;
  readonly defaultGain: number;
  readonly minIntervalMs: number;
  readonly pitchJitter: number;
  readonly gainJitter: number;
  readonly variants: readonly AudioVariantEntry[];
}

export interface AudioMusicTrackEntry {
  readonly id: AudioMusicCategoryId;
  readonly path: string;
  readonly durationSec: number;
  readonly loop: boolean;
  readonly defaultGain: number;
}

export interface AudioWeatherTrackEntry {
  readonly id: AudioWeatherCategoryId;
  readonly path: string;
  readonly durationSec: number;
  readonly loop: boolean;
}

export const AUDIO_DURATION_BOUNDS: Readonly<
  Record<AudioSfxCategory | 'music' | 'weather', { readonly minSec: number; readonly maxSec: number }>
> = {
  weapons: { minSec: 0.05, maxSec: 0.90 },
  impacts: { minSec: 0.05, maxSec: 0.85 },
  footsteps: { minSec: 0.05, maxSec: 0.45 },
  monsters: { minSec: 0.06, maxSec: 3.20 },
  ui: { minSec: 0.05, maxSec: 1.80 },
  status: { minSec: 0.06, maxSec: 1.20 },
  combat: { minSec: 0.06, maxSec: 2.50 },
  loot: { minSec: 0.06, maxSec: 3.80 },
  ambient: { minSec: 2.00, maxSec: 35.00 },
  music: { minSec: 5.00, maxSec: 240.00 },
  weather: { minSec: 1.50, maxSec: 60.00 },
} as const;

export const AUDIO_SFX_GROUPS: Readonly<Record<AudioSfxGroupId, AudioSfxGroupEntry>> = {
  "weapon_swing_wood": {
    "id": "weapon_swing_wood",
    "category": "weapons",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.72,
    "minIntervalMs": 0,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_wood_v1.ogg",
        "durationSec": 0.095
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_wood_v2.ogg",
        "durationSec": 0.072
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_wood_v3.ogg",
        "durationSec": 0.09
      }
    ]
  },
  "weapon_swing_steel": {
    "id": "weapon_swing_steel",
    "category": "weapons",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.78,
    "minIntervalMs": 0,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_steel_v1.ogg",
        "durationSec": 0.48
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_steel_v2.ogg",
        "durationSec": 0.48
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_steel_v3.ogg",
        "durationSec": 0.48
      }
    ]
  },
  "weapon_swing_iron_heavy": {
    "id": "weapon_swing_iron_heavy",
    "category": "weapons",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.84,
    "minIntervalMs": 0,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_iron_heavy_v1.ogg",
        "durationSec": 0.109
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_iron_heavy_v2.ogg",
        "durationSec": 0.115
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_iron_heavy_v3.ogg",
        "durationSec": 0.068
      }
    ]
  },
  "weapon_swing_bone": {
    "id": "weapon_swing_bone",
    "category": "weapons",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.76,
    "minIntervalMs": 0,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_bone_v1.ogg",
        "durationSec": 0.09
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_bone_v2.ogg",
        "durationSec": 0.08
      }
    ]
  },
  "weapon_swing_arcane": {
    "id": "weapon_swing_arcane",
    "category": "weapons",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.74,
    "minIntervalMs": 0,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_arcane_v1.ogg",
        "durationSec": 0.075
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_arcane_v2.ogg",
        "durationSec": 0.52
      }
    ]
  },
  "weapon_swing_draconic": {
    "id": "weapon_swing_draconic",
    "category": "weapons",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.88,
    "minIntervalMs": 0,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_draconic_v1.ogg",
        "durationSec": 0.066
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_draconic_v2.ogg",
        "durationSec": 0.551
      }
    ]
  },
  "weapon_swing_flame": {
    "id": "weapon_swing_flame",
    "category": "weapons",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.8,
    "minIntervalMs": 0,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_flame_v1.ogg",
        "durationSec": 0.55
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_flame_v2.ogg",
        "durationSec": 0.111
      }
    ]
  },
  "weapon_swing_frost": {
    "id": "weapon_swing_frost",
    "category": "weapons",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.76,
    "minIntervalMs": 0,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_frost_v1.ogg",
        "durationSec": 0.5
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_frost_v2.ogg",
        "durationSec": 0.084
      }
    ]
  },
  "weapon_swing_dagger": {
    "id": "weapon_swing_dagger",
    "category": "weapons",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.7,
    "minIntervalMs": 0,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_dagger_v1.ogg",
        "durationSec": 0.16
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_dagger_v2.ogg",
        "durationSec": 0.251
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_dagger_v3.ogg",
        "durationSec": 0.325
      }
    ]
  },
  "weapon_swing_spear": {
    "id": "weapon_swing_spear",
    "category": "weapons",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.76,
    "minIntervalMs": 0,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_spear_v1.ogg",
        "durationSec": 0.099
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_swing_spear_v2.ogg",
        "durationSec": 0.089
      }
    ]
  },
  "weapon_bow_release": {
    "id": "weapon_bow_release",
    "category": "weapons",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.76,
    "minIntervalMs": 0,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/weapons/weapon_bow_release_v1.ogg",
        "durationSec": 0.06
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_bow_release_v2.ogg",
        "durationSec": 0.4
      }
    ]
  },
  "weapon_staff_cast": {
    "id": "weapon_staff_cast",
    "category": "weapons",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.76,
    "minIntervalMs": 0,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/weapons/weapon_staff_cast_v1.ogg",
        "durationSec": 0.589
      },
      {
        "path": "assets/audio/sfx/weapons/weapon_staff_cast_v2.ogg",
        "durationSec": 0.65
      }
    ]
  },
  "impact_generic": {
    "id": "impact_generic",
    "category": "impacts",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.82,
    "minIntervalMs": 35,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/impacts/impact_generic_v1.ogg",
        "durationSec": 0.135
      },
      {
        "path": "assets/audio/sfx/impacts/impact_generic_v2.ogg",
        "durationSec": 0.115
      },
      {
        "path": "assets/audio/sfx/impacts/impact_generic_v3.ogg",
        "durationSec": 0.245
      }
    ]
  },
  "impact_gelatinous": {
    "id": "impact_gelatinous",
    "category": "impacts",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.78,
    "minIntervalMs": 35,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/impacts/impact_gelatinous_v1.ogg",
        "durationSec": 0.266
      },
      {
        "path": "assets/audio/sfx/impacts/impact_gelatinous_v2.ogg",
        "durationSec": 0.243
      },
      {
        "path": "assets/audio/sfx/impacts/impact_gelatinous_v3.ogg",
        "durationSec": 0.45
      }
    ]
  },
  "impact_flesh_fur": {
    "id": "impact_flesh_fur",
    "category": "impacts",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.82,
    "minIntervalMs": 35,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/impacts/impact_flesh_fur_v1.ogg",
        "durationSec": 0.226
      },
      {
        "path": "assets/audio/sfx/impacts/impact_flesh_fur_v2.ogg",
        "durationSec": 0.213
      },
      {
        "path": "assets/audio/sfx/impacts/impact_flesh_fur_v3.ogg",
        "durationSec": 0.42
      }
    ]
  },
  "impact_bone": {
    "id": "impact_bone",
    "category": "impacts",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.8,
    "minIntervalMs": 35,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/impacts/impact_bone_v1.ogg",
        "durationSec": 0.45
      },
      {
        "path": "assets/audio/sfx/impacts/impact_bone_v2.ogg",
        "durationSec": 0.45
      },
      {
        "path": "assets/audio/sfx/impacts/impact_bone_v3.ogg",
        "durationSec": 0.216
      }
    ]
  },
  "impact_stone_ice": {
    "id": "impact_stone_ice",
    "category": "impacts",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.84,
    "minIntervalMs": 35,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/impacts/impact_stone_ice_v1.ogg",
        "durationSec": 0.5
      },
      {
        "path": "assets/audio/sfx/impacts/impact_stone_ice_v2.ogg",
        "durationSec": 0.5
      },
      {
        "path": "assets/audio/sfx/impacts/impact_stone_ice_v3.ogg",
        "durationSec": 0.148
      }
    ]
  },
  "impact_spectral": {
    "id": "impact_spectral",
    "category": "impacts",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.78,
    "minIntervalMs": 35,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/impacts/impact_spectral_v1.ogg",
        "durationSec": 0.236
      },
      {
        "path": "assets/audio/sfx/impacts/impact_spectral_v2.ogg",
        "durationSec": 0.216
      }
    ]
  },
  "impact_dragon_scales": {
    "id": "impact_dragon_scales",
    "category": "impacts",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.88,
    "minIntervalMs": 35,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/impacts/impact_dragon_scales_v1.ogg",
        "durationSec": 0.165
      },
      {
        "path": "assets/audio/sfx/impacts/impact_dragon_scales_v2.ogg",
        "durationSec": 0.398
      }
    ]
  },
  "impact_crit": {
    "id": "impact_crit",
    "category": "impacts",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.88,
    "minIntervalMs": 40,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/impacts/impact_crit_v1.ogg",
        "durationSec": 0.65
      },
      {
        "path": "assets/audio/sfx/impacts/impact_crit_v2.ogg",
        "durationSec": 0.384
      }
    ]
  },
  "impact_blocked": {
    "id": "impact_blocked",
    "category": "impacts",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.78,
    "minIntervalMs": 40,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/impacts/impact_blocked_v1.ogg",
        "durationSec": 0.185
      },
      {
        "path": "assets/audio/sfx/impacts/impact_blocked_v2.ogg",
        "durationSec": 0.408
      }
    ]
  },
  "impact_prop_wood": {
    "id": "impact_prop_wood",
    "category": "impacts",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.74,
    "minIntervalMs": 45,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/impacts/impact_prop_wood_v1.ogg",
        "durationSec": 0.171
      },
      {
        "path": "assets/audio/sfx/impacts/impact_prop_wood_v2.ogg",
        "durationSec": 0.381
      },
      {
        "path": "assets/audio/sfx/impacts/impact_prop_wood_v3.ogg",
        "durationSec": 0.212
      }
    ]
  },
  "impact_prop_stone": {
    "id": "impact_prop_stone",
    "category": "impacts",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.76,
    "minIntervalMs": 45,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/impacts/impact_prop_stone_v1.ogg",
        "durationSec": 0.266
      },
      {
        "path": "assets/audio/sfx/impacts/impact_prop_stone_v2.ogg",
        "durationSec": 0.329
      },
      {
        "path": "assets/audio/sfx/impacts/impact_prop_stone_v3.ogg",
        "durationSec": 0.45
      }
    ]
  },
  "footstep_grass": {
    "id": "footstep_grass",
    "category": "footsteps",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.42,
    "minIntervalMs": 140,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/footsteps/footstep_grass_v1.ogg",
        "durationSec": 0.109
      },
      {
        "path": "assets/audio/sfx/footsteps/footstep_grass_v2.ogg",
        "durationSec": 0.132
      },
      {
        "path": "assets/audio/sfx/footsteps/footstep_grass_v3.ogg",
        "durationSec": 0.134
      }
    ]
  },
  "footstep_sand": {
    "id": "footstep_sand",
    "category": "footsteps",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.42,
    "minIntervalMs": 140,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/footsteps/footstep_sand_v1.ogg",
        "durationSec": 0.128
      },
      {
        "path": "assets/audio/sfx/footsteps/footstep_sand_v2.ogg",
        "durationSec": 0.142
      },
      {
        "path": "assets/audio/sfx/footsteps/footstep_sand_v3.ogg",
        "durationSec": 0.063
      }
    ]
  },
  "footstep_rock": {
    "id": "footstep_rock",
    "category": "footsteps",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.45,
    "minIntervalMs": 140,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/footsteps/footstep_rock_v1.ogg",
        "durationSec": 0.194
      },
      {
        "path": "assets/audio/sfx/footsteps/footstep_rock_v2.ogg",
        "durationSec": 0.211
      },
      {
        "path": "assets/audio/sfx/footsteps/footstep_rock_v3.ogg",
        "durationSec": 0.207
      }
    ]
  },
  "footstep_snow_ice": {
    "id": "footstep_snow_ice",
    "category": "footsteps",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.44,
    "minIntervalMs": 140,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/footsteps/footstep_snow_ice_v1.ogg",
        "durationSec": 0.161
      },
      {
        "path": "assets/audio/sfx/footsteps/footstep_snow_ice_v2.ogg",
        "durationSec": 0.17
      },
      {
        "path": "assets/audio/sfx/footsteps/footstep_snow_ice_v3.ogg",
        "durationSec": 0.172
      }
    ]
  },
  "footstep_ship_wood": {
    "id": "footstep_ship_wood",
    "category": "footsteps",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.48,
    "minIntervalMs": 140,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/footsteps/footstep_ship_wood_v1.ogg",
        "durationSec": 0.247
      },
      {
        "path": "assets/audio/sfx/footsteps/footstep_ship_wood_v2.ogg",
        "durationSec": 0.249
      },
      {
        "path": "assets/audio/sfx/footsteps/footstep_ship_wood_v3.ogg",
        "durationSec": 0.248
      }
    ]
  },
  "footstep_dungeon_stone": {
    "id": "footstep_dungeon_stone",
    "category": "footsteps",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.46,
    "minIntervalMs": 140,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/footsteps/footstep_dungeon_stone_v1.ogg",
        "durationSec": 0.103
      },
      {
        "path": "assets/audio/sfx/footsteps/footstep_dungeon_stone_v2.ogg",
        "durationSec": 0.105
      },
      {
        "path": "assets/audio/sfx/footsteps/footstep_dungeon_stone_v3.ogg",
        "durationSec": 0.11
      }
    ]
  },
  "footstep_water_shore": {
    "id": "footstep_water_shore",
    "category": "footsteps",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.45,
    "minIntervalMs": 140,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/footsteps/footstep_water_shore_v1.ogg",
        "durationSec": 0.21
      },
      {
        "path": "assets/audio/sfx/footsteps/footstep_water_shore_v2.ogg",
        "durationSec": 0.252
      },
      {
        "path": "assets/audio/sfx/footsteps/footstep_water_shore_v3.ogg",
        "durationSec": 0.274
      }
    ]
  },
  "monster_hurt": {
    "id": "monster_hurt",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.45,
    "minIntervalMs": 75,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/monster_hurt_v1.ogg",
        "durationSec": 0.331
      },
      {
        "path": "assets/audio/sfx/monsters/monster_hurt_v2.ogg",
        "durationSec": 0.333
      },
      {
        "path": "assets/audio/sfx/monsters/monster_hurt_v3.ogg",
        "durationSec": 0.344
      }
    ]
  },
  "monster_death": {
    "id": "monster_death",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.68,
    "minIntervalMs": 60,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/monster_death_v1.ogg",
        "durationSec": 0.696
      },
      {
        "path": "assets/audio/sfx/monsters/monster_death_v2.ogg",
        "durationSec": 0.099
      }
    ]
  },
  "monster_slime_telegraph": {
    "id": "monster_slime_telegraph",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.62,
    "minIntervalMs": 120,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/monster_slime_telegraph_v1.ogg",
        "durationSec": 0.484
      },
      {
        "path": "assets/audio/sfx/monsters/monster_slime_telegraph_v2.ogg",
        "durationSec": 0.405
      }
    ]
  },
  "monster_slime_attack": {
    "id": "monster_slime_attack",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.7,
    "minIntervalMs": 120,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/monster_slime_attack_v1.ogg",
        "durationSec": 0.26
      },
      {
        "path": "assets/audio/sfx/monsters/monster_slime_attack_v2.ogg",
        "durationSec": 0.333
      }
    ]
  },
  "monster_goblin_telegraph": {
    "id": "monster_goblin_telegraph",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.64,
    "minIntervalMs": 120,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/monster_goblin_telegraph_v1.ogg",
        "durationSec": 0.316
      },
      {
        "path": "assets/audio/sfx/monsters/monster_goblin_telegraph_v2.ogg",
        "durationSec": 0.438
      }
    ]
  },
  "monster_goblin_attack": {
    "id": "monster_goblin_attack",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.72,
    "minIntervalMs": 120,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/monster_goblin_attack_v1.ogg",
        "durationSec": 0.311
      },
      {
        "path": "assets/audio/sfx/monsters/monster_goblin_attack_v2.ogg",
        "durationSec": 0.258
      }
    ]
  },
  "monster_wolf_telegraph": {
    "id": "monster_wolf_telegraph",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.68,
    "minIntervalMs": 140,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/monster_wolf_telegraph_v1.ogg",
        "durationSec": 0.5
      },
      {
        "path": "assets/audio/sfx/monsters/monster_wolf_telegraph_v2.ogg",
        "durationSec": 0.253
      }
    ]
  },
  "monster_wolf_attack": {
    "id": "monster_wolf_attack",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.74,
    "minIntervalMs": 120,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/monster_wolf_attack_v1.ogg",
        "durationSec": 0.625
      },
      {
        "path": "assets/audio/sfx/monsters/monster_wolf_attack_v2.ogg",
        "durationSec": 0.505
      }
    ]
  },
  "monster_skeleton_telegraph": {
    "id": "monster_skeleton_telegraph",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.66,
    "minIntervalMs": 120,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/monster_skeleton_telegraph_v1.ogg",
        "durationSec": 0.371
      },
      {
        "path": "assets/audio/sfx/monsters/monster_skeleton_telegraph_v2.ogg",
        "durationSec": 0.331
      }
    ]
  },
  "monster_skeleton_attack": {
    "id": "monster_skeleton_attack",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.74,
    "minIntervalMs": 120,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/monster_skeleton_attack_v1.ogg",
        "durationSec": 0.531
      },
      {
        "path": "assets/audio/sfx/monsters/monster_skeleton_attack_v2.ogg",
        "durationSec": 0.6
      }
    ]
  },
  "monster_golem_telegraph": {
    "id": "monster_golem_telegraph",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.78,
    "minIntervalMs": 160,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/monster_golem_telegraph_v1.ogg",
        "durationSec": 0.457
      },
      {
        "path": "assets/audio/sfx/monsters/monster_golem_telegraph_v2.ogg",
        "durationSec": 0.574
      }
    ]
  },
  "monster_golem_attack": {
    "id": "monster_golem_attack",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.84,
    "minIntervalMs": 150,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/monster_golem_attack_v1.ogg",
        "durationSec": 0.9
      },
      {
        "path": "assets/audio/sfx/monsters/monster_golem_attack_v2.ogg",
        "durationSec": 0.9
      }
    ]
  },
  "boss_rat_telegraph": {
    "id": "boss_rat_telegraph",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.8,
    "minIntervalMs": 180,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/boss_rat_telegraph_v1.ogg",
        "durationSec": 0.364
      },
      {
        "path": "assets/audio/sfx/monsters/boss_rat_telegraph_v2.ogg",
        "durationSec": 0.385
      }
    ]
  },
  "boss_rat_attack": {
    "id": "boss_rat_attack",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.82,
    "minIntervalMs": 160,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/boss_rat_attack_v1.ogg",
        "durationSec": 0.573
      },
      {
        "path": "assets/audio/sfx/monsters/boss_rat_attack_v2.ogg",
        "durationSec": 0.809
      }
    ]
  },
  "boss_rat_death": {
    "id": "boss_rat_death",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.9,
    "minIntervalMs": 250,
    "pitchJitter": 0.02,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/boss_rat_death_v1.ogg",
        "durationSec": 2.6
      }
    ]
  },
  "boss_dragon_roar": {
    "id": "boss_dragon_roar",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.92,
    "minIntervalMs": 200,
    "pitchJitter": 0.03,
    "gainJitter": 0.05,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/boss_dragon_roar_v1.ogg",
        "durationSec": 0.259
      },
      {
        "path": "assets/audio/sfx/monsters/boss_dragon_roar_v2.ogg",
        "durationSec": 0.688
      }
    ]
  },
  "boss_dragon_telegraph": {
    "id": "boss_dragon_telegraph",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.84,
    "minIntervalMs": 180,
    "pitchJitter": 0.03,
    "gainJitter": 0.05,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/boss_dragon_telegraph_v1.ogg",
        "durationSec": 0.518
      },
      {
        "path": "assets/audio/sfx/monsters/boss_dragon_telegraph_v2.ogg",
        "durationSec": 0.836
      }
    ]
  },
  "boss_dragon_flame": {
    "id": "boss_dragon_flame",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.84,
    "minIntervalMs": 160,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/boss_dragon_flame_v1.ogg",
        "durationSec": 0.476
      },
      {
        "path": "assets/audio/sfx/monsters/boss_dragon_flame_v2.ogg",
        "durationSec": 1.306
      }
    ]
  },
  "boss_dragon_slam": {
    "id": "boss_dragon_slam",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.9,
    "minIntervalMs": 160,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/boss_dragon_slam_v1.ogg",
        "durationSec": 1.4
      },
      {
        "path": "assets/audio/sfx/monsters/boss_dragon_slam_v2.ogg",
        "durationSec": 0.748
      }
    ]
  },
  "boss_dragon_death": {
    "id": "boss_dragon_death",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.94,
    "minIntervalMs": 300,
    "pitchJitter": 0.02,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/boss_dragon_death_v1.ogg",
        "durationSec": 0.36
      }
    ]
  },
  "boss_stagger_break": {
    "id": "boss_stagger_break",
    "category": "monsters",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.88,
    "minIntervalMs": 150,
    "pitchJitter": 0.03,
    "gainJitter": 0.05,
    "variants": [
      {
        "path": "assets/audio/sfx/monsters/boss_stagger_break_v1.ogg",
        "durationSec": 1.1
      },
      {
        "path": "assets/audio/sfx/monsters/boss_stagger_break_v2.ogg",
        "durationSec": 0.334
      }
    ]
  },
  "ui_menu_open": {
    "id": "ui_menu_open",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.65,
    "minIntervalMs": 50,
    "pitchJitter": 0.02,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_menu_open_v1.ogg",
        "durationSec": 0.142
      },
      {
        "path": "assets/audio/sfx/ui/ui_menu_open_v2.ogg",
        "durationSec": 0.301
      }
    ]
  },
  "ui_menu_close": {
    "id": "ui_menu_close",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.58,
    "minIntervalMs": 50,
    "pitchJitter": 0.02,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_menu_close_v1.ogg",
        "durationSec": 0.144
      },
      {
        "path": "assets/audio/sfx/ui/ui_menu_close_v2.ogg",
        "durationSec": 0.305
      }
    ]
  },
  "ui_map_open": {
    "id": "ui_map_open",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.78,
    "minIntervalMs": 50,
    "pitchJitter": 0.02,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_map_open_v1.ogg",
        "durationSec": 0.07
      },
      {
        "path": "assets/audio/sfx/ui/ui_map_open_v2.ogg",
        "durationSec": 0.55
      }
    ]
  },
  "ui_map_close": {
    "id": "ui_map_close",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.66,
    "minIntervalMs": 50,
    "pitchJitter": 0.02,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_map_close_v1.ogg",
        "durationSec": 0.182
      },
      {
        "path": "assets/audio/sfx/ui/ui_map_close_v2.ogg",
        "durationSec": 0.357
      }
    ]
  },
  "ui_inventory_open": {
    "id": "ui_inventory_open",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.7,
    "minIntervalMs": 50,
    "pitchJitter": 0.03,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_inventory_open_v1.ogg",
        "durationSec": 0.45
      },
      {
        "path": "assets/audio/sfx/ui/ui_inventory_open_v2.ogg",
        "durationSec": 0.292
      }
    ]
  },
  "ui_inventory_close": {
    "id": "ui_inventory_close",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.6,
    "minIntervalMs": 50,
    "pitchJitter": 0.03,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_inventory_close_v1.ogg",
        "durationSec": 0.4
      },
      {
        "path": "assets/audio/sfx/ui/ui_inventory_close_v2.ogg",
        "durationSec": 0.307
      }
    ]
  },
  "ui_forge_open": {
    "id": "ui_forge_open",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.72,
    "minIntervalMs": 50,
    "pitchJitter": 0.03,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_forge_open_v1.ogg",
        "durationSec": 0.159
      },
      {
        "path": "assets/audio/sfx/ui/ui_forge_open_v2.ogg",
        "durationSec": 0.333
      }
    ]
  },
  "ui_forge_close": {
    "id": "ui_forge_close",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.62,
    "minIntervalMs": 50,
    "pitchJitter": 0.02,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_forge_close_v1.ogg",
        "durationSec": 0.056
      },
      {
        "path": "assets/audio/sfx/ui/ui_forge_close_v2.ogg",
        "durationSec": 0.062
      }
    ]
  },
  "ui_forge_upgrade": {
    "id": "ui_forge_upgrade",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.85,
    "minIntervalMs": 80,
    "pitchJitter": 0.03,
    "gainJitter": 0.05,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_forge_upgrade_v1.ogg",
        "durationSec": 1.2
      },
      {
        "path": "assets/audio/sfx/ui/ui_forge_upgrade_v2.ogg",
        "durationSec": 0.451
      }
    ]
  },
  "ui_inn_open": {
    "id": "ui_inn_open",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.72,
    "minIntervalMs": 50,
    "pitchJitter": 0.03,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_inn_open_v1.ogg",
        "durationSec": 0.6
      },
      {
        "path": "assets/audio/sfx/ui/ui_inn_open_v2.ogg",
        "durationSec": 0.6
      }
    ]
  },
  "ui_inn_close": {
    "id": "ui_inn_close",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.62,
    "minIntervalMs": 50,
    "pitchJitter": 0.03,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_inn_close_v1.ogg",
        "durationSec": 0.55
      },
      {
        "path": "assets/audio/sfx/ui/ui_inn_close_v2.ogg",
        "durationSec": 0.489
      }
    ]
  },
  "ui_quests_open": {
    "id": "ui_quests_open",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.72,
    "minIntervalMs": 50,
    "pitchJitter": 0.03,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_quests_open_v1.ogg",
        "durationSec": 0.5
      },
      {
        "path": "assets/audio/sfx/ui/ui_quests_open_v2.ogg",
        "durationSec": 0.481
      }
    ]
  },
  "ui_quests_close": {
    "id": "ui_quests_close",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.62,
    "minIntervalMs": 50,
    "pitchJitter": 0.03,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_quests_close_v1.ogg",
        "durationSec": 0.45
      },
      {
        "path": "assets/audio/sfx/ui/ui_quests_close_v2.ogg",
        "durationSec": 0.45
      }
    ]
  },
  "ui_bestiary_open": {
    "id": "ui_bestiary_open",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.72,
    "minIntervalMs": 50,
    "pitchJitter": 0.03,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_bestiary_open_v1.ogg",
        "durationSec": 0.5
      },
      {
        "path": "assets/audio/sfx/ui/ui_bestiary_open_v2.ogg",
        "durationSec": 0.5
      }
    ]
  },
  "ui_bestiary_close": {
    "id": "ui_bestiary_close",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.62,
    "minIntervalMs": 50,
    "pitchJitter": 0.03,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_bestiary_close_v1.ogg",
        "durationSec": 0.45
      },
      {
        "path": "assets/audio/sfx/ui/ui_bestiary_close_v2.ogg",
        "durationSec": 0.45
      }
    ]
  },
  "ui_npc_talk": {
    "id": "ui_npc_talk",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.72,
    "minIntervalMs": 80,
    "pitchJitter": 0.04,
    "gainJitter": 0.05,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_npc_talk_v1.ogg",
        "durationSec": 0.75
      },
      {
        "path": "assets/audio/sfx/ui/ui_npc_talk_v2.ogg",
        "durationSec": 0.75
      }
    ]
  },
  "ui_interact": {
    "id": "ui_interact",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.58,
    "minIntervalMs": 40,
    "pitchJitter": 0.02,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_interact_v1.ogg",
        "durationSec": 0.097
      },
      {
        "path": "assets/audio/sfx/ui/ui_interact_v2.ogg",
        "durationSec": 0.086
      }
    ]
  },
  "ui_special_interact": {
    "id": "ui_special_interact",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.76,
    "minIntervalMs": 60,
    "pitchJitter": 0.02,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_special_interact_v1.ogg",
        "durationSec": 0.284
      },
      {
        "path": "assets/audio/sfx/ui/ui_special_interact_v2.ogg",
        "durationSec": 0.512
      }
    ]
  },
  "ui_meow": {
    "id": "ui_meow",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.55,
    "minIntervalMs": 80,
    "pitchJitter": 0.04,
    "gainJitter": 0.05,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_meow_v1.ogg",
        "durationSec": 0.65
      },
      {
        "path": "assets/audio/sfx/ui/ui_meow_v2.ogg",
        "durationSec": 0.65
      }
    ]
  },
  "ui_portal_vortex": {
    "id": "ui_portal_vortex",
    "category": "ui",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.8,
    "minIntervalMs": 300,
    "pitchJitter": 0.02,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ui/ui_portal_vortex_v1.ogg",
        "durationSec": 1.375
      }
    ]
  },
  "status_burn_apply": {
    "id": "status_burn_apply",
    "category": "status",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.72,
    "minIntervalMs": 80,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/status/status_burn_apply_v1.ogg",
        "durationSec": 0.75
      },
      {
        "path": "assets/audio/sfx/status/status_burn_apply_v2.ogg",
        "durationSec": 0.75
      }
    ]
  },
  "status_burn_tick": {
    "id": "status_burn_tick",
    "category": "status",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.5,
    "minIntervalMs": 180,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/status/status_burn_tick_v1.ogg",
        "durationSec": 0.45
      },
      {
        "path": "assets/audio/sfx/status/status_burn_tick_v2.ogg",
        "durationSec": 0.372
      }
    ]
  },
  "status_chill_apply": {
    "id": "status_chill_apply",
    "category": "status",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.72,
    "minIntervalMs": 80,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/status/status_chill_apply_v1.ogg",
        "durationSec": 0.75
      },
      {
        "path": "assets/audio/sfx/status/status_chill_apply_v2.ogg",
        "durationSec": 0.338
      }
    ]
  },
  "status_poison_apply": {
    "id": "status_poison_apply",
    "category": "status",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.68,
    "minIntervalMs": 80,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/status/status_poison_apply_v1.ogg",
        "durationSec": 0.507
      },
      {
        "path": "assets/audio/sfx/status/status_poison_apply_v2.ogg",
        "durationSec": 0.204
      }
    ]
  },
  "status_poison_tick": {
    "id": "status_poison_tick",
    "category": "status",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.48,
    "minIntervalMs": 180,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/status/status_poison_tick_v1.ogg",
        "durationSec": 0.42
      },
      {
        "path": "assets/audio/sfx/status/status_poison_tick_v2.ogg",
        "durationSec": 0.328
      }
    ]
  },
  "status_bleed_apply": {
    "id": "status_bleed_apply",
    "category": "status",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.7,
    "minIntervalMs": 80,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/status/status_bleed_apply_v1.ogg",
        "durationSec": 0.415
      },
      {
        "path": "assets/audio/sfx/status/status_bleed_apply_v2.ogg",
        "durationSec": 0.193
      }
    ]
  },
  "status_bleed_tick": {
    "id": "status_bleed_tick",
    "category": "status",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.48,
    "minIntervalMs": 180,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/status/status_bleed_tick_v1.ogg",
        "durationSec": 0.101
      },
      {
        "path": "assets/audio/sfx/status/status_bleed_tick_v2.ogg",
        "durationSec": 0.188
      }
    ]
  },
  "status_stun_apply": {
    "id": "status_stun_apply",
    "category": "status",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.74,
    "minIntervalMs": 100,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/status/status_stun_apply_v1.ogg",
        "durationSec": 0.12
      },
      {
        "path": "assets/audio/sfx/status/status_stun_apply_v2.ogg",
        "durationSec": 0.482
      }
    ]
  },
  "status_shock_apply": {
    "id": "status_shock_apply",
    "category": "status",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.72,
    "minIntervalMs": 80,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/status/status_shock_apply_v1.ogg",
        "durationSec": 0.65
      },
      {
        "path": "assets/audio/sfx/status/status_shock_apply_v2.ogg",
        "durationSec": 0.65
      }
    ]
  },
  "status_curse_apply": {
    "id": "status_curse_apply",
    "category": "status",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.74,
    "minIntervalMs": 100,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/status/status_curse_apply_v1.ogg",
        "durationSec": 0.95
      },
      {
        "path": "assets/audio/sfx/status/status_curse_apply_v2.ogg",
        "durationSec": 0.95
      }
    ]
  },
  "status_purge": {
    "id": "status_purge",
    "category": "status",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.76,
    "minIntervalMs": 100,
    "pitchJitter": 0.03,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/status/status_purge_v1.ogg",
        "durationSec": 0.363
      },
      {
        "path": "assets/audio/sfx/status/status_purge_v2.ogg",
        "durationSec": 0.8
      }
    ]
  },
  "combat_dodge_whoosh": {
    "id": "combat_dodge_whoosh",
    "category": "combat",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.68,
    "minIntervalMs": 60,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/combat/combat_dodge_whoosh_v1.ogg",
        "durationSec": 0.061
      },
      {
        "path": "assets/audio/sfx/combat/combat_dodge_whoosh_v2.ogg",
        "durationSec": 0.239
      },
      {
        "path": "assets/audio/sfx/combat/combat_dodge_whoosh_v3.ogg",
        "durationSec": 0.282
      }
    ]
  },
  "combat_perfect_dodge": {
    "id": "combat_perfect_dodge",
    "category": "combat",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.84,
    "minIntervalMs": 120,
    "pitchJitter": 0.03,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/combat/combat_perfect_dodge_v1.ogg",
        "durationSec": 0.345
      },
      {
        "path": "assets/audio/sfx/combat/combat_perfect_dodge_v2.ogg",
        "durationSec": 0.307
      }
    ]
  },
  "combat_player_hurt": {
    "id": "combat_player_hurt",
    "category": "combat",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.86,
    "minIntervalMs": 120,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/combat/combat_player_hurt_v1.ogg",
        "durationSec": 0.261
      },
      {
        "path": "assets/audio/sfx/combat/combat_player_hurt_v2.ogg",
        "durationSec": 0.291
      }
    ]
  },
  "combat_hero_death": {
    "id": "combat_hero_death",
    "category": "combat",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.92,
    "minIntervalMs": 300,
    "pitchJitter": 0,
    "gainJitter": 0,
    "variants": [
      {
        "path": "assets/audio/sfx/combat/combat_hero_death_v1.ogg",
        "durationSec": 0.58
      }
    ]
  },
  "combat_low_hp_alert": {
    "id": "combat_low_hp_alert",
    "category": "combat",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.55,
    "minIntervalMs": 900,
    "pitchJitter": 0,
    "gainJitter": 0,
    "variants": [
      {
        "path": "assets/audio/sfx/combat/combat_low_hp_alert_v1.ogg",
        "durationSec": 0.143
      }
    ]
  },
  "combat_spell_flamepurr": {
    "id": "combat_spell_flamepurr",
    "category": "combat",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.82,
    "minIntervalMs": 60,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/combat/combat_spell_flamepurr_v1.ogg",
        "durationSec": 0.623
      },
      {
        "path": "assets/audio/sfx/combat/combat_spell_flamepurr_v2.ogg",
        "durationSec": 0.476
      }
    ]
  },
  "combat_spell_lightnyan": {
    "id": "combat_spell_lightnyan",
    "category": "combat",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.82,
    "minIntervalMs": 60,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/combat/combat_spell_lightnyan_v1.ogg",
        "durationSec": 1.25
      },
      {
        "path": "assets/audio/sfx/combat/combat_spell_lightnyan_v2.ogg",
        "durationSec": 0.89
      }
    ]
  },
  "combat_spell_freezepaw": {
    "id": "combat_spell_freezepaw",
    "category": "combat",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.82,
    "minIntervalMs": 60,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/combat/combat_spell_freezepaw_v1.ogg",
        "durationSec": 1.05
      },
      {
        "path": "assets/audio/sfx/combat/combat_spell_freezepaw_v2.ogg",
        "durationSec": 0.095
      }
    ]
  },
  "combat_spell_healing_paw": {
    "id": "combat_spell_healing_paw",
    "category": "combat",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.8,
    "minIntervalMs": 60,
    "pitchJitter": 0.03,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/combat/combat_spell_healing_paw_v1.ogg",
        "durationSec": 1.2
      },
      {
        "path": "assets/audio/sfx/combat/combat_spell_healing_paw_v2.ogg",
        "durationSec": 0.174
      }
    ]
  },
  "combat_spell_aegis_purr": {
    "id": "combat_spell_aegis_purr",
    "category": "combat",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.8,
    "minIntervalMs": 60,
    "pitchJitter": 0.03,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/combat/combat_spell_aegis_purr_v1.ogg",
        "durationSec": 0.702
      },
      {
        "path": "assets/audio/sfx/combat/combat_spell_aegis_purr_v2.ogg",
        "durationSec": 1.1
      }
    ]
  },
  "combat_spell_pounce_dash": {
    "id": "combat_spell_pounce_dash",
    "category": "combat",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.78,
    "minIntervalMs": 60,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/combat/combat_spell_pounce_dash_v1.ogg",
        "durationSec": 0.352
      },
      {
        "path": "assets/audio/sfx/combat/combat_spell_pounce_dash_v2.ogg",
        "durationSec": 0.111
      }
    ]
  },
  "combat_spell_meteor_paw": {
    "id": "combat_spell_meteor_paw",
    "category": "combat",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.84,
    "minIntervalMs": 80,
    "pitchJitter": 0.03,
    "gainJitter": 0.05,
    "variants": [
      {
        "path": "assets/audio/sfx/combat/combat_spell_meteor_paw_v1.ogg",
        "durationSec": 1.35
      },
      {
        "path": "assets/audio/sfx/combat/combat_spell_meteor_paw_v2.ogg",
        "durationSec": 0.498
      }
    ]
  },
  "combat_spell_meteor_fall": {
    "id": "combat_spell_meteor_fall",
    "category": "combat",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.66,
    "minIntervalMs": 90,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/combat/combat_spell_meteor_fall_v1.ogg",
        "durationSec": 1.193
      },
      {
        "path": "assets/audio/sfx/combat/combat_spell_meteor_fall_v2.ogg",
        "durationSec": 1.25
      }
    ]
  },
  "loot_chest_creak": {
    "id": "loot_chest_creak",
    "category": "loot",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.84,
    "minIntervalMs": 120,
    "pitchJitter": 0.03,
    "gainJitter": 0.05,
    "variants": [
      {
        "path": "assets/audio/sfx/loot/loot_chest_creak_v1.ogg",
        "durationSec": 0.397
      },
      {
        "path": "assets/audio/sfx/loot/loot_chest_creak_v2.ogg",
        "durationSec": 0.684
      }
    ]
  },
  "loot_chest_open": {
    "id": "loot_chest_open",
    "category": "loot",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.88,
    "minIntervalMs": 150,
    "pitchJitter": 0,
    "gainJitter": 0,
    "variants": [
      {
        "path": "assets/audio/sfx/loot/loot_chest_open_v1.ogg",
        "durationSec": 0.469
      }
    ]
  },
  "loot_coin_pickup": {
    "id": "loot_coin_pickup",
    "category": "loot",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.66,
    "minIntervalMs": 45,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/loot/loot_coin_pickup_v1.ogg",
        "durationSec": 0.45
      },
      {
        "path": "assets/audio/sfx/loot/loot_coin_pickup_v2.ogg",
        "durationSec": 0.214
      },
      {
        "path": "assets/audio/sfx/loot/loot_coin_pickup_v3.ogg",
        "durationSec": 0.45
      }
    ]
  },
  "loot_xp_pickup": {
    "id": "loot_xp_pickup",
    "category": "loot",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.64,
    "minIntervalMs": 45,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/loot/loot_xp_pickup_v1.ogg",
        "durationSec": 0.194
      },
      {
        "path": "assets/audio/sfx/loot/loot_xp_pickup_v2.ogg",
        "durationSec": 0.066
      },
      {
        "path": "assets/audio/sfx/loot/loot_xp_pickup_v3.ogg",
        "durationSec": 0.48
      }
    ]
  },
  "loot_item_drop": {
    "id": "loot_item_drop",
    "category": "loot",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.7,
    "minIntervalMs": 50,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/loot/loot_item_drop_v1.ogg",
        "durationSec": 0.188
      },
      {
        "path": "assets/audio/sfx/loot/loot_item_drop_v2.ogg",
        "durationSec": 0.126
      }
    ]
  },
  "loot_level_up": {
    "id": "loot_level_up",
    "category": "loot",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.9,
    "minIntervalMs": 250,
    "pitchJitter": 0,
    "gainJitter": 0,
    "variants": [
      {
        "path": "assets/audio/sfx/loot/loot_level_up_v1.ogg",
        "durationSec": 1.979
      }
    ]
  },
  "loot_victory_fanfare": {
    "id": "loot_victory_fanfare",
    "category": "loot",
    "bus": "sfx",
    "loop": false,
    "defaultGain": 0.92,
    "minIntervalMs": 400,
    "pitchJitter": 0,
    "gainJitter": 0,
    "variants": [
      {
        "path": "assets/audio/sfx/loot/loot_victory_fanfare_v1.ogg",
        "durationSec": 0.588
      }
    ]
  },
  "ambient_torch_fire": {
    "id": "ambient_torch_fire",
    "category": "ambient",
    "bus": "ambience",
    "loop": true,
    "defaultGain": 0.55,
    "minIntervalMs": 0,
    "pitchJitter": 0.02,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ambient/ambient_torch_fire_v1.ogg",
        "durationSec": 12
      }
    ]
  },
  "ambient_forge_hearth": {
    "id": "ambient_forge_hearth",
    "category": "ambient",
    "bus": "ambience",
    "loop": true,
    "defaultGain": 0.58,
    "minIntervalMs": 0,
    "pitchJitter": 0.02,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ambient/ambient_forge_hearth_v1.ogg",
        "durationSec": 10
      }
    ]
  },
  "ambient_shore_surf": {
    "id": "ambient_shore_surf",
    "category": "ambient",
    "bus": "ambience",
    "loop": true,
    "defaultGain": 0.54,
    "minIntervalMs": 0,
    "pitchJitter": 0.02,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ambient/ambient_shore_surf_v1.ogg",
        "durationSec": 8.6
      }
    ]
  },
  "ambient_seagulls": {
    "id": "ambient_seagulls",
    "category": "ambient",
    "bus": "ambience",
    "loop": true,
    "defaultGain": 0.45,
    "minIntervalMs": 200,
    "pitchJitter": 0.04,
    "gainJitter": 0.06,
    "variants": [
      {
        "path": "assets/audio/sfx/ambient/ambient_seagulls_v1.ogg",
        "durationSec": 4.5
      },
      {
        "path": "assets/audio/sfx/ambient/ambient_seagulls_v2.ogg",
        "durationSec": 4.5
      }
    ]
  },
  "ambient_crystal_hum": {
    "id": "ambient_crystal_hum",
    "category": "ambient",
    "bus": "ambience",
    "loop": true,
    "defaultGain": 0.45,
    "minIntervalMs": 0,
    "pitchJitter": 0.02,
    "gainJitter": 0.04,
    "variants": [
      {
        "path": "assets/audio/sfx/ambient/ambient_crystal_hum_v1.ogg",
        "durationSec": 2.216
      }
    ]
  }
} as const;

export const AUDIO_MUSIC_TRACKS: Readonly<Record<AudioMusicCategoryId, AudioMusicTrackEntry>> = {
  "menu": {
    "id": "menu",
    "path": "assets/audio/music/menu.ogg",
    "durationSec": 43,
    "loop": true,
    "defaultGain": 0.92
  },
  "overworld": {
    "id": "overworld",
    "path": "assets/audio/music/overworld.ogg",
    "durationSec": 97.4,
    "loop": true,
    "defaultGain": 1
  },
  "maritime": {
    "id": "maritime",
    "path": "assets/audio/music/maritime.ogg",
    "durationSec": 128.1,
    "loop": true,
    "defaultGain": 1.05
  },
  "dungeon": {
    "id": "dungeon",
    "path": "assets/audio/music/dungeon.ogg",
    "durationSec": 120,
    "loop": true,
    "defaultGain": 0.96
  },
  "combat": {
    "id": "combat",
    "path": "assets/audio/music/combat.ogg",
    "durationSec": 95.7,
    "loop": true,
    "defaultGain": 0.95
  },
  "boss": {
    "id": "boss",
    "path": "assets/audio/music/boss.ogg",
    "durationSec": 171.5,
    "loop": true,
    "defaultGain": 1
  },
  "boss_phase2": {
    "id": "boss_phase2",
    "path": "assets/audio/music/boss_phase2.ogg",
    "durationSec": 114.3,
    "loop": true,
    "defaultGain": 1.02
  },
  "victory": {
    "id": "victory",
    "path": "assets/audio/music/victory.ogg",
    "durationSec": 56.4,
    "loop": false,
    "defaultGain": 1
  }
} as const;

export const AUDIO_WEATHER_TRACKS: Readonly<Record<AudioWeatherCategoryId, AudioWeatherTrackEntry>> = {
  "ocean_waves": {
    "id": "ocean_waves",
    "path": "assets/audio/weather/ocean_waves.ogg",
    "durationSec": 12.1,
    "loop": true
  },
  "wind_gale": {
    "id": "wind_gale",
    "path": "assets/audio/weather/wind_gale.ogg",
    "durationSec": 24,
    "loop": true
  },
  "rain_storm": {
    "id": "rain_storm",
    "path": "assets/audio/weather/rain_storm.ogg",
    "durationSec": 27,
    "loop": true
  },
  "thunder_clap": {
    "id": "thunder_clap",
    "path": "assets/audio/weather/thunder_clap.ogg",
    "durationSec": 4.2,
    "loop": false
  },
  "birds_day": {
    "id": "birds_day",
    "path": "assets/audio/weather/birds_day.ogg",
    "durationSec": 30,
    "loop": true
  }
} as const;

export const LEGACY_SFX_TO_GROUP: Readonly<Record<SfxId, AudioSfxGroupId>> = {
  sword_swing: 'weapon_swing_wood',
  swing_wood: 'weapon_swing_wood',
  swing_steel: 'weapon_swing_steel',
  swing_staff: 'weapon_swing_arcane',
  swing_dragon: 'weapon_swing_draconic',
  sword_hit: 'impact_generic',
  crit_hit: 'impact_crit',
  enemy_hurt: 'monster_hurt',
  dodge_whoosh: 'combat_dodge_whoosh',
  spell_fire: 'combat_spell_flamepurr',
  spell_lightning: 'combat_spell_lightnyan',
  spell_ice: 'combat_spell_freezepaw',
  spell_heal: 'combat_spell_healing_paw',
  spell_flamepurr: 'combat_spell_flamepurr',
  spell_lightnyan: 'combat_spell_lightnyan',
  spell_freezepaw: 'combat_spell_freezepaw',
  spell_healing_paw: 'combat_spell_healing_paw',
  spell_aegis_purr: 'combat_spell_aegis_purr',
  spell_pounce_dash: 'combat_spell_pounce_dash',
  spell_meteor_paw: 'combat_spell_meteor_paw',
  spell_meteor_fall: 'combat_spell_meteor_fall',
  player_hurt: 'combat_player_hurt',
  chest_creak: 'loot_chest_creak',
  chest_open: 'loot_chest_open',
  level_up: 'loot_level_up',
  coin_pickup: 'loot_coin_pickup',
  menu_open: 'ui_menu_open',
  menu_close: 'ui_menu_close',
  map_open: 'ui_map_open',
  npc_talk: 'ui_npc_talk',
  interact: 'ui_interact',
  special_interact: 'ui_special_interact',
  meow_ui: 'ui_meow',
  boss_roar: 'boss_dragon_roar',
  boss_dragon_flame: 'boss_dragon_flame',
  boss_dragon_slam: 'boss_dragon_slam',
  boss_rat_attack: 'boss_rat_attack',
  hero_death: 'combat_hero_death',
} as const;

export function getLegacySfxPath(id: SfxId): string {
  const groupId = LEGACY_SFX_TO_GROUP[id];
  return AUDIO_SFX_GROUPS[groupId].variants[0].path;
}

export function getAllAudioAssetPaths(): string[] {
  const paths: string[] = [];
  for (const group of Object.values(AUDIO_SFX_GROUPS)) {
    for (const variant of group.variants) {
      paths.push(variant.path);
    }
  }
  for (const track of Object.values(AUDIO_MUSIC_TRACKS)) {
    paths.push(track.path);
  }
  for (const track of Object.values(AUDIO_WEATHER_TRACKS)) {
    paths.push(track.path);
  }
  return paths;
}
