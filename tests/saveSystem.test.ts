import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/gameEngine';
import {
  addEquipment,
  equipItem,
  grantXp,
  upgradeSpell,
} from '../src/game/progression';
import {
  DEFAULT_AUDIO_PREFS,
  createMemoryStorage,
  deleteSaveData,
  hasSaveData,
  loadAudioPrefs,
  loadGame,
  saveAudioPrefs,
  saveGame,
  serializeGameState,
  validateSaveData,
  type StorageLike,
} from '../src/game/saveSystem';
import {
  AUDIO_PREFS_STORAGE_KEY,
  SAVE_STORAGE_KEY,
  type SaveData,
} from '../src/game/types';

describe('SaveSystem — Persistance, Validation & Résilience JSON', () => {
  it('ignore les anciennes armes secondaires sans perdre les autres équipements ni l’inventaire', () => {
    const engine = new GameEngine();
    engine.startNewGame();
    const legacy = serializeGameState(engine.state);
    Object.assign(legacy.player.equipped, { secondary_weapon: 'dagger_fang' });
    legacy.player.inventory.dagger_fang = { id: 'dagger_fang', level: 2 } as never;
    const migrated = validateSaveData(legacy);

    expect(migrated).not.toBeNull();
    expect(migrated?.player.equipped.weapon).toBe('sword_wood');
    expect(migrated?.player.equipped.helmet).toBe('helm_bandana');
    expect(migrated?.player.equipped).not.toHaveProperty('secondary_weapon');
    expect(migrated?.player.inventory.dagger_fang).toBeUndefined();
  });

  it('sauvegarde et recharge intégralement un GameState (équipements doublons, sorts, quêtes, clé runique, bateau v2)', () => {
    const storage = createMemoryStorage();
    const engine1 = new GameEngine({ storage, rng: () => 0.5 });
    engine1.startNewGame();
    while (engine1.state.dialogue.active) engine1.advanceDialogue();

    // Fait progresser le joueur
    grantXp(engine1.state.player, 220);
    engine1.state.player.gold = 450;
    engine1.state.player.hasRunicKey = true;
    addEquipment(engine1.state.player, 'sword_steel');
    addEquipment(engine1.state.player, 'sword_steel'); // Niv. 2 !
    equipItem(engine1.state.player, 'sword_steel');
    upgradeSpell(engine1.state.player, 'flamepurr'); // Niv. 2
    engine1.state.quests.main_dragon_blood.stepIndex = 2;
    engine1.state.openedChestIds.push('chest_plains_east');
    engine1.state.defeatedBossIds.push('boss_rat_king');
    engine1.state.runStats.enemiesDefeated = 17;
    engine1.state.runStats.chestsOpened = 3;

    // Modifie les données bateau v2
    engine1.state.ship.hullHp = 82;
    engine1.state.ship.ammo = 11;
    engine1.state.ship.equippedBlueprints.coque = 'coque_cuirassée';
    engine1.state.ship.unlockedSlots.cadence = true;

    expect(engine1.saveCurrentGame()).toBe(true);
    expect(storage.getItem(SAVE_STORAGE_KEY)).not.toBeNull();
    expect(hasSaveData(storage)).toBe(true);

    const rawLoaded = loadGame(storage);
    expect(rawLoaded).not.toBeNull();
    expect(rawLoaded?.version).toBe(2);
    expect(rawLoaded?.ship?.mode).toBe('parked');
    expect(rawLoaded?.ship?.hullHp).toBe(82);
    expect(rawLoaded?.ship?.ammo).toBe(11);
    expect(rawLoaded?.ship?.equippedBlueprints.coque).toBe('coque_cuirassée');
    expect(rawLoaded?.ship?.unlockedSlots.cadence).toBe(true);

    // Recharge dans une nouvelle instance GameEngine
    const engine2 = new GameEngine({ storage, rng: () => 0.5 });
    expect(engine2.hasSavedGame()).toBe(true);
    expect(engine2.continueSavedGame()).toBe(true);

    expect(engine2.state.screen).toBe('playing');
    expect(engine2.state.player.level).toBe(engine1.state.player.level);
    expect(engine2.state.player.gold).toBe(engine1.state.player.gold);
    expect(engine2.state.player.hasRunicKey).toBe(true);
    expect(engine2.state.player.equipped.weapon).toBe('sword_steel');
    expect(engine2.state.player.inventory.sword_steel.level).toBe(2);
    expect(engine2.state.player.spellLevels.flamepurr).toBe(2);
    expect(engine2.state.quests.main_dragon_blood.stepIndex).toBe(2);
    expect(engine2.state.openedChestIds).toEqual(['chest_plains_east']);
    expect(engine2.state.defeatedBossIds).toEqual(['boss_rat_king']);
    expect(engine2.state.runStats.enemiesDefeated).toBe(17);
    expect(engine2.state.ship.hullHp).toBe(82);
    expect(engine2.state.ship.ammo).toBe(11);
    expect(engine2.state.ship.equippedBlueprints.coque).toBe('coque_cuirassée');
    expect(engine2.state.ship.unlockedSlots.cadence).toBe(true);

    // Suppression de la sauvegarde
    expect(deleteSaveData(storage)).toBe(true);
    expect(hasSaveData(storage)).toBe(false);
    expect(loadGame(storage)).toBeNull();
  });

  it('accepte les anciennes sauvegardes v1 sans champ ship (rétrocompatibilité stricte)', () => {
    const storage = createMemoryStorage();
    const engine = new GameEngine({ storage });
    const v2Snap = serializeGameState(engine.state);
    const { ship: _omittedShip, ...withoutShip } = v2Snap;
    const legacyV1: SaveData = {
      ...withoutShip,
      version: 1,
    };

    const validated = validateSaveData(legacyV1);
    expect(validated).not.toBeNull();
    expect(validated?.version).toBe(1);
    expect(validated?.ship).toBeUndefined();

    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(legacyV1));
    expect(hasSaveData(storage)).toBe(true);
    expect(loadGame(storage)?.version).toBe(1);
  });

  it('résiste gracieusement aux JSON corrompus, versions invalides, champs manquants et données ship invalides', () => {
    const storage = createMemoryStorage();

    // JSON malformé
    storage.setItem(SAVE_STORAGE_KEY, '{corrupted_json:::');
    expect(loadGame(storage)).toBeNull();
    expect(hasSaveData(storage)).toBe(false);

    // Mauvaise version
    storage.setItem(
      SAVE_STORAGE_KEY,
      JSON.stringify({ version: 99, player: {} }),
    );
    expect(loadGame(storage)).toBeNull();

    // Objet valide mais équipement inexistant
    const engine = new GameEngine({ storage });
    const snap = serializeGameState(engine.state);
    const badEquip = {
      ...snap,
      player: {
        ...snap.player,
        equipped: { ...snap.player.equipped, weapon: 'non_existent_sword' },
      },
    };
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(badEquip));
    expect(loadGame(storage)).toBeNull();

    // Statut de quête invalide
    const badQuest = {
      ...snap,
      quests: {
        ...snap.quests,
        main_dragon_blood: {
          id: 'main_dragon_blood',
          status: 'hacked',
          stepIndex: 0,
          counter: 0,
        },
      },
    };
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(badQuest));
    expect(loadGame(storage)).toBeNull();

    // Modes transitoires interdits dans une sauvegarde brute
    for (const forbiddenMode of ['boarding', 'docking', 'disembarking', 'flying']) {
      const badShipMode = {
        ...snap,
        ship: { ...snap.ship!, mode: forbiddenMode },
      };
      expect(validateSaveData(badShipMode)).toBeNull();
    }

    // Coordonnées / angles non finis (NaN / Infinity)
    expect(
      validateSaveData({
        ...snap,
        ship: { ...snap.ship!, position: { x: Number.NaN, z: 0 } },
      }),
    ).toBeNull();
    expect(
      validateSaveData({
        ...snap,
        ship: { ...snap.ship!, angle: Number.POSITIVE_INFINITY },
      }),
    ).toBeNull();

    // Île d'ancrage / blueprint / slot inconnus
    expect(
      validateSaveData({
        ...snap,
        ship: { ...snap.ship!, dockedIslandId: 'atlantis' },
      }),
    ).toBeNull();
    expect(
      validateSaveData({
        ...snap,
        ship: {
          ...snap.ship!,
          equippedBlueprints: { coque: 'canon_laser_hack' },
        },
      }),
    ).toBeNull();
    expect(
      validateSaveData({
        ...snap,
        ship: {
          ...snap.ship!,
          unlockedSlots: { ...snap.ship!.unlockedSlots, invalid_slot: true },
        },
      }),
    ).toBeNull();

    // Storage qui lève une exception (ex: quota dépassé)
    const throwingStorage: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(saveGame(snap, throwingStorage)).toBe(false);
    expect(loadGame(throwingStorage)).toBeNull();
    expect(deleteSaveData(throwingStorage)).toBe(false);
  });

  it('normalise tout mode transitoire du bateau lors de serializeGameState', () => {
    const engine = new GameEngine({ storage: createMemoryStorage() });
    engine.startNewGame();
    while (engine.state.dialogue.active) engine.advanceDialogue();

    // Boarding -> normalisé en 'parked' sur position terrestre
    engine.state.ship.mode = 'boarding';
    engine.state.ship.transition = {
      kind: 'boarding',
      elapsed: 0.1,
      duration: 0.42,
      targetIslandId: 'felingard',
      shipStartPos: { x: 0, z: 58 },
      shipTargetPos: { x: 0, z: 58 },
      shipStartAngle: 0,
      shipTargetAngle: 0,
      heroStartPos: { x: 0, z: 48 },
      heroStartY: 0,
      heroTargetPos: { x: 0, z: 58 },
      heroTargetY: 0.42,
      companionStartPos: { x: -1, z: 47 },
      companionStartY: 0,
      companionTargetPos: { x: -1, z: 58 },
      companionTargetY: 0.56,
      arcHeight: 1.5,
    };
    const snapBoarding = serializeGameState(engine.state);
    expect(snapBoarding.ship?.mode).toBe('parked');
    expect(snapBoarding.player.position).toEqual({ x: 0, z: 48 });
    expect(validateSaveData(snapBoarding)).not.toBeNull();

    // Docking -> normalisé en 'sailing'
    engine.state.ship.mode = 'docking';
    engine.state.ship.position = { x: 64, z: 32 };
    const snapDocking = serializeGameState(engine.state);
    expect(snapDocking.ship?.mode).toBe('sailing');
    expect(snapDocking.ship?.dockedIslandId).toBeNull();
    expect(snapDocking.player.position).toEqual({ x: 64, z: 32 });
    expect(validateSaveData(snapDocking)).not.toBeNull();

    // Disembarking -> normalisé en 'parked' sur l'île cible au point d'atterrissage
    engine.state.ship.mode = 'disembarking';
    engine.state.ship.transition = {
      ...engine.state.ship.transition,
      kind: 'disembarking',
      targetIslandId: 'tropical',
      landingPos: { x: 74, z: 40 },
    };
    const snapDisembark = serializeGameState(engine.state);
    expect(snapDisembark.ship?.mode).toBe('parked');
    expect(snapDisembark.islandId).toBe('tropical');
    expect(snapDisembark.ship?.dockedIslandId).toBe('tropical');
    expect(snapDisembark.player.position).toEqual({ x: 74, z: 40 });
    expect(validateSaveData(snapDisembark)).not.toBeNull();
  });

  it('persiste, valide et migre les préférences audio 4 bus sous felingard_audio_prefs_v1', () => {
    const storage = createMemoryStorage();

    // Par défaut (6 champs + master/volume unifié à 0.85)
    expect(loadAudioPrefs(storage)).toEqual(DEFAULT_AUDIO_PREFS);
    expect(DEFAULT_AUDIO_PREFS.master).toBe(0.85);
    expect(DEFAULT_AUDIO_PREFS.volume).toBe(0.85);

    // Sauvegarde + clamp volumes [0, 1] & synchronisation master/volume
    expect(
      saveAudioPrefs(
        {
          muted: true,
          volume: 1.5,
          master: 1.5,
          music: 0.45,
          sfx: 1.2,
          ambience: -0.1,
        },
        storage,
      ),
    ).toBe(true);
    expect(storage.getItem(AUDIO_PREFS_STORAGE_KEY)).not.toBeNull();
    expect(loadAudioPrefs(storage)).toEqual({
      muted: true,
      volume: 1,
      master: 1,
      music: 0.45,
      sfx: 1,
      ambience: 0,
    });

    // Migration silencieuse de l'ancien format { muted, volume }
    storage.setItem(
      AUDIO_PREFS_STORAGE_KEY,
      JSON.stringify({ muted: false, volume: 0.5 }),
    );
    expect(loadAudioPrefs(storage)).toEqual({
      muted: false,
      volume: 0.5,
      master: 0.5,
      music: 1,
      sfx: 1,
      ambience: 1,
    });

    // Préserve les bus valides même si master/volume sont null ou absents
    storage.setItem(
      AUDIO_PREFS_STORAGE_KEY,
      JSON.stringify({
        muted: false,
        master: null,
        music: 0.3,
        sfx: 0.4,
        ambience: 0.5,
      }),
    );
    expect(loadAudioPrefs(storage)).toEqual({
      muted: false,
      volume: 0.85,
      master: 0.85,
      music: 0.3,
      sfx: 0.4,
      ambience: 0.5,
    });

    storage.setItem(
      AUDIO_PREFS_STORAGE_KEY,
      JSON.stringify({
        muted: true,
        music: 0.2,
        sfx: 0.6,
        ambience: 0.1,
      }),
    );
    expect(loadAudioPrefs(storage)).toEqual({
      muted: true,
      volume: 0.85,
      master: 0.85,
      music: 0.2,
      sfx: 0.6,
      ambience: 0.1,
    });

    // Rejette les payloads sans booléen muted ou non-objets
    storage.setItem(
      AUDIO_PREFS_STORAGE_KEY,
      JSON.stringify({ music: 0.3, sfx: 0.4 }),
    );
    expect(loadAudioPrefs(storage)).toEqual(DEFAULT_AUDIO_PREFS);
    storage.setItem(AUDIO_PREFS_STORAGE_KEY, '[1, 2, 3]');
    expect(loadAudioPrefs(storage)).toEqual(DEFAULT_AUDIO_PREFS);

    // Résilience JSON corrompu
    storage.setItem(AUDIO_PREFS_STORAGE_KEY, 'not-json');
    expect(loadAudioPrefs(storage)).toEqual(DEFAULT_AUDIO_PREFS);
  });
});
