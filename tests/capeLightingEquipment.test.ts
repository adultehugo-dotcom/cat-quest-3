import { describe, expect, it } from 'vitest';
import { getHeroBodyTextureKey, getHeroEquipmentKey } from '../src/art/spriteHero';
import { AudioEngine } from '../src/audio/audioEngine';
import { EQUIPMENT, EQUIPMENT_LIST } from '../src/data/equipmentData';
import { SPELL_ORDER } from '../src/data/spellsData';
import { OVERWORLD_DATA, isInsideIsland } from '../src/data/worldData';
import { ALL_NEW_ISLANDS, NEW_ISLANDS, isInsideNewIsland } from '../src/data/worldIslands';
import {
  applyDamageToPlayer,
  castSpell,
  updatePlayerShield,
} from '../src/game/combat';
import { GameEngine } from '../src/game/gameEngine';
import {
  addEquipment,
  createInitialPlayerState,
  equipItem,
  upgradeSpell,
} from '../src/game/progression';
import {
  createMemoryStorage,
  serializeGameState,
  validateSaveData,
} from '../src/game/saveSystem';
import { ALL_EQUIP_SLOTS, type EnemyInstance, type GameEvent } from '../src/game/types';
import {
  CapeClothSolver,
  getCapeMaterialProfile,
  type CapeWindInput,
} from '../src/render/capePhysics';
import { WeatherCycleController } from '../src/render/weatherSystem';
import { OVERWORLD_LAMP_LIGHTS } from '../src/render/worldRenderer';

function makeCalmInput(overrides: Partial<CapeWindInput> = {}): CapeWindInput {
  return {
    vx: 0,
    vz: 0,
    vy: 0,
    worldX: 0,
    worldY: 0,
    worldZ: 0,
    facingX: 1,
    windDirX: 0.85,
    windDirZ: 0.52,
    windIntensity: 0.14,
    stormIntensity: 0,
    isRolling: false,
    isAttacking: false,
    attackProgress: 0,
    isJumping: false,
    isOnDeck: false,
    bounceY: 0,
    elevationY: 0,
    speed: 0,
    ...overrides,
  };
}

function getHemCenter(solver: CapeClothSolver): { x: number; y: number; z: number } {
  const idx = (solver.rows - 1) * solver.cols + Math.floor(solver.cols / 2);
  return { x: solver.posX[idx], y: solver.posY[idx], z: solver.posZ[idx] };
}

function assertAllVerticesSafe(
  solver: CapeClothSolver,
  bounceY = 0,
  elevationY = 0,
): void {
  const tanTilt = Math.tan(0.48);
  const minFloorY = Math.max(-elevationY + 0.08, -0.35);
  for (let i = 0; i < solver.vertexCount; i++) {
    const x = solver.posX[i];
    const y = solver.posY[i];
    const z = solver.posZ[i];
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
    expect(Number.isFinite(z)).toBe(true);
    if (i >= solver.cols) {
      expect(y).toBeGreaterThanOrEqual(minFloorY - 1e-4);
      const heroPlaneZ = -Math.max(0, y - bounceY) * tanTilt;
      expect(z).toBeLessThanOrEqual(heroPlaneZ - 0.04);
    }
  }
}

