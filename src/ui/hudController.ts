import { DUNGEONS } from '../data/dungeonsData';
import { getEquipmentDefinition } from '../data/equipmentData';
import { QUESTS } from '../data/questsData';
import { SPELL_ORDER, SPELLS } from '../data/spellsData';
import { getBiomeAt } from '../data/worldData';
import { getBiomeAtNewIsland, NEW_ISLANDS } from '../data/worldIslands';
import {
  MAX_PLAYER_LEVEL,
  type EnemyInstance,
  type GameEvent,
  type GameState,
  type SpellId,
} from '../game/types';

export type ToastVariant = 'info' | 'gold' | 'epic' | 'quest' | 'level' | 'warning';

export interface HudCallbacks {
  onCastSpell: (spellId: SpellId) => void;
  onInteract: () => void;
  onToggleInventory: () => void;
  onToggleMap: () => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onOpenQuests?: () => void;
}

interface SpellSlotRefs {
  button: HTMLButtonElement;
  cdVeil: HTMLDivElement;
  cdText: HTMLDivElement;
  lvlBadge: HTMLSpanElement;
  mpBadge: HTMLSpanElement;
  lastCdPct: string;
  lastCdLabel: string;
  lastNoMp: boolean;
  lastCooldown: boolean;
  lastLevel: number;
}

const DEFAULT_HERO_SVG = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
    <circle cx="48" cy="48" r="46" fill="#5e8d50"/>
    <path d="M22 42 L28 16 L43 31 L53 31 L68 16 L74 42 C77 62 66 78 48 78 C30 78 19 62 22 42 Z" fill="#e98d3c" stroke="#2b1e16" stroke-width="3.5"/>
    <path d="M28 24 L38 33 L27 37 Z" fill="#f7c49a"/>
    <path d="M68 24 L58 33 L69 37 Z" fill="#f7c49a"/>
    <path d="M21 37 Q48 27 75 37 L73 45 Q48 36 23 45 Z" fill="#d93d3d" stroke="#2b1e16" stroke-width="2.5"/>
    <circle cx="37" cy="52" r="4.5" fill="#2b1e16"/>
    <circle cx="59" cy="52" r="4.5" fill="#2b1e16"/>
    <circle cx="38.5" cy="50.5" r="1.4" fill="#fff"/>
    <circle cx="60.5" cy="50.5" r="1.4" fill="#fff"/>
    <polygon points="48,57 44,61 52,61" fill="#d45555"/>
    <path d="M43 65 Q48 69 53 65" fill="none" stroke="#2b1e16" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`,
)}`;

