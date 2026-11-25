import { DUNGEONS } from '../data/dungeonsData';
import { NEW_ISLANDS } from '../data/worldIslands';
import type {
  GameEvent,
  GameState,
  IslandId,
  ScreenMode,
  SpeakerPortraitId,
  ZoneId,
} from '../game/types';

export interface ScreensCallbacks {
  onNewGame: () => void;
  onContinueGame: () => void;
  onAdvanceDialogue: () => void;
  onResumeGame: () => void;
  onReturnToTitle: () => void;
  onRespawnAtInn: () => void;
  onContinueAfterVictory: () => void;
  onSetWeather: (condition: 'auto' | 'clear' | 'fog' | 'storm') => void;
}

function encodeSvg(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Portraits SVG par défaut pour les 7 personnages (remplaçables via setPortrait)
const DEFAULT_PORTRAITS: Record<SpeakerPortraitId, string> = {
  miaou_sprit: encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
      <rect width="96" height="96" fill="#23375e"/>
      <circle cx="48" cy="48" r="36" fill="rgba(123,227,255,0.22)"/>
      <path d="M24 46 L29 20 L43 34 L53 34 L67 20 L72 46 C74 64 62 76 48 76 C34 76 22 64 24 46 Z" fill="#9deeff" stroke="#2b1e16" stroke-width="3"/>
      <polygon points="48,14 52,24 62,25 54,31 56,41 48,35 40,41 42,31 34,25 44,24" fill="#ffe166" stroke="#2b1e16" stroke-width="2" transform="translate(0 -4) scale(0.55) translate(39 6)"/>
      <circle cx="38" cy="52" r="4.5" fill="#1e2d52"/>
      <circle cx="58" cy="52" r="4.5" fill="#1e2d52"/>
      <circle cx="39.5" cy="50.5" r="1.5" fill="#fff"/>
      <circle cx="59.5" cy="50.5" r="1.5" fill="#fff"/>
      <path d="M43 62 Q48 67 53 62" fill="none" stroke="#1e2d52" stroke-width="2.8" stroke-linecap="round"/>
    </svg>`,
  ),
  mayor_moustache: encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
      <rect width="96" height="96" fill="#4f6d43"/>
      <path d="M22 48 L28 24 L42 36 L54 36 L68 24 L74 48 C76 66 64 78 48 78 C32 78 20 66 22 48 Z" fill="#d9c6a3" stroke="#2b1e16" stroke-width="3"/>
      <rect x="26" y="14" width="44" height="17" rx="4" fill="#2b2638" stroke="#2b1e16" stroke-width="2.6"/>
      <rect x="20" y="29" width="56" height="6" rx="3" fill="#f2be42" stroke="#2b1e16" stroke-width="2.2"/>
      <circle cx="38" cy="50" r="4" fill="#2b1e16"/>
      <circle cx="58" cy="50" r="4" fill="#2b1e16"/>
      <path d="M24 63 Q36 55 48 62 Q60 55 72 63 Q60 72 48 66 Q36 72 24 63 Z" fill="#ffffff" stroke="#2b1e16" stroke-width="2.4"/>
    </svg>`,
  ),
  kit_chat: encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
      <rect width="96" height="96" fill="#5e321e"/>
      <path d="M22 44 L28 18 L43 32 L53 32 L68 18 L74 44 C76 64 64 78 48 78 C32 78 20 64 22 44 Z" fill="#6e5a50" stroke="#2b1e16" stroke-width="3"/>
      <rect x="24" y="34" width="48" height="9" rx="4" fill="#f2be42" stroke="#2b1e16" stroke-width="2.4"/>
      <circle cx="37" cy="53" r="4.2" fill="#2b1e16"/>
      <circle cx="59" cy="53" r="4.2" fill="#2b1e16"/>
      <polygon points="48,58 44,62 52,62" fill="#d97b7b"/>
    </svg>`,
  ),
  innkeeper: encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
      <rect width="96" height="96" fill="#704a30"/>
      <path d="M22 44 L28 18 L43 32 L53 32 L68 18 L74 44 C76 64 64 78 48 78 C32 78 20 64 22 44 Z" fill="#f5d5b0" stroke="#2b1e16" stroke-width="3"/>
      <path d="M32 52 Q37 47 42 52 M54 52 Q59 47 64 52" fill="none" stroke="#2b1e16" stroke-width="3" stroke-linecap="round"/>
      <path d="M43 63 Q48 67 53 63" fill="none" stroke="#2b1e16" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`,
  ),
  hero: encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
      <rect width="96" height="96" fill="#5e8d50"/>
      <path d="M22 42 L28 16 L43 31 L53 31 L68 16 L74 42 C77 62 66 78 48 78 C30 78 19 62 22 42 Z" fill="#e98d3c" stroke="#2b1e16" stroke-width="3.5"/>
      <path d="M21 37 Q48 27 75 37 L73 45 Q48 36 23 45 Z" fill="#d93d3d" stroke="#2b1e16" stroke-width="2.5"/>
      <circle cx="37" cy="52" r="4.5" fill="#2b1e16"/>
      <circle cx="59" cy="52" r="4.5" fill="#2b1e16"/>
      <polygon points="48,57 44,61 52,61" fill="#d45555"/>
    </svg>`,
  ),
  boss_rat_king: encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
      <rect width="96" height="96" fill="#2b1d45"/>
      <circle cx="24" cy="34" r="14" fill="#8b6ec4" stroke="#2b1e16" stroke-width="3"/>
      <circle cx="72" cy="34" r="14" fill="#8b6ec4" stroke="#2b1e16" stroke-width="3"/>
      <ellipse cx="48" cy="55" rx="26" ry="24" fill="#a286d9" stroke="#2b1e16" stroke-width="3"/>
      <polygon points="30,34 36,16 48,26 60,16 66,34" fill="#f5c542" stroke="#2b1e16" stroke-width="2.5"/>
      <circle cx="39" cy="52" r="4" fill="#ffe14d"/>
      <circle cx="57" cy="52" r="4" fill="#ffe14d"/>
    </svg>`,
  ),
  boss_dragon_claw: encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
      <rect width="96" height="96" fill="#3a1219"/>
      <path d="M18 28 L34 12 L42 30 L54 30 L62 12 L78 28 L72 68 C66 79 30 79 24 68 Z" fill="#b5283a" stroke="#2b1e16" stroke-width="3.2"/>
      <polygon points="24,26 14,10 34,20" fill="#f4b942" stroke="#2b1e16" stroke-width="2.4"/>
      <polygon points="72,26 82,10 62,20" fill="#f4b942" stroke="#2b1e16" stroke-width="2.4"/>
      <polygon points="34,48 44,53 35,56" fill="#ffe047"/>
      <polygon points="62,48 52,53 61,56" fill="#ffe047"/>
      <path d="M35 66 Q48 61 61 66" fill="none" stroke="#ffd88a" stroke-width="3" stroke-linecap="round"/>
    </svg>`,
  ),
};

function formatPlayTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}h ${pad(mins)}m ${pad(secs)}s`;
  }
  return `${mins} min ${pad(secs)} s`;
}

