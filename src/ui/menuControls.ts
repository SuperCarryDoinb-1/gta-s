import { MenuInteraction } from './MenuInteraction';
import { MenuAudio } from './MenuAudio';
import { MenuDrone } from './MenuDrone';

new MenuAudio();
const drone = new MenuDrone(document.getElementById('menu')!);

const interaction = new MenuInteraction(document.getElementById('menu')!);
const dialog = document.querySelector<HTMLDialogElement>('#guide-dialog')!;
const credits = document.querySelector<HTMLDialogElement>('#credits-dialog')!;
document.getElementById('credits-btn')!.addEventListener('click', () => credits.showModal());
document.getElementById('credits-close')!.addEventListener('click', () => credits.close());
document.getElementById('guide-btn')!.addEventListener('click', () => dialog.showModal());
document.getElementById('guide-close')!.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right ||
    event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
export let menuMotion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const motion = document.getElementById('motion-btn')!;
function updateMotion() {
  drone.setEnabled(menuMotion);
  interaction.setEnabled(menuMotion);
  document.getElementById('menu')!.classList.toggle('motion-off', !menuMotion);
  motion.setAttribute('aria-pressed', String(menuMotion));
  document.getElementById('motion-state')!.textContent = menuMotion ? '开' : '关';
}
updateMotion();
motion.addEventListener('click', () => { menuMotion = !menuMotion; updateMotion(); });
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
motionPreference.addEventListener('change', (event) => {
  menuMotion = !event.matches;
  updateMotion();
});
window.addEventListener('unhandledrejection', () => {
  if (document.querySelector<HTMLButtonElement>('#start-btn')?.disabled) {
    document.getElementById('load-status')!.textContent = '加载失败，请刷新页面重试';
    document.getElementById('start-label')!.textContent = '资源加载未完成';
  }
});
