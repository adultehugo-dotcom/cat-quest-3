import fs from 'node:fs';
import path from 'node:path';
import { runDomAudit } from './dom-audit.mjs';
import {
  attachPageListeners,
  inspectWebglRuntime,
  installWebglInitHooks,
  verifyCanvasNonBlank,
  waitForGameReady,
} from './webgl-probe.mjs';

export const SAVE_STORAGE_KEY = 'felingard_cat_quest_save_v1';

export const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '850x700', width: 850, height: 700 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x667', width: 375, height: 667 },
  { name: '667x375', width: 667, height: 375 },
];

export const SCENARIO_IDS = [
  'title',
  'intro',
  'village',
  'modals',
  'biomes',
  'ghost_cave',
  'dragon_lair',
  'endgame',
];

export function makeSave(overrides = {}) {
  const base = {
    version: 1,
    timestamp: Date.now(),
    player: {
      level: 10,
      xp: 0,
      gold: 1000,
      hp: 9999,
      mp: 9999,
      hasRunicKey: true,
      equipped: {
        weapon: 'blade_dragon',
        secondary_weapon: '',
        shield: '',
        helmet: 'helm_dragon',
        armor: 'armor_dragon',
        trinket: '',
      },
      inventory: {
        sword_wood: { id: 'sword_wood', level: 1 },
        blade_dragon: { id: 'blade_dragon', level: 25 },
        helm_bandana: { id: 'helm_bandana', level: 1 },
        helm_dragon: { id: 'helm_dragon', level: 25 },
        armor_tunic: { id: 'armor_tunic', level: 1 },
        armor_dragon: { id: 'armor_dragon', level: 25 },
      },
      spellLevels: {
        flamepurr: 5,
        lightnyan: 5,
        freezepaw: 5,
        healing_paw: 5,
      },
    },
    quests: {
      main_dragon_blood: { id: 'main_dragon_blood', status: 'active', stepIndex: 2, counter: 0 },
      side_yarn_hunt: { id: 'side_yarn_hunt', status: 'available', stepIndex: 0, counter: 0 },
      side_lost_blade: { id: 'side_lost_blade', status: 'available', stepIndex: 0, counter: 0 },
    },
    trackedQuestId: 'main_dragon_blood',
    openedChestIds: [],
    defeatedBossIds: [],
    runStats: {
      playTimeSec: 120,
      enemiesDefeated: 12,
      chestsOpened: 2,
    },
  };

  return {
    ...base,
    ...overrides,
    player: {
      ...base.player,
      ...(overrides.player || {}),
      equipped: {
        ...base.player.equipped,
        ...(overrides.player?.equipped || {}),
      },
      inventory: {
        ...base.player.inventory,
        ...(overrides.player?.inventory || {}),
      },
      spellLevels: {
        ...base.player.spellLevels,
        ...(overrides.player?.spellLevels || {}),
      },
    },
    quests: {
      ...base.quests,
      ...(overrides.quests || {}),
    },
    runStats: {
      ...base.runStats,
      ...(overrides.runStats || {}),
    },
  };
}

async function settleFrames(page, delayMs = 150) {
  if (delayMs > 0) {
    await page.waitForTimeout(delayMs);
  }
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(resolve);
      }),
  );
}

async function getSnapshot(page) {
  return page.evaluate(() => window.__CAT_QUEST__?.getSnapshot?.() ?? null);
}

async function walkTo(page, waypoints, { stopOnInteractableId = null, timeoutMs = 18000 } = {}) {
  const held = new Set();
  const syncKeys = async (next) => {
    for (const k of held) {
      if (!next.has(k)) {
        await page.keyboard.up(k);
        held.delete(k);
      }
    }
    for (const k of next) {
      if (!held.has(k)) {
        await page.keyboard.down(k);
        held.add(k);
      }
    }
  };

  try {
    for (const [tx, tz] of waypoints) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const snap = await getSnapshot(page);
        if (!snap || snap.screen !== 'playing' || snap.dialogue?.active) {
          return snap;
        }
        if (stopOnInteractableId && snap.nearestInteractable?.id === stopOnInteractableId) {
          return snap;
        }
        const dx = tx - snap.player.x;
        const dz = tz - snap.player.z;
        if (Math.hypot(dx, dz) < 0.9) {
          break;
        }
        const next = new Set();
        if (dx < -0.4) next.add('KeyA');
        if (dx > 0.4) next.add('KeyD');
        if (dz < -0.4) next.add('KeyW');
        if (dz > 0.4) next.add('KeyS');
        await syncKeys(next);
        await page.waitForTimeout(70);
      }
    }
    return await getSnapshot(page);
  } finally {
    await syncKeys(new Set());
  }
}

