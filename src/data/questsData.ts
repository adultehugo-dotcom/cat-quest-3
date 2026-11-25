import type { DialogueLine, QuestDefinition, QuestId } from '../game/types';

export const QUESTS: Record<QuestId, QuestDefinition> = {
  main_dragon_blood: {
    id: 'main_dragon_blood',
    title: "L'Éveil du Sang-de-Dragon",
    isMain: true,
    recommendedLevel: 1,
    summary:
      'Drak-Miaou le Dragon-Griffe sème la terreur depuis les Monts Prr-Glacés. Réveillez votre héritage félin et sauvez Félingard !',
    steps: [
      {
        id: 'main_act_1',
        title: 'Acte 1 — Audiences à Miaou-bourg',
        description: 'Parler au Maire Moustache au sud de la place de Miaou-bourg.',
        objectiveType: 'talk_npc',
        targetId: 'mayor_moustache',
        requiredCount: 1,
        targetZoneId: 'overworld',
        targetPos: { x: -2, z: 26 },
        stepReward: { xp: 40, gold: 60 },
      },
      {
        id: 'main_act_2',
        title: 'Acte 2 — La Clé de la Grotte',
        description:
          'Explorer la Grotte des Souris-Fantômes (Est des Plaines, Niv. 2), vaincre le Roi Rat-Spectre et récupérer la Clé Runique.',
        objectiveType: 'defeat_boss',
        targetId: 'boss_rat_king',
        requiredCount: 1,
        targetZoneId: 'dungeon_ghost_cave',
        targetPos: { x: 0, z: -18 },
        overworldPortalPos: { x: 30, z: 4 },
        stepReward: { xp: 150, gold: 150, itemId: 'sword_steel' },
        onCompleteDialogue: [
          {
            speaker: 'Miaou-sprit',
            portraitId: 'miaou_sprit',
            text: "Purr-fait ! Le Roi Rat-Spectre est renvoyé dans son fromage spectral ! N'oublie pas d'ouvrir le Coffre Doré pour prendre la Clé Runique !",
          },
          {
            speaker: 'Miaou-sprit',
            portraitId: 'miaou_sprit',
            text: "Cap au Nord vers les Monts Prr-Glacés ! L'Antre du Dragon-Griffe nous attend — pense à forger un peu d'équipement chez Kit-Chat avant d'y aller !",
          },
        ],
      },
      {
        id: 'main_act_3',
        title: 'Acte 3 — Le Dragon-Griffe',
        description:
          "Traverser les Monts Prr-Glacés, ouvrir l'Antre du Dragon-Griffe (Nord, Niv. 5) et vaincre Drak-Miaou.",
        objectiveType: 'defeat_boss',
        targetId: 'boss_dragon_claw',
        requiredCount: 1,
        targetZoneId: 'dungeon_dragon_lair',
        targetPos: { x: 0, z: -11 },
        overworldPortalPos: { x: 8, z: -42 },
      },
    ],
    completionReward: {
      xp: 400,
      gold: 500,
      itemId: 'blade_dragon',
    },
  },

  side_yarn_hunt: {
    id: 'side_yarn_hunt',
    title: 'Chasse aux Pelotes',
    isMain: false,
    recommendedLevel: 1,
    summary:
      'Des Slime-Pelotes bondissent partout dans les Plaines de Miaou-Vert et emmêlent les moustaches des villageois !',
    steps: [
      {
        id: 'yarn_hunt_kill',
        title: 'Démêler les Plaines',
        description: 'Vaincre 5 Slime-Pelotes dans les Plaines de Miaou-Vert.',
        objectiveType: 'kill_enemy',
        targetId: 'slime_yarn',
        requiredCount: 5,
        targetZoneId: 'overworld',
        targetPos: { x: 20, z: 24 },
      },
    ],
    completionReward: {
      xp: 110,
      gold: 140,
      itemId: 'helm_knight',
    },
    acceptDialogue: [
      {
        speaker: 'Miaou-sprit',
        portraitId: 'miaou_sprit',
        text: "Une chasse aux Slime-Pelotes ! Facile comme attraper un point lumineux ! En plus, la récompense est un vrai Heaume de Chat-valier !",
      },
    ],
  },

  side_lost_blade: {
    id: 'side_lost_blade',
    title: "L'Épée Perdue du Bois Griffu",
    isMain: false,
    recommendedLevel: 3,
    summary:
      'Un ancien chevalier félin a caché son trésor tout au fond du Bois Griffu, sous la garde féroce des Loups-Épines.',
    steps: [
      {
        id: 'lost_blade_chest',
        title: 'Le Coffre du Bois Griffu',
        description:
          'Trouver et ouvrir le coffre ancien caché au nord-ouest du Bois Griffu.',
        objectiveType: 'open_chest',
        targetId: 'chest_forest_lost_blade',
        requiredCount: 1,
        targetZoneId: 'overworld',
        targetPos: { x: -38, z: -22 },
      },
    ],
    completionReward: {
      xp: 180,
      gold: 200,
      itemId: 'staff_arcane',
    },
    acceptDialogue: [
      {
        speaker: 'Miaou-sprit',
        portraitId: 'miaou_sprit',
        text: "Ouh, le Bois Griffu à l'Ouest donne la chair de poule... enfin, de chat ! Prépare tes esquives contre les Loups-Épines !",
      },
    ],
  },
};

