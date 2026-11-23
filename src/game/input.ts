// ============================================================================
// Gestionnaire d'Entrées Unifié : Clavier (event.code AZERTY/QWERTY),
// Souris (clics + coordonnées NDC pour raycast y=0) et Manette (Gamepad API).
// Zéro import Three.js ; sûr en environnement Node (Vitest).
// ============================================================================

import type { InputState, SpellId, Vec2 } from './types';

export interface PointerNdc {
  x: number; // -1 (gauche) à +1 (droite)
  y: number; // -1 (bas) à +1 (haut)
}

export type AimWorldResolver = (ndcX: number, ndcY: number) => Vec2 | null;

export function createEmptyInputState(): InputState {
  return {
    moveX: 0,
    moveZ: 0,
    attackPressed: false,
    attackHeld: false,
    dodgePressed: false,
    interactPressed: false,
    spellPressed: {
      flamepurr: false,
      lightnyan: false,
      freezepaw: false,
      healing_paw: false,
    },
    aimWorldPos: null,
    usingPointerAim: false,
    toggleInventoryPressed: false,
    toggleMapPressed: false,
    pausePressed: false,
    confirmPressed: false,
  };
}

const PREVENT_DEFAULT_CODES = new Set([
  'Space',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

const GAMEPAD_DEADZONE = 0.22;

export class InputManager {
  private keysDown = new Set<string>();
  private keysJustPressed = new Set<string>();

  private mouseLeftDown = false;
  private mouseLeftPressed = false;
  private mouseRightPressed = false;

  private pointerNdc: PointerNdc | null = null;
  private usingPointerAim = false;
  private manualAimWorldPos: Vec2 | null = null;
  private aimWorldResolver: AimWorldResolver | null = null;

  // Déclencheurs synthétiques (boutons HUD / tests)
  private syntheticSpells: Record<SpellId, boolean> = {
    flamepurr: false,
    lightnyan: false,
    freezepaw: false,
    healing_paw: false,
  };
  private syntheticInteract = false;
  private syntheticInventory = false;
  private syntheticMap = false;
  private syntheticPause = false;
  private syntheticConfirm = false;
  private syntheticAttack = false;
  private syntheticDodge = false;

  // État précédent de la manette pour détection de front montant
  private prevGamepadButtons: boolean[] = [];

  private attachedCanvas: HTMLElement | null = null;
  private attachedWindow: Window | null = null;

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as { tagName?: string } | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
    ) {
      return;
    }

    if (PREVENT_DEFAULT_CODES.has(e.code)) {
      e.preventDefault();
    }

    if (!this.keysDown.has(e.code)) {
      this.keysJustPressed.add(e.code);
    }
    this.keysDown.add(e.code);

    // Si le joueur utilise les touches de direction ou d'attaque clavier, repasser hors visée souris
    if (
      !this.mouseLeftDown &&
      (e.code === 'KeyW' ||
        e.code === 'KeyA' ||
        e.code === 'KeyS' ||
        e.code === 'KeyD' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown' ||
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight' ||
        e.code === 'Space' ||
        e.code === 'KeyJ')
    ) {
      this.usingPointerAim = false;
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code);
  };

  private readonly handleMouseMove = (e: MouseEvent): void => {
    this.updatePointerFromMouseEvent(e);
    this.usingPointerAim = true;
  };

  private readonly handleMouseDown = (e: MouseEvent): void => {
    // N'enregistre les clics d'attaque/esquive que sur le canvas WebGL
    if (this.attachedCanvas && e.target !== this.attachedCanvas) {
      return;
    }

    this.updatePointerFromMouseEvent(e);
    this.usingPointerAim = true;

    if (e.button === 0) {
      this.mouseLeftDown = true;
      this.mouseLeftPressed = true;
    } else if (e.button === 2) {
      this.mouseRightPressed = true;
    }
  };

  private readonly handleMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.mouseLeftDown = false;
    }
  };

  private readonly handleContextMenu = (e: MouseEvent): void => {
    if (!this.attachedCanvas || e.target === this.attachedCanvas) {
      e.preventDefault();
    }
  };

  private readonly handleWindowBlur = (): void => {
    this.reset();
  };

  public attach(canvasElement?: HTMLElement | null): void {
    this.detach();
    if (typeof window === 'undefined') return;

    this.attachedWindow = window;
    this.attachedCanvas = canvasElement ?? null;

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('blur', this.handleWindowBlur);

    const mouseTarget: EventTarget = this.attachedCanvas ?? window;
    mouseTarget.addEventListener('mousedown', this.handleMouseDown as EventListener);
    mouseTarget.addEventListener('contextmenu', this.handleContextMenu as EventListener);
  }

  public detach(): void {
    if (this.attachedWindow) {
      this.attachedWindow.removeEventListener('keydown', this.handleKeyDown);
      this.attachedWindow.removeEventListener('keyup', this.handleKeyUp);
      this.attachedWindow.removeEventListener('mousemove', this.handleMouseMove);
      this.attachedWindow.removeEventListener('mouseup', this.handleMouseUp);
      this.attachedWindow.removeEventListener('blur', this.handleWindowBlur);
    }

    const mouseTarget: EventTarget | null =
      this.attachedCanvas ?? this.attachedWindow;
    if (mouseTarget) {
      mouseTarget.removeEventListener('mousedown', this.handleMouseDown as EventListener);
      mouseTarget.removeEventListener(
        'contextmenu',
        this.handleContextMenu as EventListener,
      );
    }

    this.attachedCanvas = null;
    this.attachedWindow = null;
    this.reset();
  }

  public reset(): void {
    this.keysDown.clear();
    this.keysJustPressed.clear();
    this.mouseLeftDown = false;
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
    this.clearSynthetics();
  }

  public setAimWorldResolver(resolver: AimWorldResolver | null): void {
    this.aimWorldResolver = resolver;
  }

  public setAimWorldPos(pos: Vec2 | null): void {
    this.manualAimWorldPos = pos;
    if (pos) {
      this.usingPointerAim = true;
    }
  }

  public getPointerNdc(): PointerNdc | null {
    return this.pointerNdc ? { ...this.pointerNdc } : null;
  }

  public triggerSpell(spellId: SpellId): void {
    this.syntheticSpells[spellId] = true;
  }

  public triggerAttack(): void {
    this.syntheticAttack = true;
  }

  public triggerDodge(): void {
    this.syntheticDodge = true;
  }

  public triggerInteract(): void {
    this.syntheticInteract = true;
  }

  public triggerToggleInventory(): void {
    this.syntheticInventory = true;
  }

  public triggerToggleMap(): void {
    this.syntheticMap = true;
  }

  public triggerPause(): void {
    this.syntheticPause = true;
  }

  public triggerConfirm(): void {
    this.syntheticConfirm = true;
  }

  /**
   * Capture et retourne l'état unifié des entrées pour la frame courante,
   * puis vide les buffers front-montant (*Pressed).
   */
  public poll(): InputState {
    const state = createEmptyInputState();

    // --- 1. Clavier (event.code : compatible AZERTY/QWERTY automatiquement) ---
    let moveX = 0;
    let moveZ = 0;

    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) moveX -= 1;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) moveX += 1;
    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) moveZ -= 1;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) moveZ += 1;

    const kAttackHeld =
      this.keysDown.has('Space') || this.keysDown.has('KeyJ');
    const kAttackPressed =
      this.keysJustPressed.has('Space') || this.keysJustPressed.has('KeyJ');
    if (
      (kAttackHeld || kAttackPressed) &&
      !this.mouseLeftDown &&
      !this.mouseLeftPressed
    ) {
      this.usingPointerAim = false;
    }
    const kDodgePressed =
      this.keysJustPressed.has('ShiftLeft') ||
      this.keysJustPressed.has('ShiftRight') ||
      this.keysJustPressed.has('KeyK');

    const kInteractPressed =
      this.keysJustPressed.has('KeyE') || this.keysJustPressed.has('Enter');

    const kSpellFlame =
      this.keysJustPressed.has('Digit1') || this.keysJustPressed.has('KeyQ');
    const kSpellLight =
      this.keysJustPressed.has('Digit2') || this.keysJustPressed.has('KeyE');
    const kSpellFreeze =
      this.keysJustPressed.has('Digit3') || this.keysJustPressed.has('KeyR');
    const kSpellHeal =
      this.keysJustPressed.has('Digit4') || this.keysJustPressed.has('KeyF');

    const kInventoryPressed =
      this.keysJustPressed.has('KeyI') || this.keysJustPressed.has('Tab');
    const kMapPressed = this.keysJustPressed.has('KeyM');
    const kPausePressed = this.keysJustPressed.has('Escape');
    const kConfirmPressed =
      this.keysJustPressed.has('Enter') ||
      this.keysJustPressed.has('Space') ||
      this.keysJustPressed.has('KeyE');

    // --- 2. Manette (Gamepad API standard) ---
    let gpAttackPressed = false;
    let gpAttackHeld = false;
    let gpDodgePressed = false;
    let gpInteractPressed = false;
    let gpSpellFlame = false;
    let gpSpellLight = false;
    let gpSpellFreeze = false;
    let gpSpellHeal = false;
    let gpInventoryPressed = false;
    let gpMapPressed = false;
    let gpPausePressed = false;
    let gpConfirmPressed = false;

    const gp = this.getActiveGamepad();
    if (gp) {
      const ax0 = gp.axes[0] ?? 0;
      const ax1 = gp.axes[1] ?? 0;
      let gx = Math.abs(ax0) > GAMEPAD_DEADZONE ? ax0 : 0;
      let gz = Math.abs(ax1) > GAMEPAD_DEADZONE ? ax1 : 0;

      // D-Pad (12=haut, 13=bas, 14=gauche, 15=droite)
      if (this.isGamepadButtonDown(gp, 14)) gx = -1;
      if (this.isGamepadButtonDown(gp, 15)) gx = 1;
      if (this.isGamepadButtonDown(gp, 12)) gz = -1;
      if (this.isGamepadButtonDown(gp, 13)) gz = 1;

      if (Math.hypot(gx, gz) > 0.05) {
        moveX += gx;
        moveZ += gz;
        this.usingPointerAim = false;
      }

      const currButtons: boolean[] = [];
      for (let i = 0; i < gp.buttons.length; i++) {
        currButtons[i] = this.isGamepadButtonDown(gp, i);
      }
      const justPressed = (idx: number): boolean =>
        Boolean(currButtons[idx] && !this.prevGamepadButtons[idx]);

      gpAttackHeld = Boolean(currButtons[0]);
      gpAttackPressed = justPressed(0); // A / Croix
      if (gpAttackHeld || gpAttackPressed) {
        this.usingPointerAim = false;
      }
      gpDodgePressed = justPressed(1); // B / Rond
      gpInteractPressed = justPressed(2); // X / Carré
      gpInventoryPressed = justPressed(3); // Y / Triangle
      gpSpellFlame = justPressed(4); // LB
      gpSpellLight = justPressed(5); // RB
      gpSpellFreeze = justPressed(6); // LT
      gpSpellHeal = justPressed(7); // RT
      gpMapPressed = justPressed(8); // Back / Select
      gpPausePressed = justPressed(9); // Start
      gpConfirmPressed = gpAttackPressed || gpInteractPressed;

      this.prevGamepadButtons = currButtons;
    } else {
      this.prevGamepadButtons = [];
    }

    // Normalisation du vecteur de déplacement
    const moveLen = Math.hypot(moveX, moveZ);
    if (moveLen > 1) {
      moveX /= moveLen;
      moveZ /= moveLen;
    }

    state.moveX = moveX;
    state.moveZ = moveZ;
    state.attackHeld = kAttackHeld || this.mouseLeftDown || gpAttackHeld;
    state.attackPressed =
      kAttackPressed ||
      this.mouseLeftPressed ||
      gpAttackPressed ||
      this.syntheticAttack;
    state.dodgePressed =
      kDodgePressed ||
      this.mouseRightPressed ||
      gpDodgePressed ||
      this.syntheticDodge;
    state.interactPressed =
      kInteractPressed || gpInteractPressed || this.syntheticInteract;

    state.spellPressed.flamepurr =
      kSpellFlame || gpSpellFlame || this.syntheticSpells.flamepurr;
    state.spellPressed.lightnyan =
      kSpellLight || gpSpellLight || this.syntheticSpells.lightnyan;
    state.spellPressed.freezepaw =
      kSpellFreeze || gpSpellFreeze || this.syntheticSpells.freezepaw;
    state.spellPressed.healing_paw =
      kSpellHeal || gpSpellHeal || this.syntheticSpells.healing_paw;

    state.toggleInventoryPressed =
      kInventoryPressed || gpInventoryPressed || this.syntheticInventory;
    state.toggleMapPressed =
      kMapPressed || gpMapPressed || this.syntheticMap;
    state.pausePressed =
      kPausePressed || gpPausePressed || this.syntheticPause;
    state.confirmPressed =
      kConfirmPressed || gpConfirmPressed || this.syntheticConfirm;

    // --- 3. Visée pointeur (raycast délégué via callback pour zéro import Three.js) ---
    state.usingPointerAim = this.usingPointerAim;
    if (this.usingPointerAim) {
      if (this.pointerNdc && this.aimWorldResolver) {
        state.aimWorldPos = this.aimWorldResolver(
          this.pointerNdc.x,
          this.pointerNdc.y,
        );
      } else {
        state.aimWorldPos = this.manualAimWorldPos;
      }
    }

    // Nettoyage des fronts montants
    this.keysJustPressed.clear();
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
    this.clearSynthetics();

    return state;
  }

  private clearSynthetics(): void {
    this.syntheticSpells.flamepurr = false;
    this.syntheticSpells.lightnyan = false;
    this.syntheticSpells.freezepaw = false;
    this.syntheticSpells.healing_paw = false;
    this.syntheticInteract = false;
    this.syntheticInventory = false;
    this.syntheticMap = false;
    this.syntheticPause = false;
    this.syntheticConfirm = false;
    this.syntheticAttack = false;
    this.syntheticDodge = false;
  }

  private updatePointerFromMouseEvent(e: MouseEvent): void {
    let left = 0;
    let top = 0;
    let width = 1;
    let height = 1;

    if (this.attachedCanvas) {
      const rect = this.attachedCanvas.getBoundingClientRect();
      left = rect.left;
      top = rect.top;
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
    } else if (this.attachedWindow) {
      width = Math.max(1, this.attachedWindow.innerWidth);
      height = Math.max(1, this.attachedWindow.innerHeight);
    }

    const ndcX = ((e.clientX - left) / width) * 2 - 1;
    const ndcY = -(((e.clientY - top) / height) * 2 - 1);
    this.pointerNdc = { x: ndcX, y: ndcY };
  }

  private getActiveGamepad(): Gamepad | null {
    if (
      typeof navigator === 'undefined' ||
      typeof navigator.getGamepads !== 'function'
    ) {
      return null;
    }
    try {
      const pads = navigator.getGamepads();
      if (!pads) return null;
      for (const pad of pads) {
        if (pad && pad.connected) {
          return pad;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private isGamepadButtonDown(gp: Gamepad, index: number): boolean {
    const btn = gp.buttons[index];
    if (!btn) return false;
    return btn.pressed || btn.value > 0.35;
  }
}