describe('Priorité 1 — Éclairage extérieur & cohérence des emplacements', () => {
  it('place tous les lampadaires extérieurs sur la terre ferme sans bloquer bâtiments, PNJ, portails ni obstacles', () => {
    expect(OVERWORLD_LAMP_LIGHTS.length).toBeGreaterThanOrEqual(13);

    const allProps = [
      ...OVERWORLD_DATA.props,
      ...ALL_NEW_ISLANDS.flatMap((id) => NEW_ISLANDS[id].props),
    ];

    for (const lamp of OVERWORLD_LAMP_LIGHTS) {
      const onFelingard = isInsideIsland(lamp.x, lamp.z, 1.8);
      const onOtherIsland = ALL_NEW_ISLANDS.some((id) =>
        isInsideNewIsland(id, lamp.x, lamp.z, 1.8),
      );
      expect(onFelingard || onOtherIsland).toBe(true);
      expect(lamp.outdoor).toBe(true);
      expect(lamp.distance ?? 0).toBeGreaterThanOrEqual(10);
      expect(lamp.intensity ?? 0).toBeGreaterThan(1.5);

      // Ne chevauche aucun bâtiment
      for (const b of OVERWORLD_DATA.buildings) {
        const d = Math.hypot(lamp.x - b.x, lamp.z - b.z);
        expect(d).toBeGreaterThan(b.colliderRadius + 0.8);
      }
      // Ne chevauche aucun PNJ
      for (const npc of OVERWORLD_DATA.npcs) {
        const d = Math.hypot(lamp.x - npc.x, lamp.z - npc.z);
        expect(d).toBeGreaterThan(npc.radius + 1.0);
      }
      // Ne bloque pas le point de départ joueur
      expect(
        Math.hypot(
          lamp.x - OVERWORLD_DATA.playerStart.x,
          lamp.z - OVERWORLD_DATA.playerStart.z,
        ),
      ).toBeGreaterThan(2.0);
      // Ne chevauche aucun prop bloquant
      for (const prop of allProps) {
        if (!prop.collidable) continue;
        const d = Math.hypot(lamp.x - prop.x, lamp.z - prop.z);
        expect(d).toBeGreaterThan((prop.colliderRadius ?? 0.8) + 0.5);
      }
    }
  });

  it('active la lanterne automatique à l’aube, au coucher, la nuit, dans le brouillard et en tempête (éteinte à midi clair)', () => {
    const weather = new WeatherCycleController({
      initialCondition: 'clear',
      initialTimeOfDay: 0.5,
    });
    expect(weather.getSnapshot().lanternBoost).toBeLessThan(0.02);

    weather.applyQaOverride({ condition: 'clear', timeOfDay: 0.26, instant: true });
    expect(weather.getSnapshot().lanternBoost).toBeGreaterThan(0.2);

    weather.applyQaOverride({ condition: 'clear', timeOfDay: 0.02, instant: true });
    expect(weather.getSnapshot().lanternBoost).toBeGreaterThan(0.85);

    weather.applyQaOverride({ condition: 'fog', timeOfDay: 0.5, instant: true });
    expect(weather.getSnapshot().lanternBoost).toBeGreaterThan(0.45);

    weather.applyQaOverride({ condition: 'storm', timeOfDay: 0.5, instant: true });
    expect(weather.getSnapshot().lanternBoost).toBeGreaterThan(0.65);
  });
});

