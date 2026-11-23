/**
 * DOM Geometry, Overlap, Containment, Scrollability, Truncation, Image & Hidden-State Auditor.
 * Compatible with both pre-M3 and post-M3 DOM structures (e.g. div/button .hud-quest-card, dynamic .inv-filter-row .tab-btn).
 */
export async function runDomAudit(page, options = {}) {
  const { skipHiddenCheck = false, expectDialogue = false } = options;

  return page.evaluate(
    ({ skipHiddenCheck: skipHidden, expectDialogue: expectDlg }) => {
      const issues = [];
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const addIssue = (code, detail) => {
        issues.push({ code, ...detail });
      };

      const describeEl = (el) => {
        if (!el) return '<null>';
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const cls =
          typeof el.className === 'string' && el.className.trim()
            ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
            : '';
        const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 36);
        return txt ? `${tag}${id}${cls}("${txt}")` : `${tag}${id}${cls}`;
      };

      const roundRect = (r) => ({
        left: Math.round(r.left * 10) / 10,
        top: Math.round(r.top * 10) / 10,
        right: Math.round(r.right * 10) / 10,
        bottom: Math.round(r.bottom * 10) / 10,
        width: Math.round(r.width * 10) / 10,
        height: Math.round(r.height * 10) / 10,
      });

      const isVisible = (el) => {
        if (!el || el.getClientRects().length === 0) return false;
        let cur = el;
        while (cur && cur.nodeType === 1) {
          const st = getComputedStyle(cur);
          if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) <= 0.05) {
            return false;
          }
          cur = cur.parentElement;
        }
        const r = el.getBoundingClientRect();
        return r.width > 0.5 && r.height > 0.5;
      };

      const checkOverlapPair = (a, b, contextLabel) => {
        if (!a || !b || a === b) return;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const ox = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
        const oy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
        if (ox > 2 && oy > 2) {
          addIssue('element_overlap', {
            context: contextLabel,
            a: describeEl(a),
            b: describeEl(b),
            overlapX: Math.round(ox * 10) / 10,
            overlapY: Math.round(oy * 10) / 10,
            rectA: roundRect(ra),
            rectB: roundRect(rb),
          });
        }
      };

      const checkPairwise = (els, contextLabel) => {
        for (let i = 0; i < els.length; i++) {
          for (let j = i + 1; j < els.length; j++) {
            checkOverlapPair(els[i], els[j], contextLabel);
          }
        }
      };

      const checkViewportBounds = (el, contextLabel, { horizontalOnly = false, code = 'viewport_overflow' } = {}) => {
        if (!el || !isVisible(el)) return;
        const r = el.getBoundingClientRect();
        const outX = r.left < -1 || r.right > vw + 1;
        const outY = !horizontalOnly && (r.top < -1 || r.bottom > vh + 1);
        if (outX || outY) {
          addIssue(code, {
            context: contextLabel,
            element: describeEl(el),
            rect: roundRect(r),
            viewport: { width: vw, height: vh },
          });
        }
      };

      const modalOpen = Boolean(document.querySelector('.modal-backdrop.is-open'));
      const centerOverlayOpen = Boolean(document.querySelector('.center-screen-overlay:not(.is-hidden)'));
      const hudRoot = document.querySelector('.hud-root');
      const hudVisible = Boolean(hudRoot && isVisible(hudRoot));
      const titleScreen = document.querySelector('.title-screen');
      const titleVisible = Boolean(titleScreen && !titleScreen.classList.contains('is-hidden') && isVisible(titleScreen));
      const dialogueWrap = document.querySelector('.dialogue-wrap');
      const dialogueBox = dialogueWrap?.querySelector('.dialogue-box');
      const dialogueVisible = Boolean(dialogueWrap && !dialogueWrap.classList.contains('is-hidden') && isVisible(dialogueBox));

      // ----------------------------------------------------------------------
      // 1. Mutually Exclusive Non-Overlapping Pairs
      // ----------------------------------------------------------------------
      if (hudVisible && !modalOpen && !centerOverlayOpen) {
        const hudHero = hudRoot.querySelector('.hud-hero');
        const hudBoss = hudRoot.querySelector('.hud-boss:not(.is-hidden)');
        const hudTopRight = hudRoot.querySelector('.hud-top-right');
        const interactPrompt = hudRoot.querySelector('.interact-prompt:not(.is-hidden)');
        const spellBar = hudRoot.querySelector('.spell-bar:not(.is-hidden)');
        const activeToasts = Array.from(hudRoot.querySelectorAll('.toast-item:not(.is-leaving)')).filter(isVisible);

        const hudTopLevel = [hudHero, hudBoss, hudTopRight, interactPrompt, spellBar, ...activeToasts].filter(
          (el) => el && isVisible(el),
        );
        checkPairwise(hudTopLevel, 'hud_top_level');

        const hudActions = hudRoot.querySelector('.hud-actions');
        const hudQuestCard = hudRoot.querySelector('.hud-quest-card');
        if (isVisible(hudActions) && isVisible(hudQuestCard)) {
          checkOverlapPair(hudActions, hudQuestCard, 'hud_top_right_children');
        }

        if (dialogueVisible) {
          for (const panel of [hudHero, hudTopRight, hudBoss, ...activeToasts]) {
            if (isVisible(panel)) {
              checkOverlapPair(dialogueBox, panel, 'dialogue_vs_hud');
            }
          }
          if (isVisible(spellBar)) {
            addIssue('dialogue_hidden_invariant', {
              context: 'dialogue_active',
              element: describeEl(spellBar),
              message: '.spell-bar must be hidden while dialogue is active',
            });
          }
          if (isVisible(interactPrompt)) {
            addIssue('dialogue_hidden_invariant', {
              context: 'dialogue_active',
              element: describeEl(interactPrompt),
              message: '.interact-prompt must be hidden while dialogue is active',
            });
          }
        }

        const zoneLabel = hudRoot.querySelector('.hud-zone-label');
        const goldPill = hudRoot.querySelector('.hud-gold-pill');
        if (isVisible(zoneLabel) && isVisible(goldPill)) {
          checkOverlapPair(zoneLabel, goldPill, 'hud_hero_meta');
        }

        const portraitWrap = hudRoot.querySelector('.hud-portrait-wrap');
        const barsCol = hudRoot.querySelector('.hud-bars-col');
        if (isVisible(portraitWrap) && isVisible(barsCol)) {
          checkOverlapPair(portraitWrap, barsCol, 'hud_hero_columns');
        }

        const hudBtns = Array.from(hudRoot.querySelectorAll('.hud-actions .hud-btn')).filter(isVisible);
        checkPairwise(hudBtns, 'hud_action_buttons');

        const spellSlots = Array.from(hudRoot.querySelectorAll('.spell-bar .spell-slot')).filter(isVisible);
        checkPairwise(spellSlots, 'hud_spell_slots');
      }

      if (expectDlg && !dialogueVisible) {
        addIssue('expected_dialogue_missing', {
          context: 'dialogue_check',
          message: 'Dialogue box was expected to be visible',
        });
      }

      // World Map modal checks
      const mapWindow = document.querySelector('.modal-backdrop.is-open .modal-window--map');
      if (mapWindow && isVisible(mapWindow)) {
        const mapFrame = mapWindow.querySelector('.map-frame');
        const mapLegend = mapWindow.querySelector('.map-legend');
        if (isVisible(mapFrame) && isVisible(mapLegend)) {
          checkOverlapPair(mapFrame, mapLegend, 'map_frame_vs_legend');
        }
        if (isVisible(mapFrame)) {
          const frameRect = mapFrame.getBoundingClientRect();
          const labels = Array.from(mapFrame.querySelectorAll('.map-marker-label')).filter(isVisible);
          const compass = mapFrame.querySelector('.map-compass');
          const labelSet = isVisible(compass) ? [...labels, compass] : labels;
          checkPairwise(labelSet, 'world_map_labels_and_compass');

          const dots = Array.from(mapFrame.querySelectorAll('.map-marker-dot')).filter(isVisible);
          for (const lbl of labels) {
            const ownMarker = lbl.closest('.map-marker');
            for (const dot of dots) {
              if (dot.closest('.map-marker') !== ownMarker) {
                checkOverlapPair(lbl, dot, 'world_map_label_vs_other_dot');
              }
            }
            const lr = lbl.getBoundingClientRect();
            if (
              lr.left < frameRect.left - 0.5 ||
              lr.top < frameRect.top - 0.5 ||
              lr.right > frameRect.right + 0.5 ||
              lr.bottom > frameRect.bottom + 0.5
            ) {
              addIssue('map_label_out_of_frame', {
                context: 'world_map_frame_containment',
                element: describeEl(lbl),
                labelRect: roundRect(lr),
                frameRect: roundRect(frameRect),
              });
            }
          }
        }
      }

      // Title Screen overlaps
      if (titleVisible) {
        const banner = titleScreen.querySelector('.title-hero-banner');
        const actions = titleScreen.querySelector('.title-actions');
        const memo = titleScreen.querySelector('.controls-memo');
        checkPairwise([banner, actions, memo].filter(isVisible), 'title_screen_sections');
      }

      // Open Modal general overlaps
      if (modalOpen) {
        const modalWin = document.querySelector('.modal-backdrop.is-open .modal-window');
        if (modalWin && isVisible(modalWin)) {
          const titleGroup = modalWin.querySelector('.modal-title-group');
          const headerRight = modalWin.querySelector('.modal-header-right');
          if (isVisible(titleGroup) && isVisible(headerRight)) {
            checkOverlapPair(titleGroup, headerRight, 'modal_header');
          }

          const invLayout = modalWin.querySelector('.inv-layout');
          if (isVisible(invLayout)) {
            const heroCard = invLayout.querySelector('.inv-hero-card');
            const rightCol = invLayout.lastElementChild;
            if (isVisible(heroCard) && isVisible(rightCol) && heroCard !== rightCol) {
              checkOverlapPair(heroCard, rightCol, 'inventory_columns');
            }
          }

          const invTabs = Array.from(modalWin.querySelectorAll('.inv-filter-row .tab-btn')).filter(isVisible);
          checkPairwise(invTabs, 'inventory_filter_tabs');

          const forgeTabs = Array.from(modalWin.querySelectorAll('.forge-tabs .tab-btn')).filter(isVisible);
          checkPairwise(forgeTabs, 'forge_tabs');
        }
      }

      // ----------------------------------------------------------------------
      // 2. Viewport Containment, Scrollability & Clipping Invariants
      // ----------------------------------------------------------------------
      if (titleVisible) {
        const titleOverflowY = getComputedStyle(titleScreen).overflowY;
        const titleScrollable = titleOverflowY === 'auto' || titleOverflowY === 'scroll';
        checkViewportBounds(titleScreen, 'title_screen');
        for (const child of Array.from(titleScreen.children)) {
          if (!isVisible(child)) continue;
          if (titleScrollable) {
            checkViewportBounds(child, 'title_screen_scrollable_child', {
              horizontalOnly: true,
              code: 'viewport_overflow',
            });
          } else {
            checkViewportBounds(child, 'title_screen_non_scrollable_child', {
              horizontalOnly: false,
              code: 'viewport_overflow_on_non_scrollable',
            });
          }
        }
      }

      if (hudVisible) {
        const hudSelectors = [
          '.hud-hero',
          '.hud-boss',
          '.hud-top-right',
          '.hud-actions button',
          '.hud-quest-card',
          '.interact-prompt',
          '.spell-bar',
          '.spell-slot',
          '.spell-slot-key',
          '.spell-slot-mp',
          '.toast-item:not(.is-leaving)',
        ];
        for (const sel of hudSelectors) {
          for (const el of hudRoot.querySelectorAll(sel)) {
            if (isVisible(el)) checkViewportBounds(el, `hud_bounds:${sel}`);
          }
        }
      }

      if (modalOpen) {
        for (const sel of ['.modal-window', '.modal-header', '.modal-close-btn', '.map-frame']) {
          const el = document.querySelector(`.modal-backdrop.is-open ${sel}`);
          if (isVisible(el)) checkViewportBounds(el, `modal_bounds:${sel}`);
        }
      }

      if (dialogueVisible) {
        checkViewportBounds(dialogueBox, 'dialogue_box_bounds');
      }

      for (const overlay of document.querySelectorAll('.center-screen-overlay:not(.is-hidden)')) {
        if (!isVisible(overlay)) continue;
        const card = overlay.querySelector('.center-screen-card');
        if (!card || !isVisible(card)) continue;
        const cardOverflowY = getComputedStyle(card).overflowY;
        const cardScrollable = cardOverflowY === 'auto' || cardOverflowY === 'scroll';
        if (cardScrollable) {
          checkViewportBounds(card, 'center_screen_card_scrollable', {
            horizontalOnly: false,
            code: 'viewport_overflow',
          });
        } else {
          checkViewportBounds(card, 'center_screen_card_non_scrollable', {
            horizontalOnly: false,
            code: 'viewport_overflow_on_non_scrollable',
          });
        }
      }

      // Horizontal overflow (scrollWidth <= clientWidth + 2)
      if (document.documentElement.scrollWidth > vw + 2) {
        addIssue('horizontal_overflow', {
          context: 'documentElement',
          element: 'html',
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: vw,
        });
      }
      for (const sel of [
        '.modal-body',
        '.inv-layout',
        '.inv-grid',
        '.forge-spells-grid',
        '.quest-list',
        '.title-screen',
        '.center-screen-card',
        '.dialogue-box',
      ]) {
        for (const el of document.querySelectorAll(sel)) {
          if (!isVisible(el)) continue;
          if (el.scrollWidth > el.clientWidth + 2) {
            addIssue('horizontal_overflow', {
              context: sel,
              element: describeEl(el),
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
            });
          }
        }
      }

      // Vertical clipping on non-scrollable containers (scrollHeight <= clientHeight + 2)
      const verticalNonScrollableSelectors = [
        '.hud-hero',
        '.hud-quest-card',
        '.hud-boss',
        '.dialogue-box',
        '.quest-card',
        '.forge-spell-card',
        '.inv-item-card',
      ];
      for (const sel of verticalNonScrollableSelectors) {
        for (const el of document.querySelectorAll(sel)) {
          if (!isVisible(el)) continue;
          const oy = getComputedStyle(el).overflowY;
          if (oy === 'auto' || oy === 'scroll') continue;
          if (el.scrollHeight > el.clientHeight + 2) {
            addIssue('vertical_clipping', {
              context: sel,
              element: describeEl(el),
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
              overflowY: oy,
            });
          }
        }
      }
      for (const sel of ['.title-screen:not(.is-hidden)', '.center-screen-overlay:not(.is-hidden) .center-screen-card']) {
        for (const el of document.querySelectorAll(sel)) {
          if (!isVisible(el)) continue;
          const oy = getComputedStyle(el).overflowY;
          if (oy === 'auto' || oy === 'scroll') continue;
          if (el.scrollHeight > el.clientHeight + 2) {
            addIssue('vertical_clipping', {
              context: sel,
              element: describeEl(el),
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
              overflowY: oy,
            });
          }
        }
      }

      // Text truncation (ellipsis / nowrap overflow)
      const checkedTextEls = new Set();
      const textSelectors = [
        '.hud-zone-label',
        '.inv-slot-name',
        '.map-marker-label',
        '.modal-title',
        '.tab-btn',
        '.wood-btn',
      ];
      for (const sel of textSelectors) {
        for (const el of document.querySelectorAll(sel)) {
          checkedTextEls.add(el);
        }
      }
      for (const rootSel of ['.hud-root', '.modal-window', '.screen-root']) {
        const root = document.querySelector(rootSel);
        if (!root) continue;
        for (const el of root.querySelectorAll('*')) {
          const st = getComputedStyle(el);
          if (st.textOverflow === 'ellipsis' && st.whiteSpace === 'nowrap') {
            checkedTextEls.add(el);
          }
        }
      }
      for (const el of checkedTextEls) {
        if (!isVisible(el)) continue;
        if (el.scrollWidth > el.clientWidth) {
          addIssue('text_truncated', {
            context: 'text_truncation',
            element: describeEl(el),
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            text: (el.textContent || '').trim(),
          });
        }
      }

      // ----------------------------------------------------------------------
      // 3. Broken <img> Check
      // ----------------------------------------------------------------------
      for (const img of document.querySelectorAll('img')) {
        if (!isVisible(img)) continue;
        const src = img.currentSrc || img.getAttribute('src') || '';
        if (!src || !img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
          addIssue('broken_image', {
            context: 'img_check',
            element: describeEl(img),
            src: src.slice(0, 120),
            complete: img.complete,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
          });
        }
      }
      if (mapWindow && isVisible(mapWindow)) {
        const mapImg = mapWindow.querySelector('img.map-image');
        if (!mapImg || !isVisible(mapImg) || !mapImg.complete || mapImg.naturalWidth === 0) {
          addIssue('missing_map_image', {
            context: 'world_map_modal',
            message: 'img.map-image is missing or failed to load',
          });
        }
      }

      // ----------------------------------------------------------------------
      // 4. Hidden-State CSS Invariants
      // ----------------------------------------------------------------------
      if (!skipHidden) {
        const hiddenSelectors = [
          '.hud-root.is-hidden',
          '.hud-boss.is-hidden',
          '.interact-prompt.is-hidden',
          '.spell-bar.is-hidden',
          '.modal-backdrop:not(.is-open)',
          '.title-screen.is-hidden',
          '.dialogue-wrap.is-hidden',
          '.center-screen-overlay.is-hidden',
        ];
        for (const sel of hiddenSelectors) {
          for (const el of document.querySelectorAll(sel)) {
            const st = getComputedStyle(el);
            const ok =
              st.display === 'none' ||
              (st.visibility === 'hidden' && parseFloat(st.opacity) <= 0.01 && st.pointerEvents === 'none');
            if (!ok) {
              addIssue('hidden_state_leak', {
                context: sel,
                element: describeEl(el),
                display: st.display,
                visibility: st.visibility,
                opacity: st.opacity,
                pointerEvents: st.pointerEvents,
              });
            }
          }
        }
      }

      return {
        viewport: { width: vw, height: vh },
        issueCount: issues.length,
        issues,
      };
    },
    { skipHiddenCheck, expectDialogue },
  );
}