async function waitForTransitionDone(page, timeoutMs = 4000) {
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('.transition-overlay');
        if (!el) return true;
        return parseFloat(getComputedStyle(el).opacity) <= 0.02 && !el.classList.contains('is-blocking');
      },
      null,
      { timeout: timeoutMs },
    )
    .catch(() => {});
}

async function waitForModalClosed(page, timeoutMs = 4000) {
  await page.waitForFunction(
    () => {
      const s = window.__CAT_QUEST__?.getSnapshot?.();
      const b = document.querySelector('.modal-backdrop');
      if (!s || s.activeModal !== 'none') return false;
      if (!b) return true;
      return !b.classList.contains('is-open') && parseFloat(getComputedStyle(b).opacity) <= 0.01;
    },
    null,
    { timeout: timeoutMs },
  );
}

async function captureTransitionBanner(ctx, { scenario, view, viewport }) {
  const { page } = ctx;
  let capturedOpacity = 0;
  let capturedText = '';
  try {
    await page.waitForFunction(
      () => {
        const texts = Array.from(document.querySelectorAll('.transition-text'));
        for (const t of texts) {
          const content = (t.textContent || '').trim();
          if (!content) continue;
          const ownOp = parseFloat(getComputedStyle(t).opacity);
          const parentOp = t.parentElement ? parseFloat(getComputedStyle(t.parentElement).opacity) : 1;
          const effectiveOp = Math.min(ownOp, parentOp);
          if (effectiveOp > 0.15) return true;
        }
        return false;
      },
      null,
      { polling: 50, timeout: 3500 },
    );
    const info = await page.evaluate(() => {
      const texts = Array.from(document.querySelectorAll('.transition-text'));
      for (const t of texts) {
        const content = (t.textContent || '').trim();
        if (!content) continue;
        const ownOp = parseFloat(getComputedStyle(t).opacity);
        const parentOp = t.parentElement ? parseFloat(getComputedStyle(t.parentElement).opacity) : 1;
        const effectiveOp = Math.min(ownOp, parentOp);
        if (effectiveOp > 0.15) {
          return { opacity: effectiveOp, text: content };
        }
      }
      return { opacity: 0, text: '' };
    });
    capturedOpacity = info.opacity;
    capturedText = info.text;
  } catch {
    // Still capture diagnostic screenshot & report missing transition banner
  }

  await auditAndCapture(ctx, {
    scenario,
    view,
    viewport,
    immediate: true,
    skipHiddenCheck: true,
    verifyCanvas: false,
    assertFn: () => {
      const errs = [];
      if (!capturedText || capturedOpacity <= 0.15) {
        errs.push({
          category: 'scenario',
          code: 'transition_banner_not_captured',
          capturedOpacity,
          capturedText,
        });
      }
      return errs;
    },
  });
}