describe('Priorité 2 — Équipement modulaire indépendant & zéro arme secondaire', () => {
  it('supprime totalement secondary_weapon, boots, gloves, trinket et dagger_fang des données actives et de l’état initial', () => {
    expect(ALL_EQUIP_SLOTS).toEqual([
      'weapon',
      'shield',
      'helmet',
      'armor',
      'cape',
    ]);
    expect((ALL_EQUIP_SLOTS as readonly string[]).includes('secondary_weapon')).toBe(false);
    expect((ALL_EQUIP_SLOTS as readonly string[]).includes('boots')).toBe(false);
    expect((ALL_EQUIP_SLOTS as readonly string[]).includes('gloves')).toBe(false);
    expect((ALL_EQUIP_SLOTS as readonly string[]).includes('trinket')).toBe(false);
    expect(EQUIPMENT['dagger_fang']).toBeUndefined();
    expect(EQUIPMENT['trinket_yarn']).toBeUndefined();
    expect(EQUIPMENT['boots_leather']).toBeUndefined();
    expect(EQUIPMENT['gloves_leather']).toBeUndefined();
    expect(EQUIPMENT_LIST.some((item) => item.id === 'dagger_fang')).toBe(false);

    const player = createInitialPlayerState();
    expect(player.inventory['dagger_fang']).toBeUndefined();
    expect(player.inventory['boots_leather']).toBeUndefined();
    expect(player.inventory['gloves_leather']).toBeUndefined();
    expect(player.inventory['trinket_yarn']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(player.equipped, 'secondary_weapon')).toBe(false);
    expect(player.inventory['shield_wood']).toBeDefined();
    expect(player.inventory['cape_traveler']).toBeDefined();
  });

  it('garantit que changer armure, casque ou cape ne remplace strictement que son emplacement dédié', () => {
    const player = createInitialPlayerState();
    addEquipment(player, 'armor_mail');
    addEquipment(player, 'helm_knight');
    addEquipment(player, 'cape_knight');
    addEquipment(player, 'cape_starlight');
    addEquipment(player, 'shield_knight');

    const beforeBodyKey = getHeroBodyTextureKey(player.equipped, 'idle');
    const beforeFullKey = getHeroEquipmentKey(player.equipped);

    // 1. Changer la cape ne modifie NI l'armure NI le casque NI la texture du corps 3D
    expect(equipItem(player, 'cape_knight')).toBe(true);
    expect(player.equipped.cape).toBe('cape_knight');
    expect(player.equipped.armor).toBe('armor_tunic');
    expect(player.equipped.helmet).toBe('helm_bandana');
    expect(getHeroBodyTextureKey(player.equipped, 'idle')).toBe(beforeBodyKey);
    expect(getHeroEquipmentKey(player.equipped)).not.toBe(beforeFullKey);

    // 2. Changer l'armure ne modifie que l'armure
    const prevHelmet = player.equipped.helmet;
    const prevCape = player.equipped.cape;
    expect(equipItem(player, 'armor_mail')).toBe(true);
    expect(player.equipped.armor).toBe('armor_mail');
    expect(player.equipped.helmet).toBe(prevHelmet);
    expect(player.equipped.cape).toBe(prevCape);
    expect(getHeroBodyTextureKey(player.equipped, 'idle')).not.toBe(beforeBodyKey);

    // 3. Changer le casque ne modifie que le casque
    const prevArmor = player.equipped.armor;
    expect(equipItem(player, 'helm_knight')).toBe(true);
    expect(player.equipped.helmet).toBe('helm_knight');
    expect(player.equipped.armor).toBe(prevArmor);
    expect(player.equipped.cape).toBe(prevCape);

    // 4. Arme principale et bouclier coexistent indépendamment
    expect(equipItem(player, 'shield_knight')).toBe(true);
    expect(player.equipped.weapon).toBe('sword_wood');
    expect(player.equipped.shield).toBe('shield_knight');
  });
});

