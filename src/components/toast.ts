let toastEl: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, duration = 3000): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }

  if (hideTimer) clearTimeout(hideTimer);
  toastEl.textContent = message;
  toastEl.classList.add('visible');

  hideTimer = setTimeout(() => {
    toastEl?.classList.remove('visible');
  }, duration);
}