export const QUEST_LIST: QuestDefinition[] = [
  QUESTS.main_dragon_blood,
  QUESTS.side_yarn_hunt,
  QUESTS.side_lost_blade,
];

export function getQuestDefinition(id: QuestId): QuestDefinition {
  return QUESTS[id];
}

// ============================================================================
// Dialogues VF pleins d'humour félin
// ============================================================================

export const INTRO_DIALOGUE: DialogueLine[] = [
  {
    speaker: 'Miaou-sprit',
    portraitId: 'miaou_sprit',
    text: "Miaou-jour, jeune Chat-valier ! Je suis Miaou-sprit, ton guide astral garanti sans boules de poils !",
  },
  {
    speaker: 'Miaou-sprit',
    portraitId: 'miaou_sprit',
    text: "Félingard est en grand danger : suis ma flèche dorée et va vite parler au Maire Moustache juste à côté de nous !",
  },
];

export const MAYOR_DIALOGUES: Record<
  'act1' | 'act2' | 'act3' | 'postVictory',
  DialogueLine[]
> = {
  act1: [
    {
      speaker: 'Maire Moustache',
      portraitId: 'mayor_moustache',
      text: "Ah, enfin un aventurier aux griffes affûtées ! Par mes moustaches, c'est une véritable chat-astrophe !",
    },
    {
      speaker: 'Maire Moustache',
      portraitId: 'mayor_moustache',
      text: "Drak-Miaou, le terrible Dragon-Griffe, s'est réveillé dans les Monts Prr-Glacés au Nord et a scellé son antre d'une barrière runique !",
    },
    {
      speaker: 'Miaou-sprit',
      portraitId: 'miaou_sprit',
      text: "Oh ! Le Sang-de-Dragon coule dans tes veines, héros ! Mais sans la Clé Runique, cette barrière ne nous laissera même pas passer une vibrisse.",
    },
    {
      speaker: 'Maire Moustache',
      portraitId: 'mayor_moustache',
      text: "Exactement ! Le Roi Rat-Spectre a volé la Clé Runique dans la Grotte des Souris-Fantômes, à l'Est des Plaines. Prends ces pièces, consulte le Panneau de Quêtes, et bonne chasse !",
    },
  ],
  act2: [
    {
      speaker: 'Maire Moustache',
      portraitId: 'mayor_moustache',
      text: "La Grotte des Souris-Fantômes se trouve à l'Est des Plaines de Miaou-Vert. Pense à frapper au corps-à-corps pour recharger ton mana, et fais une sieste à l'Auberge si besoin !",
    },
  ],
  act3: [
    {
      speaker: 'Maire Moustache',
      portraitId: 'mayor_moustache',
      text: "Incroyable, tu as vaincu le Roi Rat-Spectre ! Avec la Clé Runique en patte, tu peux maintenant forcer l'Antre du Dragon-Griffe dans les Monts Prr-Glacés au Nord !",
    },
    {
      speaker: 'Miaou-sprit',
      portraitId: 'miaou_sprit',
      text: "Un petit détour par la Forge de Kit-Chat pour améliorer tes sorts ne fera pas de mal avant d'affronter Drak-Miaou !",
    },
  ],
  postVictory: [
    {
      speaker: 'Maire Moustache',
      portraitId: 'mayor_moustache',
      text: "Gloire à toi, Légende de Félingard ! Grâce à ton courage, nos siestes au soleil sont de nouveau purr-faitement paisibles !",
    },
  ],
};

export const SEALED_DRAGON_LAIR_DIALOGUE: DialogueLine[] = [
  {
    speaker: 'Miaou-sprit',
    portraitId: 'miaou_sprit',
    text: "Halte-là, moustache brûlée ! Une barrière runique scelle l'Antre du Dragon-Griffe !",
  },
  {
    speaker: 'Miaou-sprit',
    portraitId: 'miaou_sprit',
    text: "Il nous faut la Clé Runique ! Direction la Grotte des Souris-Fantômes à l'Est des Plaines de Miaou-Vert (Niv. 2) pour la reprendre au Roi Rat-Spectre !",
  },
];

export const BOSS_DRAGON_PHASE2_DIALOGUE: DialogueLine[] = [
  {
    speaker: 'Drak-Miaou, Dragon-Griffe',
    portraitId: 'boss_dragon_claw',
    text: 'Grr-miaou ! Tu oses ébouriffer mes écailles ?! Goûte à ma fureur draconique !',
  },
];

export const VICTORY_DIALOGUE: DialogueLine[] = [
  {
    speaker: 'Drak-Miaou, Dragon-Griffe',
    portraitId: 'boss_dragon_claw',
    text: 'Miaaaou... Mes écailles... Vaincu par un si petit chat-valier... Tu mérites vraiment le titre de Sang-de-Dragon...',
  },
  {
    speaker: 'Miaou-sprit',
    portraitId: 'miaou_sprit',
    text: 'HOURRA-MIAOU !! Drak-Miaou est vaincu et Félingard est sauvé ! Tu entres officiellement dans Les Chroniques de Félingard !',
  },
];

export const INN_REST_MESSAGE =
  'Zzz... Ronron... Miaou ! PV & PM restaurés à 100 % et partie sauvegardée !';
