import { DUNGEONS } from '../data/dungeonsData';
import {
  EQUIPMENT,
  MYSTERY_CHEST_WEIGHTS,
  getEquipmentDefinition,
} from '../data/equipmentData';
import { QUEST_LIST } from '../data/questsData';
import {
  SPELL_LIST,
  getSpellPower,
  getSpellUpgradeCost,
} from '../data/spellsData';
import { OVERWORLD_DATA } from '../data/worldData';
import {
  ALL_NEW_ISLANDS,
  FELINGARD_DOCK_POS,
  NEW_ISLANDS,
} from '../data/worldIslands';
import {
  MAX_SPELL_LEVEL,
  MYSTERY_CHEST_COST,
  type ActiveModal,
  type EquipSlot,
  type EquipmentDefinition,
  type EquipmentStatBonuses,
  type GameState,
  type MysteryChestResult,
  type QuestId,
  type Rarity,
  type SpellId,
} from '../game/types';

export type ForgeTab = 'chest' | 'spells';
type InventoryFilter = 'all' | EquipSlot;
type MapLabelPlacement = 'below' | 'above' | 'below-offset' | 'above-offset';

interface MapStaticAnchor {
  left: number;
  top: number;
  el: HTMLDivElement;
  labelEl: HTMLSpanElement;
  dotEl: HTMLDivElement;
}

interface SimpleRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function getRectOverlapArea(a: SimpleRect, b: SimpleRect, pad = 0): number {
  const ox = Math.max(
    0,
    Math.min(a.right + pad, b.right + pad) - Math.max(a.left - pad, b.left - pad),
  );
  const oy = Math.max(
    0,
    Math.min(a.bottom + pad, b.bottom + pad) - Math.max(a.top - pad, b.top - pad),
  );
  return ox * oy;
}

export interface ModalsCallbacks {
  onClose: () => void;
  onEquipItem: (itemId: string) => void;
  onAcceptQuest: (questId: QuestId) => void;
  onTrackQuest: (questId: QuestId) => void;
  onBuyMysteryChest: () => MysteryChestResult | null;
  onUpgradeSpell: (spellId: SpellId) => boolean;
}

const SLOT_ORDER: Record<EquipSlot, number> = {
  weapon: 0,
  secondary_weapon: 1,
  shield: 2,
  helmet: 3,
  armor: 4,
  trinket: 5,
};

const SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: 'Arme',
  secondary_weapon: 'Arme secondaire',
  shield: 'Bouclier',
  helmet: 'Casque',
  armor: 'Armure',
  trinket: 'Babiole',
};

const RARITY_ORDER: Record<Rarity, number> = {
  epic: 0,
  rare: 1,
  common: 2,
};

const RARITY_LABELS: Record<Rarity, string> = {
  common: 'Commun',
  rare: 'Rare',
  epic: 'Épique',
};

const DEFAULT_HERO_PREVIEW_SVG = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <ellipse cx="64" cy="112" rx="34" ry="8" fill="rgba(0,0,0,0.22)"/>
    <path d="M40 72 L88 72 L94 106 L34 106 Z" fill="#4e9e48" stroke="#2b1e16" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M34 46 L42 18 L57 34 L71 34 L86 18 L94 46 C97 66 84 82 64 82 C44 82 31 66 34 46 Z" fill="#e98d3c" stroke="#2b1e16" stroke-width="3.5"/>
    <path d="M33 41 Q64 30 95 41 L93 50 Q64 40 35 50 Z" fill="#d93d3d" stroke="#2b1e16" stroke-width="2.5"/>
    <circle cx="51" cy="58" r="5" fill="#2b1e16"/>
    <circle cx="77" cy="58" r="5" fill="#2b1e16"/>
    <circle cx="52.5" cy="56.5" r="1.6" fill="#fff"/>
    <circle cx="78.5" cy="56.5" r="1.6" fill="#fff"/>
    <polygon points="64,64 59,69 69,69" fill="#d45555"/>
    <rect x="92" y="48" width="9" height="46" rx="3" fill="#b57b45" stroke="#2b1e16" stroke-width="2.8" transform="rotate(14 96 71)"/>
  </svg>`,
)}`;

interface ScaledItemStats {
  atk: number;
  mag: number;
  def: number;
  hp: number;
  mp: number;
  critPct: number;
}

function computeScaledStats(
  base: EquipmentStatBonuses,
  level: number,
): ScaledItemStats {
  const mult = 1 + 0.25 * Math.max(0, level - 1);
  return {
    atk: base.atk ? Math.round(base.atk * mult) : 0,
    mag: base.mag ? Math.round(base.mag * mult) : 0,
    def: base.def ? Math.round(base.def * mult) : 0,
    hp: base.hp ? Math.round(base.hp * mult) : 0,
    mp: base.mp ? Math.round(base.mp * mult) : 0,
    critPct: base.critChance ? Math.round(base.critChance * 100 * mult) : 0,
  };
}

function getEquipmentSvgMarkup(def: EquipmentDefinition): string {
  const { primaryColor, secondaryColor, accentColor } = def.visualStyle;
  switch (def.slot) {
    case 'weapon':
      if (def.visualStyle.shape === 'arcane_staff') {
        return `<svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true">
          <line x1="12" y1="38" x2="31" y2="19" stroke="${primaryColor}" stroke-width="6" stroke-linecap="round"/>
          <line x1="12" y1="38" x2="31" y2="19" stroke="#2b1e16" stroke-width="2" stroke-linecap="round"/>
          <polygon points="34,6 37,13 44,15 37,18 34,25 31,18 24,15 31,13" fill="${accentColor}" stroke="#2b1e16" stroke-width="2"/>
        </svg>`;
      }
      return `<svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M13 35 L36 8 L40 12 L17 39 Z" fill="${primaryColor}" stroke="#2b1e16" stroke-width="2.4" stroke-linejoin="round"/>
        <line x1="10" y1="28" x2="20" y2="38" stroke="${secondaryColor}" stroke-width="4.5" stroke-linecap="round"/>
        <circle cx="11" cy="37" r="3.5" fill="${accentColor}" stroke="#2b1e16" stroke-width="2"/>
      </svg>`;
    case 'secondary_weapon':
      return `<svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M12 36 L35 9 L39 13 L16 40 Z" fill="${primaryColor}" stroke="#2b1e16" stroke-width="2.4"/>
        <circle cx="11" cy="37" r="3" fill="${accentColor}" stroke="#2b1e16" stroke-width="2"/>
      </svg>`;
    case 'shield':
      return `<svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M24 6 L38 12 L36 31 Q33 39 24 43 Q15 39 12 31 L10 12 Z" fill="${primaryColor}" stroke="#2b1e16" stroke-width="2.6"/>
        <circle cx="24" cy="24" r="7" fill="${accentColor}" stroke="#2b1e16" stroke-width="2"/>
      </svg>`;
    case 'trinket':
      return `<svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="13" fill="${primaryColor}" stroke="#2b1e16" stroke-width="2.5"/>
        <path d="M24 11 Q31 16 24 24 Q17 32 24 37" fill="none" stroke="${accentColor}" stroke-width="3"/>
      </svg>`;
    case 'helmet':
      return `<svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M10 30 L14 13 L21 21 L27 21 L34 13 L38 30 C38 36 32 39 24 39 C16 39 10 36 10 30 Z" fill="${primaryColor}" stroke="#2b1e16" stroke-width="2.6" stroke-linejoin="round"/>
        <path d="M12 28 Q24 22 36 28" fill="none" stroke="${accentColor}" stroke-width="3.5" stroke-linecap="round"/>
      </svg>`;
    case 'armor':
      return `<svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M14 10 L20 14 L28 14 L34 10 L40 18 L35 24 L36 39 L12 39 L13 24 L8 18 Z" fill="${primaryColor}" stroke="#2b1e16" stroke-width="2.6" stroke-linejoin="round"/>
        <rect x="14" y="26" width="20" height="4.5" rx="2" fill="${accentColor}" stroke="#2b1e16" stroke-width="1.6"/>
        <path d="M20 14 L24 21 L28 14" fill="${secondaryColor}" stroke="#2b1e16" stroke-width="1.8"/>
      </svg>`;
  }
}