function getSpellSvgMarkup(spellId: SpellId): string {
  switch (spellId) {
    case 'flamepurr':
      return `<svg class="spell-slot-icon" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <radialGradient id="fg-fire" cx="50%" cy="62%" r="55%">
            <stop offset="0%" stop-color="#fff4a3"/>
            <stop offset="48%" stop-color="#ff8c2b"/>
            <stop offset="100%" stop-color="#cf261d"/>
          </radialGradient>
        </defs>
        <path d="M33 6 C42 18 52 25 50 40 C49 51 41 58 32 58 C21 58 14 50 14 39 C14 29 21 22 24 14 C26 19 29 21 30 16 C31 12 31 9 33 6 Z" fill="url(#fg-fire)" stroke="#2b1e16" stroke-width="3" stroke-linejoin="round"/>
        <path d="M32 30 C37 36 40 41 39 47 C38 52 35 54 32 54 C28 54 25 51 25 46 C25 41 28 36 32 30 Z" fill="#fff5b8"/>
      </svg>`;
    case 'lightnyan':
      return `<svg class="spell-slot-icon" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="fg-bolt" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fffbe0"/>
            <stop offset="50%" stop-color="#ffe142"/>
            <stop offset="100%" stop-color="#53d8ff"/>
          </linearGradient>
        </defs>
        <polygon points="38,6 15,35 30,35 24,58 49,27 34,27" fill="url(#fg-bolt)" stroke="#2b1e16" stroke-width="3" stroke-linejoin="round"/>
      </svg>`;
    case 'freezepaw':
      return `<svg class="spell-slot-icon" viewBox="0 0 64 64" aria-hidden="true">
        <g stroke="#2b1e16" stroke-width="5.5" stroke-linecap="round">
          <line x1="32" y1="8" x2="32" y2="56"/>
          <line x1="11" y1="20" x2="53" y2="44"/>
          <line x1="53" y1="20" x2="11" y2="44"/>
        </g>
        <g stroke="#8ceeff" stroke-width="3.2" stroke-linecap="round">
          <line x1="32" y1="8" x2="32" y2="56"/>
          <line x1="11" y1="20" x2="53" y2="44"/>
          <line x1="53" y1="20" x2="11" y2="44"/>
          <polyline points="26,14 32,20 38,14" fill="none"/>
          <polyline points="26,50 32,44 38,50" fill="none"/>
        </g>
        <circle cx="32" cy="32" r="8" fill="#e5fbff" stroke="#2b1e16" stroke-width="2.5"/>
      </svg>`;
    case 'healing_paw':
      return `<svg class="spell-slot-icon" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <radialGradient id="fg-heal" cx="50%" cy="45%" r="55%">
            <stop offset="0%" stop-color="#e3ffe9"/>
            <stop offset="55%" stop-color="#5ce67a"/>
            <stop offset="100%" stop-color="#1d8f44"/>
          </radialGradient>
        </defs>
        <ellipse cx="20" cy="24" rx="6" ry="7.5" fill="url(#fg-heal)" stroke="#2b1e16" stroke-width="2.6"/>
        <ellipse cx="32" cy="18" rx="6.2" ry="7.8" fill="url(#fg-heal)" stroke="#2b1e16" stroke-width="2.6"/>
        <ellipse cx="44" cy="24" rx="6" ry="7.5" fill="url(#fg-heal)" stroke="#2b1e16" stroke-width="2.6"/>
        <path d="M18 42 C18 33 25 29 32 29 C39 29 46 33 46 42 C46 50 40 54 32 54 C24 54 18 50 18 42 Z" fill="url(#fg-heal)" stroke="#2b1e16" stroke-width="2.8"/>
        <path d="M32 36 V47 M26.5 41.5 H37.5" stroke="#ffffff" stroke-width="3.2" stroke-linecap="round"/>
      </svg>`;
  }
}

function getZoneDisplayName(state: GameState): string {
  if (state.zoneId !== 'overworld') {
    return DUNGEONS[state.zoneId].name;
  }
  if (state.islandId !== 'felingard') {
    return NEW_ISLANDS[state.islandId].name;
  }
  if (state.inVillage) {
    return 'Miaou-bourg';
  }
  const biome =
    state.islandId === 'felingard'
      ? getBiomeAt(state.player.x, state.player.z)
      : getBiomeAtNewIsland(state.islandId, state.player.x, state.player.z);
  switch (biome) {
    case 'village':
      return 'Miaou-bourg';
    case 'forest':
      return 'Bois Griffu';
    case 'frost':
      return 'Monts Prr-Glacés';
    case 'plains':
      return 'Plaines de Miaou-Vert';
    case 'tropical':
      return 'Plage des Ronrons Dorés';
    case 'mountain':
      return 'Griffe-de-Roc';
    case 'mystic':
      return 'Sanctuaire des Ronrons Oubliés';
    case 'wild':
      return 'Terres des Griffes Sauvages';
  }
}

function findActiveBoss(state: GameState): EnemyInstance | null {
  if (state.activeBossId) {
    const match = state.enemies.find(
      (e) => e.id === state.activeBossId && e.state !== 'dead' && e.hp > 0,
    );
    if (match) return match;
  }
  return (
    state.enemies.find(
      (e) =>
        e.isBoss &&
        e.state !== 'dead' &&
        e.hp > 0 &&
        (e.aggroed || e.hp < e.maxHp),
    ) ?? null
  );
}

/**
 * Contrôleur du HUD temps réel en jeu :
 * - Haut-gauche : portrait héros, niveau, zone, PV/PM/XP, Or, Clé Runique
 * - Haut-centre : barre de Boss conditionnelle (nom + Phase 1/2)
 * - Haut-droite : encart quête active + boutons Inventaire (I), Carte (M), Audio, Pause
 * - Bas-centre : bulle d'interaction contextuelle [E] + barre des 4 sorts
 * - Centre-haut : pile de toasts animés
 */
export class HudController {
  private readonly container: HTMLElement;
  private readonly callbacks: HudCallbacks;