function getZoneBannerName(
  zoneId: ZoneId | undefined,
  islandId?: IslandId,
): string {
  if (!zoneId || zoneId === 'overworld') {
    if (islandId && islandId !== 'felingard') {
      return NEW_ISLANDS[islandId].name;
    }
    return 'Île de Félingard';
  }
  return DUNGEONS[zoneId].name;
}

/**
 * Contrôleur des écrans pleins et dialogues :
 * - Écran Titre transparent sur scène 2.5D animée
 * - Boîte de Dialogue VF avec portraits
 * - Menu Pause (Échap)
 * - Fondu de transition entre zones & sieste à l'Auberge (« Zzz... Miaou ! »)
 * - Écran de Défaite (« Chat-astrophe ! »)
 * - Écran de Victoire (« Légende de Félingard ! »)
 */
export class ScreensController {
  private readonly container: HTMLElement;
  private readonly callbacks: ScreensCallbacks;
  private readonly portraits: Record<SpeakerPortraitId, string> = {
    ...DEFAULT_PORTRAITS,
  };

  private readonly rootEl: HTMLDivElement;

  // Écran Titre
  private readonly titleEl: HTMLDivElement;
  private readonly continueBtn: HTMLButtonElement;

  // Boîte de Dialogue
  private readonly dialogueWrap: HTMLDivElement;
  private readonly dialoguePortraitImg: HTMLImageElement;
  private readonly dialogueSpeaker: HTMLSpanElement;
  private readonly dialogueProgress: HTMLSpanElement;
  private readonly dialogueText: HTMLParagraphElement;

