export function $(selector: string, parent: Element | Document = document): HTMLElement | null {
  return parent.querySelector(selector);
}

export function $$(selector: string, parent: Element | Document = document): HTMLElement[] {
  return Array.from(parent.querySelectorAll(selector));
}

export function show(el: HTMLElement | null): void {
  if (!el) return;
  el.style.display = '';
  el.classList.remove('hidden');
}

export function hide(el: HTMLElement | null): void {
  if (!el) return;
  el.style.display = 'none';
  el.classList.add('hidden');
}
