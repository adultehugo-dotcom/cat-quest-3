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
  'maritime',
  'ocean_weather',
  'cape_lighting',
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

function normalizeAngleRad(a) {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r <= -Math.PI) r += Math.PI * 2;
  return r;
}

async function getMetrics(page) {
  return page.evaluate(() => window.__CAT_QUEST__?.getMetrics?.() ?? null);
}

/**
 * Pilote le voilier au clavier réel (KeyW/KeyS/KeyA/KeyD) en boucle fermée sur `__CAT_QUEST__.getSnapshot().ship`.
 */
async function steerShipTo(
  page,
  waypoints,
  {
    arrivalRadius = 4.0,
    stopOnCoastCollision = false,
    stopOnCanDisembarkIsland = null,
    keepKeysOnExit = false,
    timeoutMs = 26000,
  } = {},
) {
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

  let sawCoastCollision = false;

  try {
    for (const [tx, tz] of waypoints) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const snap = await getSnapshot(page);
        if (!snap || snap.screen !== 'playing' || !snap.ship || snap.ship.mode !== 'sailing') {
          return { snap, sawCoastCollision };
        }

        if (snap.ship.isCollidingShore) {
          sawCoastCollision = true;
          if (stopOnCoastCollision) {
            return { snap, sawCoastCollision };
          }
        }

        if (
          stopOnCanDisembarkIsland &&
          snap.ship.canDisembark &&
          snap.ship.nearestCoastIslandId === stopOnCanDisembarkIsland
        ) {
          return { snap, sawCoastCollision };
        }

        const dx = tx - snap.ship.x;
        const dz = tz - snap.ship.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= arrivalRadius && !stopOnCoastCollision && !stopOnCanDisembarkIsland) {
          break;
        }

        // Cap canonique Three.js : forward(angle) = (-sin(angle), -cos(angle))
        const desiredHeading = Math.atan2(-dx, -dz);
        const angleErr = normalizeAngleRad(desiredHeading - snap.ship.angle);

        const next = new Set();
        // angleErr > 0 => cible à gauche (CCW) => KeyA (steer = -1 => angularVelocity > 0)
        if (angleErr > 0.12) {
          next.add('KeyA');
        } else if (angleErr < -0.12) {
          next.add('KeyD');
        }

        if (Math.abs(angleErr) < 1.05) {
          if (stopOnCoastCollision || dist > 6.5 || snap.ship.speed < 4.5) {
            next.add('KeyW');
          }
        } else if (snap.ship.speed > 4.2) {
          next.add('KeyS');
        }

        await syncKeys(next);
        await page.waitForTimeout(60);
      }
    }
    return { snap: await getSnapshot(page), sawCoastCollision };
  } finally {
    if (!keepKeysOnExit) {
      await syncKeys(new Set());
    }
  }
}