async function auditAndCapture(
  ctx,
  {
    scenario,
    view,
    viewport,
    immediate = false,
    skipHiddenCheck = false,
    expectDialogue = false,
    verifyCanvas = true,
    assertFn = null,
  },
) {
  const t0 = Date.now();
  const { page, outDir, listeners, results } = ctx;

  if (!immediate) {
    await settleFrames(page, 240);
  }

  const issues = [];
  let snapshot = null;
  let webglInfo = null;
  let canvasAnalysis = null;
  let relShot = null;

  try {
    snapshot = await getSnapshot(page);
    const domAudit = await runDomAudit(page, { skipHiddenCheck, expectDialogue });
    for (const iss of domAudit.issues) {
      issues.push({ category: 'dom', ...iss });
    }

    webglInfo = await inspectWebglRuntime(page);
    if (!webglInfo.hasCanvas) {
      issues.push({ category: 'webgl', code: 'missing_canvas' });
    } else {
      if (webglInfo.contextLost) {
        issues.push({ category: 'webgl', code: 'context_lost' });
      }
      if (webglInfo.glError !== 0 && webglInfo.glError !== null) {
        issues.push({ category: 'webgl', code: 'gl_error', glError: webglInfo.glError });
      }
      if (!webglInfo.metrics?.hdAssetsLoaded) {
        issues.push({ category: 'asset', code: 'hd_assets_not_loaded', metrics: webglInfo.metrics });
      }
      const badShaders = (webglInfo.diag?.shaderErrors || []).filter((s) => !s.ok);
      for (const s of badShaders) {
        issues.push({ category: 'webgl', code: 'shader_compile_error', detail: s });
      }
      const badPrograms = (webglInfo.diag?.programErrors || []).filter((p) => !p.ok);
      for (const p of badPrograms) {
        issues.push({ category: 'webgl', code: 'program_link_error', detail: p });
      }
      const cs = webglInfo.canvasSize;
      if (cs && (cs.clientWidth !== viewport.width || cs.clientHeight !== viewport.height)) {
        issues.push({
          category: 'webgl',
          code: 'canvas_viewport_mismatch',
          canvasSize: cs,
          viewport,
        });
      }
    }

    if (typeof assertFn === 'function') {
      const extra = await assertFn(snapshot, page);
      if (Array.isArray(extra)) {
        for (const e of extra) issues.push(e);
      }
    }

    const shotsDir = path.join(outDir, 'screenshots');
    fs.mkdirSync(shotsDir, { recursive: true });
    const fileName = `${scenario}__${view}__${viewport.name}.png`;
    const absShot = path.join(shotsDir, fileName);
    const pngBuf = await page.screenshot({ path: absShot, type: 'png' });
    relShot = `screenshots/${fileName}`;

    if (verifyCanvas) {
      canvasAnalysis = await verifyCanvasNonBlank(page, pngBuf);
      if (!canvasAnalysis.ok) {
        issues.push({ category: 'webgl', code: 'blank_or_uniform_canvas', detail: canvasAnalysis });
      }
    }
  } catch (err) {
    issues.push({
      category: 'harness',
      code: 'view_capture_exception',
      message: String(err?.stack || err),
    });
  }

  const delta = listeners.consumeDelta();
  for (const msg of delta.consoleErrors) {
    issues.push({ category: 'console', code: 'console_error', message: msg });
  }
  for (const err of delta.pageErrors) {
    issues.push({ category: 'pageerror', code: 'uncaught_pageerror', message: err });
  }
  for (const req of delta.requestFailed) {
    issues.push({ category: 'network', code: 'request_failed', ...req });
  }
  for (const res of delta.httpErrors) {
    issues.push({ category: 'network', code: 'http_error', ...res });
  }
  for (const w of delta.webglWarningsOrErrors) {
    if (w.type === 'error') {
      issues.push({ category: 'webgl', code: 'webgl_console_error', message: w.text });
    }
  }

  const durationMs = Date.now() - t0;
  console.log(`[e2e]     ${scenario}/${view} (${viewport.name}) -> ${issues.length === 0 ? 'PASS' : `FAIL(${issues.length})`} (${durationMs}ms)`);

  results.push({
    id: `${scenario}__${view}__${viewport.name}`,
    scenario,
    view,
    viewport,
    screenshot: relShot,
    passed: issues.length === 0,
    issues,
    snapshot,
    webgl: {
      glError: webglInfo?.glError ?? null,
      contextLost: webglInfo?.contextLost ?? null,
      renderer: webglInfo?.renderer ?? null,
      metrics: webglInfo?.metrics ?? null,
      canvasAnalysis,
    },
    networkDelta: {
      consoleErrors: delta.consoleErrors.length,
      consoleWarnings: delta.consoleWarnings.length,
      pageErrors: delta.pageErrors.length,
      requestFailed: delta.requestFailed.length,
      httpErrors: delta.httpErrors.length,
    },
    durationMs,
  });
}

async function sweepViewports(ctx, opts) {
  const { page, activeViewports } = ctx;
  const restoreVp = activeViewports.find((v) => v.name === '1280x720') || {
    name: '1280x720',
    width: 1280,
    height: 720,
  };

  for (const vp of activeViewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await settleFrames(page, 140);
    await auditAndCapture(ctx, { ...opts, viewport: vp, immediate: true });
  }

  if (
    activeViewports.length > 1 ||
    activeViewports[0]?.width !== restoreVp.width ||
    activeViewports[0]?.height !== restoreVp.height
  ) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await settleFrames(page, 120);
  }
}

async function withScenarioPage({ browser, url, savePayload = null, activeViewports, outDir, results, sessionErrors }, fn) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const listeners = attachPageListeners(page);
  await installWebglInitHooks(page);

  await page.addInitScript(
    ({ key, payload }) => {
      if (!sessionStorage.getItem('__e2e_seeded__')) {
        sessionStorage.setItem('__e2e_seeded__', '1');
        if (payload) {
          localStorage.setItem(key, JSON.stringify(payload));
        } else {
          localStorage.removeItem(key);
        }
      }
    },
    { key: SAVE_STORAGE_KEY, payload: savePayload },
  );

  const ctx = {
    page,
    url,
    outDir,
    activeViewports,
    listeners,
    results,
    defaultViewport: { name: '1280x720', width: 1280, height: 720 },
  };

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await waitForGameReady(page, 20000);
    await settleFrames(page, 250);
    await fn(ctx);
  } catch (err) {
    results.push({
      id: `scenario_fatal_${Date.now()}`,
      scenario: 'fatal',
      view: 'scenario_execution',
      viewport: ctx.defaultViewport,
      screenshot: null,
      passed: false,
      issues: [{ category: 'harness', code: 'scenario_exception', message: String(err?.stack || err) }],
      snapshot: null,
      webgl: null,
      networkDelta: null,
      durationMs: 0,
    });
  } finally {
    const all = listeners.getAll();
    sessionErrors.consoleErrors.push(...all.consoleErrors);
    sessionErrors.consoleWarnings.push(...all.consoleWarnings);
    sessionErrors.webglWarningsOrErrors.push(...all.webglWarningsOrErrors);
    sessionErrors.pageErrors.push(...all.pageErrors);
    sessionErrors.requestFailed.push(...all.requestFailed);
    sessionErrors.httpErrors.push(...all.httpErrors);
    await context.close().catch(() => {});
  }
}

