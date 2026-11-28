import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/gameEngine';
import { createEmptyInputState } from '../src/game/input';
import { createInitialPlayerState } from '../src/game/progression';
import {
  acceptQuest,
  computeQuestTarget,
  createInitialQuests,
  onChestOpenedForQuests,
  onEnemyDefeated,
  onNpcTalked,
} from '../src/game/quests';
import { createMemoryStorage } from '../src/game/saveSystem';
import type { GameEvent } from '../src/game/types';

describe('Quêtes — Quête Principale (3 Actes), Secondaires & Flèche Dorée', () => {
  it('fait progresser les 3 actes de la quête principale et distribue toutes les récompenses', () => {
    const player = createInitialPlayerState();
    const quests = createInitialQuests();
    const events: GameEvent[] = [];

    expect(quests.main_dragon_blood.status).toBe('active');
    expect(quests.main_dragon_blood.stepIndex).toBe(0);

    // Flèche en Overworld sur Acte 1 -> Maire Moustache (-2, 26)
    const targetAct1 = computeQuestTarget(quests, 'main_dragon_blood', 'overworld');
    expect(targetAct1).toMatchObject({
      questId: 'main_dragon_blood',
      zoneId: 'overworld',
      x: -2,
      z: 26,
      isPortalRedirect: false,
    });

    // Acte 1 : Parler au Maire Moustache (+40 XP, +60 Or)
    onNpcTalked(quests, 'mayor_moustache', player, events);
    expect(quests.main_dragon_blood.stepIndex).toBe(1);
    expect(player.gold).toBe(60);
    expect(player.xp).toBe(40);

    // Flèche Acte 2 depuis Overworld -> redirige vers l'entrée de la Grotte (30, 4)
    const targetAct2Overworld = computeQuestTarget(
      quests,
      'main_dragon_blood',
      'overworld',
    );
    expect(targetAct2Overworld).toMatchObject({
      zoneId: 'overworld',
      x: 30,
      z: 4,
      isPortalRedirect: true,
    });

    // Flèche Acte 2 DANS la Grotte -> pointe directement vers le Roi Rat-Spectre (0, -18)
    const targetAct2Dungeon = computeQuestTarget(
      quests,
      'main_dragon_blood',
      'dungeon_ghost_cave',
    );
    expect(targetAct2Dungeon).toMatchObject({
      zoneId: 'dungeon_ghost_cave',
      x: 0,
      z: -18,
      isPortalRedirect: false,
    });

    // Acte 2 : Vaincre le Roi Rat-Spectre (+150 XP, +150 Or, sword_steel)
    const act2Res = onEnemyDefeated(quests, 'boss_rat_king', player, events);
    expect(quests.main_dragon_blood.stepIndex).toBe(2);
    expect(player.gold).toBe(210);
    expect(player.inventory.sword_steel).toBeDefined();
    expect(act2Res.dialogues.length).toBeGreaterThan(0);

    // Dans la Grotte sans Clé Runique -> la flèche pointe vers le Coffre Doré (0, -22)
    const targetKeyChest = computeQuestTarget(
      quests,
      'main_dragon_blood',
      'dungeon_ghost_cave',
      { hasRunicKey: false, defeatedBossIds: ['boss_rat_king'] },
    );
    expect(targetKeyChest).toMatchObject({
      zoneId: 'dungeon_ghost_cave',
      x: 0,
      z: -22,
      isPortalRedirect: false,
    });

    // Flèche Acte 3 depuis Overworld -> redirige vers l'Antre du Dragon-Griffe (8, -42)
    const targetAct3Overworld = computeQuestTarget(
      quests,
      'main_dragon_blood',
      'overworld',
    );
    expect(targetAct3Overworld).toMatchObject({
      zoneId: 'overworld',
      x: 8,
      z: -42,
      isPortalRedirect: true,
    });

    // Flèche Acte 3 DANS l'Antre -> pointe directement vers Drak-Miaou (0, -11)
    const targetAct3Lair = computeQuestTarget(
      quests,
      'main_dragon_blood',
      'dungeon_dragon_lair',
    );
    expect(targetAct3Lair).toMatchObject({
      zoneId: 'dungeon_dragon_lair',
      x: 0,
      z: -11,
      isPortalRedirect: false,
    });

    // Acte 3 : Vaincre Drak-Miaou (+400 XP, +500 Or, blade_dragon, quête terminée)
    const act3Res = onEnemyDefeated(quests, 'boss_dragon_claw', player, events);
    expect(act3Res.completedQuestIds).toContain('main_dragon_blood');
    expect(quests.main_dragon_blood.status).toBe('completed');
    expect(player.gold).toBe(710);
    expect(player.inventory.blade_dragon).toBeDefined();
    expect(events.some((e) => e.type === 'quest_completed')).toBe(true);
  });

  it('gère les 2 quêtes secondaires (Chasse aux Pelotes & Épée Perdue du Bois Griffu)', () => {
    const player = createInitialPlayerState();
    const quests = createInitialQuests();
    const events: GameEvent[] = [];

    // Quête secondaire 1 : Chasse aux Pelotes (5 Slime-Pelotes)
    const acc1 = acceptQuest(quests, 'side_yarn_hunt', player, events);
    expect(acc1.accepted).toBe(true);
    expect(quests.side_yarn_hunt.status).toBe('active');

    for (let i = 0; i < 4; i++) {
      onEnemyDefeated(quests, 'slime_yarn', player, events);
    }
    expect(quests.side_yarn_hunt.status).toBe('active');
    expect(quests.side_yarn_hunt.counter).toBe(4);

    // 5e slime termine la quête -> +110 XP, +140 Or, helm_knight
    onEnemyDefeated(quests, 'slime_yarn', player, events);
    expect(quests.side_yarn_hunt.status).toBe('completed');
    expect(player.inventory.helm_knight).toBeDefined();
    expect(player.gold).toBe(140);

    // Quête secondaire 2 : Coffre du Bois Griffu (-38, -22)
    acceptQuest(quests, 'side_lost_blade', player, events);
    const targetSide2 = computeQuestTarget(quests, 'side_lost_blade', 'overworld');
    expect(targetSide2).toMatchObject({
      questId: 'side_lost_blade',
      x: -38,
      z: -22,
      isPortalRedirect: false,
    });

    // Si le joueur est dans un donjon alors qu'il suit une quête Overworld -> pointe vers la sortie
    const targetFromDungeon = computeQuestTarget(
      quests,
      'side_lost_blade',
      'dungeon_ghost_cave',
    );
    expect(targetFromDungeon).toMatchObject({
      zoneId: 'dungeon_ghost_cave',
      x: 0,
      z: 22,
      isPortalRedirect: true,
    });

    onChestOpenedForQuests(quests, 'chest_forest_lost_blade', player, events);
    expect(quests.side_lost_blade.status).toBe('completed');
    expect(player.inventory.staff_arcane).toBeDefined();
    expect(player.gold).toBe(340);
  });

  it('valide la priorité [E] sur Sort 2, la barrière runique, et la boucle complète GameEngine', () => {
    const storage = createMemoryStorage();
    const engine = new GameEngine({ storage, rng: () => 0.5 });

    engine.startNewGame();
    // Ferme le dialogue d'intro (2 lignes)
    engine.advanceDialogue();
    engine.advanceDialogue();
    expect(engine.state.dialogue.active).toBe(false);

    // Place le héros devant Maire Moustache et simule appui sur [E] (interactPressed + lightnyan)
    engine.state.player.x = -2;
    engine.state.player.z = 25;
    const mpBefore = engine.state.player.mp;
    const input = createEmptyInputState();
    input.interactPressed = true;
    input.spellPressed.lightnyan = true;
    engine.step(0.016, input);

    // L'interaction avec le Maire a priorité : dialogue lancé et AUCUN mana dépensé pour Sort 2 !
    expect(engine.state.dialogue.active).toBe(true);
    expect(engine.state.player.mp).toBe(mpBefore);

    // Termine le dialogue -> Acte 1 validé
    while (engine.state.dialogue.active) {
      engine.advanceDialogue();
    }
    expect(engine.state.quests.main_dragon_blood.stepIndex).toBe(1);

    // Approche de l'Antre du Dragon sans Clé Runique -> barrière bloque l'entrée !
    engine.state.player.x = 8;
    engine.state.player.z = -41;
    engine.triggerInteraction();
    expect(engine.state.zoneId).toBe('overworld');
    expect(engine.state.dialogue.active).toBe(true);
    while (engine.state.dialogue.active) engine.advanceDialogue();

    // Entrée Grotte des Souris-Fantômes -> combat Roi Rat-Spectre -> Coffre Doré -> Clé Runique
    engine.state.player.x = 30;
    engine.state.player.z = 4.5;
    engine.triggerInteraction();
    expect(engine.state.zoneId).toBe('dungeon_ghost_cave');

    const ratKing = engine.state.enemies.find((e) => e.typeId === 'boss_rat_king')!;
    expect(ratKing).toBeDefined();
    // Achève le Roi Rat-Spectre d'un coup mêlée
    ratKing.hp = 1;
    engine.state.player.x = ratKing.x - 1.2;
    engine.state.player.z = ratKing.z;
    engine.state.player.aimAngle = 0;
    const atkInput = createEmptyInputState();
    atkInput.attackPressed = true;
    engine.step(0.016, atkInput);

    expect(engine.state.defeatedBossIds).toContain('boss_rat_king');
    expect(engine.state.quests.main_dragon_blood.stepIndex).toBe(2);
    while (engine.state.dialogue.active) engine.advanceDialogue();

    // Ouvre le Coffre Doré déverrouillé -> Clé Runique obtenue !
    expect(engine.openChest('chest_ghost_cave_key')).toBe(true);
    expect(engine.state.player.hasRunicKey).toBe(true);

    // Retour Overworld puis entrée dans l'Antre du Dragon-Griffe désormais autorisée !
    engine.loadZone('overworld', { x: 8, z: -41 });
    engine.triggerInteraction();
    expect(engine.state.zoneId).toBe('dungeon_dragon_lair');

    // Défaite du Boss Dragon -> dialogue de victoire -> écran Victoire !
    const dragon = engine.state.enemies.find((e) => e.typeId === 'boss_dragon_claw')!;
    dragon.hp = 1;
    engine.state.player.x = dragon.x - 1.5;
    engine.state.player.z = dragon.z;
    engine.state.player.aimAngle = 0;
    engine.state.player.attackCooldown = 0;
    engine.step(0.016, atkInput);

    expect(engine.state.defeatedBossIds).toContain('boss_dragon_claw');
    expect(engine.state.quests.main_dragon_blood.status).toBe('completed');
    const idle = createEmptyInputState();
    for (let i = 0; i < 100 && engine.state.cinematic !== null; i++) {
      engine.step(0.05, idle);
    }
    expect(engine.state.cinematic).toBeNull();
    while (engine.state.dialogue.active) engine.advanceDialogue();
    expect(engine.state.screen).toBe('victory');

    // Continuer après la victoire
    engine.continueAfterVictory();
    expect(engine.state.screen).toBe('playing');

    // Test Défaite -> Réveil à l'Auberge sans perte de progression
    const goldBeforeDeath = engine.state.player.gold;
    const levelBeforeDeath = engine.state.player.level;
    engine.state.player.hp = 0;
    engine.state.screen = 'defeat';
    engine.respawnAtInn();
    expect(engine.state.screen).toBe('playing');
    expect(engine.state.zoneId).toBe('overworld');
    expect(engine.state.player.hp).toBe(engine.state.player.maxHp);
    expect(engine.state.player.gold).toBe(goldBeforeDeath);
    expect(engine.state.player.level).toBe(levelBeforeDeath);
  });
});