  private readonly rootEl: HTMLDivElement;
  private readonly portraitImg: HTMLImageElement;
  private readonly levelBadge: HTMLDivElement;
  private readonly zoneLabel: HTMLSpanElement;
  private readonly goldPill: HTMLDivElement;
  private readonly goldValueEl: HTMLSpanElement;
  private readonly keyBadge: HTMLDivElement;
  private readonly hpTrack: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpText: HTMLSpanElement;
  private readonly mpFill: HTMLDivElement;
  private readonly mpText: HTMLSpanElement;
  private readonly xpFill: HTMLDivElement;
  private readonly xpText: HTMLSpanElement;

  private readonly bossBox: HTMLDivElement;
  private readonly bossName: HTMLSpanElement;
  private readonly bossPhase: HTMLSpanElement;
  private readonly bossFill: HTMLDivElement;
  private readonly bossHpText: HTMLDivElement;

  private readonly muteBtn: HTMLButtonElement;
  private readonly muteIcon: HTMLSpanElement;

  private readonly questCard: HTMLDivElement;
  private readonly questBadge: HTMLSpanElement;
  private readonly questCounter: HTMLSpanElement;
  private readonly questTitle: HTMLDivElement;
  private readonly questObj: HTMLDivElement;

  private readonly promptBtn: HTMLButtonElement;
  private readonly promptText: HTMLSpanElement;
  private readonly spellBar: HTMLDivElement;

  private readonly toastStack: HTMLDivElement;
  private readonly spellSlots: Record<SpellId, SpellSlotRefs>;

  // Cache de valeurs pour éviter tout thrashing DOM à 60 FPS
  private lastVisible = false;
  private lastLevel = -1;
  private lastZone = '';
  private lastGold = -1;
  private lastHasKey = false;
  private lastHpStr = '';
  private lastMpStr = '';
  private lastXpStr = '';
  private lastLowHp = false;
  private lastBossSignature = '';
  private lastQuestSignature = '';
  private lastPromptText = '';
  private lastPromptVisible = false;
  private lastSpellBarVisible = true;
  private goldBumpTimer: number | null = null;
  private toastTimers: Set<number> = new Set();