async function runTitleScenario(shared) {
  await withScenarioPage({ ...shared, savePayload: null }, async (ctx) => {
    await sweepViewports(ctx, {
      scenario: 'title',
      view: 'title_fresh',
      assertFn: async (snap, page) => {
        const errs = [];
        if (snap?.screen !== 'title') {
          errs.push({ category: 'scenario', code: 'unexpected_screen', expected: 'title', actual: snap?.screen });
        }
        const disabled = await page.locator('.title-actions button:has-text("Continuer")').isDisabled();
        if (!disabled) {
          errs.push({ category: 'scenario', code: 'continue_should_be_disabled' });
        }
        return errs;
      },
    });
  });

  await withScenarioPage({ ...shared, savePayload: makeSave() }, async (ctx) => {
    await sweepViewports(ctx, {
      scenario: 'title',
      view: 'title_saved',
      assertFn: async (snap, page) => {
        const errs = [];
        if (snap?.screen !== 'title') {
          errs.push({ category: 'scenario', code: 'unexpected_screen', expected: 'title', actual: snap?.screen });
        }
        const disabled = await page.locator('.title-actions button:has-text("Continuer")').isDisabled();
        if (disabled) {
          errs.push({ category: 'scenario', code: 'continue_should_be_enabled' });
        }
        return errs;
      },
    });
  });
}

async function runIntroScenario(shared) {
  await withScenarioPage({ ...shared, savePayload: null }, async (ctx) => {
    const { page, defaultViewport } = ctx;
    await page.locator('.title-actions button:has-text("Nouvelle Partie")').click();
    await page.waitForFunction(() => {
      const s = window.__CAT_QUEST__?.getSnapshot?.();
      const wrap = document.querySelector('.dialogue-wrap:not(.is-hidden)');
      const box = wrap?.querySelector('.dialogue-box');
      if (!s || s.screen !== 'playing' || !s.dialogue?.active || !box) return false;
      return parseFloat(getComputedStyle(box).opacity) > 0.5 && box.getBoundingClientRect().height > 10;
    });
    await settleFrames(page, 200);

    await sweepViewports(ctx, {
      scenario: 'intro',
      view: 'intro_dialogue_line1',
      expectDialogue: true,
      assertFn: async (snap, p) => {
        const errs = [];
        if (!snap?.dialogue?.active) {
          errs.push({ category: 'scenario', code: 'intro_dialogue_not_active' });
        }
        const speaker = (await p.locator('.dialogue-speaker').textContent()) || '';
        if (!speaker.includes('Miaou-sprit')) {
          errs.push({ category: 'scenario', code: 'unexpected_speaker', expected: 'Miaou-sprit', actual: speaker });
        }
        return errs;
      },
    });

    // Advance through remaining dialogue lines
    for (let i = 0; i < 6; i++) {
      const snap = await getSnapshot(page);
      if (!snap?.dialogue?.active) break;
      await page.keyboard.press('Space');
      await settleFrames(page, 220);
      const after = await getSnapshot(page);
      if (after?.dialogue?.active && i === 0) {
        await auditAndCapture(ctx, {
          scenario: 'intro',
          view: 'intro_dialogue_line2',
          viewport: defaultViewport,
          expectDialogue: true,
        });
      }
    }

    await waitForTransitionDone(page, 3000);
    await auditAndCapture(ctx, {
      scenario: 'intro',
      view: 'intro_village_spawn',
      viewport: defaultViewport,
      assertFn: (snap) => {
        const errs = [];
        if (snap?.zoneId !== 'overworld' || !snap?.inVillage) {
          errs.push({ category: 'scenario', code: 'expected_miaou_bourg_spawn', snap });
        }
        return errs;
      },
    });
  });
}