function getSpellIconSvg(spellId: SpellId): string {
  switch (spellId) {
    case 'flamepurr':
      return `<svg width="32" height="32" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M33 6 C42 18 52 25 50 40 C49 51 41 58 32 58 C21 58 14 50 14 39 C14 29 21 22 24 14 C26 19 29 21 30 16 Z" fill="#ff7d2b" stroke="#2b1e16" stroke-width="3"/>
        <path d="M32 30 C37 36 40 41 39 47 C38 52 35 54 32 54 C28 54 25 51 25 46 Z" fill="#fff4a3"/>
      </svg>`;
    case 'lightnyan':
      return `<svg width="32" height="32" viewBox="0 0 64 64" aria-hidden="true">
        <polygon points="38,6 15,35 30,35 24,58 49,27 34,27" fill="#ffe142" stroke="#2b1e16" stroke-width="3" stroke-linejoin="round"/>
      </svg>`;
    case 'freezepaw':
      return `<svg width="32" height="32" viewBox="0 0 64 64" aria-hidden="true">
        <g stroke="#7beeff" stroke-width="4" stroke-linecap="round">
          <line x1="32" y1="8" x2="32" y2="56"/>
          <line x1="11" y1="20" x2="53" y2="44"/>
          <line x1="53" y1="20" x2="11" y2="44"/>
        </g>
        <circle cx="32" cy="32" r="8" fill="#e5fbff" stroke="#2b1e16" stroke-width="2.5"/>
      </svg>`;
    case 'healing_paw':
      return `<svg width="32" height="32" viewBox="0 0 64 64" aria-hidden="true">
        <ellipse cx="20" cy="24" rx="6" ry="7.5" fill="#5ce67a" stroke="#2b1e16" stroke-width="2.6"/>
        <ellipse cx="32" cy="18" rx="6.2" ry="7.8" fill="#5ce67a" stroke="#2b1e16" stroke-width="2.6"/>
        <ellipse cx="44" cy="24" rx="6" ry="7.5" fill="#5ce67a" stroke="#2b1e16" stroke-width="2.6"/>
        <path d="M18 42 C18 33 25 29 32 29 C39 29 46 33 46 42 C46 50 40 54 32 54 C24 54 18 50 18 42 Z" fill="#5ce67a" stroke="#2b1e16" stroke-width="2.8"/>
        <path d="M32 36 V47 M26.5 41.5 H37.5" stroke="#ffffff" stroke-width="3.2" stroke-linecap="round"/>
      </svg>`;
  }
}

function worldToMapPercent(x: number, z: number): { left: number; top: number } {
  const minX = -135;
  const minZ = -140;
  const spanX = 270;
  const spanZ = 220;
  const left = Math.max(2, Math.min(98, ((x - minX) / spanX) * 100));
  const top = Math.max(2, Math.min(98, ((z - minZ) / spanZ) * 100));
  return { left, top };
}

function getOverworldPlayerPos(state: GameState): { x: number; z: number } {
  if (state.zoneId === 'overworld') {
    return { x: state.player.x, z: state.player.z };
  }
  const portal = OVERWORLD_DATA.dungeonPortals.find(
    (p) => p.targetZoneId === state.zoneId,
  );
  return portal ? { x: portal.x, z: portal.z } : { x: 0, z: 24 };
}

function getOverworldQuestPos(state: GameState): { x: number; z: number; label: string } | null {
  const target = state.questTarget;
  if (!target) return null;
  if (target.zoneId === 'overworld') {
    return { x: target.x, z: target.z, label: target.label };
  }
  const portal = OVERWORLD_DATA.dungeonPortals.find(
    (p) => p.targetZoneId === target.zoneId,
  );
  if (portal) {
    return { x: portal.x, z: portal.z, label: target.label };
  }
  return null;
}

/**
 * Contrôleur des 4 modales Parchemin (découplé de GameEngine par callbacks) :
 * - Inventaire & Équipement (I / Tab)
 * - Carte du Monde (M)
 * - Panneau de Quêtes
 * - Forge de Kit-Chat (Coffre Mystère & Autel des Sorts)
 */
export class ModalsController {
  private readonly container: HTMLElement;
  private readonly callbacks: ModalsCallbacks;

  private readonly backdropEl: HTMLDivElement;
  private readonly windowEl: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly headerExtraEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;

  private heroPortraitUrl = DEFAULT_HERO_PREVIEW_SVG;
  private heroPortraitVersion = 0;
  private mapImageUrl = '';
  private mapImageVersion = 0;

  private activeModal: ActiveModal = 'none';
  private inventoryFilter: InventoryFilter = 'all';
  private forgeTab: ForgeTab = 'chest';
  private lastChestResult: MysteryChestResult | null = null;
  private chestResultNonce = 0;
  private lastRenderSignature = '';
  private latestState: GameState | null = null;

  // Références en direct pour la Carte du Monde (mise à jour fluide à 60 FPS sans rebuild)
  private mapFrameEl: HTMLDivElement | null = null;
  private mapCompassEl: HTMLDivElement | null = null;
  private mapPlayerPinEl: HTMLDivElement | null = null;
  private mapQuestMarkerEl: HTMLDivElement | null = null;
  private mapQuestLabelEl: HTMLSpanElement | null = null;
  private mapQuestDotEl: HTMLDivElement | null = null;
  private mapStaticAnchors: MapStaticAnchor[] = [];
  private lastMapLayoutSig = '';

  constructor(container: HTMLElement, callbacks: ModalsCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'modal-backdrop';
    this.backdropEl.addEventListener('click', (e) => {
      if (e.target === this.backdropEl) {
        this.callbacks.onClose();
      }
    });

    this.windowEl = document.createElement('div');
    this.windowEl.className = 'parchment-panel modal-window';
    this.windowEl.addEventListener('click', (e) => e.stopPropagation());

    const header = document.createElement('div');
    header.className = 'modal-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'modal-title-group';
    const titleTextCol = document.createElement('div');
    this.titleEl = document.createElement('h2');
    this.titleEl.className = 'modal-title';
    this.subtitleEl = document.createElement('div');
    this.subtitleEl.className = 'modal-subtitle';
    titleTextCol.append(this.titleEl, this.subtitleEl);
    titleGroup.appendChild(titleTextCol);

    const headerRight = document.createElement('div');
    headerRight.className = 'modal-header-right';
    this.headerExtraEl = document.createElement('div');
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Fermer (Échap)';
    closeBtn.setAttribute('aria-label', 'Fermer');
    closeBtn.addEventListener('click', () => this.callbacks.onClose());
    headerRight.append(this.headerExtraEl, closeBtn);

    header.append(titleGroup, headerRight);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'modal-body';

    this.windowEl.append(header, this.bodyEl);
    this.backdropEl.appendChild(this.windowEl);
    this.container.appendChild(this.backdropEl);
  }

  public setHeroPortrait(dataUrl: string): void {
    if (!dataUrl || dataUrl === this.heroPortraitUrl) return;
    this.heroPortraitUrl = dataUrl;
    this.heroPortraitVersion += 1;
    if (this.activeModal === 'inventory' && this.latestState) {
      this.forceRerender();
    }
  }

  public setMapImage(dataUrl: string): void {
    if (!dataUrl || dataUrl === this.mapImageUrl) return;
    this.mapImageUrl = dataUrl;
    this.mapImageVersion += 1;
    if (this.activeModal === 'map' && this.latestState) {
      this.forceRerender();
    }
  }

  public setForgeTab(tab: ForgeTab): void {
    if (tab === this.forgeTab) return;
    this.forgeTab = tab;
    if (this.activeModal === 'forge' && this.latestState) {
      this.forceRerender();
    }
  }