  constructor(container: HTMLElement, callbacks: HudCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.rootEl = document.createElement('div');
    this.rootEl.className = 'hud-root is-hidden';

    // --- 1. Haut-Gauche : Héros ---
    const heroPanel = document.createElement('div');
    heroPanel.className = 'hud-hero';

    const portraitWrap = document.createElement('div');
    portraitWrap.className = 'hud-portrait-wrap';
    const portraitFrame = document.createElement('div');
    portraitFrame.className = 'hud-portrait-frame';
    this.portraitImg = document.createElement('img');
    this.portraitImg.className = 'hud-portrait-img';
    this.portraitImg.alt = 'Héros';
    this.portraitImg.src = DEFAULT_HERO_SVG;
    portraitFrame.appendChild(this.portraitImg);

    this.levelBadge = document.createElement('div');
    this.levelBadge.className = 'hud-level-badge';
    this.levelBadge.textContent = 'Niv. 1';

    portraitWrap.append(portraitFrame, this.levelBadge);

    const barsCol = document.createElement('div');
    barsCol.className = 'hud-bars-col';

    const metaRow = document.createElement('div');
    metaRow.className = 'hud-hero-meta';

    this.zoneLabel = document.createElement('span');
    this.zoneLabel.className = 'hud-zone-label';
    this.zoneLabel.textContent = 'Miaou-bourg';

    this.goldPill = document.createElement('div');
    this.goldPill.className = 'hud-gold-pill';
    this.goldPill.innerHTML = '<span aria-hidden="true">🪙</span>';
    this.goldValueEl = document.createElement('span');
    this.goldValueEl.textContent = '0 Or';
    this.goldPill.appendChild(this.goldValueEl);

    metaRow.append(this.zoneLabel, this.goldPill);

    // Barre PV
    this.hpTrack = document.createElement('div');
    this.hpTrack.className = 'bar-track';
    this.hpFill = document.createElement('div');
    this.hpFill.className = 'bar-fill bar-fill--hp';
    const hpOverlay = document.createElement('div');
    hpOverlay.className = 'bar-text';
    const hpLabel = document.createElement('span');
    hpLabel.textContent = 'PV';
    this.hpText = document.createElement('span');
    this.hpText.textContent = '100 / 100';
    hpOverlay.append(hpLabel, this.hpText);
    this.hpTrack.append(this.hpFill, hpOverlay);

    // Barre PM
    const mpTrack = document.createElement('div');
    mpTrack.className = 'bar-track';
    this.mpFill = document.createElement('div');
    this.mpFill.className = 'bar-fill bar-fill--mp';
    const mpOverlay = document.createElement('div');
    mpOverlay.className = 'bar-text';
    const mpLabel = document.createElement('span');
    mpLabel.textContent = 'PM';
    this.mpText = document.createElement('span');
    this.mpText.textContent = '100 / 100';
    mpOverlay.append(mpLabel, this.mpText);
    mpTrack.append(this.mpFill, mpOverlay);

    // Barre XP
    const xpTrack = document.createElement('div');
    xpTrack.className = 'bar-track bar-track--xp';
    this.xpFill = document.createElement('div');
    this.xpFill.className = 'bar-fill bar-fill--xp';
    this.xpFill.style.width = '0%';
    const xpOverlay = document.createElement('div');
    xpOverlay.className = 'bar-text bar-text--xp';
    this.xpText = document.createElement('span');
    this.xpText.textContent = 'XP 0 / 80';
    xpOverlay.appendChild(this.xpText);
    xpTrack.append(this.xpFill, xpOverlay);

    // Badge Clé Runique
    this.keyBadge = document.createElement('div');
    this.keyBadge.className = 'hud-key-badge is-hidden';
    this.keyBadge.textContent = '🗝️ Clé Runique';

    barsCol.append(metaRow, this.hpTrack, mpTrack, xpTrack, this.keyBadge);
    heroPanel.append(portraitWrap, barsCol);

    // --- 2. Haut-Centre : Barre Boss ---
    this.bossBox = document.createElement('div');
    this.bossBox.className = 'hud-boss is-hidden';

    const bossHeader = document.createElement('div');
    bossHeader.className = 'hud-boss-header';
    this.bossName = document.createElement('span');
    this.bossName.className = 'hud-boss-name';
    this.bossPhase = document.createElement('span');
    this.bossPhase.className = 'hud-boss-phase';
    bossHeader.append(this.bossName, this.bossPhase);

    const bossTrack = document.createElement('div');
    bossTrack.className = 'hud-boss-track';
    this.bossFill = document.createElement('div');
    this.bossFill.className = 'hud-boss-fill';
    this.bossHpText = document.createElement('div');
    this.bossHpText.className = 'hud-boss-hp-text';
    bossTrack.append(this.bossFill, this.bossHpText);

    this.bossBox.append(bossHeader, bossTrack);

    // --- 3. Haut-Droite : Boutons rapides + Encart Quête ---
    const topRight = document.createElement('div');
    topRight.className = 'hud-top-right';

    const actionsRow = document.createElement('div');
    actionsRow.className = 'hud-actions';

    const invBtn = this.createHudActionButton('🎒', 'I', 'Inventaire & Équipement (I)', () => {
      this.callbacks.onToggleInventory();
    });
    const mapBtn = this.createHudActionButton('🗺️', 'M', 'Carte du Monde (M)', () => {
      this.callbacks.onToggleMap();
    });

    this.muteBtn = document.createElement('button');
    this.muteBtn.type = 'button';
    this.muteBtn.className = 'hud-btn';
    this.muteBtn.title = 'Activer / Couper le son';
    this.muteBtn.setAttribute('aria-label', 'Audio');
    this.muteIcon = document.createElement('span');
    this.muteIcon.textContent = '🔊';
    this.muteBtn.appendChild(this.muteIcon);
    this.muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onToggleMute();
    });

    const pauseBtn = this.createHudActionButton('⏸️', 'Éch', 'Pause (Échap)', () => {
      this.callbacks.onTogglePause();
    });

    actionsRow.append(invBtn, mapBtn, this.muteBtn, pauseBtn);

    this.questCard = document.createElement('div');
    this.questCard.className = 'hud-quest-card';
    this.questCard.title = 'Cliquer pour ouvrir le Panneau de Quêtes';
    this.questCard.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onOpenQuests?.();
    });

    const questTop = document.createElement('div');
    questTop.className = 'hud-quest-top';
    this.questBadge = document.createElement('span');
    this.questBadge.className = 'hud-quest-badge';
    this.questBadge.textContent = 'Quête Principale';
    this.questCounter = document.createElement('span');
    this.questCounter.className = 'hud-quest-counter is-hidden';
    questTop.append(this.questBadge, this.questCounter);

    this.questTitle = document.createElement('div');
    this.questTitle.className = 'hud-quest-title';
    this.questObj = document.createElement('div');
    this.questObj.className = 'hud-quest-obj';
    this.questCard.append(questTop, this.questTitle, this.questObj);

    topRight.append(actionsRow, this.questCard);

    // --- 4. Bas-Centre : Prompt Contextuel + Barre des 4 Sorts ---
    const bottomCenter = document.createElement('div');
    bottomCenter.className = 'hud-bottom-center';

    this.promptBtn = document.createElement('button');
    this.promptBtn.type = 'button';
    this.promptBtn.className = 'interact-prompt is-hidden';
    const promptKey = document.createElement('span');
    promptKey.className = 'keycap';
    promptKey.textContent = 'E';
    this.promptText = document.createElement('span');
    this.promptBtn.append(promptKey, this.promptText);
    this.promptBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onInteract();
    });

    this.spellBar = document.createElement('div');
    this.spellBar.className = 'spell-bar';

    const slotsMap = {} as Record<SpellId, SpellSlotRefs>;
    SPELL_ORDER.forEach((spellId, index) => {
      const def = SPELLS[spellId];
      const slotBtn = document.createElement('button');
      slotBtn.type = 'button';
      slotBtn.className = 'spell-slot';
      slotBtn.title = `${def.name} (${def.hotkeyLabel}) — ${def.mpCost} PM — ${def.shortDesc}`;
      slotBtn.setAttribute('aria-label', `${def.name}, coût ${def.mpCost} PM`);

      const inner = document.createElement('div');
      inner.className = 'spell-slot-inner';
      inner.innerHTML = getSpellSvgMarkup(spellId);

      const cdVeil = document.createElement('div');
      cdVeil.className = 'spell-slot-cd-veil';

      const cdText = document.createElement('div');
      cdText.className = 'spell-slot-cd-text';

      inner.append(cdVeil, cdText);

      const keyBadge = document.createElement('span');
      keyBadge.className = 'spell-slot-key';
      keyBadge.textContent = String(index + 1);

      const lvlBadge = document.createElement('span');
      lvlBadge.className = 'spell-slot-lvl';
      lvlBadge.textContent = 'N.1';

      const mpBadge = document.createElement('span');
      mpBadge.className = 'spell-slot-mp';
      mpBadge.textContent = `${def.mpCost} PM`;

      slotBtn.append(inner, keyBadge, lvlBadge, mpBadge);
      slotBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onCastSpell(spellId);
      });

      this.spellBar.appendChild(slotBtn);
      slotsMap[spellId] = {
        button: slotBtn,
        cdVeil,
        cdText,
        lvlBadge,
        mpBadge,
        lastCdPct: '0%',
        lastCdLabel: '',
        lastNoMp: false,
        lastCooldown: false,
        lastLevel: 1,
      };
    });
    this.spellSlots = slotsMap;

    bottomCenter.append(this.promptBtn, this.spellBar);

    // --- 5. Toasts ---
    this.toastStack = document.createElement('div');
    this.toastStack.className = 'toast-stack';

    this.rootEl.append(heroPanel, this.bossBox, topRight, bottomCenter, this.toastStack);
    this.container.appendChild(this.rootEl);
  }

  public setHeroPortrait(dataUrl: string): void {
    if (!dataUrl) return;
    this.portraitImg.src = dataUrl;
  }

  public setMuted(muted: boolean): void {
    this.muteIcon.textContent = muted ? '🔇' : '🔊';
    this.muteBtn.classList.toggle('is-muted', muted);
    this.muteBtn.title = muted ? 'Son coupé — Cliquer pour réactiver' : 'Couper le son';
  }

  public setVisible(visible: boolean): void {
    if (visible === this.lastVisible) return;
    this.lastVisible = visible;
    this.rootEl.classList.toggle('is-hidden', !visible);
  }

  /**
   * Affiche une notification toast animée (auto-effacée).
   */
  public showToast(
    message: string,
    variant: ToastVariant = 'info',
    durationMs = 3200,
  ): void {
    if (!message) return;

    // Limite à 4 toasts visibles simultanément
    while (this.toastStack.children.length >= 4) {
      const oldest = this.toastStack.firstElementChild;
      if (oldest) oldest.remove();
    }

    const item = document.createElement('div');
    item.className = `toast-item toast-item--${variant}`;
    item.textContent = message;
    this.toastStack.appendChild(item);

    const leaveTimer = window.setTimeout(() => {
      this.toastTimers.delete(leaveTimer);
      item.classList.add('is-leaving');
      const removeTimer = window.setTimeout(() => {
        this.toastTimers.delete(removeTimer);
        item.remove();
      }, 300);
      this.toastTimers.add(removeTimer);
    }, Math.max(800, durationMs));
    this.toastTimers.add(leaveTimer);
  }

  /**
   * Consomme les événements de simulation pour déclencher les toasts clés.
   */
  public handleEvents(events: readonly GameEvent[]): void {
    const seenMessages = new Set<string>();
    const emitUniqueToast = (
      message: string,
      variant: ToastVariant,
      durationMs: number,
    ): void => {
      if (!message || seenMessages.has(message)) return;
      seenMessages.add(message);
      this.showToast(message, variant, durationMs);
    };

    for (const ev of events) {
      switch (ev.type) {
        case 'level_up': {
          const lvl = ev.value ?? 2;
          emitUniqueToast(
            ev.text ?? `Niveau ${lvl} atteint ! PV & PM restaurés !`,
            'level',
            3600,
          );
          break;
        }
        case 'item_upgraded': {
          const def = ev.itemId ? getEquipmentDefinition(ev.itemId) : undefined;
          const label =
            ev.text ??
            (def
              ? `${def.name} amélioré Niv. ${ev.itemLevel ?? 2} !`
              : `Équipement amélioré Niv. ${ev.itemLevel ?? 2} !`);
          emitUniqueToast(label, 'epic', 3500);
          break;
        }
        case 'chest_opened': {
          if (ev.text) {
            emitUniqueToast(ev.text, 'gold', 3200);
          }
          break;
        }
        case 'quest_updated': {
          emitUniqueToast(ev.text ?? 'Quête mise à jour !', 'quest', 3200);
          break;
        }
        case 'quest_completed': {
          emitUniqueToast(ev.text ?? 'Quête accomplie !', 'level', 3800);
          break;
        }
        case 'player_rested': {
          emitUniqueToast(
            ev.text ?? 'Zzz... Miaou ! PV & PM restaurés et partie sauvegardée !',
            'info',
            3400,
          );
          break;
        }
        case 'toast': {
          if (ev.text) {
            emitUniqueToast(ev.text, 'info', 3000);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * Met à jour l'ensemble du HUD depuis l'état de simulation courant (sans reconstructions DOM).
   */
  public update(state: GameState): void {
    const shouldShow = state.screen === 'playing' || state.screen === 'paused';
    const wasVisible = this.lastVisible;

    // Synchronise la visibilité de la barre des sorts avant d'afficher le HUD
    // afin d'éviter tout flash fugace lors d'une Nouvelle Partie (dialogue d'intro immédiat)
    const isDialogueOpen =
      state.dialogue.active && state.dialogue.lines.length > 0;
    const showSpellBar = !isDialogueOpen;
    if (showSpellBar !== this.lastSpellBarVisible) {
      this.lastSpellBarVisible = showSpellBar;
      if (!wasVisible && shouldShow && !showSpellBar) {
        this.spellBar.style.transition = 'none';
        this.spellBar.classList.add('is-hidden');
        void this.spellBar.offsetWidth;
        this.spellBar.style.transition = '';
      } else {
        this.spellBar.classList.toggle('is-hidden', !showSpellBar);
      }
    }

    this.setVisible(shouldShow);
    if (!shouldShow) return;

    const p = state.player;

    // Niveau
    if (p.level !== this.lastLevel) {
      this.lastLevel = p.level;
      this.levelBadge.textContent = `Niv. ${p.level}`;
    }

    // Zone / Biome
    const zoneName = getZoneDisplayName(state);
    if (zoneName !== this.lastZone) {
      this.lastZone = zoneName;
      this.zoneLabel.textContent = zoneName;
    }

    // Or + animation bump si gain
    if (p.gold !== this.lastGold) {
      const gained = this.lastGold >= 0 && p.gold > this.lastGold;
      this.lastGold = p.gold;
      this.goldValueEl.textContent = `${p.gold} Or`;
      if (gained) {
        this.goldPill.classList.remove('is-bump');
        void this.goldPill.offsetWidth;
        this.goldPill.classList.add('is-bump');
        if (this.goldBumpTimer !== null) window.clearTimeout(this.goldBumpTimer);
        this.goldBumpTimer = window.setTimeout(() => {
          this.goldPill.classList.remove('is-bump');
          this.goldBumpTimer = null;
        }, 380);
      }
    }

    // Clé Runique
    if (p.hasRunicKey !== this.lastHasKey) {
      this.lastHasKey = p.hasRunicKey;
      this.keyBadge.classList.toggle('is-hidden', !p.hasRunicKey);
    }

    // PV
    const hpCur = Math.max(0, Math.round(p.hp));
    const hpMax = Math.max(1, Math.round(p.maxHp));
    const hpRatio = Math.max(0, Math.min(1, p.hp / hpMax));
    const hpStr = `${hpCur} / ${hpMax}`;
    if (hpStr !== this.lastHpStr) {
      this.lastHpStr = hpStr;
      this.hpText.textContent = hpStr;
      this.hpFill.style.width = `${(hpRatio * 100).toFixed(1)}%`;
    }
    const isLowHp = hpRatio > 0 && hpRatio < 0.28;
    if (isLowHp !== this.lastLowHp) {
      this.lastLowHp = isLowHp;
      this.hpTrack.classList.toggle('is-low-hp', isLowHp);
    }

    // PM
    const mpCur = Math.max(0, Math.round(p.mp));
    const mpMax = Math.max(1, Math.round(p.maxMp));
    const mpRatio = Math.max(0, Math.min(1, p.mp / mpMax));
    const mpStr = `${mpCur} / ${mpMax}`;
    if (mpStr !== this.lastMpStr) {
      this.lastMpStr = mpStr;
      this.mpText.textContent = mpStr;
      this.mpFill.style.width = `${(mpRatio * 100).toFixed(1)}%`;
    }

    // XP
    const isMaxLvl = p.level >= MAX_PLAYER_LEVEL;
    const xpRatio = isMaxLvl
      ? 1
      : Math.max(0, Math.min(1, p.xp / Math.max(1, p.xpToNext)));
    const xpStr = isMaxLvl ? 'NIVEAU MAX' : `XP ${Math.round(p.xp)} / ${p.xpToNext}`;
    if (xpStr !== this.lastXpStr) {
      this.lastXpStr = xpStr;
      this.xpText.textContent = xpStr;
      this.xpFill.style.width = `${(xpRatio * 100).toFixed(1)}%`;
    }

    // Barre de Boss conditionnelle
    this.updateBossBar(state);

    // Encart Quête active
    this.updateQuestCard(state);

    // Barre des 4 Sorts (visibilité déjà synchronisée avec l'état de dialogue en début d'update)
    this.updateSpellBar(state);

    // Bulle d'interaction contextuelle [E]
    const showPrompt =
      state.screen === 'playing' &&
      state.activeModal === 'none' &&
      !state.dialogue.active &&
      state.nearestInteractable !== null;
    const promptLabel = state.nearestInteractable?.label ?? '';

    if (showPrompt !== this.lastPromptVisible) {
      this.lastPromptVisible = showPrompt;
      this.promptBtn.classList.toggle('is-hidden', !showPrompt);
    }
    if (showPrompt && promptLabel !== this.lastPromptText) {
      this.lastPromptText = promptLabel;
      this.promptText.textContent = promptLabel;
    }
  }

  public dispose(): void {
    if (this.goldBumpTimer !== null) {
      window.clearTimeout(this.goldBumpTimer);
      this.goldBumpTimer = null;
    }
    for (const id of this.toastTimers) {
      window.clearTimeout(id);
    }
    this.toastTimers.clear();
    this.rootEl.remove();
  }

  private createHudActionButton(
    icon: string,
    keyHint: string,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hud-btn';
    btn.title = title;
    btn.setAttribute('aria-label', title);

    const iconSpan = document.createElement('span');
    iconSpan.textContent = icon;
    const keySpan = document.createElement('span');
    keySpan.className = 'hud-btn-key';
    keySpan.textContent = keyHint;

    btn.append(iconSpan, keySpan);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  private updateBossBar(state: GameState): void {
    const boss = findActiveBoss(state);
    if (!boss) {
      if (this.lastBossSignature !== 'none') {
        this.lastBossSignature = 'none';
        this.bossBox.classList.add('is-hidden');
        this.bossBox.classList.remove('is-phase-two');
      }
      return;
    }

    const hpCur = Math.max(0, Math.round(boss.hp));
    const hpMax = Math.max(1, Math.round(boss.maxHp));
    const sig = `${boss.id}|${hpCur}|${hpMax}|${boss.phase}`;
    if (sig === this.lastBossSignature) return;
    this.lastBossSignature = sig;

    const pct = Math.max(0, Math.min(100, (boss.hp / hpMax) * 100));
    this.bossBox.classList.remove('is-hidden');
    this.bossBox.classList.toggle('is-phase-two', boss.phase === 2);
    this.bossName.textContent = `${boss.name}  (Niv. ${boss.level})`;
    this.bossPhase.textContent = boss.phase === 2 ? 'Phase 2 — Fureur !' : 'Phase 1';
    this.bossFill.style.width = `${pct.toFixed(1)}%`;
    this.bossHpText.textContent = `${hpCur} / ${hpMax} PV`;
  }

  private updateQuestCard(state: GameState): void {
    const trackedId = state.trackedQuestId;
    const progress = trackedId ? state.quests[trackedId] : undefined;
    const def = trackedId ? QUESTS[trackedId] : undefined;

    if (!def || !progress || progress.status !== 'active') {
      const sig = 'no_active_quest';
      if (sig === this.lastQuestSignature) return;
      this.lastQuestSignature = sig;
      this.questBadge.textContent = 'Journal';
      this.questBadge.classList.remove('hud-quest-badge--side');
      this.questCounter.classList.add('is-hidden');
      this.questTitle.textContent = 'Exploration libre';
      this.questObj.textContent =
        'Consultez le Panneau de Quêtes à Miaou-bourg pour de nouvelles aventures.';
      return;
    }

    const step = def.steps[progress.stepIndex] ?? def.steps[def.steps.length - 1];
    const sig = `${def.id}|${progress.stepIndex}|${progress.counter}`;
    if (sig === this.lastQuestSignature) return;
    this.lastQuestSignature = sig;

    this.questBadge.textContent = def.isMain ? 'Principale' : 'Secondaire';
    this.questBadge.classList.toggle('hud-quest-badge--side', !def.isMain);
    this.questTitle.textContent = def.title;
    this.questObj.textContent = step ? step.description : def.summary;

    if (step && step.requiredCount > 1) {
      this.questCounter.textContent = `${Math.min(progress.counter, step.requiredCount)} / ${step.requiredCount}`;
      this.questCounter.classList.remove('is-hidden');
    } else {
      this.questCounter.classList.add('is-hidden');
    }
  }

  private updateSpellBar(state: GameState): void {
    const p = state.player;
    for (const spellId of SPELL_ORDER) {
      const def = SPELLS[spellId];
      const refs = this.spellSlots[spellId];
      const level = p.spellLevels[spellId] ?? 1;
      const cd = Math.max(0, p.spellCooldowns[spellId] ?? 0);
      const isCooldown = cd > 0.04;
      const isNoMp = p.mp < def.mpCost;

      if (level !== refs.lastLevel) {
        refs.lastLevel = level;
        refs.lvlBadge.textContent = `N.${level}`;
      }

      if (isNoMp !== refs.lastNoMp) {
        refs.lastNoMp = isNoMp;
        refs.button.classList.toggle('is-no-mp', isNoMp);
      }

      if (isCooldown !== refs.lastCooldown) {
        refs.lastCooldown = isCooldown;
        refs.button.classList.toggle('is-cooldown', isCooldown);
      }

      const pct = isCooldown
        ? `${Math.min(100, (cd / def.cooldown) * 100).toFixed(1)}%`
        : '0%';
      if (pct !== refs.lastCdPct) {
        refs.lastCdPct = pct;
        refs.cdVeil.style.height = pct;
      }

      const cdLabel = isCooldown ? `${cd.toFixed(1)}s` : '';
      if (cdLabel !== refs.lastCdLabel) {
        refs.lastCdLabel = cdLabel;
        refs.cdText.textContent = cdLabel;
      }
    }
  }
}