async function runVillageScenario(shared) {
  const save = makeSave({
    player: {
      hasRunicKey: true,
      gold: 1000,
      spellLevels: { flamepurr: 2, lightnyan: 2, freezepaw: 2, healing_paw: 2 },
    },
  });

  await withScenarioPage({ ...shared, savePayload: save }, async (ctx) => {
    const { page, defaultViewport } = ctx;
    await page.locator('.title-actions button:has-text("Continuer")').click();
    await captureTransitionBanner(ctx, {
      scenario: 'village',
      view: 'transition_overworld',
      viewport: defaultViewport,
    });
    await waitForTransitionDone(page, 4000);

    await auditAndCapture(ctx, {
      scenario: 'village',
      view: 'miaou_bourg_runic_key',
      viewport: defaultViewport,
      assertFn: async (snap, p) => {
        const errs = [];
        if (!snap?.player?.hasRunicKey) {
          errs.push({ category: 'scenario', code: 'missing_runic_key_state' });
        }
        const badgeVisible = await p.locator('.hud-key-badge:not(.is-hidden)').isVisible().catch(() => false);
        if (!badgeVisible) {
          errs.push({ category: 'scenario', code: 'hud_key_badge_not_visible' });
        }
        return errs;
      },
    });

    // Walk to Mayor Moustache & talk
    await walkTo(page, [[-1.5, 25.5]], { stopOnInteractableId: 'interact_mayor_moustache', timeoutMs: 10000 });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Boolean(window.__CAT_QUEST__?.getSnapshot?.()?.dialogue?.active), null, {
      timeout: 5000,
    });
    await settleFrames(page, 260);

    await sweepViewports(ctx, {
      scenario: 'village',
      view: 'mayor_dialogue',
      expectDialogue: true,
      assertFn: async (_snap, p) => {
        const speaker = (await p.locator('.dialogue-speaker').textContent()) || '';
        return speaker.includes('Maire')
          ? []
          : [{ category: 'scenario', code: 'unexpected_mayor_speaker', speaker }];
      },
    });

    for (let i = 0; i < 6; i++) {
      const snap = await getSnapshot(page);
      if (!snap?.dialogue?.active) break;
      await page.keyboard.press('Space');
      await settleFrames(page, 180);
    }

    // Walk to Inn and rest -> capture Zzz transition + toast
    await walkTo(page, [[-6.8, 22.3]], { stopOnInteractableId: 'interact_building_inn', timeoutMs: 12000 });
    await page.keyboard.press('Enter');
    await captureTransitionBanner(ctx, {
      scenario: 'village',
      view: 'transition_inn_sleep',
      viewport: defaultViewport,
    });
    await waitForTransitionDone(page, 4000);

    // Trigger a fresh 3500ms toast at Forge right alongside Runic Key + Interact Prompt
    await walkTo(page, [[7.5, 22.3]], { stopOnInteractableId: 'interact_building_forge', timeoutMs: 12000 });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__CAT_QUEST__?.getSnapshot?.()?.activeModal === 'forge');
    await page.locator('.forge-tabs .tab-btn').nth(1).click();
    await settleFrames(page, 180);
    const upgradeBtn = page.locator('.forge-spell-card button.wood-btn:not([disabled])').first();
    if (await upgradeBtn.isVisible().catch(() => false)) {
      await upgradeBtn.click();
    }
    await page.keyboard.press('Escape');
    await waitForModalClosed(page);
    await page
      .waitForFunction(
        () => document.querySelectorAll('.toast-stack .toast-item:not(.is-leaving)').length >= 1,
        null,
        { timeout: 2500 },
      )
      .catch(() => {});
    await settleFrames(page, 80);

    // Capture HUD with Runic Key + Interact Prompt + Toast
    await auditAndCapture(ctx, {
      scenario: 'village',
      view: 'hud_key_toast_prompt',
      viewport: defaultViewport,
      immediate: true,
      assertFn: async (_snap, p) => {
        const errs = [];
        const toastCount = await p.locator('.toast-stack .toast-item:not(.is-leaving)').count();
        const promptVisible = await p.locator('.interact-prompt:not(.is-hidden)').isVisible().catch(() => false);
        if (toastCount < 1) {
          errs.push({ category: 'scenario', code: 'expected_toast_visible', toastCount });
        }
        if (!promptVisible) {
          errs.push({ category: 'scenario', code: 'expected_interact_prompt_visible' });
        }
        return errs;
      },
    });

    // Sweep responsive Overworld HUD with Runic Key + Interact Prompt
    await sweepViewports(ctx, {
      scenario: 'village',
      view: 'overworld_hud_responsive',
    });
  });
}