async function runMaritimeScenario(shared) {
  // Utilise makeSave() (version 1 sans champ ship) -> valide la migration v1 en navigateur réel !
  await withScenarioPage({ ...shared, savePayload: makeSave() }, async (ctx) => {
    const { page, defaultViewport } = ctx;
    await page.locator('.title-actions button:has-text("Continuer")').click();
    await waitForTransitionDone(page, 4000);

    // 1. Marcher jusqu'à la plage Sud de Félingard où le bateau est amarré
    await walkTo(page, [[0, 36], [0, 47.2]], {
      stopOnInteractableId: 'ship_board',
      timeoutMs: 25000,
    });
    await page.waitForFunction(
      () => window.__CAT_QUEST__?.getSnapshot?.()?.nearestInteractable?.type === 'ship_board',
      null,
      { timeout: 6000 },
    );

    const beforeBoardSnap = await getSnapshot(page);
    const mpBeforeBoard = beforeBoardSnap?.player?.mp ?? 0;

    await auditAndCapture(ctx, {
      scenario: 'maritime',
      view: 'ship_moored_felingard',
      viewport: defaultViewport,
      assertFn: async (snap, p) => {
        const errs = [];
        if (snap?.ship?.mode !== 'parked') {
          errs.push({ category: 'scenario', code: 'expected_ship_parked', mode: snap?.ship?.mode });
        }
        if (snap?.nearestInteractable?.type !== 'ship_board') {
          errs.push({
            category: 'scenario',
            code: 'expected_ship_board_prompt',
            nearest: snap?.nearestInteractable,
          });
        }
        const promptVisible = await p.locator('.interact-prompt:not(.is-hidden)').isVisible().catch(() => false);
        if (!promptVisible) {
          errs.push({ category: 'scenario', code: 'ship_board_prompt_not_visible' });
        }
        return errs;
      },
    });

    // 2. Embarquement réel via touche [E] (vérifie priorité [E] -> 0 MP dépensé)
    await page.keyboard.press('KeyE');
    await page.waitForFunction(
      () => window.__CAT_QUEST__?.getSnapshot?.()?.ship?.mode === 'sailing',
      null,
      { timeout: 8000 },
    );
    await settleFrames(page, 180);

    await auditAndCapture(ctx, {
      scenario: 'maritime',
      view: 'ship_boarding',
      viewport: defaultViewport,
      assertFn: async (snap, p) => {
        const errs = [];
        if (snap?.ship?.mode !== 'sailing' || !snap?.ship?.isSailing) {
          errs.push({ category: 'scenario', code: 'expected_ship_sailing_after_boarding', ship: snap?.ship });
        }
        if (!snap?.player?.onShipDeck || !snap?.companion?.onShipDeck) {
          errs.push({
            category: 'scenario',
            code: 'expected_crew_on_deck',
            playerOnDeck: snap?.player?.onShipDeck,
            companionOnDeck: snap?.companion?.onShipDeck,
          });
        }
        if ((snap?.player?.mp ?? -1) !== mpBeforeBoard) {
          errs.push({
            category: 'scenario',
            code: 'boarding_e_key_spent_mp',
            mpBeforeBoard,
            mpAfter: snap?.player?.mp,
          });
        }
        const spellBarVisible = await p.locator('.spell-bar:not(.is-hidden)').isVisible().catch(() => false);
        if (spellBarVisible) {
          errs.push({ category: 'scenario', code: 'spell_bar_should_be_hidden_at_sea' });
        }
        return errs;
      },
    });

    // 3. Navigation en mer ouverte + sillage actif (KeyW réel) + baseline mémoire GPU T0
    await steerShipTo(page, [[28, 66]], { arrivalRadius: 4.5, timeoutMs: 22000 });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(700);
    const metricsCruiseT0 = await getMetrics(page);
    await auditAndCapture(ctx, {
      scenario: 'maritime',
      view: 'ship_sailing_wake',
      viewport: defaultViewport,
      immediate: true,
      assertFn: (snap) => {
        const errs = [];
        if (snap?.ship?.mode !== 'sailing') {
          errs.push({ category: 'scenario', code: 'expected_sailing_wake', mode: snap?.ship?.mode });
        }
        if ((snap?.ship?.speed ?? 0) < 4.5) {
          errs.push({ category: 'scenario', code: 'expected_cruise_speed_for_wake', speed: snap?.ship?.speed });
        }
        return errs;
      },
    });

    // 4. Virage actif à bâbord (KeyW + KeyA) -> vérifie angle croissant (CCW), gouvernail < 0 & Δgeometries/textures === 0
    // Attend que le temps de simulation avance réellement (indépendant du FPS SwiftShader)
    const beforeTurnSnap = await getSnapshot(page);
    const angleBeforeTurn = beforeTurnSnap?.ship?.angle ?? 0;
    const simTimeBeforeTurn = beforeTurnSnap?.time ?? 0;
    await page.keyboard.down('KeyA');
    await page
      .waitForFunction(
        ({ a0, t0 }) => {
          const s = window.__CAT_QUEST__?.getSnapshot?.();
          if (!s?.ship) return false;
          let d = s.ship.angle - a0;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d <= -Math.PI) d += Math.PI * 2;
          return s.time - t0 >= 0.85 && d > 0.35 && s.ship.rudder < -0.5;
        },
        { a0: angleBeforeTurn, t0: simTimeBeforeTurn },
        { timeout: 14000 },
      )
      .catch(() => {});
    const turningSnap = await getSnapshot(page);
    const metricsCruiseT1 = await getMetrics(page);

    await auditAndCapture(ctx, {
      scenario: 'maritime',
      view: 'ship_turning',
      viewport: defaultViewport,
      immediate: true,
      assertFn: (snap) => {
        const errs = [];
        const dAngle = normalizeAngleRad((snap?.ship?.angle ?? 0) - angleBeforeTurn);
        if (dAngle <= 0.25) {
          errs.push({
            category: 'scenario',
            code: 'expected_port_turn_ccw_angle_increase',
            angleBeforeTurn,
            angleAfter: snap?.ship?.angle,
            dAngle,
          });
        }
        if ((snap?.ship?.rudder ?? 0) >= -0.25) {
          errs.push({
            category: 'scenario',
            code: 'expected_left_rudder_negative',
            rudder: snap?.ship?.rudder,
          });
        }
        if (
          metricsCruiseT0 &&
          metricsCruiseT1 &&
          (metricsCruiseT1.geometries !== metricsCruiseT0.geometries ||
            metricsCruiseT1.gpuTextures !== metricsCruiseT0.gpuTextures)
        ) {
          errs.push({
            category: 'perf',
            code: 'gpu_memory_growth_during_sailing',
            t0: { geometries: metricsCruiseT0.geometries, gpuTextures: metricsCruiseT0.gpuTextures },
            t1: { geometries: metricsCruiseT1.geometries, gpuTextures: metricsCruiseT1.gpuTextures },
          });
        }
        return errs;
      },
    });
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyW');
    // Assure que turningSnap a bien vu un taux de rotation positif
    if ((turningSnap?.ship?.angularVelocity ?? 0) <= 0) {
      // Déjà couvert par dAngle ci-dessus si la capture s'est faite à la transition
    }

    // 5. Approche directe vers Plage des Ronrons Dorés (tropical: centre 92, 48) -> collision côte sans pénétration
    const colRes = await steerShipTo(page, [[60, 56], [92, 48]], {
      stopOnCoastCollision: true,
      timeoutMs: 28000,
    });
    await auditAndCapture(ctx, {
      scenario: 'maritime',
      view: 'ship_coast_collision',
      viewport: defaultViewport,
      immediate: true,
      assertFn: (snap) => {
        const errs = [];
        if (!colRes.sawCoastCollision) {
          errs.push({ category: 'scenario', code: 'expected_coast_collision_contact', ship: snap?.ship });
        }
        const distCenter = Math.hypot((snap?.ship?.x ?? 0) - 92, (snap?.ship?.z ?? 0) - 48);
        if (distCenter < 25.0) {
          errs.push({
            category: 'scenario',
            code: 'ship_penetrated_tropical_island',
            distCenter,
            ship: snap?.ship,
          });
        }
        return errs;
      },
    });

    // 6. Positionné sur la plage de tropical -> prompt Débarquer visible (sweep 6 viewports)
    if (!(await getSnapshot(page))?.ship?.canDisembark) {
      await steerShipTo(page, [[65, 36]], {
        stopOnCanDisembarkIsland: 'tropical',
        timeoutMs: 18000,
      });
    }
    await page.waitForFunction(
      () =>
        Boolean(
          window.__CAT_QUEST__?.getSnapshot?.()?.ship?.canDisembark &&
            window.__CAT_QUEST__?.getSnapshot?.()?.nearestInteractable?.type === 'ship_disembark',
        ),
      null,
      { timeout: 8000 },
    );
    await sweepViewports(ctx, {
      scenario: 'maritime',
      view: 'ship_beach_approach_prompt',
      assertFn: async (snap, p) => {
        const errs = [];
        if (!snap?.ship?.canDisembark) {
          errs.push({ category: 'scenario', code: 'expected_can_disembark_true', ship: snap?.ship });
        }
        if (snap?.nearestInteractable?.type !== 'ship_disembark') {
          errs.push({
            category: 'scenario',
            code: 'expected_ship_disembark_prompt',
            nearest: snap?.nearestInteractable,
          });
        }
        const visible = await p.locator('.interact-prompt:not(.is-hidden)').isVisible().catch(() => false);
        if (!visible) {
          errs.push({ category: 'scenario', code: 'disembark_prompt_not_visible' });
        }
        return errs;
      },
    });

    // 7. Débarquement sur tropical via touche [E] -> freinage auto + saut parabolique + parked
    await page.keyboard.press('KeyE');
    await page.waitForFunction(
      () => {
        const s = window.__CAT_QUEST__?.getSnapshot?.();
        return Boolean(s && s.ship?.mode === 'parked' && s.islandId === 'tropical');
      },
      null,
      { timeout: 12000 },
    );
    await settleFrames(page, 260);

    const disembarkedSnap = await getSnapshot(page);
    const mooredP1 = {
      x: disembarkedSnap?.ship?.x ?? 0,
      z: disembarkedSnap?.ship?.z ?? 0,
      angle: disembarkedSnap?.ship?.angle ?? 0,
    };
    const landingL1 = {
      x: disembarkedSnap?.player?.x ?? 0,
      z: disembarkedSnap?.player?.z ?? 0,
    };

    await auditAndCapture(ctx, {
      scenario: 'maritime',
      view: 'ship_disembarked_island',
      viewport: defaultViewport,
      assertFn: async (snap, p) => {
        const errs = [];
        if (snap?.islandId !== 'tropical') {
          errs.push({ category: 'scenario', code: 'expected_tropical_island', islandId: snap?.islandId });
        }
        if (snap?.ship?.mode !== 'parked' || snap?.player?.onShipDeck || snap?.companion?.onShipDeck) {
          errs.push({
            category: 'scenario',
            code: 'expected_parked_on_land_crew',
            shipMode: snap?.ship?.mode,
            playerOnDeck: snap?.player?.onShipDeck,
            companionOnDeck: snap?.companion?.onShipDeck,
          });
        }
        const spellBarVisible = await p.locator('.spell-bar:not(.is-hidden)').isVisible().catch(() => false);
        if (!spellBarVisible) {
          errs.push({ category: 'scenario', code: 'spell_bar_should_reappear_on_land' });
        }
        return errs;
      },
    });

    // 8. S'éloigner sur l'île, ouvrir le coffre de tropical (sauvegarde v2), RECHARGER LA PAGE,
    // vérifier que le bateau est toujours à P1 (non téléporté), revenir à P1 et ré-embarquer
    await walkTo(page, [[82, 43]], {
      stopOnInteractableId: 'interact_chest_tropical_shore',
      timeoutMs: 20000,
    });
    const chestSnapBefore = await getSnapshot(page);
    if (chestSnapBefore?.nearestInteractable?.id === 'interact_chest_tropical_shore') {
      await page.keyboard.press('KeyE');
      await settleFrames(page, 350);
    }

    // Reload complet du navigateur pour tester la persistance réelle localStorage (v2)
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await waitForGameReady(page, 20000);
    await settleFrames(page, 240);
    await page.locator('.title-actions button:has-text("Continuer")').click();
    await waitForTransitionDone(page, 4000);
    await settleFrames(page, 240);

    const afterReloadSnap = await getSnapshot(page);
    const boatDriftAfterReload = Math.hypot(
      (afterReloadSnap?.ship?.x ?? 0) - mooredP1.x,
      (afterReloadSnap?.ship?.z ?? 0) - mooredP1.z,
    );

    // Revient à pied jusqu'au bateau resté amarré en P1
    await walkTo(page, [[landingL1.x, landingL1.z]], {
      stopOnInteractableId: 'ship_board',
      timeoutMs: 22000,
    });
    await page.waitForFunction(
      () => window.__CAT_QUEST__?.getSnapshot?.()?.nearestInteractable?.type === 'ship_board',
      null,
      { timeout: 6000 },
    );

    await auditAndCapture(ctx, {
      scenario: 'maritime',
      view: 'ship_return_and_reboard',
      viewport: defaultViewport,
      assertFn: (snap) => {
        const errs = [];
        if (afterReloadSnap?.islandId !== 'tropical') {
          errs.push({
            category: 'scenario',
            code: 'expected_tropical_after_reload',
            islandId: afterReloadSnap?.islandId,
          });
        }
        if (boatDriftAfterReload > 0.12) {
          errs.push({
            category: 'scenario',
            code: 'ship_teleported_after_reload',
            mooredP1,
            reloadedShip: afterReloadSnap?.ship,
            boatDriftAfterReload,
          });
        }
        if (snap?.nearestInteractable?.type !== 'ship_board') {
          errs.push({
            category: 'scenario',
            code: 'expected_ship_board_on_return',
            nearest: snap?.nearestInteractable,
          });
        }
        return errs;
      },
    });

    // Ré-embarque et retourne débarquer sur la côte Est de Félingard (changement d'île)
    await page.keyboard.press('KeyE');
    await page.waitForFunction(
      () => window.__CAT_QUEST__?.getSnapshot?.()?.ship?.mode === 'sailing',
      null,
      { timeout: 8000 },
    );

    await steerShipTo(page, [[62, 32], [53, 14]], {
      stopOnCanDisembarkIsland: 'felingard',
      timeoutMs: 32000,
    });
    await page.waitForFunction(
      () =>
        Boolean(
          window.__CAT_QUEST__?.getSnapshot?.()?.ship?.canDisembark &&
            window.__CAT_QUEST__?.getSnapshot?.()?.ship?.nearestCoastIslandId === 'felingard',
        ),
      null,
      { timeout: 8000 },
    );
    await page.keyboard.press('KeyE');
    await page.waitForFunction(
      () => {
        const s = window.__CAT_QUEST__?.getSnapshot?.();
        return Boolean(s && s.ship?.mode === 'parked' && s.islandId === 'felingard');
      },
      null,
      { timeout: 12000 },
    );
    await settleFrames(page, 260);

    await auditAndCapture(ctx, {
      scenario: 'maritime',
      view: 'ship_island_hop_return',
      viewport: defaultViewport,
      assertFn: (snap) => {
        const errs = [];
        if (snap?.islandId !== 'felingard' || snap?.ship?.mode !== 'parked') {
          errs.push({
            category: 'scenario',
            code: 'expected_return_felingard_parked',
            islandId: snap?.islandId,
            ship: snap?.ship,
          });
        }
        const distFromInitialSouth = Math.hypot((snap?.ship?.x ?? 0) - 0, (snap?.ship?.z ?? 0) - 53);
        if (distFromInitialSouth < 15) {
          errs.push({
            category: 'scenario',
            code: 'expected_distinct_landing_beach_on_felingard',
            ship: snap?.ship,
          });
        }
        return errs;
      },
    });

    // 9. Ouvrir la Carte du Monde avec le bateau déplacé sur la côte Est (DOM audit zéro chevauchement)
    await page.keyboard.press('KeyM');
    await page.waitForFunction(() => window.__CAT_QUEST__?.getSnapshot?.()?.activeModal === 'map');
    await settleFrames(page, 260);
    await auditAndCapture(ctx, {
      scenario: 'maritime',
      view: 'maritime_world_map',
      viewport: defaultViewport,
    });
    await page.keyboard.press('Escape');
    await waitForModalClosed(page);
  });
}

