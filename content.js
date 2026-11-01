(() => {
  'use strict';

  const IS_TOP = window === window.top;
  const HOST = location.hostname || location.protocol;
  const SIGNIFICANT_VIEWPORT_SHARE = 0.9;
  const RESCAN_INTERVAL_MS = 250;

  const setImportant = (el, prop, value) => el.style.setProperty(prop, value, 'important');

  // Visits every element, including those inside open shadow roots.
  function walkElements(root, visit) {
    for (const el of root.querySelectorAll('*')) {
      visit(el);
      if (el.shadowRoot) walkElements(el.shadowRoot, visit);
    }
  }

  /* ---------- Remove blur ---------- */

  const NON_VISIBLE_TEXT_PARENTS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

  function hasVisibleText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeValue.trim() && !NON_VISIBLE_TEXT_PARENTS.has(node.parentNode.nodeName)) {
        return true;
      }
    }
    if (root.shadowRoot && hasVisibleText(root.shadowRoot)) return true;
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot && hasVisibleText(el.shadowRoot)) return true;
    }
    return false;
  }

  function isTransparent(color) {
    if (color === 'transparent') return true;
    const parts = color.match(/[\d.]+/g);
    return color.startsWith('rgba') && parts !== null && parseFloat(parts[3]) === 0;
  }

  // Returns true if the element was changed.
  function removeBlurFrom(el) {
    const style = getComputedStyle(el);
    let changed = false;

    if (style.filter.includes('blur(') && hasVisibleText(el)) {
      const remaining = style.filter.replace(/blur\([^)]*\)/g, '').trim();
      setImportant(el, 'filter', remaining || 'none');
      changed = true;
    }
    if (style.backdropFilter.includes('blur(')) {
      setImportant(el, 'backdrop-filter', 'none');
      changed = true;
    }
    if (style.textShadow !== 'none' && isTransparent(style.color) && hasVisibleText(el)) {
      setImportant(el, 'text-shadow', 'none');
      setImportant(el, 'color', 'inherit');
      changed = true;
    }
    if (changed && style.userSelect === 'none') {
      setImportant(el, 'user-select', 'text');
    }
    return changed;
  }

  function removeBlur() {
    let count = 0;
    walkElements(document, (el) => {
      if (removeBlurFrom(el)) count += 1;
    });
    return count;
  }

  /* ---------- Enable scrolling ---------- */

  const isLockedOverflow = (value) => value === 'hidden' || value === 'clip';

  function unlockRootElement(el) {
    const style = getComputedStyle(el);
    const wasLocked = isLockedOverflow(style.overflowY);
    const wasFixed = el === document.body && style.position === 'fixed';
    if (!wasLocked && !wasFixed) return false;

    // Read before changing anything: a fixed body stores the scroll offset in `top`.
    const fixedTop = parseFloat(style.top);

    // Only the vertical axis: sites often hide horizontal overflow legitimately.
    if (wasLocked) setImportant(el, 'overflow-y', 'auto');
    if (wasFixed) setImportant(el, 'position', 'static');
    setImportant(el, 'height', 'auto');
    setImportant(el, 'max-height', 'none');

    if (wasFixed && fixedTop < 0) window.scrollTo(window.scrollX, -fixedTop);
    return true;
  }

  function unlockWrapper(el, minWidth, minHeight) {
    if (!isLockedOverflow(getComputedStyle(el).overflowY)) return false;
    if (el.scrollHeight <= el.clientHeight + 1) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < minWidth || rect.height < minHeight) return false;
    setImportant(el, 'overflow-y', 'auto');
    return true;
  }

  function enableScrolling() {
    let count = 0;
    const html = document.documentElement;
    const { body } = document;
    if (unlockRootElement(html)) count += 1;
    if (body && unlockRootElement(body)) count += 1;

    const minWidth = window.innerWidth * SIGNIFICANT_VIEWPORT_SHARE;
    const minHeight = window.innerHeight * SIGNIFICANT_VIEWPORT_SHARE;
    walkElements(document, (el) => {
      if (el !== html && el !== body && unlockWrapper(el, minWidth, minHeight)) count += 1;
    });
    return count;
  }

  /* ---------- Keep fixes applied after a click, until the page reloads ---------- */

  const activeFixes = new Set();
  let observer = null;
  let rescanTimer = null;

  function scheduleRescan() {
    if (rescanTimer !== null) return;
    rescanTimer = setTimeout(() => {
      rescanTimer = null;
      activeFixes.forEach((fix) => fix());
    }, RESCAN_INTERVAL_MS);
  }

  function keepApplied(fix) {
    activeFixes.add(fix);
    if (observer) return;
    observer = new MutationObserver(scheduleRescan);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
  }

  /* ---------- Saved rules ---------- */

  const STYLE_ELEMENT_ID = 'roaf-saved-rules';

  let currentRules = [];

  function applyRules(rules) {
    currentRules = rules;
    let styleEl = document.getElementById(STYLE_ELEMENT_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ELEMENT_ID;
      document.documentElement.appendChild(styleEl);
    }
    styleEl.textContent = rules
      .map(({ selector }) => `${selector} { display: none !important; }`)
      .join('\n');
    closeHiddenModalDialogs();
  }

  // A modal <dialog> keeps the rest of the page inert even when display: none hides it.
  function closeHiddenModalDialogs() {
    document.querySelectorAll('dialog:modal').forEach((dialog) => {
      if (!dialog.checkVisibility()) dialog.close();
    });
  }

  async function saveRule(rule) {
    const { rules = {} } = await chrome.storage.local.get('rules');
    const siteRules = rules[HOST] || [];
    if (siteRules.some(({ selector }) => selector === rule.selector)) return;
    rules[HOST] = [...siteRules, rule];
    await chrome.storage.local.set({ rules });
  }

  function loadSavedRules() {
    chrome.storage.local.get('rules').then(({ rules = {} }) => {
      if (rules[HOST]?.length) applyRules(rules[HOST]);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.rules) {
        applyRules(changes.rules.newValue?.[HOST] || []);
      }
    });
    // Catches a saved dialog that the page opens after the rules were applied.
    document.addEventListener('toggle', () => {
      if (currentRules.length) closeHiddenModalDialogs();
    }, true);
  }

  /* ---------- Selector generation ---------- */

  const UNSTABLE_TOKEN_PATTERNS = [
    /\d{3,}/, // generated ids and counters
    /^(css|sc|jsx|emotion|svelte|styled|ember|ng)-/, // CSS-in-JS and framework prefixes
    /__[\w-]{5}$/, // CSS modules hash suffix
    /^(open|opened|show|shown|visible|active|in|fade|is-.*|has-.*)$/, // state, may be absent on load
  ];

  const isStableToken = (token) => !UNSTABLE_TOKEN_PATTERNS.some((re) => re.test(token));

  const matchesOnly = (selector, el) => {
    const matches = document.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === el;
  };

  function stableIdSelector(el) {
    if (!el.id || !isStableToken(el.id)) return null;
    const selector = `#${CSS.escape(el.id)}`;
    return matchesOnly(selector, el) ? selector : null;
  }

  function buildSelector(el) {
    const idSelector = stableIdSelector(el);
    if (idSelector) return idSelector;

    const classes = [...el.classList].filter(isStableToken).slice(0, 3);
    if (classes.length) {
      const classSelector = CSS.escape(el.localName) + classes.map((c) => `.${CSS.escape(c)}`).join('');
      if (matchesOnly(classSelector, el)) return classSelector;
    }

    const parts = [];
    for (let node = el; node; node = node.parentElement) {
      // Popups can be direct children of <html>, outside <body>.
      if (node === document.documentElement) {
        parts.unshift(':root');
        break;
      }
      const anchor = node === el ? null : stableIdSelector(node);
      if (anchor) {
        parts.unshift(anchor);
        break;
      }
      if (node === document.body) {
        parts.unshift('body');
        break;
      }
      const sameTag = [...node.parentElement.children].filter((c) => c.localName === node.localName);
      parts.unshift(`${CSS.escape(node.localName)}:nth-of-type(${sameTag.indexOf(node) + 1})`);
    }
    const pathSelector = parts.join(' > ');
    return matchesOnly(pathSelector, el) ? pathSelector : null;
  }

  function describeElement(el) {
    const id = el.id ? `#${el.id}` : '';
    const firstClass = el.classList[0] ? `.${el.classList[0]}` : '';
    return `${el.localName}${id}${firstClass}`.slice(0, 60);
  }

  /* ---------- Element picker ---------- */

  const MAX_Z_INDEX = '2147483647';
  const HIGHLIGHT_COLOR = '#e5484d';
  const DEFAULT_HINT = 'Click to remove  ·  ↑ / ↓ select parent / child  ·  Esc to finish';
  const SWALLOWED_EVENTS = [
    'pointerdown', 'mousedown', 'pointerup', 'mouseup',
    'dblclick', 'auxclick', 'contextmenu',
  ];

  let picker = null;

  function createPickerOverlay() {
    // A custom tag, so page CSS for `div` misses it and it can't skew nth-of-type selectors.
    const host = document.createElement('roaf-picker');
    host.popover = 'manual';
    // CSSOM assignment rather than a <style> tag, so a page's CSP can't block it.
    // This layer takes the pointer itself: events over an iframe would otherwise go to
    // the iframe's document and never reach this script.
    host.style.cssText = `all: initial; display: block; position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: transparent; overflow: hidden; cursor: crosshair; z-index: ${MAX_Z_INDEX};`;
    const shadow = host.attachShadow({ mode: 'closed' });

    const box = document.createElement('div');
    box.style.cssText = `position: fixed; display: none; box-sizing: border-box; border: 2px solid ${HIGHLIGHT_COLOR}; background: rgba(229, 72, 77, 0.2);`;

    const label = document.createElement('div');
    label.style.cssText = `position: fixed; display: none; padding: 2px 6px; background: ${HIGHLIGHT_COLOR}; color: #fff; font: 12px/1.4 ui-monospace, Menlo, monospace; border-radius: 3px; white-space: nowrap;`;

    const hint = document.createElement('div');
    hint.style.cssText = 'position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); padding: 8px 14px; background: #1c1c1f; color: #fff; font: 13px/1.4 system-ui, sans-serif; border-radius: 6px; white-space: nowrap;';
    hint.textContent = DEFAULT_HINT;

    shadow.append(box, label, hint);
    return { host, box, label, hint };
  }

  // Keeps the overlay above popups. The top layer beats any z-index, and a modal <dialog>
  // makes everything outside itself inert, so the overlay has to live inside the open one.
  function mountOverlay() {
    const { host } = picker.overlay;
    const modals = document.querySelectorAll('dialog:modal');
    const parent = modals[modals.length - 1] || document.documentElement;
    if (host.parentNode === parent && host.matches(':popover-open')) return;
    parent.appendChild(host);
    host.showPopover();
  }

  const hasArea = (rect) => rect.width > 0 && rect.height > 0;

  // Popups are often fixed-position children of a zero-size wrapper or shadow host.
  // In that case, outline the largest thing inside it.
  function visibleRect(el) {
    const own = el.getBoundingClientRect();
    if (hasArea(own)) return own;

    let largest = own;
    const area = (rect) => rect.width * rect.height;
    const visit = (root) => {
      const shadow = root.nodeType === Node.ELEMENT_NODE ? chrome.dom.openOrClosedShadowRoot(root) : null;
      if (shadow) visit(shadow);
      for (const child of root.children) {
        const rect = child.getBoundingClientRect();
        if (area(rect) > area(largest)) largest = rect;
        visit(child);
      }
    };
    visit(el);
    return largest;
  }

  function drawHighlight() {
    const { overlay, target } = picker;
    if (!target) {
      overlay.box.style.display = 'none';
      overlay.label.style.display = 'none';
      return;
    }
    const rect = visibleRect(target);
    Object.assign(overlay.box.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    Object.assign(overlay.label.style, {
      display: 'block',
      left: `${Math.max(rect.left, 0)}px`,
      top: `${Math.max(rect.top - 22, 0)}px`,
    });
    overlay.label.textContent = describeElement(target);
  }

  function isPickable(el) {
    return Boolean(el) && el !== document.documentElement && el !== document.body;
  }

  function setPickerTarget(el, childTrail = []) {
    picker.target = isPickable(el) ? el : null;
    picker.childTrail = childTrail;
    drawHighlight();
  }

  function retargetFromPointer() {
    const { host } = picker.overlay;
    const under = document.elementsFromPoint(picker.x, picker.y).find((el) => el !== host);
    setPickerTarget(under);
  }

  function selectParent() {
    const { target, childTrail } = picker;
    if (target && isPickable(target.parentElement)) {
      setPickerTarget(target.parentElement, [...childTrail, target]);
    }
  }

  function selectChild() {
    const { target, childTrail } = picker;
    if (!target) return;
    const child = childTrail.at(-1) || target.firstElementChild;
    if (child && child !== picker.overlay.host) setPickerTarget(child, childTrail.slice(0, -1));
  }

  async function removePickedTarget() {
    const { target } = picker;
    if (!target) return;
    const selector = buildSelector(target);
    if (!selector) {
      picker.overlay.hint.textContent = 'Could not build a unique rule for this element. Try ↑ to select its parent.';
      return;
    }
    picker.overlay.hint.textContent = DEFAULT_HINT;
    const label = describeElement(target);
    const rule = { selector, label };
    // Hide through the stylesheet, not inline, so undoing the rule restores the element.
    // Doing it before the save lets the next hover land on whatever was underneath.
    applyRules([...currentRules, rule]);
    // The overlay may have been inside a dialog that was just closed.
    mountOverlay();
    retargetFromPointer();
    await saveRule(rule);
  }

  function swallow(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onPickerMouseMove(event) {
    picker.x = event.clientX;
    picker.y = event.clientY;
    // The page may have opened a dialog since the last move.
    mountOverlay();
    retargetFromPointer();
  }

  function onPickerClick(event) {
    swallow(event);
    if (event.button === 0) removePickedTarget();
  }

  function onPickerKeyDown(event) {
    const actions = { Escape: stopPicker, ArrowUp: selectParent, ArrowDown: selectChild };
    const action = actions[event.key];
    if (!action) return;
    swallow(event);
    action();
  }

  function startPicker() {
    if (picker) return;
    picker = { overlay: createPickerOverlay(), target: null, childTrail: [], x: 0, y: 0 };
    window.addEventListener('mousemove', onPickerMouseMove, true);
    window.addEventListener('click', onPickerClick, true);
    window.addEventListener('keydown', onPickerKeyDown, true);
    window.addEventListener('scroll', drawHighlight, true);
    SWALLOWED_EVENTS.forEach((type) => window.addEventListener(type, swallow, true));
    mountOverlay();
    // Key presses go to whichever document has focus, which may be a popup's iframe.
    if (document.activeElement?.tagName === 'IFRAME') document.activeElement.blur();
    window.focus();
  }

  function stopPicker() {
    if (!picker) return;
    window.removeEventListener('mousemove', onPickerMouseMove, true);
    window.removeEventListener('click', onPickerClick, true);
    window.removeEventListener('keydown', onPickerKeyDown, true);
    window.removeEventListener('scroll', drawHighlight, true);
    SWALLOWED_EVENTS.forEach((type) => window.removeEventListener(type, swallow, true));
    picker.overlay.host.remove();
    picker = null;
  }

  /* ---------- Messages from the toolbar popup ---------- */

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'getHost':
        if (IS_TOP) sendResponse({ host: HOST });
        break;
      case 'removeBlur': {
        const count = removeBlur();
        keepApplied(removeBlur);
        // Only the top frame replies: the popup receives just one response per message.
        if (IS_TOP) sendResponse({ count });
        break;
      }
      case 'enableScrolling': {
        const count = enableScrolling();
        keepApplied(enableScrolling);
        if (IS_TOP) sendResponse({ count });
        break;
      }
      case 'startPicker':
        if (IS_TOP) {
          startPicker();
          sendResponse({ ok: true });
        }
        break;
      default:
        break;
    }
  });

  if (IS_TOP) loadSavedRules();
})();