describe('Priorité 2 — Simulation physique de cape en tissu souple (CapeClothSolver)', () => {
  it('utilise un maillage riche subdivisé 11×13 avec col épinglé, plancher sol et barrière dorsale', () => {
    const solver = new CapeClothSolver();
    expect(solver.cols).toBe(11);
    expect(solver.rows).toBe(13);
    expect(solver.vertexCount).toBe(143);

    // Repos calme 1.5 s
    for (let i = 0; i < 90; i++) {
      solver.step(1 / 60, makeCalmInput());
    }
    assertAllVerticesSafe(solver, 0, 0);

    // Ligne 0 strictement épinglée aux épaules
    for (let c = 0; c < solver.cols; c++) {
      expect(solver.posY[c]).toBeCloseTo(solver.restY[c], 4);
    }
  });

  it('réagit proportionnellement entre marche lente, course rapide et arrêt net avec inertie réelle', () => {
    const slowSolver = new CapeClothSolver();
    const fastSolver = new CapeClothSolver();

    let slowX = 0;
    let fastX = 0;
    for (let i = 0; i < 60; i++) {
      const dt = 1 / 60;
      slowX += 3.0 * dt;
      fastX += 10.5 * dt;
      slowSolver.step(
        dt,
        makeCalmInput({ vx: 3.0, speed: 3.0, worldX: slowX, facingX: 1 }),
      );
      fastSolver.step(
        dt,
        makeCalmInput({ vx: 10.5, speed: 10.5, worldX: fastX, facingX: 1 }),
      );
    }
    assertAllVerticesSafe(slowSolver);
    assertAllVerticesSafe(fastSolver);

    const slowHem = getHemCenter(slowSolver);
    const fastHem = getHemCenter(fastSolver);
    // Course rapide = traînée plus marquée derrière (-X) et soulèvement plus haut qu'en marche lente
    expect(Math.abs(fastHem.x)).toBeGreaterThan(Math.abs(slowHem.x) + 0.08);
    expect(fastHem.y).toBeGreaterThan(slowHem.y + 0.03);

    // Arrêt net : la cape conserve une inertie avant de retomber progressivement par gravité
    const trailingBeforeStop = fastHem.x;
    fastSolver.step(1 / 60, makeCalmInput({ vx: 0, speed: 0, worldX: fastX, facingX: 1 }));
    const rightAfterStop = getHemCenter(fastSolver).x;
    // Pas de retour instantané au repos sur 1 frame (inertie réelle)
    expect(Math.abs(rightAfterStop)).toBeGreaterThan(Math.abs(trailingBeforeStop) * 0.5);

    for (let i = 0; i < 90; i++) {
      fastSolver.step(1 / 60, makeCalmInput({ vx: 0, speed: 0, worldX: fastX, facingX: 1 }));
    }
    assertAllVerticesSafe(fastSolver);
    const settledHem = getHemCenter(fastSolver);
    expect(Math.abs(settledHem.x)).toBeLessThan(Math.abs(trailingBeforeStop) * 0.55);
    expect(settledHem.y).toBeLessThan(fastHem.y);
  });

  it('gère proprement virages, attaques, roulades, sauts et téléportations sans clipping ni NaN', () => {
    const solver = new CapeClothSolver();
    let wx = 0;

    // 1. Virage brusque gauche -> droite -> gauche
    for (let i = 0; i < 45; i++) {
      const dt = 1 / 60;
      const facing = i < 20 ? 1 : -1;
      const vx = facing * 8.0;
      wx += vx * dt;
      solver.step(dt, makeCalmInput({ vx, speed: Math.abs(vx), worldX: wx, facingX: facing }));
      assertAllVerticesSafe(solver);
    }

    // 2. Attaque à l'épée (impulsion latérale fluide)
    solver.reset();
    for (let i = 0; i < 18; i++) {
      solver.step(
        1 / 60,
        makeCalmInput({
          isAttacking: i < 12,
          attackProgress: Math.min(1, i / 12),
          bounceY: 0.06,
        }),
      );
      assertAllVerticesSafe(solver, 0.06, 0);
    }
    expect(Math.abs(getHemCenter(solver).x)).toBeGreaterThan(0.03);

    // 3. Roulade (repli compact sans toucher le sol ni traverser le dos)
    for (let i = 0; i < 25; i++) {
      const dt = 1 / 60;
      wx += 14 * dt;
      solver.step(
        dt,
        makeCalmInput({
          vx: 14,
          speed: 14,
          worldX: wx,
          isRolling: true,
          bounceY: 0.22,
        }),
      );
      assertAllVerticesSafe(solver, 0.22, 0);
    }

    // 4. Saut parabolique (montée -> descente -> atterrissage)
    solver.reset();
    let riseMinY = 0;
    let fallMaxY = -10;
    for (let i = 0; i < 44; i++) {
      const t = i / 43;
      const elev = Math.sin(t * Math.PI) * 1.45;
      const vy = Math.cos(t * Math.PI) * 6.5;
      solver.step(
        1 / 60,
        makeCalmInput({
          vx: 4,
          speed: 4,
          vy,
          worldX: i * 0.06,
          worldY: elev,
          elevationY: elev,
          isJumping: true,
        }),
      );
      assertAllVerticesSafe(solver, 0, elev);
      const hem = getHemCenter(solver);
      if (i === 10) riseMinY = hem.y;
      if (i > 24 && hem.y > fallMaxY) fallMaxY = hem.y;
    }
    // En descente, le flux d'air par-dessous soulève l'ourlet plus haut qu'en montée
    expect(fallMaxY).toBeGreaterThan(riseMinY + 0.06);

    // 5. Téléportation brutale (transition de zone) : zéro explosion / NaN
    solver.step(1 / 60, makeCalmInput({ worldX: 95, worldZ: -80, worldY: 0 }));
    assertAllVerticesSafe(solver, 0, 0);
  });

  it('différencie les propriétés matérielles entre capes (soie astrale plus légère que velours draconique)', () => {
    const silk = new CapeClothSolver();
    const dragon = new CapeClothSolver();
    silk.setMaterialProfile(getCapeMaterialProfile('cape_starlight'));
    dragon.setMaterialProfile(getCapeMaterialProfile('cape_dragon'));

    const stormWind = makeCalmInput({
      windDirX: 0.9,
      windDirZ: 0.4,
      windIntensity: 0.95,
      stormIntensity: 1.0,
    });
    for (let i = 0; i < 80; i++) {
      silk.step(1 / 60, stormWind);
      dragon.step(1 / 60, stormWind);
    }
    assertAllVerticesSafe(silk);
    assertAllVerticesSafe(dragon);

    const silkHem = getHemCenter(silk);
    const dragonHem = getHemCenter(dragon);
    // La soie légère se soulève davantage dans la tempête que le lourd velours draconique
    expect(silkHem.y).toBeGreaterThan(dragonHem.y + 0.04);
  });
});