async function runOceanWeatherScenario(shared) {
  await withScenarioPage({ ...shared, savePayload: makeSave() }, async (ctx) => {
    const { page, defaultViewport } = ctx;

    // Vérifie qu'une nouvelle session démarre sans météo ni heure sauvegardées dans localStorage
    const rawSaveOnBoot = await page.evaluate((k) => localStorage.getItem(k), SAVE_STORAGE_KEY);
    const parsedBootSave = rawSaveOnBoot ? JSON.parse(rawSaveOnBoot) : {};
    const bootWeather = await getSnapshot(page);

    // Clic réel sur Continuer -> déverrouille aussi WebAudio et déclenche le chargement local des 4 .ogg !
    await page.locator('.title-actions button:has-text("Continuer")').click();
    await waitForTransitionDone(page, 4000);

    // Attend le chargement & décodage local des 4 fichiers audio météo (ocean, wind, rain, thunder)
    await page
      .waitForFunction(
        () => {
          const m = window.__CAT_QUEST__?.getMetrics?.();
          return Boolean(
            m?.audioUnlocked &&
              m?.weatherAudio &&
              m.weatherAudio.loadedTracks.length + m.weatherAudio.fallbackTracks.length === 4,
          );
        },
        null,
        { timeout: 10000 },
      )
      .catch(() => {});

    // 1. Bateau immobile & mer calme ensoleillée (clear day, midi)
    await page.evaluate(() => {
      window.__CAT_QUEST__?.setWeatherForTest?.({
        condition: 'clear',
        timeOfDay: 0.5,
        instant: true,
      });
    });
    await walkTo(page, [[0, 36], [0, 47.2]], {
      stopOnInteractableId: 'ship_board',
      timeoutMs: 24000,
    });
    await settleFrames(page, 260);

    await auditAndCapture(ctx, {
      scenario: 'ocean_weather',
      view: 'calm_parked_ship',
      viewport: defaultViewport,
      assertFn: async (snap, p) => {
        const errs = [];
        if (snap?.ship?.mode !== 'parked') {
          errs.push({ category: 'scenario', code: 'expected_parked_ship', mode: snap?.ship?.mode });
        }
        if (snap?.weather?.condition !== 'clear' || snap?.weather?.dayPhase !== 'day') {
          errs.push({ category: 'scenario', code: 'expected_clear_day', weather: snap?.weather });
        }
        if ('weather' in parsedBootSave || 'timeOfDay' in parsedBootSave) {
          errs.push({ category: 'scenario', code: 'weather_should_not_be_saved' });
        }
        if (!bootWeather?.weather?.condition) {
          errs.push({ category: 'scenario', code: 'missing_initial_weather_state' });
        }
        // Zéro indicateur ou réglage météo dans l'UI
        const weatherUiCount = await p.locator('[class*="weather"]:visible, [id*="weather"]:visible, [data-weather]:visible').count();
        if (weatherUiCount > 0) {
          errs.push({ category: 'dom', code: 'unexpected_weather_ui_elements', count: weatherUiCount });
        }
        return errs;
      },
    });

    await page.keyboard.press('Escape');
    const weatherSelect = page.locator('.pause-weather-row select');
    const weatherOptions = await weatherSelect.locator('option').evaluateAll((options) =>
      options.map((option) => ({ value: option.value, label: option.textContent?.trim() ?? '' })),
    );
    await weatherSelect.selectOption('storm');
    await page.waitForFunction(
      () => window.__CAT_QUEST__?.getSnapshot?.()?.weather?.targetCondition === 'storm',
      null,
      { timeout: 3000 },
    );
    const stormChoice = await getSnapshot(page);
    await weatherSelect.selectOption('auto');
    await page.waitForFunction(
      () => window.__CAT_QUEST__?.getSnapshot?.()?.weather?.targetCondition !== 'storm',
      null,
      { timeout: 3000 },
    );
    const autoChoice = await getSnapshot(page);

    await auditAndCapture(ctx, {
      scenario: 'ocean_weather',
      view: 'weather_selector_pause',
      viewport: defaultViewport,
      assertFn: () => {
        const expected = ['auto', 'clear', 'fog', 'storm'];
        const actual = weatherOptions.map((option) => option.value);
        const errs = [];
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          errs.push({ category: 'scenario', code: 'weather_options_missing', weatherOptions });
        }
        if (stormChoice?.weather?.targetCondition !== 'storm') {
          errs.push({ category: 'scenario', code: 'manual_weather_not_applied', weather: stormChoice?.weather });
        }
        if (autoChoice?.weather?.targetCondition === 'storm') {
          errs.push({ category: 'scenario', code: 'automatic_weather_not_restored', weather: autoChoice?.weather });
        }
        return errs;
      },
    });
    await page.locator('.center-screen-overlay:not(.is-hidden) .center-screen-buttons .wood-btn--gold').click();

    // 2. Embarquement + accélération + navigation en ligne droite en mer calme
    await page.keyboard.press('KeyE');
    await page.waitForFunction(
      () => window.__CAT_QUEST__?.getSnapshot?.()?.ship?.mode === 'sailing',
      null,
      { timeout: 8000 },
    );

    await steerShipTo(page, [[22, 66]], { arrivalRadius: 4.5, timeoutMs: 20000 });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(850);
    const gpuT0 = await getMetrics(page);
    await auditAndCapture(ctx, {
      scenario: 'ocean_weather',
      view: 'calm_sailing_straight',
      viewport: defaultViewport,
      immediate: true,
      assertFn: (snap) => {
        const errs = [];
        if ((snap?.ship?.speed ?? 0) < 5.0) {
          errs.push({ category: 'scenario', code: 'expected_forward_cruise_speed', speed: snap?.ship?.speed });
        }
        return errs;
      },
    });

    // 3. Virage actif (KeyW + KeyA) -> sillage courbé & gîte cohérente
    const turnStart = await getSnapshot(page);
    await page.keyboard.down('KeyA');
    await page
      .waitForFunction(
        ({ a0, t0 }) => {
          const s = window.__CAT_QUEST__?.getSnapshot?.();
          if (!s?.ship) return false;
          let d = s.ship.angle - a0;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d <= -Math.PI) d += Math.PI * 2;
          return s.time - t0 >= 0.85 && d > 0.35;
        },
        { a0: turnStart?.ship?.angle ?? 0, t0: turnStart?.time ?? 0 },
        { timeout: 14000 },
      )
      .catch(() => {});
    await auditAndCapture(ctx, {
      scenario: 'ocean_weather',
      view: 'calm_sailing_turn',
      viewport: defaultViewport,
      immediate: true,
      assertFn: (snap) => {
        const errs = [];
        const dA = normalizeAngleRad((snap?.ship?.angle ?? 0) - (turnStart?.ship?.angle ?? 0));
        if (dA <= 0.25) {
          errs.push({ category: 'scenario', code: 'expected_turn_ccw', dA });
        }
        return errs;
      },
    });
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyW');

    // 4. Freinage puis marche arrière réelle (KeyS jusqu'à speed < -1.5)
    await page.keyboard.down('KeyS');
    await page
      .waitForFunction(
        () => (window.__CAT_QUEST__?.getSnapshot?.()?.ship?.speed ?? 0) < -1.8,
        null,
        { timeout: 12000 },
      )
      .catch(() => {});
    const gpuAfterReverse = await getMetrics(page);
    await auditAndCapture(ctx, {
      scenario: 'ocean_weather',
      view: 'calm_sailing_reverse',
      viewport: defaultViewport,
      immediate: true,
      assertFn: (snap) => {
        const errs = [];
        if ((snap?.ship?.speed ?? 0) >= -1.2) {
          errs.push({ category: 'scenario', code: 'expected_reverse_speed', speed: snap?.ship?.speed });
        }
        if (
          gpuT0 &&
          gpuAfterReverse &&
          (gpuAfterReverse.geometries !== gpuT0.geometries ||
            gpuAfterReverse.gpuTextures !== gpuT0.gpuTextures)
        ) {
          errs.push({
            category: 'perf',
            code: 'gpu_memory_growth_during_maneuvers',
            t0: { geometries: gpuT0.geometries, gpuTextures: gpuT0.gpuTextures },
            t1: { geometries: gpuAfterReverse.geometries, gpuTextures: gpuAfterReverse.gpuTextures },
          });
        }
        return errs;
      },
    });
    await page.keyboard.up('KeyS');

    // 5. Coucher de soleil doré (clear, timeOfDay = 0.745) — sweep multi-résolutions
    await page.evaluate(() => {
      window.__CAT_QUEST__?.setWeatherForTest?.({
        condition: 'clear',
        timeOfDay: 0.745,
        instant: true,
      });
    });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(750);
    await page.keyboard.up('KeyW');
    await sweepViewports(ctx, {
      scenario: 'ocean_weather',
      view: 'golden_sunset_sea',
      assertFn: (snap) =>
        snap?.weather?.dayPhase === 'sunset'
          ? []
          : [{ category: 'scenario', code: 'expected_sunset_phase', weather: snap?.weather }],
    });

    // 6. Nuit lunaire (clear, timeOfDay = 0.02) — bateau & lanterne de poupe lisibles
    await page.evaluate(() => {
      window.__CAT_QUEST__?.setWeatherForTest?.({
        condition: 'clear',
        timeOfDay: 0.02,
        instant: true,
      });
    });
    await settleFrames(page, 260);
    const gpuWeatherT0 = await getMetrics(page);
    await auditAndCapture(ctx, {
      scenario: 'ocean_weather',
      view: 'moonlit_night_sea',
      viewport: defaultViewport,
      assertFn: (snap) =>
        snap?.weather?.dayPhase === 'night'
          ? []
          : [{ category: 'scenario', code: 'expected_night_phase', weather: snap?.weather }],
    });

    // 7. Brouillard dense (fog, jour) — masque le lointain mais bateau & zone proche reconnaissables
    await page.evaluate(() => {
      window.__CAT_QUEST__?.setWeatherForTest?.({
        condition: 'fog',
        timeOfDay: 0.48,
        instant: true,
      });
    });
    await settleFrames(page, 260);
    await auditAndCapture(ctx, {
      scenario: 'ocean_weather',
      view: 'dense_fog_sea',
      viewport: defaultViewport,
      assertFn: (snap) =>
        snap?.weather?.condition === 'fog' && (snap?.weather?.fogIntensity ?? 0) > 0.9
          ? []
          : [{ category: 'scenario', code: 'expected_dense_fog', weather: snap?.weather }],
    });

    // 8. Transition météo progressive (clear -> storm sur 12 s) vérifiée en paliers
    await page.evaluate(() => {
      window.__CAT_QUEST__?.setWeatherForTest?.({
        condition: 'clear',
        targetCondition: 'storm',
        timeOfDay: 0.52,
        instant: false,
        transitionDurationSec: 12,
      });
    });
    const transSteps = [];
    for (let k = 0; k < 6; k++) {
      await page.evaluate(() => window.__CAT_QUEST__?.advanceWeatherForTest?.(2.0));
      const s = await getSnapshot(page);
      transSteps.push({
        storm: s?.weather?.stormIntensity ?? 0,
        rain: s?.weather?.rainIntensity ?? 0,
        waveAmp: s?.weather?.waveAmplitude ?? 0,
      });
    }

    // 9. Tempête complète (forte houle, pluie, embruns, brouillard dense, éclair + tonnerre) — sweep multi-résolutions
    await page.evaluate(() => {
      window.__CAT_QUEST__?.setWeatherForTest?.({
        condition: 'storm',
        timeOfDay: 0.52,
        instant: true,
        triggerLightning: true,
      });
    });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(900);
    // Laisse passer le délai lumière -> son pour déclencher le tonnerre
    await page.evaluate(() => window.__CAT_QUEST__?.advanceWeatherForTest?.(1.5));
    await settleFrames(page, 180);
    const stormMetrics = await getMetrics(page);
    await page.keyboard.up('KeyW');

    await sweepViewports(ctx, {
      scenario: 'ocean_weather',
      view: 'storm_full_sea',
      assertFn: (snap) => {
        const errs = [];
        if (snap?.weather?.condition !== 'storm' || (snap?.weather?.stormIntensity ?? 0) < 0.9) {
          errs.push({ category: 'scenario', code: 'expected_full_storm', weather: snap?.weather });
        }
        if ((snap?.weather?.rainIntensity ?? 0) < 0.9 || (snap?.weather?.waveAmplitude ?? 0) < 1.9) {
          errs.push({ category: 'scenario', code: 'expected_storm_rain_and_swell', weather: snap?.weather });
        }
        // Vérifie la progressivité stricte de la transition clear -> storm
        const mid = transSteps[2];
        const end = transSteps[5];
        if (!(mid.storm > 0.15 && mid.storm < 0.85 && end.storm > 0.95 && end.waveAmp > transSteps[0].waveAmp)) {
          errs.push({ category: 'scenario', code: 'weather_transition_not_progressive', transSteps });
        }
        // Zéro fuite mémoire GPU (0 alloc géométries/textures à travers nuit -> brouillard -> tempête & navigation)
        if (
          gpuWeatherT0 &&
          stormMetrics &&
          (stormMetrics.geometries !== gpuWeatherT0.geometries ||
            stormMetrics.gpuTextures !== gpuWeatherT0.gpuTextures)
        ) {
          errs.push({
            category: 'perf',
            code: 'gpu_memory_growth_during_weather_sailing',
            t0: { geometries: gpuWeatherT0.geometries, gpuTextures: gpuWeatherT0.gpuTextures },
            t1: { geometries: stormMetrics.geometries, gpuTextures: stormMetrics.gpuTextures },
          });
        }
        // Audio local chargé (4/4 .ogg) & tonnerre déclenché
        if (stormMetrics?.audioUnlocked) {
          const loaded = stormMetrics.weatherAudio?.loadedTracks || [];
          if (loaded.length < 4) {
            errs.push({
              category: 'asset',
              code: 'weather_audio_tracks_not_all_loaded',
              weatherAudio: stormMetrics.weatherAudio,
            });
          }
          if ((stormMetrics.weatherAudio?.thunderCount ?? 0) < 1) {
            errs.push({
              category: 'scenario',
              code: 'expected_storm_thunder_played',
              weatherAudio: stormMetrics.weatherAudio,
            });
          }
        }
        return errs;
      },
    });

    // 10. Vérification stricte du volume général et du bouton Muet sur l'audio météo
    await page.evaluate(() => window.__CAT_QUEST__?.setAudioVolumeForTest?.(0.35));
    const afterVol = await getMetrics(page);
    await page.locator('button[aria-label="Audio"]').click();
    await settleFrames(page, 120);
    const afterMute = await getMetrics(page);
    const thunderBeforeMuted = afterMute?.weatherAudio?.thunderCount ?? 0;
    await page.evaluate(() => {
      window.__CAT_QUEST__?.setWeatherForTest?.({
        condition: 'storm',
        timeOfDay: 0.52,
        instant: true,
        triggerLightning: true,
      });
      window.__CAT_QUEST__?.advanceWeatherForTest?.(1.6);
    });
    const afterMutedThunder = await getMetrics(page);
    await page.locator('button[aria-label="Audio"]').click();
    await page.evaluate(() => window.__CAT_QUEST__?.setAudioVolumeForTest?.(0.85));
    await settleFrames(page, 120);
    const afterUnmute = await getMetrics(page);

    // 11. Approche d'une plage (Plage des Ronrons Dorés) en temps clair doré -> zéro traversée de la terre
    await page.evaluate(() => {
      window.__CAT_QUEST__?.setWeatherForTest?.({
        condition: 'clear',
        timeOfDay: 0.55,
        instant: true,
      });
    });
    await steerShipTo(page, [[60, 52], [72, 48]], {
      stopOnCanDisembarkIsland: 'tropical',
      timeoutMs: 26000,
    });
    await page.waitForFunction(
      () => Boolean(window.__CAT_QUEST__?.getSnapshot?.()?.ship?.canDisembark),
      null,
      { timeout: 10000 },
    );
    await auditAndCapture(ctx, {
      scenario: 'ocean_weather',
      view: 'beach_approach_attenuated_waves',
      viewport: defaultViewport,
      assertFn: (snap) => {
        const errs = [];
        if (!snap?.ship?.canDisembark) {
          errs.push({ category: 'scenario', code: 'expected_beach_can_disembark', ship: snap?.ship });
        }
        if (Math.abs((afterVol?.audioVolume ?? 0) - 0.35) > 0.02) {
          errs.push({ category: 'scenario', code: 'audio_volume_not_applied', afterVol });
        }
        if (!afterMute?.audioMuted || afterUnmute?.audioMuted) {
          errs.push({ category: 'scenario', code: 'mute_toggle_failed', afterMute, afterUnmute });
        }
        if ((afterMutedThunder?.weatherAudio?.thunderCount ?? -1) !== thunderBeforeMuted) {
          errs.push({
            category: 'scenario',
            code: 'thunder_played_while_muted',
            thunderBeforeMuted,
            afterMutedThunder: afterMutedThunder?.weatherAudio,
          });
        }
        return errs;
      },
    });
  });
}