async function runModalsScenario(shared) {
  const save = makeSave({
    player: {
      hasRunicKey: true,
      gold: 1000,
      spellLevels: { flamepurr: 2, lightnyan: 2, freezepaw: 2, healing_paw: 2 },
    },
  });

  await withScenarioPage({ ...shared, savePayload: save }, async (ctx) => {
    const { page, defaultViewport } = ctx;
    await page.locator('.title-actions button:has-text("Continuer")').click();
    await waitForTransitionDone(page, 4000);

    // 1. Inventory modal + all dynamic filter tabs
    await page.keyboard.press('KeyI');
    await page.waitForFunction(() => window.__CAT_QUEST__?.getSnapshot?.()?.activeModal === 'inventory');
    await settleFrames(page, 280);

    const tabCount = await page.locator('.inv-filter-row .tab-btn').count();
    for (let i = 0; i < tabCount; i++) {
      await page.locator('.inv-filter-row .tab-btn').nth(i).click();
      await settleFrames(page, 160);
      await auditAndCapture(ctx, {
        scenario: 'modals',
        view: `inventory_tab_${i}`,
        viewport: defaultViewport,
      });
    }
    if (tabCount > 0) {
      await page.locator('.inv-filter-row .tab-btn').first().click();
      await settleFrames(page, 160);
    }
    await sweepViewports(ctx, {
      scenario: 'modals',
      view: 'inventory',
    });
    await page.keyboard.press('Escape');
    await waitForModalClosed(page);
    await settleFrames(page, 120);

    // 2. World Map modal ("Carte de Félingard")
    await page.keyboard.press('KeyM');
    await page.waitForFunction(() => window.__CAT_QUEST__?.getSnapshot?.()?.activeModal === 'map');
    await settleFrames(page, 280);
    await sweepViewports(ctx, {
      scenario: 'modals',
      view: 'world_map',
    });
    await page.keyboard.press('Escape');
    await waitForModalClosed(page);
    await settleFrames(page, 120);

    // 3. Quests modal (click .hud-quest-card)
    await page.locator('.hud-quest-card').click();
    await page.waitForFunction(() => window.__CAT_QUEST__?.getSnapshot?.()?.activeModal === 'quests');
    await settleFrames(page, 280);
    await sweepViewports(ctx, {
      scenario: 'modals',
      view: 'quests',
    });
    await page.keyboard.press('Escape');
    await waitForModalClosed(page);
    await settleFrames(page, 120);

    // 4. Forge modal (Chest + Reveal + Spell Altar)
    await walkTo(page, [[7.5, 22.3]], { stopOnInteractableId: 'interact_building_forge', timeoutMs: 12000 });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__CAT_QUEST__?.getSnapshot?.()?.activeModal === 'forge');
    await settleFrames(page, 280);

    const buyBtn = page.locator('.forge-chest-panel button.wood-btn--gold');
    if (await buyBtn.isEnabled()) {
      await buyBtn.click();
      await settleFrames(page, 220);
    }
    await sweepViewports(ctx, {
      scenario: 'modals',
      view: 'forge_chest',
    });

    await page.locator('.forge-tabs .tab-btn').nth(1).click();
    await settleFrames(page, 240);
    await sweepViewports(ctx, {
      scenario: 'modals',
      view: 'forge_altar',
    });

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__CAT_QUEST__?.getSnapshot?.()?.activeModal === 'none');
  });
}

async function runBiomesScenario(shared) {
  await withScenarioPage({ ...shared, savePayload: makeSave() }, async (ctx) => {
    const { page, defaultViewport } = ctx;
    await page.locator('.title-actions button:has-text("Continuer")').click();
    await waitForTransitionDone(page, 4000);

    // Plains + combat VFX
    await walkTo(page, [[18, 23], [26, 22]], { timeoutMs: 18000 });
    await page.keyboard.press('Digit1');
    await settleFrames(page, 220);
    await auditAndCapture(ctx, {
      scenario: 'biomes',
      view: 'plains_combat',
      viewport: defaultViewport,
    });

    await walkTo(page, [[38, 22]], { timeoutMs: 15000 });
    await auditAndCapture(ctx, {
      scenario: 'biomes',
      view: 'plains_shoreline',
      viewport: defaultViewport,
    });

    // Forest
    await walkTo(page, [[26, 16], [10, 12], [-14, 10], [-26, -2], [-34, -14]], { timeoutMs: 22000 });
    await auditAndCapture(ctx, {
      scenario: 'biomes',
      view: 'forest_deep',
      viewport: defaultViewport,
    });

    // Frost
    await walkTo(page, [[-20, -18], [0, -24], [12, -31]], { timeoutMs: 22000 });
    await auditAndCapture(ctx, {
      scenario: 'biomes',
      view: 'frost_summit',
      viewport: defaultViewport,
    });

    await walkTo(page, [[29, -31]], { timeoutMs: 15000 });
    await auditAndCapture(ctx, {
      scenario: 'biomes',
      view: 'frost_shoreline',
      viewport: defaultViewport,
    });
  });
}