describe('Priorité 4 — Météo (sélecteur pause sans persistance) & Audio', () => {
  it('applique les choix manuels avec transition 14 s, restaure Automatique et ne sauvegarde jamais la météo', () => {
    const ctrl = new WeatherCycleController({
      initialCondition: 'clear',
      initialTimeOfDay: 0.5,
    });

    ctrl.setManualWeather('storm');
    expect(ctrl.getSnapshot().targetCondition).toBe('storm');
    for (let i = 0; i < 28; i++) ctrl.update(0.25); // 7 s (transition 14 s -> ~50 %)
    const mid = ctrl.getSnapshot();
    expect(mid.transitionProgress).toBeGreaterThan(0.35);
    expect(mid.transitionProgress).toBeLessThan(0.65);
    for (let i = 0; i < 32; i++) ctrl.update(0.25); // +8 s -> terminé
    expect(ctrl.getSnapshot().currentCondition).toBe('storm');

    ctrl.setManualWeather(null);
    ctrl.update(0.1);
    expect(ctrl.getSnapshot().targetCondition).toBeDefined();

    // Aucune clé météo dans la sauvegarde sérialisée
    const engine = new GameEngine();
    engine.startNewGame();
    const serialized = serializeGameState(engine.state) as unknown as Record<string, unknown>;
    expect('weather' in serialized).toBe(false);
    expect('timeOfDay' in serialized).toBe(false);
  });

  it('gère le mode muet, le volume général et les thèmes musicaux (overworld, dungeon, boss)', () => {
    const storage = createMemoryStorage();
    const audio = new AudioEngine(storage);

    audio.setVolume(0.42);
    expect(audio.getVolume()).toBeCloseTo(0.42, 2);
    expect(audio.isMuted()).toBe(false);

    expect(audio.toggleMute()).toBe(true);
    expect(audio.isMuted()).toBe(true);
    expect(audio.toggleMute()).toBe(false);

    audio.setMusicTheme('overworld');
    expect(audio.getMusicTheme()).toBe('overworld');
    audio.setMusicTheme('dungeon');
    expect(audio.getMusicTheme()).toBe('dungeon');
    audio.setMusicTheme('boss');
    expect(audio.getMusicTheme()).toBe('boss');

    audio.dispose();
  });
});

