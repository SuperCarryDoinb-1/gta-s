/** Keep the loaded homepage in place and cancel stale transitions on quick returns. */
export class HomeScreen {
  private readonly menu: HTMLElement;
  private hideTimer = 0;
  private fade: Animation | null = null;

  constructor(menu: HTMLElement) {
    this.menu = menu;
  }

  leave(): void {
    window.clearTimeout(this.hideTimer);
    this.fade?.cancel();
    this.menu.classList.remove('returning');
    this.menu.classList.add('leaving');
    this.menu.inert = true;
    this.hideTimer = window.setTimeout(() => { this.menu.style.display = 'none'; }, 180);
  }

  show(): void {
    window.clearTimeout(this.hideTimer);
    this.fade?.cancel();
    this.menu.classList.add('returning');
    this.menu.classList.remove('leaving', 'intro-playing');
    this.menu.style.display = '';
    this.menu.inert = false;
    this.menu.querySelectorAll<HTMLElement>('[inert]').forEach(el => { el.inert = false; });
    document.body.classList.add('menu-open');
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.fade = this.menu.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 240, easing: 'ease-out',
      });
    }
    this.menu.querySelector<HTMLButtonElement>('#start-btn')?.focus({ preventScroll: true });
  }
}