async function runGhostCaveScenario(shared) {
  await withScenarioPage({ ...shared, savePayload: makeSave() }, async (ctx) => {
    const { page, defaultViewport } = ctx;
    await page.locator('.title-actions button:has-text("Continuer")').click();
    await waitForTransitionDone(page, 4000);

    await walkTo(page, [[18, 22], [24, 11], [30, 5.5]], {
      stopOnInteractableId: 'portal_ghost_cave',
      timeoutMs: 20000,
    });
    await page.keyboard.press('Enter');

    await captureTransitionBanner(ctx, {
      scenario: 'ghost_cave',
      view: 'transition_ghost_cave',
      viewport: defaultViewport,
    });

    await page.waitForFunction(() => window.__CAT_QUEST__?.getSnapshot?.()?.zoneId === 'dungeon_ghost_cave', null, {
      timeout: 8000,
    });
    await waitForTransitionDone(page, 4000);

    await auditAndCapture(ctx, {
      scenario: 'ghost_cave',
      view: 'interior_entry',
      viewport: defaultViewport,
      assertFn: (snap) =>
        snap?.zoneId === 'dungeon_ghost_cave'
          ? []
          : [{ category: 'scenario', code: 'expected_ghost_cave_zone', zoneId: snap?.zoneId }],
    });

    // Walk north to aggro Rat King & trigger Active Boss HUD (z <= 4)
    await walkTo(page, [[0, 10], [0, 2.5]], { timeoutMs: 20000 });
    await page.waitForFunction(() => {
      const s = window.__CAT_QUEST__?.getSnapshot?.();
      const b = document.querySelector('.hud-boss:not(.is-hidden)');
      return Boolean(s?.activeBoss?.typeId === 'boss_rat_king' && b && parseFloat(getComputedStyle(b).opacity) > 0.9);
    }, null, { timeout: 8000 });

    await sweepViewports(ctx, {
      scenario: 'ghost_cave',
      view: 'boss_hud_rat_king',
      assertFn: (snap) =>
        snap?.activeBoss?.typeId === 'boss_rat_king'
          ? []
          : [{ category: 'scenario', code: 'missing_rat_king_boss_hud', activeBoss: snap?.activeBoss }],
    });
  });
}

async function runDragonLairScenario(shared) {
  const opSave = makeSave({
    player: {
      level: 10,
      hasRunicKey: true,
      hp: 9999,
      mp: 9999,
      equipped: {
        weapon: 'blade_dragon',
        secondary_weapon: '',
        shield: '',
        helmet: 'helm_dragon',
        armor: 'armor_dragon',
        trinket: '',
      },
      inventory: {
        blade_dragon: { id: 'blade_dragon', level: 40 },
        helm_dragon: { id: 'helm_dragon', level: 40 },
        armor_dragon: { id: 'armor_dragon', level: 40 },
      },
      spellLevels: { flamepurr: 5, lightnyan: 5, freezepaw: 5, healing_paw: 5 },
    },
    defeatedBossIds: [],
  });

  await withScenarioPage({ ...shared, savePayload: opSave }, async (ctx) => {
    const { page, defaultViewport } = ctx;
    await page.locator('.title-actions button:has-text("Continuer")').click();
    await waitForTransitionDone(page, 4000);

    await walkTo(page, [[4, 18], [5, 6], [6, -15], [6, -32], [8, -40.5]], {
      stopOnInteractableId: 'portal_dragon_lair',
      timeoutMs: 25000,
    });
    await page.keyboard.press('Enter');

    await captureTransitionBanner(ctx, {
      scenario: 'dragon_lair',
      view: 'transition_dragon_lair',
      viewport: defaultViewport,
    });

    await page.waitForFunction(() => window.__CAT_QUEST__?.getSnapshot?.()?.zoneId === 'dungeon_dragon_lair', null, {
      timeout: 8000,
    });
    await waitForTransitionDone(page, 4000);

    await auditAndCapture(ctx, {
      scenario: 'dragon_lair',
      view: 'interior_entry',
      viewport: defaultViewport,
      assertFn: (snap) =>
        snap?.zoneId === 'dungeon_dragon_lair'
          ? []
          : [{ category: 'scenario', code: 'expected_dragon_lair_zone', zoneId: snap?.zoneId }],
    });

    // Walk to z <= 11 to trigger Dragon Claw Boss HUD
    await walkTo(page, [[0, 9.5]], { timeoutMs: 18000 });
    await page.waitForFunction(() => {
      const s = window.__CAT_QUEST__?.getSnapshot?.();
      const b = document.querySelector('.hud-boss:not(.is-hidden)');
      return Boolean(s?.activeBoss?.typeId === 'boss_dragon_claw' && b && parseFloat(getComputedStyle(b).opacity) > 0.9);
    }, null, { timeout: 8000 });

    await auditAndCapture(ctx, {
      scenario: 'dragon_lair',
      view: 'boss_hud_dragon_claw',
      viewport: defaultViewport,
    });

    // Close in on boss and cast spells to trigger Victory Dialogue -> Victory Screen
    await walkTo(page, [[0, -6]], { timeoutMs: 15000 });
    for (let attempt = 0; attempt < 8; attempt++) {
      const snap = await getSnapshot(page);
      if (snap?.dialogue?.active || snap?.screen === 'victory') break;
      await page.keyboard.press('Digit1'); // flamepurr AoE
      await settleFrames(page, 250);
      await page.keyboard.press('Digit2'); // lightnyan
      await settleFrames(page, 350);
      if (attempt === 3) {
        await walkTo(page, [[0, -9]], { timeoutMs: 6000 });
      }
    }

    await page.waitForFunction(
      () => {
        const s = window.__CAT_QUEST__?.getSnapshot?.();
        return Boolean(s && (s.dialogue?.active || s.screen === 'victory'));
      },
      null,
      { timeout: 10000 },
    );

    for (let i = 0; i < 6; i++) {
      const snap = await getSnapshot(page);
      if (snap?.screen === 'victory') break;
      if (snap?.dialogue?.active) {
        await page.keyboard.press('Space');
        await settleFrames(page, 240);
      } else {
        await page.waitForTimeout(200);
      }
    }

    await page.waitForFunction(() => window.__CAT_QUEST__?.getSnapshot?.()?.screen === 'victory', null, {
      timeout: 8000,
    });
    await settleFrames(page, 300);

    await sweepViewports(ctx, {
      scenario: 'dragon_lair',
      view: 'victory_screen',
      assertFn: (snap) =>
        snap?.screen === 'victory'
          ? []
          : [{ category: 'scenario', code: 'expected_victory_screen', screen: snap?.screen }],
    });
  });
}

