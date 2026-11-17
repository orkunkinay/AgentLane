// Fixed presentation bootstrap, run only in owned targets in an isolated world.
// Never returns page content or accepts agent-supplied script/selectors.
export function installSelectPicker() {
  if (globalThis.__agentlanePickerInstalled) return;
  globalThis.__agentlanePickerInstalled = true;
  const supported = CSS.supports('appearance', 'base-select');
  const originals = new WeakMap();
  const roots = new WeakSet();
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('select::picker(select) { appearance: base-select !important; }');
  function prepare(select) {
    if (!(select instanceof HTMLSelectElement)) return;
    if (select.multiple || select.size > 1) {
      const original = originals.get(select);
      if (original && select.style.getPropertyValue('appearance') === 'base-select') {
        if (original.value)
          select.style.setProperty('appearance', original.value, original.priority);
        else select.style.removeProperty('appearance');
      }
      originals.delete(select);
      return;
    }
    if (!supported) return;
    if (!originals.has(select))
      originals.set(select, {
        value: select.style.getPropertyValue('appearance'),
        priority: select.style.getPropertyPriority('appearance'),
      });
    if (
      select.style.getPropertyValue('appearance') !== 'base-select' ||
      select.style.getPropertyPriority('appearance') !== 'important'
    )
      select.style.setProperty('appearance', 'base-select', 'important');
  }
  function scan(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node instanceof HTMLSelectElement) prepare(node);
    if (node.shadowRoot) install(node.shadowRoot);
    for (const child of node.querySelectorAll('select')) prepare(child);
    for (const child of node.querySelectorAll('*')) if (child.shadowRoot) install(child.shadowRoot);
  }
  function install(root) {
    if (roots.has(root)) return;
    roots.add(root);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    for (const child of root.children) scan(child);
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') prepare(record.target);
        else for (const node of record.addedNodes) scan(node);
      }
    }).observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'size', 'multiple'],
    });
  }
  install(document);
  // Also covers open shadow roots attached after their host was inserted.
  function guard(event) {
    const select = event.composedPath().find((node) => node instanceof HTMLSelectElement);
    if (!select || select.multiple || select.size > 1) return;
    install(select.getRootNode());
    prepare(select);
    if (
      supported &&
      getComputedStyle(select).appearance === 'base-select' &&
      getComputedStyle(select, '::picker(select)').appearance === 'base-select'
    )
      return;
    // Do not let a stylesheet conflict or unsupported picker open native browser UI.
    event.preventDefault();
    event.stopImmediatePropagation();
    globalThis.__agentlanePickerBlocked('Native select picker could not be kept inside the page');
  }
  for (const type of ['pointerdown', 'mousedown', 'click', 'keydown'])
    addEventListener(type, guard, { capture: true });
}