  public showMysteryChestResult(result: MysteryChestResult): void {
    this.lastChestResult = result;
    this.chestResultNonce += 1;
    if (this.activeModal === 'forge' && this.latestState) {
      this.forceRerender();
    }
  }

  public update(state: GameState): void {
    this.latestState = state;
    const modal = state.screen === 'playing' ? state.activeModal : 'none';
    const isManaged =
      modal === 'inventory' ||
      modal === 'map' ||
      modal === 'quests' ||
      modal === 'forge';

    if (!isManaged) {
      if (this.activeModal !== 'none') {
        this.activeModal = 'none';
        this.lastRenderSignature = '';
        this.clearMapRefs();
        this.backdropEl.classList.remove('is-open');
      }
      return;
    }

    if (this.activeModal !== modal) {
      this.activeModal = modal;
      this.lastRenderSignature = '';
      this.backdropEl.classList.add('is-open');
      if (modal === 'forge') {
        this.lastChestResult = null;
      }
    }

    const sig = this.computeSignature(modal, state);
    if (sig !== this.lastRenderSignature) {
      this.lastRenderSignature = sig;
      this.renderModal(modal, state);
    }

    // Sur la Carte du Monde, actualise en douceur le point joueur & objectif à chaque frame
    if (modal === 'map') {
      this.updateLiveMapPins(state);
    }
  }

  public dispose(): void {
    this.backdropEl.remove();
  }

  private forceRerender(): void {
    if (!this.latestState || this.activeModal === 'none') return;
    this.lastRenderSignature = '';
    this.update(this.latestState);
  }

  private computeSignature(modal: ActiveModal, state: GameState): string {
    const p = state.player;
    switch (modal) {
      case 'inventory': {
        const invKey = Object.values(p.inventory)
          .map((item) => `${item.id}:${item.level}`)
          .sort()
          .join(',');
        return [
          'inv',
          this.inventoryFilter,
          this.heroPortraitVersion,
          p.level,
          p.gold,
          p.maxHp,
          p.maxMp,
          p.stats.atk,
          p.stats.mag,
          p.stats.def,
          Math.round(p.stats.critChance * 100),
          p.hasRunicKey ? 1 : 0,
          p.equipped.weapon,
          p.equipped.helmet,
          p.equipped.armor,
          invKey,
        ].join('|');
      }
      case 'map':
        return [
          'map',
          this.mapImageVersion,
          state.zoneId,
          p.hasRunicKey ? 1 : 0,
          state.trackedQuestId ?? 'none',
          state.questTarget?.zoneId ?? 'none',
          state.questTarget ? `${Math.round(state.questTarget.x)},${Math.round(state.questTarget.z)}` : '0',
        ].join('|');
      case 'quests': {
        const qKey = QUEST_LIST.map((q) => {
          const prog = state.quests[q.id];
          return `${q.id}:${prog.status}:${prog.stepIndex}:${prog.counter}`;
        }).join(',');
        return ['quests', state.trackedQuestId ?? 'none', qKey].join('|');
      }
      case 'forge': {
        const spKey = SPELL_LIST.map((s) => `${s.id}:${p.spellLevels[s.id]}`).join(',');
        return [
          'forge',
          this.forgeTab,
          p.gold,
          p.stats.mag,
          p.maxHp,
          p.equipped.weapon,
          p.equipped.helmet,
          p.equipped.armor,
          spKey,
          this.chestResultNonce,
        ].join('|');
      }
      default:
        return modal;
    }
  }

  private renderModal(modal: ActiveModal, state: GameState): void {
    this.windowEl.className = 'parchment-panel modal-window';
    this.headerExtraEl.innerHTML = '';
    this.bodyEl.innerHTML = '';
    this.clearMapRefs();

    switch (modal) {
      case 'inventory':
        this.titleEl.textContent = 'Inventaire & Équipement';
        this.subtitleEl.textContent =
          'Cliquez sur un objet pour l’équiper instantanément sur votre héros';
        this.renderInventory(state);
        break;
      case 'map':
        this.windowEl.classList.add('modal-window--map');
        this.titleEl.textContent = 'Carte des îles';
        this.subtitleEl.textContent =
          state.zoneId === 'overworld'
            ? 'Position en temps réel sur l’île de Félingard'
            : `Actuellement dans : ${DUNGEONS[state.zoneId].name} (entrée indiquée)`;
        this.renderWorldMap(state);
        break;
      case 'quests':
        this.windowEl.classList.add('modal-window--quests');
        this.titleEl.textContent = 'Panneau de Quêtes';
        this.subtitleEl.textContent =
          'Suivez la flèche dorée pour accomplir votre légende à Félingard';
        this.renderQuests(state);
        break;
      case 'forge':
        this.windowEl.classList.add('modal-window--forge');
        this.titleEl.textContent = 'Forge de Kit-Chat';
        this.subtitleEl.textContent =
          'Coffres Mystère avec amélioration par doublons & Autel des Sorts';
        this.renderForge(state);
        break;
      default:
        break;
    }
  }

  // ==========================================================================
  // 1. INVENTAIRE & ÉQUIPEMENT
  // ==========================================================================