async function runEndgameScenario(shared) {
  // 1. Pause screen
  await withScenarioPage({ ...shared, savePayload: makeSave() }, async (ctx) => {
    const { page } = ctx;
    await page.locator('.title-actions button:has-text("Continuer")').click();
    await waitForTransitionDone(page, 4000);

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__CAT_QUEST__?.getSnapshot?.()?.screen === 'paused', null, {
      timeout: 5000,
    });
    await settleFrames(page, 280);

    await sweepViewports(ctx, {
      scenario: 'endgame',
      view: 'pause_screen',
      assertFn: (snap) =>
        snap?.screen === 'paused'
          ? []
          : [{ category: 'scenario', code: 'expected_pause_screen', screen: snap?.screen }],
    });
  });

  // 2. Defeat screen ("Chat-astrophe !")
  const fragileSave = makeSave({
    player: {
      level: 1,
      hp: 1,
      mp: 10,
      hasRunicKey: false,
      equipped: {
        weapon: 'sword_wood',
        secondary_weapon: '',
        shield: '',
        helmet: '',
        armor: '',
        trinket: '',
      },
      inventory: {
        sword_wood: { id: 'sword_wood', level: 1 },
      },
    },
  });

  await withScenarioPage({ ...shared, savePayload: fragileSave }, async (ctx) => {
    const { page } = ctx;
    await page.locator('.title-actions button:has-text("Continuer")').click();
    await waitForTransitionDone(page, 4000);

    await walkTo(page, [[4, 24], [18.5, 23]], { timeoutMs: 18000 });
    await page.waitForFunction(() => window.__CAT_QUEST__?.getSnapshot?.()?.screen === 'defeat', null, {
      timeout: 15000,
    });
    await settleFrames(page, 300);

    await sweepViewports(ctx, {
      scenario: 'endgame',
      view: 'defeat_screen',
      assertFn: (snap) =>
        snap?.screen === 'defeat'
          ? []
          : [{ category: 'scenario', code: 'expected_defeat_screen', screen: snap?.screen }],
    });
  });
}

const SCENARIO_RUNNERS = {
  title: runTitleScenario,
  intro: runIntroScenario,
  village: runVillageScenario,
  modals: runModalsScenario,
  biomes: runBiomesScenario,
  ghost_cave: runGhostCaveScenario,
  dragon_lair: runDragonLairScenario,
  endgame: runEndgameScenario,
};

export async function runAllScenarios({ browser, url, outDir, activeViewports, scenarioIds }) {
  const results = [];
  const sessionErrors = {
    consoleErrors: [],
    consoleWarnings: [],
    webglWarningsOrErrors: [],
    pageErrors: [],
    requestFailed: [],
    httpErrors: [],
  };

  const shared = { browser, url, activeViewports, outDir, results, sessionErrors };

  for (const id of scenarioIds) {
    const runner = SCENARIO_RUNNERS[id];
    if (!runner) continue;
    console.log(`[e2e] Running scenario: ${id}`);
    await runner(shared);
  }

  return { results, sessionErrors };
}
