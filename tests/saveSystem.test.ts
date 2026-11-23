import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/gameEngine';
import { addEquipment, equipItem, grantXp, upgradeSpell } from '../src/game/progression';
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
  type StorageLike,
} from '../src/game/saveSystem';
import { AUDIO_PREFS_STORAGE_KEY, SAVE_STORAGE_KEY } from '../src/game/types';

describe('SaveSystem — Persistance, Validation & Résilience JSON', () => {
  it('sauvegarde et recharge intégralement un GameState (équipements doublons, sorts, quêtes, clé runique)', () => {
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

    expect(engine1.saveCurrentGame()).toBe(true);
    expect(storage.getItem(SAVE_STORAGE_KEY)).not.toBeNull();
    expect(hasSaveData(storage)).toBe(true);

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

    // Suppression de la sauvegarde
    expect(deleteSaveData(storage)).toBe(true);
    expect(hasSaveData(storage)).toBe(false);
    expect(loadGame(storage)).toBeNull();
  });

  it('résiste gracieusement aux JSON corrompus, versions invalides et champs manquants', () => {
    const storage = createMemoryStorage();

    // JSON malformé
    storage.setItem(SAVE_STORAGE_KEY, '{corrupted_json:::');
    expect(loadGame(storage)).toBeNull();
    expect(hasSaveData(storage)).toBe(false);

    // Mauvaise version
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify({ version: 99, player: {} }));
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
        main_dragon_blood: { id: 'main_dragon_blood', status: 'hacked', stepIndex: 0, counter: 0 },
      },
    };
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(badQuest));
    expect(loadGame(storage)).toBeNull();

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

  it('persiste et valide les préférences audio sous felingard_audio_prefs_v1', () => {
    const storage = createMemoryStorage();

    // Par défaut
    expect(loadAudioPrefs(storage)).toEqual(DEFAULT_AUDIO_PREFS);

    // Sauvegarde + clamp volume [0, 1]
    expect(saveAudioPrefs({ muted: true, volume: 1.5 }, storage)).toBe(true);
    expect(storage.getItem(AUDIO_PREFS_STORAGE_KEY)).not.toBeNull();
    expect(loadAudioPrefs(storage)).toEqual({ muted: true, volume: 1 });

    // Résilience JSON corrompu
    storage.setItem(AUDIO_PREFS_STORAGE_KEY, 'not-json');
    expect(loadAudioPrefs(storage)).toEqual(DEFAULT_AUDIO_PREFS);
  });
});