  private renderInventory(state: GameState): void {
    const p = state.player;
    const goldBadge = document.createElement('div');
    goldBadge.className = 'hud-gold-pill';
    goldBadge.textContent = `🪙 ${p.gold} Or`;
    this.headerExtraEl.appendChild(goldBadge);

    const layout = document.createElement('div');
    layout.className = 'inv-layout';

    // Colonne gauche : Aperçu chat équipé + stats + 3 slots équipés
    const leftCol = document.createElement('div');
    leftCol.className = 'inv-hero-card';

    const stage = document.createElement('div');
    stage.className = 'inv-preview-stage';
    const previewImg = document.createElement('img');
    previewImg.className = 'inv-preview-img';
    previewImg.src = this.heroPortraitUrl;
    previewImg.alt = 'Aperçu du Chat-valier équipé';
    stage.appendChild(previewImg);

    const statsGrid = document.createElement('div');
    statsGrid.className = 'inv-stats-grid';
    const statRows: Array<[string, string]> = [
      ['Niveau', `${p.level}`],
      ['PV Max', `${Math.round(p.maxHp)}`],
      ['PM Max', `${Math.round(p.maxMp)}`],
      ['ATK', `${p.stats.atk}`],
      ['MAG', `${p.stats.mag}`],
      ['DEF', `${p.stats.def}`],
      ['Critique', `${Math.round(p.stats.critChance * 100)} %`],
      ['Clé Runique', p.hasRunicKey ? 'Obtenue ✓' : 'Non'],
    ];
    for (const [label, value] of statRows) {
      const chip = document.createElement('div');
      chip.className = 'inv-stat-chip';
      chip.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
      statsGrid.appendChild(chip);
    }

    const equippedList = document.createElement('div');
    equippedList.className = 'inv-equipped-list';

    ([
      'weapon',
      'secondary_weapon',
      'shield',
      'helmet',
      'armor',
      'trinket',
    ] as EquipSlot[]).forEach((slot) => {
      const itemId = p.equipped[slot];
      const def = getEquipmentDefinition(itemId);
      const owned = p.inventory[itemId];
      if (!def || !owned) return;

      const slotBox = document.createElement('div');
      slotBox.className = `inv-equipped-slot inv-equipped-slot--${def.rarity}`;
      slotBox.innerHTML = `
        <div class="inv-slot-icon">${getEquipmentSvgMarkup(def)}</div>
        <div class="inv-slot-info">
          <div class="inv-slot-type">${SLOT_LABELS[slot]} • Niv. ${owned.level}</div>
          <div class="inv-slot-name">${def.name}</div>
        </div>
      `;
      equippedList.appendChild(slotBox);
    });

    leftCol.append(stage, statsGrid, equippedList);

    // Colonne droite : Filtres + Grille d'inventaire triée avec comparaison
    const rightCol = document.createElement('div');

    const filterRow = document.createElement('div');
    filterRow.className = 'inv-filter-row';
    const filters: Array<{ id: InventoryFilter; label: string }> = [
      { id: 'all', label: 'Tout' },
      { id: 'weapon', label: 'Armes' },
      { id: 'helmet', label: 'Casques' },
      { id: 'armor', label: 'Armures' },
    ];
    for (const f of filters) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tab-btn${this.inventoryFilter === f.id ? ' is-active' : ''}`;
      btn.textContent = f.label;
      btn.addEventListener('click', () => {
        this.inventoryFilter = f.id;
        this.forceRerender();
      });
      filterRow.appendChild(btn);
    }

    const grid = document.createElement('div');
    grid.className = 'inv-grid';

    const ownedEntries = Object.values(p.inventory)
      .map((owned) => {
        const def = getEquipmentDefinition(owned.id);
        return def ? { owned, def } : null;
      })
      .filter(
        (entry): entry is { owned: { id: string; level: number }; def: EquipmentDefinition } =>
          entry !== null &&
          (this.inventoryFilter === 'all' || entry.def.slot === this.inventoryFilter),
      )
      .sort((a, b) => {
        if (SLOT_ORDER[a.def.slot] !== SLOT_ORDER[b.def.slot]) {
          return SLOT_ORDER[a.def.slot] - SLOT_ORDER[b.def.slot];
        }
        if (RARITY_ORDER[a.def.rarity] !== RARITY_ORDER[b.def.rarity]) {
          return RARITY_ORDER[a.def.rarity] - RARITY_ORDER[b.def.rarity];
        }
        return b.owned.level - a.owned.level;
      });

    for (const { owned, def } of ownedEntries) {
      const isEquipped = p.equipped[def.slot] === def.id;
      const itemStats = computeScaledStats(def.baseStats, owned.level);

      // Stats de l'objet actuellement équipé dans ce slot pour calcul du delta +/-
      const equippedId = p.equipped[def.slot];
      const equippedDef = getEquipmentDefinition(equippedId);
      const equippedOwned = p.inventory[equippedId];
      const equippedStats =
        equippedDef && equippedOwned
          ? computeScaledStats(equippedDef.baseStats, equippedOwned.level)
          : { atk: 0, mag: 0, def: 0, hp: 0, mp: 0, critPct: 0 };

      const card = document.createElement('button');
      card.type = 'button';
      card.className = `inv-item-card inv-item-card--${def.rarity}${isEquipped ? ' is-equipped' : ''}`;
      card.addEventListener('click', () => {
        if (!isEquipped) {
          this.callbacks.onEquipItem(def.id);
        }
      });

      const statsHtml = this.buildItemComparisonHtml(
        itemStats,
        equippedStats,
        isEquipped,
      );

      card.innerHTML = `
        <div class="inv-item-top">
          <div class="inv-slot-icon">${getEquipmentSvgMarkup(def)}</div>
          <div class="inv-item-title-wrap">
            <div class="inv-item-name">${def.name}</div>
            <div class="inv-badges-row">
              <span class="rarity-badge rarity-badge--${def.rarity}">${RARITY_LABELS[def.rarity]}</span>
              <span class="lvl-badge">Niv. ${owned.level}</span>
              ${isEquipped ? '<span class="equipped-badge">Équipé</span>' : ''}
            </div>
          </div>
        </div>
        <div class="inv-item-stats">${statsHtml}</div>
        <div class="inv-item-desc">${def.description}</div>
      `;

      grid.appendChild(card);
    }

    rightCol.append(filterRow, grid);
    layout.append(leftCol, rightCol);
    this.bodyEl.appendChild(layout);
  }

  private buildItemComparisonHtml(
    item: ScaledItemStats,
    equipped: ScaledItemStats,
    isEquipped: boolean,
  ): string {
    const keys: Array<{ key: keyof ScaledItemStats; label: string; suffix?: string }> = [
      { key: 'atk', label: 'ATK' },
      { key: 'mag', label: 'MAG' },
      { key: 'def', label: 'DEF' },
      { key: 'hp', label: 'PV' },
      { key: 'mp', label: 'PM' },
      { key: 'critPct', label: 'Crit', suffix: '%' },
    ];

    const pills: string[] = [];
    for (const { key, label, suffix = '' } of keys) {
      const val = item[key];
      const eqVal = equipped[key];
      const diff = val - eqVal;
      if (val === 0 && (isEquipped || diff === 0)) continue;

      let diffHtml = '';
      if (!isEquipped && diff !== 0) {
        const cls = diff > 0 ? 'stat-diff-pos' : 'stat-diff-neg';
        const sign = diff > 0 ? '+' : '';
        diffHtml = `<span class="${cls}">(${sign}${diff}${suffix})</span>`;
      }
      pills.push(
        `<span class="stat-pill">${val > 0 ? `+${val}${suffix}` : `0${suffix}`} ${label}${diffHtml}</span>`,
      );
    }
    return pills.join('');
  }

  // ==========================================================================
  // 2. CARTE DU MONDE
  // ==========================================================================

  private clearMapRefs(): void {
    this.mapFrameEl = null;
    this.mapCompassEl = null;
    this.mapPlayerPinEl = null;
    this.mapQuestMarkerEl = null;
    this.mapQuestLabelEl = null;
    this.mapQuestDotEl = null;
    this.mapStaticAnchors = [];
    this.lastMapLayoutSig = '';
  }

  private renderWorldMap(state: GameState): void {
    const container = document.createElement('div');
    container.className = 'map-container';

    const frame = document.createElement('div');
    frame.className = 'map-frame';
    this.mapFrameEl = frame;

    if (this.mapImageUrl) {
      const img = document.createElement('img');
      img.className = 'map-image';
      img.src = this.mapImageUrl;
      img.alt = 'Carte des îles de Félingard';
      frame.appendChild(img);
    }

    const compass = document.createElement('div');
    compass.className = 'map-compass';
    compass.textContent = 'N';
    this.mapCompassEl = compass;
    frame.appendChild(compass);

    // Marqueur Miaou-bourg
    const villagePos = worldToMapPercent(0, 22);
    const villageMarker = document.createElement('div');
    villageMarker.className = 'map-marker map-marker--village';
    villageMarker.style.left = `${villagePos.left}%`;
    villageMarker.style.top = `${villagePos.top}%`;
    const villageDot = document.createElement('div');
    villageDot.className = 'map-marker-dot';
    villageDot.setAttribute('aria-hidden', 'true');
    villageDot.textContent = '🏠';
    const villageLabel = document.createElement('span');
    villageLabel.className = 'map-marker-label';
    villageLabel.textContent = 'Félingard — Miaou-bourg';
    villageMarker.append(villageDot, villageLabel);
    frame.appendChild(villageMarker);
    this.mapStaticAnchors.push({
      left: villagePos.left,
      top: villagePos.top,
      el: villageMarker,
      labelEl: villageLabel,
      dotEl: villageDot,
    });

    const mainlandDockPos = worldToMapPercent(
      FELINGARD_DOCK_POS.x,
      FELINGARD_DOCK_POS.z,
    );
    const mainlandDock = document.createElement('div');
    mainlandDock.className = 'map-marker map-marker--island';
    mainlandDock.style.left = `${mainlandDockPos.left}%`;
    mainlandDock.style.top = `${mainlandDockPos.top}%`;
    const mainlandDockDot = document.createElement('div');
    mainlandDockDot.className = 'map-marker-dot';
    mainlandDockDot.setAttribute('aria-hidden', 'true');
    mainlandDockDot.textContent = '⚓';
    const mainlandDockLabel = document.createElement('span');
    mainlandDockLabel.className = 'map-marker-label';
    mainlandDockLabel.textContent = 'Quai de Félingard';
    mainlandDock.append(mainlandDockDot, mainlandDockLabel);
    frame.appendChild(mainlandDock);
    this.mapStaticAnchors.push({
      left: mainlandDockPos.left,
      top: mainlandDockPos.top,
      el: mainlandDock,
      labelEl: mainlandDockLabel,
      dotEl: mainlandDockDot,
    });

    for (const islandId of ALL_NEW_ISLANDS) {
      const island = NEW_ISLANDS[islandId];
      const pos = worldToMapPercent(island.dockPos.x, island.dockPos.z);
      const marker = document.createElement('div');
      marker.className = 'map-marker map-marker--island';
      marker.style.left = `${pos.left}%`;
      marker.style.top = `${pos.top}%`;
      const dot = document.createElement('div');
      dot.className = 'map-marker-dot';
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = '⚓';
      const label = document.createElement('span');
      label.className = 'map-marker-label';
      label.textContent = `${island.name} — Quai`;
      marker.append(dot, label);
      frame.appendChild(marker);
      this.mapStaticAnchors.push({
        left: pos.left,
        top: pos.top,
        el: marker,
        labelEl: label,
        dotEl: dot,
      });
    }

    // Marqueurs Donjons (+ niveaux recommandés & cadenas si Clé Runique manquante)
    for (const portal of state.islandId === 'felingard' ? OVERWORLD_DATA.dungeonPortals : []) {
      const pos = worldToMapPercent(portal.x, portal.z);
      const isDragon = portal.targetZoneId === 'dungeon_dragon_lair';
      const isLocked = Boolean(portal.requiresRunicKey && !state.player.hasRunicKey);
      const dungeonName =
        portal.targetZoneId !== 'overworld'
          ? DUNGEONS[portal.targetZoneId].name
          : portal.label;

      const marker = document.createElement('div');
      marker.className = `map-marker ${isDragon ? 'map-marker--dragon' : 'map-marker--dungeon'}`;
      marker.style.left = `${pos.left}%`;
      marker.style.top = `${pos.top}%`;

      const dot = document.createElement('div');
      dot.className = 'map-marker-dot';
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = isLocked ? '🔒' : isDragon ? '🐉' : '⚔️';

      const label = document.createElement('span');
      label.className = 'map-marker-label';
      label.textContent = `${dungeonName} (${portal.shortLabel})`;

      marker.append(dot, label);
      frame.appendChild(marker);
      this.mapStaticAnchors.push({
        left: pos.left,
        top: pos.top,
        el: marker,
        labelEl: label,
        dotEl: dot,
      });
    }

    // Marqueur doré de Quête active (mis à jour en direct)
    const questMarker = document.createElement('div');
    questMarker.className = 'map-marker map-marker--quest';
    const questDot = document.createElement('div');
    questDot.className = 'map-marker-dot';
    questDot.setAttribute('aria-hidden', 'true');
    questDot.textContent = '★';
    const questLabel = document.createElement('span');
    questLabel.className = 'map-marker-label';
    questLabel.textContent = 'Objectif';
    questMarker.append(questDot, questLabel);
    this.mapQuestMarkerEl = questMarker;
    this.mapQuestDotEl = questDot;
    this.mapQuestLabelEl = questLabel;
    frame.appendChild(questMarker);

    // Point joueur en direct
    const playerPin = document.createElement('div');
    playerPin.className = 'map-player-pin';
    playerPin.title = 'Votre position';
    this.mapPlayerPinEl = playerPin;
    frame.appendChild(playerPin);

    // Légende
    const legend = document.createElement('div');
    legend.className = 'map-legend';
    legend.innerHTML = `
      <span class="map-legend-item"><span class="map-legend-swatch" style="background:#3be8ff;"></span>Vous</span>
      <span class="map-legend-item"><span class="map-legend-swatch" style="background:#f5c95d;"></span>Miaou-bourg</span>
      <span class="map-legend-item"><span class="map-legend-swatch" style="background:#8a56d6;"></span>Grotte (Niv. 2)</span>
      <span class="map-legend-item"><span class="map-legend-swatch" style="background:#c92a3e;"></span>Antre du Dragon (Niv. 5)</span>
      <span class="map-legend-item"><span class="map-legend-swatch" style="background:#f5b316;"></span>Objectif de quête</span>
      <span class="map-legend-item"><span class="map-legend-swatch" style="background:#70c8d8;"></span>Îles accessibles par bateau</span>
    `;

    container.append(frame, legend);
    this.bodyEl.appendChild(container);
    this.lastMapLayoutSig = '';
    this.updateLiveMapPins(state);
  }

  private applyMarkerLabelStyle(
    markerEl: HTMLDivElement,
    labelEl: HTMLSpanElement,
    mode: MapLabelPlacement,
    shiftX: number,
  ): void {
    markerEl.classList.toggle('is-label-above', mode === 'above');
    markerEl.classList.toggle('is-label-above-offset', mode === 'above-offset');
    markerEl.classList.toggle('is-label-below-offset', mode === 'below-offset');
    labelEl.style.setProperty('--label-shift-x', `${Math.round(shiftX)}px`);
  }

  private clampLabelShiftX(
    labelEl: HTMLSpanElement,
    frameRect: DOMRect,
    scaleX: number,
    desiredShiftX: number,
    edgePad = 6,
  ): number {
    labelEl.style.setProperty('--label-shift-x', `${Math.round(desiredShiftX)}px`);
    const r = labelEl.getBoundingClientRect();
    let adjustScreenPx = 0;
    const padScreen = edgePad * scaleX;
    if (r.left < frameRect.left + padScreen) {
      adjustScreenPx = frameRect.left + padScreen - r.left;
    } else if (r.right > frameRect.right - padScreen) {
      adjustScreenPx = frameRect.right - padScreen - r.right;
    }
    const finalShift = desiredShiftX + adjustScreenPx / scaleX;
    if (Math.abs(adjustScreenPx) > 0.5) {
      labelEl.style.setProperty('--label-shift-x', `${Math.round(finalShift)}px`);
    }
    return Math.round(finalShift);
  }

  private updateLiveMapPins(state: GameState): void {
    if (this.mapPlayerPinEl) {
      const pPos = getOverworldPlayerPos(state);
      const pct = worldToMapPercent(pPos.x, pPos.z);
      this.mapPlayerPinEl.style.left = `${pct.left.toFixed(2)}%`;
      this.mapPlayerPinEl.style.top = `${pct.top.toFixed(2)}%`;
    }

    if (!this.mapQuestMarkerEl || !this.mapQuestLabelEl) return;

    const qPos = getOverworldQuestPos(state);
    let qPct: { left: number; top: number } | null = null;
    if (!qPos) {
      this.mapQuestMarkerEl.style.display = 'none';
    } else {
      qPct = worldToMapPercent(qPos.x, qPos.z);
      this.mapQuestMarkerEl.style.display = 'flex';
      this.mapQuestMarkerEl.style.left = `${qPct.left.toFixed(2)}%`;
      this.mapQuestMarkerEl.style.top = `${qPct.top.toFixed(2)}%`;
      if (this.mapQuestLabelEl.textContent !== qPos.label) {
        this.mapQuestLabelEl.textContent = qPos.label;
      }
    }

    const frameW = this.mapFrameEl ? Math.round(this.mapFrameEl.getBoundingClientRect().width) : 0;
    const frameH = this.mapFrameEl ? Math.round(this.mapFrameEl.getBoundingClientRect().height) : 0;
    const layoutSig = `${frameW}x${frameH}|${qPos && qPct ? `${qPct.left.toFixed(1)},${qPct.top.toFixed(1)},${qPos.label}` : 'none'}`;
    if (layoutSig === this.lastMapLayoutSig) return;
    this.lastMapLayoutSig = layoutSig;

    this.layoutMapLabels(qPct);
  }

  private layoutMapLabels(qPct: { left: number; top: number } | null): void {
    if (!this.mapFrameEl) return;

    const frameRect = this.mapFrameEl.getBoundingClientRect();
    const hasDomLayout = frameRect.width > 40 && frameRect.height > 40;
    const scaleX = hasDomLayout
      ? frameRect.width / Math.max(1, this.mapFrameEl.clientWidth)
      : 1;

    // 1. Place les libellés statiques par défaut (en dessous) avec clamp minimal dans le cadre
    const defaultStaticShifts: number[] = [];
    for (const anchor of this.mapStaticAnchors) {
      this.applyMarkerLabelStyle(anchor.el, anchor.labelEl, 'below', 0);
      const shift = hasDomLayout
        ? this.clampLabelShiftX(anchor.labelEl, frameRect, scaleX, 0)
        : 0;
      defaultStaticShifts.push(shift);
    }

    if (!qPct || !this.mapQuestMarkerEl || !this.mapQuestLabelEl || !this.mapQuestDotEl) {
      return;
    }

    // 2. Détecte la proximité (< 12 % de la carte) avec un marqueur de village/donjon
    const PROXIMITY_THRESHOLD_PCT = 12;
    let nearestIdx = -1;
    let nearestDist = Infinity;
    for (let i = 0; i < this.mapStaticAnchors.length; i++) {
      const anchor = this.mapStaticAnchors[i];
      const d = Math.hypot(qPct.left - anchor.left, qPct.top - anchor.top);
      if (d < PROXIMITY_THRESHOLD_PCT && d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }

    const nearestAnchor = nearestIdx >= 0 ? this.mapStaticAnchors[nearestIdx] : null;
    const isStacked = nearestAnchor !== null && nearestDist < 3.5;
    this.mapQuestMarkerEl.classList.toggle('is-stacked', isStacked);

    // Fallback sans layout DOM (ex: environnement de test sans rendu)
    if (!hasDomLayout) {
      let questMode: MapLabelPlacement = 'below';
      if (nearestAnchor) {
        if (qPct.top <= nearestAnchor.top + 1.5) {
          questMode = qPct.top >= 12 ? 'above' : 'below-offset';
        } else if (nearestAnchor.top >= 12) {
          this.applyMarkerLabelStyle(nearestAnchor.el, nearestAnchor.labelEl, 'above', 0);
        } else {
          questMode = 'below-offset';
        }
      }
      this.applyMarkerLabelStyle(this.mapQuestMarkerEl, this.mapQuestLabelEl, questMode, 0);
      return;
    }

    // 3. Évalue les placements candidats (proximité < 12 % + zéro chevauchement réel DOM)
    interface CandidateSpec {
      questMode: MapLabelPlacement;
      flipIdx: number;
      flipMode: MapLabelPlacement;
      flipNudges: number[];
      questNudges: number[];
    }

    const candidates: CandidateSpec[] = [];
    if (nearestAnchor) {
      if (qPct.top <= nearestAnchor.top + 1.5) {
        // Quête au même point ou au-dessus du marqueur (ex. Donjon) : étiquette de quête AU-DESSUS en priorité
        candidates.push(
          { questMode: 'above', flipIdx: -1, flipMode: 'below', flipNudges: [0], questNudges: [0, -24, 24, -44, 44] },
          { questMode: 'below-offset', flipIdx: -1, flipMode: 'below', flipNudges: [0], questNudges: [0, -24, 24, -44, 44] },
          { questMode: 'above-offset', flipIdx: -1, flipMode: 'below', flipNudges: [0], questNudges: [0, -24, 24] },
          { questMode: 'below', flipIdx: nearestIdx, flipMode: 'above', flipNudges: [0, -28, 28, -48, 48], questNudges: [0, -24, 24] },
        );
      } else {
        // Quête juste sous le marqueur proche (ex. Maire Moustache sous Miaou-bourg) :
        // bascule l'étiquette statique au-dessus (avec léger décalage si un donjon est proche) ou décale la quête
        candidates.push(
          { questMode: 'below', flipIdx: nearestIdx, flipMode: 'above', flipNudges: [0, -28, 28, -48, 48], questNudges: [0, -20, 20] },
          { questMode: 'below-offset', flipIdx: -1, flipMode: 'below', flipNudges: [0], questNudges: [0, -24, 24, -44, 44] },
          { questMode: 'above-offset', flipIdx: -1, flipMode: 'below', flipNudges: [0], questNudges: [0, -24, 24] },
          { questMode: 'above', flipIdx: -1, flipMode: 'below', flipNudges: [0], questNudges: [0, -24, 24] },
        );
      }
    } else {
      // Hors proximité directe (< 12 %), évite tout de même les collisions horizontales (ex. Chasse aux Pelotes / Miaou-bourg)
      candidates.push(
        { questMode: 'below', flipIdx: -1, flipMode: 'below', flipNudges: [0], questNudges: [0, 26, -26, 48, -48] },
        { questMode: 'above', flipIdx: -1, flipMode: 'below', flipNudges: [0], questNudges: [0, 26, -26, 48, -48] },
        { questMode: 'below-offset', flipIdx: -1, flipMode: 'below', flipNudges: [0], questNudges: [0, 26, -26, 48, -48] },
        { questMode: 'above-offset', flipIdx: -1, flipMode: 'below', flipNudges: [0], questNudges: [0, 26, -26] },
      );
    }

    const compassRect = this.mapCompassEl?.getBoundingClientRect() ?? null;
    const dotRects: SimpleRect[] = [
      ...this.mapStaticAnchors.map((a) => a.dotEl.getBoundingClientRect()),
      this.mapQuestDotEl.getBoundingClientRect(),
    ];
    const questDotIdx = this.mapStaticAnchors.length;

    let bestScore = Infinity;
    let bestChoice: {
      questMode: MapLabelPlacement;
      questShiftX: number;
      flipIdx: number;
      flipMode: MapLabelPlacement;
      flipShiftX: number;
    } = {
      questMode: candidates[0].questMode,
      questShiftX: 0,
      flipIdx: -1,
      flipMode: 'below',
      flipShiftX: 0,
    };

    for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
      const cand = candidates[cIdx];

      for (const fNudge of cand.flipNudges) {
        // Restaure les marqueurs statiques à leur état par défaut
        for (let i = 0; i < this.mapStaticAnchors.length; i++) {
          const anchor = this.mapStaticAnchors[i];
          if (i === cand.flipIdx) {
            this.applyMarkerLabelStyle(anchor.el, anchor.labelEl, cand.flipMode, fNudge);
            this.clampLabelShiftX(anchor.labelEl, frameRect, scaleX, fNudge);
          } else {
            this.applyMarkerLabelStyle(
              anchor.el,
              anchor.labelEl,
              'below',
              defaultStaticShifts[i],
            );
          }
        }

        const appliedFlipShift =
          cand.flipIdx >= 0
            ? parseInt(
                this.mapStaticAnchors[cand.flipIdx].labelEl.style.getPropertyValue(
                  '--label-shift-x',
                ) || '0',
                10,
              )
            : 0;

        for (const qNudge of cand.questNudges) {
          this.applyMarkerLabelStyle(
            this.mapQuestMarkerEl,
            this.mapQuestLabelEl,
            cand.questMode,
            qNudge,
          );
          const appliedQuestShift = this.clampLabelShiftX(
            this.mapQuestLabelEl,
            frameRect,
            scaleX,
            qNudge,
          );

          // Mesure l'ensemble des étiquettes visibles
          const labelRects: SimpleRect[] = [
            ...this.mapStaticAnchors.map((a) => a.labelEl.getBoundingClientRect()),
            this.mapQuestLabelEl.getBoundingClientRect(),
          ];

          let score =
            cIdx * 12 +
            Math.abs(appliedQuestShift) * 0.12 +
            Math.abs(appliedFlipShift) * 0.14;

          // Pénalité de débordement hors du cadre de la carte
          const margin = 3 * scaleX;
          for (const lr of labelRects) {
            const clip =
              Math.max(0, frameRect.left + margin - lr.left) +
              Math.max(0, lr.right - (frameRect.right - margin)) +
              Math.max(0, frameRect.top + margin - lr.top) +
              Math.max(0, lr.bottom - (frameRect.bottom - margin));
            if (clip > 0) {
              score += 100000 + clip * 5000;
            }
            if (compassRect) {
              const ca = getRectOverlapArea(lr, compassRect, 2 * scaleX);
              if (ca > 0) score += 20000 + ca * 50;
            }
          }

          // Pénalité de chevauchement entre deux étiquettes
          for (let i = 0; i < labelRects.length; i++) {
            for (let j = i + 1; j < labelRects.length; j++) {
              const area = getRectOverlapArea(labelRects[i], labelRects[j], 2 * scaleX);
              if (area > 0) {
                score += 20000 + area * 80;
              }
            }
          }

          // Pénalité si une étiquette recouvre la pastille d'un autre marqueur
          for (let i = 0; i < labelRects.length; i++) {
            for (let j = 0; j < dotRects.length; j++) {
              if (i === j) continue;
              // Si la quête est empilée exactement sur son ancre statique, les deux pastilles coïncident
              if (isStacked && ((i === questDotIdx && j === nearestIdx) || (i === nearestIdx && j === questDotIdx))) {
                continue;
              }
              const area = getRectOverlapArea(labelRects[i], dotRects[j], 1 * scaleX);
              if (area > 0) {
                score += 3000 + area * 25;
              }
            }
          }

          if (score < bestScore) {
            bestScore = score;
            bestChoice = {
              questMode: cand.questMode,
              questShiftX: appliedQuestShift,
              flipIdx: cand.flipIdx,
              flipMode: cand.flipMode,
              flipShiftX: appliedFlipShift,
            };
          }
        }
      }
    }

    // 4. Applique le meilleur placement sans chevauchement
    for (let i = 0; i < this.mapStaticAnchors.length; i++) {
      const anchor = this.mapStaticAnchors[i];
      if (i === bestChoice.flipIdx) {
        this.applyMarkerLabelStyle(
          anchor.el,
          anchor.labelEl,
          bestChoice.flipMode,
          bestChoice.flipShiftX,
        );
      } else {
        this.applyMarkerLabelStyle(
          anchor.el,
          anchor.labelEl,
          'below',
          defaultStaticShifts[i],
        );
      }
    }
    this.applyMarkerLabelStyle(
      this.mapQuestMarkerEl,
      this.mapQuestLabelEl,
      bestChoice.questMode,
      bestChoice.questShiftX,
    );
  }

  // ==========================================================================
  // 3. PANNEAU DE QUÊTES
  // ==========================================================================

  private renderQuests(state: GameState): void {
    const list = document.createElement('div');
    list.className = 'quest-list';

    for (const def of QUEST_LIST) {
      const progress = state.quests[def.id];
      const isTracked = state.trackedQuestId === def.id && progress.status === 'active';
      const currentStep =
        def.steps[progress.stepIndex] ?? def.steps[def.steps.length - 1];

      const card = document.createElement('div');
      card.className = [
        'quest-card',
        def.isMain ? 'quest-card--main' : '',
        isTracked ? 'quest-card--tracked' : '',
        progress.status === 'completed' ? 'quest-card--completed' : '',
      ]
        .filter(Boolean)
        .join(' ');

      const statusLabel =
        progress.status === 'completed'
          ? 'Accomplie ✓'
          : isTracked
            ? 'Suivie ★'
            : progress.status === 'active'
              ? 'En cours'
              : 'Disponible';

      const rewardItem = def.completionReward.itemId
        ? EQUIPMENT[def.completionReward.itemId]
        : undefined;

      const stepBoxHtml =
        progress.status === 'active' && currentStep
          ? `<div class="quest-step-box">
              <strong>${currentStep.title}${
                currentStep.requiredCount > 1
                  ? ` (${Math.min(progress.counter, currentStep.requiredCount)} / ${currentStep.requiredCount})`
                  : ''
              }</strong>
              <span>${currentStep.description}</span>
            </div>`
          : progress.status === 'available' && currentStep
            ? `<div class="quest-step-box">
                <strong>Objectif :</strong>
                <span>${currentStep.description}</span>
              </div>`
            : '';

      card.innerHTML = `
        <div class="quest-card-header">
          <div>
            <span class="hud-quest-badge${def.isMain ? '' : ' hud-quest-badge--side'}">
              ${def.isMain ? 'Quête Principale' : 'Quête Secondaire'} • Niv. ${def.recommendedLevel}
            </span>
            <h3 class="quest-card-title" style="margin-top:6px;">${def.title}</h3>
          </div>
          <span class="quest-status-pill quest-status-pill--${progress.status}">${statusLabel}</span>
        </div>
        <p class="quest-summary">${def.summary}</p>
        ${stepBoxHtml}
      `;

      const footer = document.createElement('div');
      footer.className = 'quest-card-footer';

      const rewards = document.createElement('div');
      rewards.className = 'quest-rewards';
      rewards.innerHTML = `
        <span>Récompenses :</span>
        <span class="reward-pill">+${def.completionReward.xp} XP</span>
        <span class="reward-pill">+${def.completionReward.gold} Or</span>
        ${
          rewardItem
            ? `<span class="reward-pill">${rewardItem.name}</span>`
            : ''
        }
      `;

      const actionWrap = document.createElement('div');
      if (progress.status === 'available') {
        const acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.className = 'wood-btn wood-btn--gold wood-btn--small';
        acceptBtn.textContent = 'Accepter la quête';
        acceptBtn.addEventListener('click', () => {
          this.callbacks.onAcceptQuest(def.id);
        });
        actionWrap.appendChild(acceptBtn);
      } else if (progress.status === 'active' && !isTracked) {
        const trackBtn = document.createElement('button');
        trackBtn.type = 'button';
        trackBtn.className = 'wood-btn wood-btn--small';
        trackBtn.textContent = 'Suivre';
        trackBtn.addEventListener('click', () => {
          this.callbacks.onTrackQuest(def.id);
        });
        actionWrap.appendChild(trackBtn);
      } else if (isTracked) {
        const trackedBtn = document.createElement('button');
        trackedBtn.type = 'button';
        trackedBtn.className = 'wood-btn wood-btn--secondary wood-btn--small';
        trackedBtn.disabled = true;
        trackedBtn.textContent = 'Flèche dorée active ★';
        actionWrap.appendChild(trackedBtn);
      }

      footer.append(rewards, actionWrap);
      card.appendChild(footer);
      list.appendChild(card);
    }

    this.bodyEl.appendChild(list);
  }

  // ==========================================================================
  // 4. FORGE DE KIT-CHAT (Coffre Mystère + Autel des Sorts)
  // ==========================================================================

  private renderForge(state: GameState): void {
    const p = state.player;
    const goldBadge = document.createElement('div');
    goldBadge.className = 'hud-gold-pill';
    goldBadge.textContent = `🪙 ${p.gold} Or`;
    this.headerExtraEl.appendChild(goldBadge);

    const tabs = document.createElement('div');
    tabs.className = 'forge-tabs';

    const chestTabBtn = document.createElement('button');
    chestTabBtn.type = 'button';
    chestTabBtn.className = `tab-btn${this.forgeTab === 'chest' ? ' is-active' : ''}`;
    chestTabBtn.textContent = `🎁 Coffre Mystère (${MYSTERY_CHEST_COST} Or)`;
    chestTabBtn.addEventListener('click', () => this.setForgeTab('chest'));

    const spellsTabBtn = document.createElement('button');
    spellsTabBtn.type = 'button';
    spellsTabBtn.className = `tab-btn${this.forgeTab === 'spells' ? ' is-active' : ''}`;
    spellsTabBtn.textContent = '✨ Autel des Sorts (Niv. 1 → 5)';
    spellsTabBtn.addEventListener('click', () => this.setForgeTab('spells'));

    tabs.append(chestTabBtn, spellsTabBtn);
    this.bodyEl.appendChild(tabs);

    if (this.forgeTab === 'chest') {
      this.renderForgeMysteryChest(state);
    } else {
      this.renderForgeSpellAltar(state);
    }
  }

  private renderForgeMysteryChest(state: GameState): void {
    const p = state.player;
    const canAfford = p.gold >= MYSTERY_CHEST_COST;

    const panel = document.createElement('div');
    panel.className = 'forge-chest-panel';

    panel.innerHTML = `
      <div class="forge-chest-art" aria-hidden="true">
        <svg width="58" height="58" viewBox="0 0 64 64">
          <rect x="8" y="24" width="48" height="30" rx="5" fill="#8b4d22" stroke="#2b1e16" stroke-width="3.2"/>
          <path d="M8 26 C8 14 18 10 32 10 C46 10 56 14 56 26 Z" fill="#b86b2d" stroke="#2b1e16" stroke-width="3.2"/>
          <rect x="8" y="24" width="48" height="6" fill="#f2be42" stroke="#2b1e16" stroke-width="2.4"/>
          <rect x="26" y="21" width="12" height="14" rx="3" fill="#ffe27a" stroke="#2b1e16" stroke-width="2.6"/>
          <circle cx="32" cy="28" r="2.3" fill="#2b1e16"/>
        </svg>
      </div>
      <div style="max-width: 520px;">
        <h3 style="margin:0 0 6px; font-family: var(--font-title); font-size: 19px;">
          « Bienvenue à la Forge de Kit-Chat ! »
        </h3>
        <p style="margin:0; font-size: 13.5px; color: var(--ink-soft); line-height: 1.45;">
          Tente ta chance dans le <strong>Coffre Mystère</strong> ! Si tu obtiens un objet déjà possédé,
          ses statistiques augmentent immédiatement de <strong>+1 Niveau</strong> !
        </p>
      </div>
      <div class="forge-odds">
        <span class="rarity-badge rarity-badge--common">Commun ${Math.round(MYSTERY_CHEST_WEIGHTS.common * 100)} %</span>
        <span class="rarity-badge rarity-badge--rare">Rare ${Math.round(MYSTERY_CHEST_WEIGHTS.rare * 100)} %</span>
        <span class="rarity-badge rarity-badge--epic">Épique ${Math.round(MYSTERY_CHEST_WEIGHTS.epic * 100)} %</span>
      </div>
    `;

    const buyBtn = document.createElement('button');
    buyBtn.type = 'button';
    buyBtn.className = 'wood-btn wood-btn--gold';
    buyBtn.disabled = !canAfford;
    buyBtn.textContent = canAfford
      ? `Ouvrir un Coffre Mystère — ${MYSTERY_CHEST_COST} Or`
      : `Or insuffisant (${p.gold} / ${MYSTERY_CHEST_COST} Or)`;
    buyBtn.addEventListener('click', () => {
      const result = this.callbacks.onBuyMysteryChest();
      if (result) {
        this.lastChestResult = result;
        this.chestResultNonce += 1;
        this.forceRerender();
      }
    });
    panel.appendChild(buyBtn);

    if (this.lastChestResult) {
      const res = this.lastChestResult;
      const def = getEquipmentDefinition(res.itemId);
      const isAlreadyEquipped = def ? p.equipped[def.slot] === def.id : false;

      const reveal = document.createElement('div');
      reveal.className = `forge-reveal-card forge-reveal-card--${res.rarity}`;
      reveal.innerHTML = `
        <div class="forge-reveal-banner">
          ${
            res.isUpgrade
              ? `✨ Doublon ! Amélioré au Niveau ${res.newLevel} ! ✨`
              : `🎉 Nouvel équipement obtenu ! (Niv. ${res.newLevel}) 🎉`
          }
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          ${def ? `<div class="inv-slot-icon">${getEquipmentSvgMarkup(def)}</div>` : ''}
          <div style="text-align:left;">
            <div style="font-family:var(--font-title); font-size:16px; font-weight:700;">${res.itemName}</div>
            <div class="inv-badges-row">
              <span class="rarity-badge rarity-badge--${res.rarity}">${RARITY_LABELS[res.rarity]}</span>
              <span class="lvl-badge">Niv. ${res.newLevel}</span>
            </div>
          </div>
        </div>
      `;

      if (def && !isAlreadyEquipped) {
        const equipNowBtn = document.createElement('button');
        equipNowBtn.type = 'button';
        equipNowBtn.className = 'wood-btn wood-btn--small';
        equipNowBtn.textContent = 'Équiper maintenant';
        equipNowBtn.addEventListener('click', () => {
          this.callbacks.onEquipItem(def.id);
        });
        reveal.appendChild(equipNowBtn);
      }

      panel.appendChild(reveal);
    }

    this.bodyEl.appendChild(panel);
  }

  private renderForgeSpellAltar(state: GameState): void {
    const p = state.player;
    const grid = document.createElement('div');
    grid.className = 'forge-spells-grid';

    for (const def of SPELL_LIST) {
      const level = p.spellLevels[def.id] ?? 1;
      const isMax = level >= MAX_SPELL_LEVEL;
      const cost = getSpellUpgradeCost(def.id, level);
      const canAfford = !isMax && p.gold >= cost;

      const curPower = getSpellPower(def.id, level, p.stats.mag);
      const nextPower = isMax ? curPower : getSpellPower(def.id, level + 1, p.stats.mag);

      const powerLabel =
        def.id === 'healing_paw'
          ? `Soin inst. : ${Math.round(p.maxHp * (def.instantHealPct ?? 0.25) + curPower)} PV${
              !isMax
                ? ` → ${Math.round(p.maxHp * (def.instantHealPct ?? 0.25) + nextPower)} PV`
                : ''
            }`
          : `Puissance : ${curPower}${!isMax ? ` → ${nextPower}` : ''} dégâts`;

      const card = document.createElement('div');
      card.className = 'forge-spell-card';
      card.innerHTML = `
        <div class="forge-spell-head">
          <div class="forge-spell-icon-box">${getSpellIconSvg(def.id)}</div>
          <div style="flex:1;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
              <strong style="font-family:var(--font-title); font-size:15.5px;">${def.name}</strong>
              <span class="lvl-badge">Niv. ${level} / ${MAX_SPELL_LEVEL}</span>
            </div>
            <div style="font-size:12px; color:var(--ink-soft); margin-top:2px;">${def.shortDesc}</div>
          </div>
        </div>
        <div style="font-size:12.5px; color:var(--ink-muted); line-height:1.4;">${def.description}</div>
        <div class="forge-spell-stats">
          <span class="stat-pill">${powerLabel}</span>
          <span class="stat-pill">${def.mpCost} PM</span>
          <span class="stat-pill">Recharge ${def.cooldown.toFixed(1)} s</span>
        </div>
      `;

      const footer = document.createElement('div');
      footer.className = 'forge-spell-footer';

      const hint = document.createElement('span');
      hint.style.fontSize = '12px';
      hint.style.fontWeight = '700';
      hint.style.color = 'var(--ink-soft)';
      hint.textContent = isMax
        ? 'Maîtrise féline maximale !'
        : `Touche : ${def.hotkeyLabel}`;

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = `wood-btn wood-btn--small${canAfford ? ' wood-btn--gold' : ''}`;
      upBtn.disabled = isMax || !canAfford;
      upBtn.textContent = isMax
        ? 'Niveau MAX ★'
        : `Améliorer — ${cost} Or`;
      upBtn.addEventListener('click', () => {
        if (this.callbacks.onUpgradeSpell(def.id)) {
          this.forceRerender();
        }
      });

      footer.append(hint, upBtn);
      card.appendChild(footer);
      grid.appendChild(card);
    }

    this.bodyEl.appendChild(grid);
  }
}
