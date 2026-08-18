/**
 * A very small helper for building the menus.
 *
 * The screens are ordinary HTML built in code, which keeps every word of the
 * game in one file (src/ui/text.ts) and keeps the markup and its behaviour
 * side by side.
 */

export interface ElementOptions {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  title?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
}

type Child = Node | string | null | undefined | false;

/** Builds an element, its attributes, its listeners and its children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.id) node.id = options.id;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.html !== undefined) node.innerHTML = options.html;
  if (options.title) node.title = options.title;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) node.setAttribute(key, value);
  }
  if (options.on) {
    for (const [name, handler] of Object.entries(options.on)) {
      if (handler) node.addEventListener(name, handler as EventListener);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** A button that looks like the rest of the game. */
export function button(
  label: string,
  onClick: () => void,
  extraClass = '',
): HTMLButtonElement {
  return el('button', {
    class: `button ${extraClass}`.trim(),
    text: label,
    attrs: { type: 'button' },
    on: { click: onClick },
  });
}

/** A labelled slider. */
export function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onChange: (value: number) => void,
): HTMLLabelElement {
  const input = el('input', {
    class: 'slider',
    attrs: {
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(value),
    },
    on: {
      input: (event) => onChange(Number((event.target as HTMLInputElement).value)),
    },
  });
  return el('label', { class: 'field' }, el('span', { class: 'field-label', text: label }), input);
}

/** A labelled on/off switch. */
export function toggle(
  label: string,
  value: boolean,
  onChange: (value: boolean) => void,
): HTMLLabelElement {
  const input = el('input', {
    class: 'toggle',
    attrs: { type: 'checkbox', ...(value ? { checked: 'checked' } : {}) },
    on: {
      change: (event) => onChange((event.target as HTMLInputElement).checked),
    },
  });
  return el(
    'label',
    { class: 'field field-row' },
    el('span', { class: 'field-label', text: label }),
    input,
  );
}

/** Empties an element. */
export function clear(node: HTMLElement): void {
  while (node.firstChild) node.firstChild.remove();
}
