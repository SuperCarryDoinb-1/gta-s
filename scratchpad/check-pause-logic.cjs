// Browser-independent checks; the Playwright companion checks actual rendering and physics.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

class Element extends EventTarget {
  style = {};
  classList = new Set();
  children = new Map();
  hidden = false;
  open = false;
  constructor() {
    super();
    this.classList.contains = this.classList.has.bind(this.classList);
    this.classList.remove = (...names) => names.forEach(name => this.classList.delete(name));
  }
  attributes = new Map();
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  append(element) { document.elements.set(element.id, element); }
  set innerHTML(html) {
    for (const match of html.matchAll(/id="([^"]+)"/g)) {
      const child = new Element(); child.id = match[1]; this.children.set(`#${child.id}`, child);
    }
    this.children.set('.pause-hint', new Element());
  }
  querySelector(selector) { return this.children.get(selector); }
  querySelectorAll(selector) { return [...this.children.values()].filter(e => selector === '[inert]' ? e.inert : /^pause-(resume|home|quit|sound)$/.test(e.id)); }
  animate() { this.animated = true; return { cancel() {} }; }
  focus() { document.activeElement = this; }
  showModal() { this.open = true; this.querySelector('#pause-resume').focus(); }
  close() { this.open = false; }
  click() { this.dispatchEvent(new Event('click')); }
}
const window = new EventTarget();
const timers = new Map();
let nextTimer = 1;
window.setTimeout = callback => { const id = nextTimer++; timers.set(id, callback); return id; };
window.clearTimeout = id => timers.delete(id);
function flushTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); }
let closeRequests = 0;
window.close = () => closeRequests++;
const document = Object.assign(new EventTarget(), {
  elements: new Map(), body: new Element(), pointerLockElement: null, fullscreenElement: null,
  createElement: () => new Element(), getElementById(id) { return this.elements.get(id); },
  exitPointerLock() { this.pointerLockElement = null; this.dispatchEvent(new Event('pointerlockchange')); },
});
const location = { href: 'http://localhost:5175/?autotest=tank', replace(url) { this.replaced = url; } };
const cache = new Map();
const settings = new Map();
const localStorage = { getItem: key => settings.get(key) ?? null, setItem: (key, value) => settings.set(key, value) };
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    exports, window, document, location, URL, HTMLElement: Element, localStorage,
    matchMedia: () => ({ matches: false }),
    require: name => name.endsWith('.css') ? {} : load('src/core/Input.ts'),
  }, { filename: file });
  cache.set(file, exports);
  return exports;
}
function key(code, repeat = false) {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { code, repeat });
  window.dispatchEvent(event);
}
function mouse(type, values) { const event = new Event(type); Object.assign(event, values); window.dispatchEvent(event); }
const { Input } = load('src/core/Input.ts');
const { PauseMenu } = load('src/ui/PauseMenu.ts');
const { GameAudio } = load('src/core/Audio.ts');
const audio = new GameAudio();
assert.equal(audio.soundEnabled, true);
audio.setSoundEnabled(false);
assert.equal(new GameAudio().soundEnabled, false, 'Sound preference survives a new session');
audio.setSoundEnabled(true);
audio.ctx = { state: 'suspended', currentTime: 3, resume() { this.state = 'running'; return Promise.resolve(); } };
audio.master = { gain: { value: 0.9, setValueAtTime(value) { this.value = value; } } };
const canvas = new Element();
const input = new Input(canvas);
let playing = false, pauses = 0, resumes = 0, ends = 0, homes = 0;
new PauseMenu({
  isPlaying: () => playing,
  soundEnabled: () => audio.soundEnabled,
  setSoundEnabled: enabled => audio.setSoundEnabled(enabled),
  pause: () => { pauses++; input.setEnabled(false); },
  resume: () => { resumes++; input.setEnabled(true); },
  home: () => { homes++; playing = false; input.setEnabled(false); },
  end: () => { ends++; playing = false; input.setEnabled(false); },
});
const dialog = document.getElementById('pause-menu');
key('Escape');
assert.equal(dialog.open, false, 'Homepage Esc does not pause');
playing = true;
document.pointerLockElement = canvas;
document.dispatchEvent(new Event('pointerlockchange'));
key('KeyW'); mouse('mousedown', { button: 0 }); mouse('mousemove', { movementX: 30, movementY: 10 }); mouse('wheel', { deltaY: 200 });
assert.equal(input.isDown('KeyW'), true);
key('Escape');
for (let i = 0; i < 20; i++) key('Escape', true);
assert.equal(dialog.open, true);
assert.equal(pauses, 1, 'Hold and pointer unlock pause only once');
assert.equal(input.isDown('KeyW'), false);
assert.equal(input.isDown('Mouse0'), false);
assert.equal(input.consumeMouseDelta().x, 0);
assert.equal(input.consumeWheel(), 0);
key('KeyR'); mouse('mousedown', { button: 0 }); mouse('wheel', { deltaY: 100 });
assert.equal(input.wasPressed('KeyR'), false);
assert.equal(input.isDown('Mouse0'), false);
assert.equal(input.consumeWheel(), 0);
document.dispatchEvent(new Event('click'));
assert.equal(document.activeElement.id, 'pause-resume', 'Canvas does not steal menu focus');
key('ArrowDown'); assert.equal(document.activeElement.id, 'pause-home');
key('ArrowDown'); assert.equal(document.activeElement.id, 'pause-quit');
key('ArrowDown'); assert.equal(document.activeElement.id, 'pause-sound');
const soundButton = dialog.querySelector('#pause-sound');
assert.equal(soundButton.getAttribute('aria-checked'), 'true');
soundButton.click();
assert.equal(audio.soundEnabled, false);
assert.equal(audio.master.gain.value, 0);
assert.equal(audio.ctx.state, 'suspended', 'Toggling sound must not resume paused audio');
assert.equal(dialog.open, true, 'Toggling sound keeps the pause menu open');
assert.equal(soundButton.getAttribute('aria-checked'), 'false');
assert.equal(dialog.querySelector('#pause-sound-state').textContent, '关');
key('ArrowDown'); assert.equal(document.activeElement.id, 'pause-resume');
const cancel = new Event('cancel', { cancelable: true }); dialog.dispatchEvent(cancel);
assert.equal(cancel.defaultPrevented, true);
dialog.querySelector('#pause-resume').click();
assert.equal(dialog.open, false); assert.equal(resumes, 1);
key('KeyW'); assert.equal(input.isDown('KeyW'), true);
document.pointerLockElement = canvas; document.dispatchEvent(new Event('pointerlockchange'));
document.exitPointerLock();
assert.equal(dialog.open, true, 'Browser-consumed Esc pauses via pointer unlock');
assert.equal(pauses, 2);
audio.resume();
assert.equal(audio.master.gain.value, 0, 'Resuming must not undo mute');
assert.equal(soundButton.getAttribute('aria-checked'), 'false');
soundButton.click();
assert.equal(audio.master.gain.value, 0.9);
assert.equal(new GameAudio().soundEnabled, true);
for (let i = 0; i < 4; i++) {
  dialog.querySelector('#pause-home').click();
  assert.equal(dialog.open, false);
  assert.equal(location.replaced, undefined, 'Returning home must not reload');
  assert.equal(ends, 0, 'Returning home must keep the session');
  playing = true; input.setEnabled(true);
  key('Escape');
  assert.equal(dialog.open, true, 'Pause menu works after repeated returns');
}
assert.equal(homes, 4);
dialog.querySelector('#pause-quit').click();
assert.equal(closeRequests, 1); assert.equal(ends, 1);
assert.equal(dialog.querySelector('#pause-title').textContent, '游戏已结束');
assert.equal(dialog.querySelector('#pause-resume').hidden, true);
assert.equal(soundButton.hidden, true);
dialog.querySelector('#pause-resume').click(); assert.equal(resumes, 1, 'Ended game cannot resume');
key('Escape'); assert.equal(dialog.open, true);
dialog.querySelector('#pause-home').click();
assert.equal(location.replaced, 'http://localhost:5175/');
console.log('PASS: Esc repeat, input reset/blocking, menu focus/navigation, resume, pointer unlock, end fallback, home navigation');
console.log('PASS: sound toggle, gain muting, persisted preference, paused audio isolation, keyboard access');

const { HomeScreen } = load('src/ui/HomeScreen.ts');
const menu = new Element();
const button = new Element(); button.id = 'start-btn';
const hero = new Element(); hero.inert = true;
menu.children.set('#start-btn', button); menu.children.set('.hero-body', hero);
const home = new HomeScreen(menu);
home.leave();
menu.classList.add('intro-playing');
home.show();
flushTimers();
assert.notEqual(menu.style.display, 'none', 'Old leave timer must not hide a returned homepage');
assert.equal(menu.classList.has('intro-playing'), false);
assert.equal(menu.classList.has('leaving'), false);
assert.equal(menu.inert, false); assert.equal(hero.inert, false);
assert.equal(document.activeElement, button);
assert.equal(menu.animated, true);
home.leave(); flushTimers();
assert.equal(menu.style.display, 'none');
home.show(); home.leave(); home.show(); flushTimers();
assert.notEqual(menu.style.display, 'none');
console.log('PASS: cancelled stale hide timers, restored intro controls/focus, repeated home transitions');
