// ============================================================================
// Machine à états des Quêtes, Récompenses & Calcul de la Flèche Dorée
// Zéro import Three.js, zéro dépendance DOM.
// ============================================================================

import { DUNGEONS } from '../data/dungeonsData';
import { QUESTS, QUEST_LIST, getQuestDefinition } from '../data/questsData';
import { addEquipment, grantXp } from './progression';
import type {
  DialogueLine,
  EnemyTypeId,
  GameEvent,
  PlayerState,
  QuestId,
  QuestObjectiveType,
  QuestProgress,
  QuestReward,
  QuestStepDef,
  QuestTargetMarker,
  ZoneId,
} from './types';

export interface QuestAdvanceResult {
  updatedQuestIds: QuestId[];
  completedQuestIds: QuestId[];
  dialogues: DialogueLine[][];
}

/**
 * Initialise l'état des 3 quêtes (la quête principale démarre active dès le début).
 */
export function createInitialQuests(): Record<QuestId, QuestProgress> {
  return {
    main_dragon_blood: {
      id: 'main_dragon_blood',
      status: 'active',
      stepIndex: 0,
      counter: 0,
    },
    side_yarn_hunt: {
      id: 'side_yarn_hunt',
      status: 'available',
      stepIndex: 0,
      counter: 0,
    },
    side_lost_blade: {
      id: 'side_lost_blade',
      status: 'available',
      stepIndex: 0,
      counter: 0,
    },
  };
}

/**
 * Retourne la définition de l'étape en cours pour une quête active, ou null.
 */
export function getCurrentQuestStep(progress: QuestProgress): QuestStepDef | null {
  if (progress.status !== 'active') return null;
  const def = getQuestDefinition(progress.id);
  return def.steps[progress.stepIndex] ?? null;
}

/**
 * Verse une récompense de quête (Or, XP, Équipement avec gestion doublon).
 */
export function applyQuestReward(
  player: PlayerState,
  reward: QuestReward,
  events?: GameEvent[],
): void {
  if (reward.gold > 0) {
    player.gold += reward.gold;
  }
  if (reward.xp > 0) {
    grantXp(player, reward.xp, events);
  }
  if (reward.itemId) {
    addEquipment(player, reward.itemId, events);
  }
}

/**
 * Accepte une quête secondaire disponible sur le Panneau de Quêtes.
 * Vérifie aussi si l'objectif (ex: coffre déjà ouvert) a déjà été accompli avant l'acceptation.
 */
export function acceptQuest(
  quests: Record<QuestId, QuestProgress>,
  questId: QuestId,
  player: PlayerState,
  events?: GameEvent[],
  context?: {
    openedChestIds?: string[];
    defeatedBossIds?: EnemyTypeId[];
  },
): {
  accepted: boolean;
  completedImmediately: boolean;
  acceptDialogue?: DialogueLine[];
} {
  const progress = quests[questId];
  if (!progress || progress.status !== 'available') {
    return { accepted: false, completedImmediately: false };
  }

  const def = getQuestDefinition(questId);
  progress.status = 'active';
  progress.stepIndex = 0;
  progress.counter = 0;

  events?.push({
    type: 'quest_updated',
    questId,
    text: `Nouvelle quête : ${def.title}`,
  });

  // Vérification rétroactive anti-blocage (ex: coffre du Bois Griffu déjà ouvert)
  let completedImmediately = false;
  const firstStep = def.steps[0];
  if (firstStep) {
    if (
      firstStep.objectiveType === 'open_chest' &&
      context?.openedChestIds?.includes(firstStep.targetId)
    ) {
      const res = advanceQuestsForObjective(
        quests,
        'open_chest',
        firstStep.targetId,
        player,
        events,
      );
      completedImmediately = res.completedQuestIds.includes(questId);
    } else if (
      firstStep.objectiveType === 'defeat_boss' &&
      context?.defeatedBossIds?.includes(firstStep.targetId as EnemyTypeId)
    ) {
      const res = advanceQuestsForObjective(
        quests,
        'defeat_boss',
        firstStep.targetId,
        player,
        events,
      );
      completedImmediately = res.completedQuestIds.includes(questId);
    }
  }

  return {
    accepted: true,
    completedImmediately,
    acceptDialogue: completedImmediately ? undefined : def.acceptDialogue,
  };
}

