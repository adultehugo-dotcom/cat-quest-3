export {
  WATER_VERTEX_SHADER,
  WATER_FRAGMENT_SHADER,
  createWaterMaterial,
  updateWaterMaterial,
  createWaterGeometry,
  createWaterMesh,
  sampleOceanWaveHeight,
  type OceanCoastIsland,
  type WaterMaterialOptions,
} from './waterShader';

export {
  SHIP_WAKE_VERTEX_SHADER,
  SHIP_WAKE_FRAGMENT_SHADER,
  BOW_FOAM_VERTEX_SHADER,
  BOW_FOAM_FRAGMENT_SHADER,
  HULL_RIPPLE_VERTEX_SHADER,
  HULL_RIPPLE_FRAGMENT_SHADER,
  WIND_STREAK_VERTEX_SHADER,
  WIND_STREAK_FRAGMENT_SHADER,
  applySailWindShader,
  createShipWakeMaterial,
  createBowFoamMaterial,
  createHullRippleMaterial,
  createWindStreakMaterial,
  type SailWindUniforms,
} from './shipShaders';

export {
  TiltShiftVignetteShader,
  createTiltShiftVignettePass,
  updateTiltShiftResolution,
  type TiltShiftVignetteOptions,
} from './tiltShiftShader';

export {
  TELEGRAPH_VERTEX_SHADER,
  TELEGRAPH_FRAGMENT_SHADER,
  createTelegraphMaterial,
  updateTelegraphMaterial,
  type TelegraphShaderOptions,
} from './telegraphShader';

export {
  FLAME_RING_VERTEX_SHADER,
  FLAME_RING_FRAGMENT_SHADER,
  HEAT_HAZE_VERTEX_SHADER,
  HEAT_HAZE_FRAGMENT_SHADER,
  LIGHTNING_BEAM_VERTEX_SHADER,
  LIGHTNING_BEAM_FRAGMENT_SHADER,
  LIGHTNING_SCORCH_FRAGMENT_SHADER,
  ICE_CRYSTAL_VERTEX_SHADER,
  ICE_CRYSTAL_FRAGMENT_SHADER,
  FROST_MIST_VERTEX_SHADER,
  FROST_MIST_FRAGMENT_SHADER,
  HEAL_BEAM_VERTEX_SHADER,
  HEAL_BEAM_FRAGMENT_SHADER,
  HEAL_RING_VERTEX_SHADER,
  HEAL_RING_FRAGMENT_SHADER,
  createFlameRingMaterial,
  createHeatHazeMaterial,
  createLightningBeamMaterial,
  createLightningScorchMaterial,
  createIceCrystalMaterial,
  createFrostMistMaterial,
  createHealBeamMaterial,
  createHealRingMaterial,
  createQuestArrowMaterial,
} from './spellShaders';