  // Menu Pause
  private readonly pauseEl: HTMLDivElement;

  // Écran Défaite
  private readonly defeatEl: HTMLDivElement;

  // Écran Victoire
  private readonly victoryEl: HTMLDivElement;
  private readonly victoryTimeVal: HTMLSpanElement;
  private readonly victoryLevelVal: HTMLSpanElement;
  private readonly victoryEnemiesVal: HTMLSpanElement;
  private readonly victoryChestsVal: HTMLSpanElement;

  // Fondu de transition & bannière de zone découplée
  private readonly transitionEl: HTMLDivElement;
  private readonly transitionTextEl: HTMLDivElement;
  private readonly zoneBannerEl: HTMLDivElement;

  private hasSave = false;
  private lastScreen: ScreenMode | null = null;
  private lastPauseVisible = false;
  private lastDialogueKey = '';
  private lastVictoryStatsKey = '';
  private lastFadeValue = -1;

  // Override temporaire du texte et fondu manuel (ex: sieste à l'Auberge)
  private transitionLabel = '';
  private manualFadeActive = false;
  private manualFadeTimer: number | null = null;
  private labelClearTimer: number | null = null;
  private zoneBannerHoldTimer: number | null = null;
  private zoneBannerClearTimer: number | null = null;

  constructor(container: HTMLElement, callbacks: ScreensCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.rootEl = document.createElement('div');
    this.rootEl.className = 'screen-root';

    // ========================================================================
    // 1. ÉCRAN TITRE (transparent sur scène 2.5D animée)
    // ========================================================================
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'title-screen is-hidden';

    const banner = document.createElement('div');
    banner.className = 'title-hero-banner';
    banner.innerHTML = `
      <svg class="title-crest" viewBox="0 0 96 96" aria-hidden="true">
        <circle cx="48" cy="48" r="44" fill="#3b2214" stroke="#f2be42" stroke-width="4.5"/>
        <path d="M22 46 L29 18 L43 32 L53 32 L67 18 L74 46 C76 64 64 78 48 78 C32 78 20 64 22 46 Z" fill="#e98d3c" stroke="#2b1e16" stroke-width="3.5"/>
        <polygon points="33,24 40,10 48,19 56,10 63,24" fill="#ffe07a" stroke="#2b1e16" stroke-width="2.5"/>
        <circle cx="38" cy="52" r="4.5" fill="#2b1e16"/>
        <circle cx="58" cy="52" r="4.5" fill="#2b1e16"/>
        <polygon points="48,58 44,62 52,62" fill="#d45555"/>
      </svg>
      <h1 class="title-main">Les Chroniques de Félingard</h1>
      <div class="title-divider" aria-hidden="true"></div>
      <p class="title-sub">L'Éveil du Sang-de-Dragon — Action-RPG 2.5D</p>
    `;

    const titleActions = document.createElement('div');
    titleActions.className = 'title-actions';

    const newGameBtn = document.createElement('button');
    newGameBtn.type = 'button';
    newGameBtn.className = 'wood-btn wood-btn--gold';
    newGameBtn.textContent = '⚔️ Nouvelle Partie';
    newGameBtn.addEventListener('click', () => this.callbacks.onNewGame());

    this.continueBtn = document.createElement('button');
    this.continueBtn.type = 'button';
    this.continueBtn.className = 'wood-btn';
    this.continueBtn.textContent = '📜 Continuer';
    this.continueBtn.disabled = true;
    this.continueBtn.title = 'Aucune sauvegarde trouvée';
    this.continueBtn.addEventListener('click', () => {
      if (this.hasSave) {
        this.callbacks.onContinueGame();
      }
    });

    titleActions.append(newGameBtn, this.continueBtn);

    const controlsMemo = document.createElement('div');
    controlsMemo.className = 'controls-memo';
    controlsMemo.innerHTML = `
      <div class="controls-memo-title">Commandes — AZERTY • QWERTY • Souris • Manette</div>
      <div class="controls-memo-grid">
        <span class="controls-memo-item"><span class="controls-memo-keys">ZQSD / WASD / Flèches / Stick G</span> Déplacer</span>
        <span class="controls-memo-item"><span class="controls-memo-keys">Clic G / Espace / J / A</span> Attaque (+PM)</span>
        <span class="controls-memo-item"><span class="controls-memo-keys">Clic D / Maj / K / B</span> Roulade</span>
        <span class="controls-memo-item"><span class="controls-memo-keys">1-7 / A E R F C V X / Gâchettes</span> Sorts</span>
        <span class="controls-memo-item"><span class="controls-memo-keys">E / Entrée / X</span> Interagir</span>
        <span class="controls-memo-item"><span class="controls-memo-keys">I</span> Inventaire • <span class="controls-memo-keys">M</span> Carte • <span class="controls-memo-keys">Échap</span> Pause</span>
      </div>
    `;

    this.titleEl.append(banner, titleActions, controlsMemo);

    // ========================================================================
    // 2. BOÎTE DE DIALOGUE
    // ========================================================================
    this.dialogueWrap = document.createElement('div');
    this.dialogueWrap.className = 'dialogue-wrap is-hidden';

    const dialogueBox = document.createElement('div');
    dialogueBox.className = 'parchment-panel dialogue-box';
    dialogueBox.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onAdvanceDialogue();
    });

    const portraitBox = document.createElement('div');
    portraitBox.className = 'dialogue-portrait';
    this.dialoguePortraitImg = document.createElement('img');
    this.dialoguePortraitImg.alt = 'Portrait du personnage';
    portraitBox.appendChild(this.dialoguePortraitImg);

    const contentCol = document.createElement('div');
    contentCol.className = 'dialogue-content';

    const diagHeader = document.createElement('div');
    diagHeader.className = 'dialogue-header';
    this.dialogueSpeaker = document.createElement('span');
    this.dialogueSpeaker.className = 'dialogue-speaker';
    this.dialogueProgress = document.createElement('span');
    this.dialogueProgress.className = 'dialogue-progress';
    diagHeader.append(this.dialogueSpeaker, this.dialogueProgress);

    this.dialogueText = document.createElement('p');
    this.dialogueText.className = 'dialogue-text';

    const diagFooter = document.createElement('div');
    diagFooter.className = 'dialogue-footer';
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'wood-btn wood-btn--gold wood-btn--small';
    nextBtn.textContent = 'Continuer [E / Espace]';
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onAdvanceDialogue();
    });
    diagFooter.appendChild(nextBtn);

    contentCol.append(diagHeader, this.dialogueText, diagFooter);
    dialogueBox.append(portraitBox, contentCol);
    this.dialogueWrap.appendChild(dialogueBox);

    // ========================================================================
    // 3. MENU PAUSE
    // ========================================================================
    this.pauseEl = document.createElement('div');
    this.pauseEl.className = 'center-screen-overlay is-hidden';

    const pauseCard = document.createElement('div');
    pauseCard.className = 'parchment-panel center-screen-card';
    pauseCard.innerHTML = `
      <h2 class="center-screen-title">Pause</h2>
      <p class="center-screen-desc">
        Prenez le temps de faire votre toilette, jeune Chat-valier.
      </p>
      <div class="center-screen-note">
        🛏️ <strong>Sauvegarde à l'Auberge</strong> : Reposez-vous à
        <em>l'Auberge du Coussin Doux</em> à Miaou-bourg pour restaurer 100 % de vos PV/PM
        et enregistrer votre partie. Une sauvegarde automatique s'effectue aussi après chaque quête ou boss.
      </div>
    `;

    const pauseButtons = document.createElement('div');
    pauseButtons.className = 'center-screen-buttons';
    const resumeBtn = document.createElement('button');
    resumeBtn.type = 'button';
    resumeBtn.className = 'wood-btn wood-btn--gold';
    resumeBtn.textContent = '▶ Reprendre';
    resumeBtn.addEventListener('click', () => this.callbacks.onResumeGame());

    const returnTitleBtn = document.createElement('button');
    returnTitleBtn.type = 'button';
    returnTitleBtn.className = 'wood-btn wood-btn--secondary';
    returnTitleBtn.textContent = 'Retour au Titre';
    returnTitleBtn.addEventListener('click', () => this.callbacks.onReturnToTitle());

    const weatherLabel = document.createElement('label');
    weatherLabel.className = 'pause-weather-row';
    weatherLabel.innerHTML = '<span>Météo</span>';
    const weatherSelect = document.createElement('select');
    weatherSelect.setAttribute('aria-label', 'Choisir la météo');
    weatherSelect.innerHTML = `
      <option value="auto">Automatique</option>
      <option value="clear">Beau temps</option>
      <option value="fog">Brouillard</option>
      <option value="storm">Tempête</option>`;
    weatherSelect.addEventListener('change', () => {
      this.callbacks.onSetWeather(weatherSelect.value as 'auto' | 'clear' | 'fog' | 'storm');
    });
    weatherLabel.appendChild(weatherSelect);

    pauseButtons.append(resumeBtn, returnTitleBtn);
    pauseCard.append(weatherLabel, pauseButtons);
    this.pauseEl.appendChild(pauseCard);

    // ========================================================================
    // 4. ÉCRAN DE DÉFAITE (« Chat-astrophe ! »)
    // ========================================================================
    this.defeatEl = document.createElement('div');
    this.defeatEl.className = 'center-screen-overlay is-hidden';

    const defeatCard = document.createElement('div');
    defeatCard.className = 'parchment-panel center-screen-card';
    defeatCard.innerHTML = `
      <div style="font-size: 46px;" aria-hidden="true">😿</div>
      <h2 class="center-screen-title center-screen-title--defeat">Chat-astrophe !</h2>
      <p class="center-screen-desc">
        Vous avez été terrassé, mais Miaou-sprit vous a ramené en lieu sûr avant la neuvième vie !
      </p>
      <div class="center-screen-note">
        ✨ Ne vous inquiétez pas : votre <strong>niveau</strong>, votre <strong>or</strong>,
        vos <strong>équipements</strong> et vos <strong>quêtes</strong> sont intégralement conservés.
      </div>
    `;

    const defeatBtns = document.createElement('div');
    defeatBtns.className = 'center-screen-buttons';
    const respawnBtn = document.createElement('button');
    respawnBtn.type = 'button';
    respawnBtn.className = 'wood-btn wood-btn--gold';
    respawnBtn.textContent = "🛏️ Se réveiller à l'Auberge";
    respawnBtn.addEventListener('click', () => this.callbacks.onRespawnAtInn());
    defeatBtns.appendChild(respawnBtn);
    defeatCard.appendChild(defeatBtns);
    this.defeatEl.appendChild(defeatCard);

    // ========================================================================
    // 5. ÉCRAN DE VICTOIRE (« Légende de Félingard ! »)
    // ========================================================================
    this.victoryEl = document.createElement('div');
    this.victoryEl.className =
      'center-screen-overlay center-screen-overlay--victory is-hidden';

    const victoryCard = document.createElement('div');
    victoryCard.className = 'parchment-panel center-screen-card';

    const victoryHead = document.createElement('div');
    victoryHead.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 4px;" aria-hidden="true">👑</div>
      <h2 class="center-screen-title center-screen-title--victory">Légende de Félingard !</h2>
      <p class="center-screen-desc" style="margin-top:6px;">
        Drak-Miaou, le Dragon-Griffe, a été vaincu ! Tout Félingard célèbre votre héroïsme félin.
      </p>
    `;

    const statsGrid = document.createElement('div');
    statsGrid.className = 'victory-stats-grid';

    this.victoryTimeVal = this.createVictoryStatBox(statsGrid, 'Temps de jeu', '0 min 00 s');
    this.victoryLevelVal = this.createVictoryStatBox(statsGrid, 'Niveau atteint', 'Niv. 1');
    this.victoryEnemiesVal = this.createVictoryStatBox(statsGrid, 'Ennemis vaincus', '0');
    this.victoryChestsVal = this.createVictoryStatBox(statsGrid, 'Coffres ouverts', '0');

    const victoryBtns = document.createElement('div');
    victoryBtns.className = 'center-screen-buttons';

    const keepExploringBtn = document.createElement('button');
    keepExploringBtn.type = 'button';
    keepExploringBtn.className = 'wood-btn wood-btn--gold';
    keepExploringBtn.textContent = "🧭 Continuer l'exploration";
    keepExploringBtn.addEventListener('click', () =>
      this.callbacks.onContinueAfterVictory(),
    );

    const restartBtn = document.createElement('button');
    restartBtn.type = 'button';
    restartBtn.className = 'wood-btn wood-btn--secondary';
    restartBtn.textContent = '⚔️ Nouvelle Partie';
    restartBtn.addEventListener('click', () => this.callbacks.onNewGame());

    victoryBtns.append(keepExploringBtn, restartBtn);
    victoryCard.append(victoryHead, statsGrid, victoryBtns);
    this.victoryEl.appendChild(victoryCard);

    // ========================================================================
    // 6. FONDU DE TRANSITION (Zones / Auberge)
    // ========================================================================
    this.transitionEl = document.createElement('div');
    this.transitionEl.className = 'transition-overlay';
    this.transitionTextEl = document.createElement('div');
    this.transitionTextEl.className = 'transition-text';
    this.transitionEl.appendChild(this.transitionTextEl);

    // Bannière dédiée aux transitions de zone (découplée du fondu noir 0.45s)
    this.zoneBannerEl = document.createElement('div');
    this.zoneBannerEl.className = 'transition-text';
    this.zoneBannerEl.style.position = 'fixed';
    this.zoneBannerEl.style.left = '50%';
    this.zoneBannerEl.style.top = '26%';
    this.zoneBannerEl.style.transform = 'translate(-50%, -56%)';
    this.zoneBannerEl.style.zIndex = '92';
    this.zoneBannerEl.style.pointerEvents = 'none';
    this.zoneBannerEl.style.opacity = '0';
    this.zoneBannerEl.style.transition = 'opacity 0.42s ease, transform 0.42s ease';
    this.zoneBannerEl.style.textShadow =
      '0 3px 14px rgba(0, 0, 0, 0.95), 0 0 24px rgba(20, 11, 7, 0.9)';

    this.rootEl.append(
      this.titleEl,
      this.dialogueWrap,
      this.pauseEl,
      this.defeatEl,
      this.victoryEl,
      this.transitionEl,
      this.zoneBannerEl,
    );
    this.container.appendChild(this.rootEl);
  }

  public setHasSave(hasSave: boolean): void {
    this.hasSave = hasSave;
    this.continueBtn.disabled = !hasSave;
    this.continueBtn.title = hasSave
      ? 'Reprendre votre aventure sauvegardée'
      : 'Aucune sauvegarde trouvée';
  }

  public setPortrait(id: SpeakerPortraitId, dataUrl: string): void {
    if (!dataUrl) return;
    this.portraits[id] = dataUrl;
    this.lastDialogueKey = '';
  }

  public setPortraits(portraits: Partial<Record<SpeakerPortraitId, string>>): void {
    for (const [key, value] of Object.entries(portraits)) {
      if (value) {
        this.portraits[key as SpeakerPortraitId] = value;
      }
    }
    this.lastDialogueKey = '';
  }

  private clearZoneBanner(): void {
    if (this.zoneBannerHoldTimer !== null) {
      window.clearTimeout(this.zoneBannerHoldTimer);
      this.zoneBannerHoldTimer = null;
    }
    if (this.zoneBannerClearTimer !== null) {
      window.clearTimeout(this.zoneBannerClearTimer);
      this.zoneBannerClearTimer = null;
    }
    this.zoneBannerEl.style.opacity = '0';
    this.zoneBannerEl.style.transform = 'translate(-50%, -56%)';
    this.zoneBannerEl.textContent = '';
  }

  private showZoneBanner(label: string): void {
    if (this.zoneBannerHoldTimer !== null) {
      window.clearTimeout(this.zoneBannerHoldTimer);
      this.zoneBannerHoldTimer = null;
    }
    if (this.zoneBannerClearTimer !== null) {
      window.clearTimeout(this.zoneBannerClearTimer);
      this.zoneBannerClearTimer = null;
    }
    this.zoneBannerEl.textContent = label;
    this.zoneBannerEl.style.transition = 'none';
    this.zoneBannerEl.style.opacity = '1';
    this.zoneBannerEl.style.transform = 'translate(-50%, -50%)';
    void this.zoneBannerEl.offsetWidth;
    this.zoneBannerEl.style.transition = 'opacity 0.42s ease, transform 0.42s ease';

    this.zoneBannerHoldTimer = window.setTimeout(() => {
      this.zoneBannerHoldTimer = null;
      this.zoneBannerEl.style.opacity = '0';
      this.zoneBannerEl.style.transform = 'translate(-50%, -56%)';
      this.zoneBannerClearTimer = window.setTimeout(() => {
        this.zoneBannerClearTimer = null;
        this.zoneBannerEl.textContent = '';
      }, 450);
    }, 1200);
  }

  /**
   * Déclenche un fondu visuel temporaire avec message (ex: sieste à l'Auberge « Zzz... Miaou ! »).
   */
  public showTransitionOverlay(message = 'Zzz... Miaou !', durationMs = 1100): void {
    this.clearZoneBanner();
    if (this.manualFadeTimer !== null) {
      window.clearTimeout(this.manualFadeTimer);
      this.manualFadeTimer = null;
    }
    if (this.labelClearTimer !== null) {
      window.clearTimeout(this.labelClearTimer);
      this.labelClearTimer = null;
    }
    this.transitionLabel = message;
    this.transitionTextEl.textContent = message;
    this.manualFadeActive = true;
    this.transitionEl.style.transition = 'opacity 0.28s ease';
    this.transitionEl.style.opacity = '1';
    this.transitionEl.classList.add('is-blocking');

    this.manualFadeTimer = window.setTimeout(() => {
      this.manualFadeTimer = null;
      this.transitionEl.style.opacity = '0';
      this.transitionEl.classList.remove('is-blocking');
      this.labelClearTimer = window.setTimeout(() => {
        this.labelClearTimer = null;
        this.manualFadeActive = false;
        this.transitionEl.style.transition = '';
        this.transitionLabel = '';
        this.transitionTextEl.textContent = '';
      }, 300);
    }, Math.max(400, durationMs));
  }

  /**
   * Intercepte les événements de sieste et de transition de zone pour afficher un texte adapté sur le fondu.
   */
  public handleEvents(events: readonly GameEvent[]): void {
    for (const ev of events) {
      if (ev.type === 'player_rested') {
        this.clearZoneBanner();
        this.showTransitionOverlay('Zzz... Miaou !', 1050);
      } else if (ev.type === 'zone_transition') {
        this.showZoneBanner(getZoneBannerName(ev.zoneId, ev.islandId));
      }
    }
  }

  /**
   * Synchronise Écran Titre, Dialogue, Pause, Défaite, Victoire et Fondu avec l'état du jeu.
   */
  public update(state: GameState): void {
    // 1. Écrans majeurs (Titre / Défaite / Victoire)
    if (state.screen !== this.lastScreen) {
      this.lastScreen = state.screen;
      this.titleEl.classList.toggle('is-hidden', state.screen !== 'title');
      this.defeatEl.classList.toggle('is-hidden', state.screen !== 'defeat');
      this.victoryEl.classList.toggle('is-hidden', state.screen !== 'victory');
      if (
        state.screen === 'title' ||
        state.screen === 'defeat' ||
        state.screen === 'victory'
      ) {
        this.clearZoneBanner();
      }
    }

    // 2. Menu Pause
    const pauseVisible = state.screen === 'paused' || state.activeModal === 'pause';
    if (pauseVisible !== this.lastPauseVisible) {
      this.lastPauseVisible = pauseVisible;
      this.pauseEl.classList.toggle('is-hidden', !pauseVisible);
    }

    // 3. Stats de l'écran de Victoire
    if (state.screen === 'victory') {
      const vKey = `${Math.floor(state.runStats.playTimeSec)}|${state.player.level}|${state.runStats.enemiesDefeated}|${state.runStats.chestsOpened}`;
      if (vKey !== this.lastVictoryStatsKey) {
        this.lastVictoryStatsKey = vKey;
        this.victoryTimeVal.textContent = formatPlayTime(state.runStats.playTimeSec);
        this.victoryLevelVal.textContent = `Niv. ${state.player.level}`;
        this.victoryEnemiesVal.textContent = String(state.runStats.enemiesDefeated);
        this.victoryChestsVal.textContent = String(state.runStats.chestsOpened);
      }
    }

    // 4. Boîte de Dialogue
    const showDialogue =
      state.screen === 'playing' &&
      state.dialogue.active &&
      state.dialogue.lines.length > 0;
    if (!showDialogue) {
      if (this.lastDialogueKey !== 'hidden') {
        this.lastDialogueKey = 'hidden';
        this.dialogueWrap.classList.add('is-hidden');
      }
    } else {
      const idx = Math.max(
        0,
        Math.min(state.dialogue.lines.length - 1, state.dialogue.currentIndex),
      );
      const line = state.dialogue.lines[idx];
      const dKey = `${idx}|${state.dialogue.lines.length}|${line.speaker}|${line.portraitId}|${line.text}`;
      if (dKey !== this.lastDialogueKey) {
        this.lastDialogueKey = dKey;
        this.dialogueWrap.classList.remove('is-hidden');
        this.dialoguePortraitImg.src =
          this.portraits[line.portraitId] ?? DEFAULT_PORTRAITS.miaou_sprit;
        this.dialogueSpeaker.textContent = line.speaker;
        this.dialogueProgress.textContent = `${idx + 1} / ${state.dialogue.lines.length}`;
        this.dialogueText.textContent = line.text;
      }
    }

    // 5. Fondu de transition piloté par GameState.transitionFade
    if (!this.manualFadeActive) {
      const fade = Math.max(0, Math.min(1, state.transitionFade));
      const quantized = Math.round(fade * 100) / 100;
      if (quantized !== this.lastFadeValue) {
        this.lastFadeValue = quantized;
        this.transitionEl.style.opacity = quantized > 0.005 ? String(quantized) : '0';
        this.transitionEl.classList.toggle('is-blocking', quantized > 0.15);
        if (quantized <= 0.01 && this.transitionLabel && this.labelClearTimer === null) {
          this.transitionLabel = '';
          this.transitionTextEl.textContent = '';
        }
      }
    }
  }

  public dispose(): void {
    this.clearZoneBanner();
    if (this.manualFadeTimer !== null) {
      window.clearTimeout(this.manualFadeTimer);
      this.manualFadeTimer = null;
    }
    if (this.labelClearTimer !== null) {
      window.clearTimeout(this.labelClearTimer);
      this.labelClearTimer = null;
    }
    this.rootEl.remove();
  }

  private createVictoryStatBox(
    parent: HTMLElement,
    label: string,
    initialValue: string,
  ): HTMLSpanElement {
    const box = document.createElement('div');
    box.className = 'victory-stat-box';
    const lbl = document.createElement('span');
    lbl.className = 'victory-stat-label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'victory-stat-val';
    val.textContent = initialValue;
    box.append(lbl, val);
    parent.appendChild(box);
    return val;
  }
}