/**
 * Fait avancer toutes les quêtes actives correspondant à l'objectif accompli.
 */
export function advanceQuestsForObjective(
  quests: Record<QuestId, QuestProgress>,
  objectiveType: QuestObjectiveType,
  targetId: string,
  player: PlayerState,
  events?: GameEvent[],
  amount = 1,
): QuestAdvanceResult {
  const updatedQuestIds: QuestId[] = [];
  const completedQuestIds: QuestId[] = [];
  const dialogues: DialogueLine[][] = [];

  for (const def of QUEST_LIST) {
    const progress = quests[def.id];
    if (!progress || progress.status !== 'active') continue;

    const step = def.steps[progress.stepIndex];
    if (!step) continue;

    if (step.objectiveType !== objectiveType || step.targetId !== targetId) {
      continue;
    }

    progress.counter = Math.min(step.requiredCount, progress.counter + amount);
    updatedQuestIds.push(def.id);

    if (progress.counter >= step.requiredCount) {
      // Récompense d'étape intermédiaire éventuelle
      if (step.stepReward) {
        applyQuestReward(player, step.stepReward, events);
      }

      if (step.onCompleteDialogue && step.onCompleteDialogue.length > 0) {
        dialogues.push(step.onCompleteDialogue);
      }

      if (progress.stepIndex + 1 < def.steps.length) {
        progress.stepIndex += 1;
        progress.counter = 0;
        const nextStep = def.steps[progress.stepIndex];
        events?.push({
          type: 'quest_updated',
          questId: def.id,
          text: `Quête mise à jour : ${nextStep.title}`,
        });
      } else {
        progress.status = 'completed';
        applyQuestReward(player, def.completionReward, events);
        completedQuestIds.push(def.id);
        events?.push({
          type: 'quest_completed',
          questId: def.id,
          text: `Quête terminée : ${def.title} !`,
        });
      }
    } else {
      events?.push({
        type: 'quest_updated',
        questId: def.id,
        text: `${def.title} (${progress.counter}/${step.requiredCount})`,
      });
    }
  }

  return { updatedQuestIds, completedQuestIds, dialogues };
}

export function onNpcTalked(
  quests: Record<QuestId, QuestProgress>,
  npcId: string,
  player: PlayerState,
  events?: GameEvent[],
): QuestAdvanceResult {
  return advanceQuestsForObjective(quests, 'talk_npc', npcId, player, events, 1);
}

export function onEnemyDefeated(
  quests: Record<QuestId, QuestProgress>,
  enemyTypeId: EnemyTypeId,
  player: PlayerState,
  events?: GameEvent[],
): QuestAdvanceResult {
  const killRes = advanceQuestsForObjective(
    quests,
    'kill_enemy',
    enemyTypeId,
    player,
    events,
    1,
  );
  const bossRes = advanceQuestsForObjective(
    quests,
    'defeat_boss',
    enemyTypeId,
    player,
    events,
    1,
  );

  return {
    updatedQuestIds: Array.from(
      new Set([...killRes.updatedQuestIds, ...bossRes.updatedQuestIds]),
    ),
    completedQuestIds: Array.from(
      new Set([...killRes.completedQuestIds, ...bossRes.completedQuestIds]),
    ),
    dialogues: [...killRes.dialogues, ...bossRes.dialogues],
  };
}

export function onChestOpenedForQuests(
  quests: Record<QuestId, QuestProgress>,
  chestId: string,
  player: PlayerState,
  events?: GameEvent[],
): QuestAdvanceResult {
  return advanceQuestsForObjective(
    quests,
    'open_chest',
    chestId,
    player,
    events,
    1,
  );
}