describe('Priorité 5 — Nouveaux sorts (Défense, Mobilité, AoE) & Rétrocompatibilité', () => {
  function makeTestEnemy(id: string, x: number, z: number, hp = 200): EnemyInstance {
    return {
      id,
      typeId: 'slime_yarn',
      name: 'Slime test',
      level: 1,
      x,
      z,
      homeX: x,
      homeZ: z,
      facingX: 1,
      hp,
      maxHp: hp,
      radius: 0.9,
      state: 'idle',
      stateTimer: 0,
      attackCooldown: 0,
      slowTimer: 0,
      hitFlashTimer: 0,
      phase: 1,
      isBoss: false,
      respawnTimer: 0,
    };
  }

  it('Égide de Ronron (défense) crée une barrière qui absorbe les dégâts avant les PV puis expire proprement', () => {
    const player = createInitialPlayerState(0, 24);
    player.mp = 100;
    const events: GameEvent[] = [];

    const res = castSpell(player, 'aegis_purr', [], events);
    expect(res.cast).toBe(true);
    expect(res.shieldAmount ?? 0).toBeGreaterThan(25);
    expect(player.shieldHp ?? 0).toBe(res.shieldAmount);
    expect(player.shieldTimer ?? 0).toBeGreaterThan(5);
    expect(player.spellCooldowns.aegis_purr).toBeGreaterThan(0);

    const hpBefore = player.hp;
    const hit1 = applyDamageToPlayer(player, 18, 2, 24, events);
    expect(hit1.hit).toBe(true);
    expect(hit1.damage).toBe(0);
    expect(hit1.absorbedByShield ?? 0).toBeGreaterThan(0);
    expect(player.hp).toBe(hpBefore);

    // Expiration naturelle du bouclier
    updatePlayerShield(player, 6.0);
    expect(player.shieldHp).toBe(0);
    expect(player.shieldTimer).toBe(0);
  });

  it('Bond Foudroyant (mobilité) propulse le héros avec garde-fou collision, i-frames et dégâts de traversée', () => {
    const player = createInitialPlayerState(0, 24);
    player.aimAngle = 0; // +X
    player.mp = 100;
    const enemy = makeTestEnemy('e_dash', 3.2, 24, 150);
    const events: GameEvent[] = [];

    const res = castSpell(player, 'pounce_dash', [enemy], events, {
      resolveDashPosition: (x, z) => ({ x: Math.min(x, 4.5), z }),
      rng: () => 0.5,
    });
    expect(res.cast).toBe(true);
    expect(player.x).toBeCloseTo(4.5, 2); // bloqué proprement par la limite de collision
    expect(player.invulnTimer).toBeGreaterThan(0.2);
    expect(res.hitEnemies.length).toBe(1);
    expect(enemy.hp).toBeLessThan(150);
  });

  it("Chute d'Étoiles (AoE) inflige des dégâts magiques de zone avec recul, améliorable à la Forge et rétrocompatible", () => {
    const player = createInitialPlayerState(0, 24);
    player.aimAngle = 0;
    player.mp = 100;
    player.gold = 500;

    expect(SPELL_ORDER).toContain('aegis_purr');
    expect(SPELL_ORDER).toContain('pounce_dash');
    expect(SPELL_ORDER).toContain('meteor_paw');

    // Amélioration Forge Niv 1 -> 2
    const up = upgradeSpell(player, 'meteor_paw');
    expect(up.success).toBe(true);
    expect(player.spellLevels.meteor_paw).toBe(2);

    const e1 = makeTestEnemy('e_aoe_1', 4.0, 24, 300);
    const e2 = makeTestEnemy('e_aoe_2', 5.2, 25.5, 300);
    const eFar = makeTestEnemy('e_aoe_far', 22, 24, 300);
    const events: GameEvent[] = [];

    const res = castSpell(player, 'meteor_paw', [e1, e2, eFar], events, { rng: () => 0.5 });
    expect(res.cast).toBe(true);
    expect(res.hitEnemies.map((e) => e.id).sort()).toEqual(['e_aoe_1', 'e_aoe_2']);
    expect(e1.hp).toBeLessThan(300);
    expect(e2.hp).toBeLessThan(300);
    expect(eFar.hp).toBe(300);

    // Rétrocompatibilité stricte : une ancienne sauvegarde avec seulement 4 sorts reste valide
    const engine = new GameEngine();
    engine.startNewGame();
    const legacy = serializeGameState(engine.state);
    const legacySpells = legacy.player.spellLevels as Record<string, number>;
    delete legacySpells.aegis_purr;
    delete legacySpells.pounce_dash;
    delete legacySpells.meteor_paw;
    const validated = validateSaveData(legacy);
    expect(validated).not.toBeNull();
    expect(validated?.player.spellLevels.aegis_purr).toBe(1);
    expect(validated?.player.spellLevels.pounce_dash).toBe(1);
    expect(validated?.player.spellLevels.meteor_paw).toBe(1);
  });
});
