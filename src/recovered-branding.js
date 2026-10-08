// Replace display branding without changing the recovered routing or interaction code.
(async () => {
  const response = await fetch('/assets/v1/aster-branding.json');
  if (!response.ok) return;
  const brand = await response.json();
  const ns = 'http://www.w3.org/2000/svg';
  let serial = 0;
  const fingerprint = value => {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16);
  };
  function mark(svg) {
    if (svg.getAttribute('data-cds') === 'ClaudeLogo') {
      const paths = svg.querySelectorAll('path');
      if (!paths.length) return;
      const lockup = paths.length > 1;
      if (lockup) {
        paths[0].setAttribute('d', brand.mark);
        paths[0].setAttribute('transform', 'translate(0 1) scale(.28)');
        paths[0].setAttribute('fill-rule', 'evenodd');
      }
      for (let i = lockup ? 1 : 0; i < paths.length; i++) paths[i].setAttribute('d', '');
      if (!svg.querySelector('[data-aster-wordmark]')) {
        const label = document.createElementNS(ns, 'text');
        label.setAttribute('data-aster-wordmark', ''); label.setAttribute('x', lockup ? '29' : '30'); label.setAttribute('y', '20');
        label.setAttribute('class', 'font-voice'); label.setAttribute('font-size', '23'); label.textContent = 'E1 Code'; svg.append(label);
      }
      svg.setAttribute('viewBox', lockup ? '0 0 135 24' : '30 0 105 24');
      if (svg.getAttribute('aria-label') !== 'E1 Code') svg.setAttribute('aria-label', 'E1 Code');
    } else if (svg.getAttribute('data-cds') === 'Spark') {
      const p = svg.querySelector('path');
      if (p && p.getAttribute('d') !== brand.mark) {
        p.setAttribute('d', brand.mark); p.setAttribute('fill-rule', 'evenodd');
        svg.setAttribute('viewBox', brand.viewBox);
      }
    } else if (svg.closest('[data-cds-spark-strip]') && !svg.hasAttribute('data-aster-sprite')) {
      const key = fingerprint(svg.getAttribute('viewBox') + '|' + [...svg.querySelectorAll('path')].map(p => p.getAttribute('d')).join('|'));
      const sprite = brand.sprites[key];
      if (!sprite) return;
      const id = 'aster-motion-mark-' + (++serial);
      const defs = document.createElementNS(ns, 'defs');
      const parts = brand.parts || [brand.mark];
      for (let i = 0; i < parts.length; i++) {
        const path = document.createElementNS(ns, 'path');
        path.id = `${id}-${i}`; path.setAttribute('d', parts[i]);
        path.setAttribute('fill-rule', 'evenodd'); defs.append(path);
      }
      // Only the injected SVG artwork changes. React still owns its outer
      // strip, timing, reduced-motion fallback, and mousedown tickle handler.
      svg.replaceChildren(defs);
      for (let f = 0; f < sprite.frames.length; f++) {
        const frame = sprite.frames[f];
        if (!frame) continue;
        const viewport = document.createElementNS(ns, 'svg');
        const height = sprite.height || 100, width = sprite.width || 100;
        viewport.setAttribute('y', f * height); viewport.setAttribute('width', width);
        viewport.setAttribute('height', height); viewport.setAttribute('viewBox', `0 0 ${width} ${height}`);
        viewport.setAttribute('overflow', 'hidden');
        const group = document.createElementNS(ns, 'g');
        group.setAttribute('transform', `translate(${frame.x} ${frame.y - f * height}) scale(${frame.scale})`);
        group.setAttribute('opacity', frame.opacity);
        for (let i = 0; i < parts.length; i++) {
          const use = document.createElementNS(ns, 'use'); use.setAttribute('href', `#${id}-${i}`);
          const motion = frame.parts?.[i], center = brand.centers?.[i];
          if (motion && center) use.setAttribute('transform',
            `translate(${center.x + motion.x} ${center.y + motion.y}) rotate(${motion.rotate}) scale(${motion.scale}) translate(${-center.x} ${-center.y})`);
          group.append(use);
        }
        viewport.append(group); svg.append(viewport);
      }
      svg.setAttribute('data-aster-sprite', sprite.state);
    }
  }
  const phrases = new Map([
    ['Claude is AI and can make mistakes. Please double-check responses.', 'E1 Code is AI and can make mistakes. Please double-check responses.'],
    ['Claude is responding', 'E1 Code is responding'], ['Claude finished the response', 'E1 Code finished the response'],
    ['Claude’s response was interrupted.', 'E1 Code’s response was interrupted.'],
    ['Write your prompt to Claude', 'Write your prompt to E1 Code'],
    ['Claude can edit, delete, and share these files with connected tools.', 'E1 Code can edit, delete, and share these files with connected tools.'],
    ['Notifications are turned off for Claude. Enable them in System Settings to get alerts when Claude finishes a task.', 'Notifications are turned off for E1 Code. Enable them in System Settings to get alerts when E1 Code finishes a task.'],
    ['Browse with Claude', 'Browse with E1 Code'],
    ['Type a URL or ask Claude to open a site. Claude can read, click, and type.', 'Type a URL or ask E1 Code to open a site. E1 Code can read, click, and type.'],
  ]);
  const pickerSelector = '[data-testid="epitaxy-cds-model-selector"], [data-testid="model-selector-dropdown"], button[aria-label^="Model:"]';
  const statusSelector = '[data-turn-working], [data-testid="code-working-line"], [data-testid="working-activity-row"], [role="status"], [aria-live]';
  const protectedSelector = 'script,style,textarea,pre,code,[contenteditable="true"],[data-testid="user-message"],[data-testid="assistant-message"],.font-claude-response';
  const tracked = new Map();
  const trackedAttributes = new Map();
  function modelFor(element) {
    // Find the nearest pane containing its own picker, never borrow another
    // session's model for sidebar rows or an unrelated split pane.
    if (element.closest('[data-testid="sidebar"],[aria-label="Sidebar"]')) return 'The model';
    for (let scope = element; scope; scope = scope.parentElement) {
      const labels = [...scope.querySelectorAll(pickerSelector)]
        .filter(p => p.getClientRects().length && !p.closest('[role="dialog"]'))
        .map(p => (p.getAttribute('aria-label')?.match(/^Model:\s*(.+)$/)?.[1] || p.textContent).trim())
        .filter(v => v && !/^(Select|Choose|Change) model|^Model$|^Default$/i.test(v));
      const unique = [...new Set(labels)];
      if (unique.length === 1) return unique[0];
      if (unique.length > 1) return 'The model';
      if (scope.matches('section,[role="region"],[data-session-id],[aria-label="Primary pane"],[aria-label="Secondary pane"]')) return 'The model';
    }
    return 'The model';
  }
  const activity = /(?:Claude|Aster|E1 Code)(?: is (?:working|responding|thinking)| finished the response|[’']s response was interrupted)|Waiting for (?:Claude|Aster|E1 Code)/;
  function activityText(value, element) {
    const model = modelFor(element);
    return value.replace(/(?:Claude|Aster|E1 Code)(?= is (?:working|responding|thinking)| finished the response|[’']s response was interrupted)/g, () => model)
      .replace(/Waiting for (?:Claude|Aster|E1 Code)/g, () => 'Waiting for ' + (model === 'The model' ? 'the model' : model));
  }
  function text(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest(protectedSelector)) return;
    if (parent.closest('h2.sr-only[data-find-omitted]')) {
      const heading = node.data.replace(/^Claude responded:/, 'Assistant responded:');
      if (heading !== node.data) node.data = heading;
      return;
    }
    const isStatus = parent.closest(statusSelector);
    if (!isStatus && parent.closest('[aria-label="Chat messages"]')) return;
    const old = tracked.get(node);
    const original = old && node.data === old.rendered ? old.original : node.data;
    if (activity.test(original)) {
      const next = activityText(original, parent);
      tracked.set(node, { original, rendered: next });
      if (node.data !== next) node.data = next;
      return;
    }
    tracked.delete(node);
    const value = node.data;
    const next = parent.localName === 'title' ? value.replace(/\b(?:Claude|Aster)(?: Code)?(?=$| [—–-])/g, 'E1 Code') :
      phrases.get(value) || (/^Allow Claude to change files in /.test(value) ? value.replace(/^Allow Claude/, 'Allow E1 Code') :
        parent.closest('[data-cds="ProductLogo"]') ? value.replace(/^(?:Claude|Aster)(?: Code)?\b/, 'E1 Code') : value);
    if (next !== value) node.data = next;
  }
  function updateActivityAttribute(el, attr) {
    const value = el.getAttribute(attr);
    const attrs = trackedAttributes.get(el) || new Map();
    const old = attrs.get(attr);
    const original = old && old.rendered === value ? old.original : value;
    if (!original || !activity.test(original)) { attrs.delete(attr); return false; }
    const next = activityText(original, el);
    attrs.set(attr, { original, rendered: next });
    trackedAttributes.set(el, attrs);
    if (next !== value) el.setAttribute(attr, next);
    return true;
  }
  function refreshActivity() {
    for (const [el, attrs] of trackedAttributes) {
      if (!el.isConnected) { trackedAttributes.delete(el); continue; }
      for (const attr of attrs.keys()) updateActivityAttribute(el, attr);
    }
    for (const node of tracked.keys()) {
      if (!node.isConnected) tracked.delete(node);
      else text(node);
    }
  }
  function visit(root) {
    if (root.nodeType === Node.TEXT_NODE) { text(root); return; }
    if (!(root instanceof Element) && root !== document) return;
    const svg = root instanceof Element ? root.closest('svg') : null;
    if (svg) mark(svg);
    for (const el of root.querySelectorAll('svg[data-cds="Spark"],svg[data-cds="ClaudeLogo"],[data-cds-spark-strip] svg')) mark(el);
    const elements = root instanceof Element ? [root, ...root.querySelectorAll('[aria-label],[placeholder],[title]')] : root.querySelectorAll('[aria-label],[placeholder],[title]');
    for (const el of elements) for (const attr of ['aria-label', 'placeholder', 'title']) {
      const value = el.getAttribute(attr);
      if (el.closest(protectedSelector)) continue;
      if (el.closest('[aria-label="Chat messages"]') && !el.closest(statusSelector) && !value?.startsWith('Show message actions for Claude responded:')) continue;
      if (updateActivityAttribute(el, attr)) continue;
      const next = attr === 'aria-label' && el.localName === 'button' && value?.startsWith('Show message actions for Claude responded:')
        ? value.replace(/^Show message actions for Claude responded:/, 'Show message actions for Assistant responded:') : phrases.get(value);
      if (next && next !== value) el.setAttribute(attr, next);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) text(node);
    const title = document.title.replace(/\b(?:Claude|Aster)(?: Code)?(?=$| [—–-])/g, 'E1 Code');
    if (document.title !== title) document.title = title;
  }
  visit(document);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') for (const node of record.addedNodes) visit(node);
      else if (record.type === 'characterData') text(record.target);
      else if (['aria-label', 'placeholder', 'title'].includes(record.attributeName)) visit(record.target);
      else if (record.target.localName === 'path') {
        const svg = record.target.closest('svg[data-cds="Spark"]'); if (svg) mark(svg);
      }
    }
    refreshActivity();
  }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['d', 'aria-label', 'placeholder', 'title'] });
})().catch(error => console.error('E1 Code display branding:', error.message));