/**
 * Sélectionne une quête suivie valide (conserve l'actuelle si toujours active, sinon la première active).
 */
export function pickTrackedQuestId(
  quests: Record<QuestId, QuestProgress>,
  currentTrackedId: QuestId | null,
): QuestId | null {
  if (currentTrackedId && quests[currentTrackedId]?.status === 'active') {
    return currentTrackedId;
  }
  if (quests.main_dragon_blood.status === 'active') {
    return 'main_dragon_blood';
  }
  for (const def of QUEST_LIST) {
    if (quests[def.id].status === 'active') {
      return def.id;
    }
  }
  return null;
}

/**
 * Calcule la position cible temps réel de la flèche dorée directionnelle.
 * - Depuis l'Overworld, si la cible est dans un donjon, pointe vers l'entrée du donjon (`overworldPortalPos`).
 * - Dans le donjon cible, pointe directement vers le boss ou coffre objectif (`targetPos`).
 * - Si le joueur est dans la Grotte des Souris-Fantômes après avoir battu le Roi Rat-Spectre mais sans Clé Runique,
 *   pointe vers le Coffre Doré pour ne pas l'oublier !
 * - Si le joueur est dans un autre donjon que la cible, pointe vers le portail de sortie du donjon courant.
 */
export function computeQuestTarget(
  quests: Record<QuestId, QuestProgress>,
  trackedQuestId: QuestId | null,
  currentZoneId: ZoneId,
  options?: {
    hasRunicKey?: boolean;
    defeatedBossIds?: EnemyTypeId[];
  },
): QuestTargetMarker | null {
  const effectiveId = pickTrackedQuestId(quests, trackedQuestId);
  if (!effectiveId) return null;

  const progress = quests[effectiveId];
  const def = QUESTS[effectiveId];
  const step = getCurrentQuestStep(progress);
  if (!step) return null;

  // Cas spécial pratique : dans la Grotte après défaite du Roi Rat-Spectre sans avoir pris la Clé Runique
  if (
    effectiveId === 'main_dragon_blood' &&
    currentZoneId === 'dungeon_ghost_cave' &&
    options?.hasRunicKey === false &&
    options?.defeatedBossIds?.includes('boss_rat_king')
  ) {
    const keyChest = DUNGEONS.dungeon_ghost_cave.chests.find(
      (c) => c.loot.grantsRunicKey,
    );
    if (keyChest) {
      return {
        questId: effectiveId,
        label: 'Récupérer la Clé Runique (Coffre Doré)',
        zoneId: 'dungeon_ghost_cave',
        x: keyChest.x,
        z: keyChest.z,
        isPortalRedirect: false,
      };
    }
  }

  // Même zone : cible directe
  if (step.targetZoneId === currentZoneId) {
    return {
      questId: effectiveId,
      label: step.title || def.title,
      zoneId: currentZoneId,
      x: step.targetPos.x,
      z: step.targetPos.z,
      isPortalRedirect: false,
    };
  }

  // En Overworld mais la cible est dans un donjon : redirige vers le portail d'entrée du donjon
  if (currentZoneId === 'overworld' && step.targetZoneId !== 'overworld') {
    const portalPos = step.overworldPortalPos ?? step.targetPos;
    const targetDungeon = DUNGEONS[step.targetZoneId];
    return {
      questId: effectiveId,
      label: `Entrer : ${targetDungeon.name}`,
      zoneId: 'overworld',
      x: portalPos.x,
      z: portalPos.z,
      isPortalRedirect: true,
    };
  }

  // Dans un donjon mais la cible est ailleurs (Overworld ou l'autre donjon) : pointe vers la sortie
  if (currentZoneId !== 'overworld') {
    const exit = DUNGEONS[currentZoneId].exitPortal;
    return {
      questId: effectiveId,
      label: exit.label,
      zoneId: currentZoneId,
      x: exit.x,
      z: exit.z,
      isPortalRedirect: true,
    };
  }

  return null;
}