async function runCapeLightingScenario(shared) {
  const capeSave = makeSave({
    player: {
      level: 10,
      gold: 1000,
      hasRunicKey: true,
      equipped: {
        weapon: 'blade_dragon',
        shield: 'shield_knight',
        helmet: 'helm_knight',
        armor: 'armor_mail',
        boots: 'boots_iron',
        gloves: 'gloves_iron',
        cape: 'cape_dragon',
        trinket: 'trinket_yarn',
      },
      inventory: {
        sword_wood: { id: 'sword_wood', level: 1 },
        blade_dragon: { id: 'blade_dragon', level: 10 },
        shield_wood: { id: 'shield_wood', level: 1 },
        shield_knight: { id: 'shield_knight', level: 5 },
        helm_bandana: { id: 'helm_bandana', level: 1 },
        helm_knight: { id: 'helm_knight', level: 5 },
        armor_tunic: { id: 'armor_tunic', level: 1 },
        armor_mail: { id: 'armor_mail', level: 5 },
        boots_iron: { id: 'boots_iron', level: 3 },
        gloves_iron: { id: 'gloves_iron', level: 3 },
        cape_traveler: { id: 'cape_traveler', level: 1 },
        cape_knight: { id: 'cape_knight', level: 3 },
        cape_starlight: { id: 'cape_starlight', level: 5 },
        cape_dragon: { id: 'cape_dragon', level: 5 },
        trinket_yarn: { id: 'trinket_yarn', level: 1 },
      },
    },
  });

  await withScenarioPage({ ...shared, savePayload: capeSave }, async (ctx) => {
    const { page, defaultViewport } = ctx;
    await page.locator('.title-actions button:has-text("Continuer")').click();
    await waitForTransitionDone(page, 4000);

    // 1. Plein jour clair : cape draconique au repos dans Miaou-bourg
    await page.evaluate(() => {
      window.__CAT_QUEST__?.setWeatherForTest?.({
        condition: 'clear',
        timeOfDay: 0.5,
        instant: true,
      });
    });
    await settleFrames(page, 320);

    const assertCapeHealthy = async (expectedCapeId) => {
      const m = await getMetrics(page);
      const errs = [];
      if (!m?.cape?.visible) {
        errs.push({ category: 'scenario', code: 'cape_not_visible', cape: m?.cape });
      }
      if (expectedCapeId && m?.cape?.activeCapeId !== expectedCapeId) {
        errs.push({
          category: 'scenario',
          code: 'unexpected_active_cape',
          expected: expectedCapeId,
          actual: m?.cape?.activeCapeId,
        });
      }
      if ((m?.cape?.minWorldY ?? -1) < 0.04) {
        errs.push({ category: 'scenario', code: 'cape_ground_clipping', cape: m?.cape });
      }
      if ((m?.cape?.maxZViolation ?? 1) > 0.005) {
        errs.push({ category: 'scenario', code: 'cape_front_body_clipping', cape: m?.cape });
      }
      return errs;
    };

    await auditAndCapture(ctx, {
      scenario: 'cape_lighting',
      view: 'cape_dragon_idle_day',
      viewport: defaultViewport,
      assertFn: () => assertCapeHealthy('cape_dragon'),
    });

    // 2. Course rapide vers l'Est puis virage brusque vers l'Ouest + arrêt net
    await page.keyboard.down('KeyD');
    await settleFrames(page, 420);
    await auditAndCapture(ctx, {
      scenario: 'cape_lighting',
      view: 'cape_dragon_run_east',
      viewport: defaultViewport,
      assertFn: () => assertCapeHealthy('cape_dragon'),
    });
    await page.keyboard.up('KeyD');
    await page.keyboard.down('KeyA');
    await settleFrames(page, 260);
    await auditAndCapture(ctx, {
      scenario: 'cape_lighting',
      view: 'cape_dragon_turn_west',
      viewport: defaultViewport,
      assertFn: () => assertCapeHealthy('cape_dragon'),
    });
    await page.keyboard.up('KeyA');
    await settleFrames(page, 180);
    await auditAndCapture(ctx, {
      scenario: 'cape_lighting',
      view: 'cape_dragon_stop_settle',
      viewport: defaultViewport,
      assertFn: () => assertCapeHealthy('cape_dragon'),
    });

    // 3. Attaque à l'épée + Roulade
    await page.keyboard.press('Space');
    await settleFrames(page, 90);
    await auditAndCapture(ctx, {
      scenario: 'cape_lighting',
      view: 'cape_dragon_attack',
      viewport: defaultViewport,
      assertFn: () => assertCapeHealthy('cape_dragon'),
    });

    await page.keyboard.down('KeyD');
    await page.keyboard.press('ShiftLeft');
    await settleFrames(page, 120);
    await auditAndCapture(ctx, {
      scenario: 'cape_lighting',
      view: 'cape_dragon_roll',
      viewport: defaultViewport,
      assertFn: () => assertCapeHealthy('cape_dragon'),
    });
    await page.keyboard.up('KeyD');
    await settleFrames(page, 240);

    // 3b. Nouveaux sorts : Égide de Ronron (5), Bond Foudroyant (6), Chute d'Étoiles (7)
    const beforeSpellsSnap = await getSnapshot(page);
    await page.keyboard.press('Digit5');
    await settleFrames(page, 180);
    await auditAndCapture(ctx, {
      scenario: 'cape_lighting',
      view: 'spell_aegis_purr_shield',
      viewport: defaultViewport,
      assertFn: (snap) => {
        const errs = [];
        if ((snap?.player?.shieldHp ?? 0) <= 0) {
          errs.push({ category: 'scenario', code: 'expected_aegis_shield_active', player: snap?.player });
        }
        return errs;
      },
    });

    await page.keyboard.press('Digit6');
    await settleFrames(page, 140);
    await auditAndCapture(ctx, {
      scenario: 'cape_lighting',
      view: 'spell_pounce_dash_mobility',
      viewport: defaultViewport,
      assertFn: (snap) => {
        const errs = [];
        const moved = Math.hypot(
          (snap?.player?.x ?? 0) - (beforeSpellsSnap?.player?.x ?? 0),
          (snap?.player?.z ?? 0) - (beforeSpellsSnap?.player?.z ?? 0),
        );
        if (moved < 2.0) {
          errs.push({ category: 'scenario', code: 'expected_pounce_dash_displacement', moved });
        }
        return errs;
      },
    });

    await page.keyboard.press('Digit7');
    await settleFrames(page, 310);
    await auditAndCapture(ctx, {
      scenario: 'cape_lighting',
      view: 'spell_meteor_paw_aoe',
      viewport: defaultViewport,
    });
    await settleFrames(page, 320);

    // 4. Changement de cape via l'Inventaire -> Cape de Nuit Étoilée (seule la cape change)
    await page.keyboard.press('KeyI');
    await page.waitForFunction(() => window.__CAT_QUEST__?.getSnapshot?.()?.activeModal === 'inventory');
    await settleFrames(page, 200);
    await page.locator('.inv-filter-row .tab-btn:has-text("Capes")').click();
    await settleFrames(page, 120);
    await page.locator('.inv-item-card:has-text("Cape de Nuit Étoilée")').click();
    await settleFrames(page, 160);
    await page.keyboard.press('Escape');
    await waitForModalClosed(page);
    await settleFrames(page, 220);

    // 5. Éclairage Aube / Nuit / Brouillard / Tempête + Lanterne auto sur la cape stellaire
    await page.evaluate(() => {
      window.__CAT_QUEST__?.setWeatherForTest?.({
        condition: 'clear',
        timeOfDay: 0.26,
        instant: true,
      });
    });
    await settleFrames(page, 260);
    await auditAndCapture(ctx, {
      scenario: 'cape_lighting',
      view: 'cape_starlight_dawn',
      viewport: defaultViewport,
      assertFn: async (snap) => {
        const errs = await assertCapeHealthy('cape_starlight');
        if (snap?.player?.equipped?.armor !== 'armor_mail' || snap?.player?.equipped?.helmet !== 'helm_knight') {
          errs.push({ category: 'scenario', code: 'cape_swap_altered_other_slots', equipped: snap?.player?.equipped });
        }
        return errs;
      },
    });

    await page.evaluate(() => {
      window.__CAT_QUEST__?.setWeatherForTest?.({
        condition: 'clear',
        timeOfDay: 0.02,
        instant: true,
      });
    });
    await settleFrames(page, 280);
    await auditAndCapture(ctx, {
      scenario: 'cape_lighting',
      view: 'cape_starlight_night_lantern',
      viewport: defaultViewport,
      assertFn: async () => {
        const errs = await assertCapeHealthy('cape_starlight');
        const m = await getMetrics(page);
        if (!m?.cape?.lanternActive || (m?.cape?.lanternIntensity ?? 0) <= 0.5) {
          errs.push({ category: 'scenario', code: 'expected_night_hero_lantern_active', cape: m?.cape });
        }
        return errs;
      },
    });

    await page.evaluate(() => {
      window.__CAT_QUEST__?.setWeatherForTest?.({
        condition: 'storm',
        timeOfDay: 0.5,
        instant: true,
      });
    });
    await page.keyboard.down('KeyS');
    await settleFrames(page, 380);
    await auditAndCapture(ctx, {
      scenario: 'cape_lighting',
      view: 'cape_starlight_storm_wind',
      viewport: defaultViewport,
      assertFn: () => assertCapeHealthy('cape_starlight'),
    });
    await page.keyboard.up('KeyS');

    // 6. Marche jusqu'au bateau, saut d'embarquement & vérification lanterne éteinte sur le pont
    await walkTo(page, [[0, 36], [0, 47.2]], {
      stopOnInteractableId: 'ship_board',
      timeoutMs: 22000,
    });
    await page.keyboard.press('KeyE');
    await settleFrames(page, 180);
    await auditAndCapture(ctx, {
      scenario: 'cape_lighting',
      view: 'cape_starlight_boarding_jump',
      viewport: defaultViewport,
    });
    await page.waitForFunction(
      () => window.__CAT_QUEST__?.getSnapshot?.()?.ship?.mode === 'sailing',
      null,
      { timeout: 8000 },
    );
    await settleFrames(page, 240);
    await auditAndCapture(ctx, {
      scenario: 'cape_lighting',
      view: 'cape_starlight_ship_deck_lantern_off',
      viewport: defaultViewport,
      assertFn: async () => {
        const m = await getMetrics(page);
        const errs = [];
        if (m?.cape?.lanternActive) {
          errs.push({ category: 'scenario', code: 'lantern_should_be_off_on_ship_deck', cape: m?.cape });
        }
        return errs;
      },
    });
  });
}

const SCENARIO_RUNNERS = {
  title: runTitleScenario,
  intro: runIntroScenario,
  village: runVillageScenario,
  modals: runModalsScenario,
  biomes: runBiomesScenario,
  maritime: runMaritimeScenario,
  ocean_weather: runOceanWeatherScenario,
  cape_lighting: runCapeLightingScenario,
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
