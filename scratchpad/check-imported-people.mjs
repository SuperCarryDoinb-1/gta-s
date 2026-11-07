import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
process.env.TEMP = process.env.TMP = path.resolve('scratchpad/fleet-browser-tmp');
const context = await chromium.launchPersistentContext(path.resolve('scratchpad/people-browser-profile'), {
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  viewport: { width: 1200, height: 800 },
});
try {
  const page = context.pages()[0], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.text().includes('PropertyBinding')) errors.push(m.text()); });
  await page.route('**/people-test', r => r.fulfill({contentType:'text/html',body:'<body style="margin:0"></body>'}));
  await page.goto('http://127.0.0.1:5181/people-test');
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { PersonLibrary } = await import('/src/core/Loader.ts');
    const lib = await PersonLibrary.load();
    const { Character } = await import('/src/entities/Character.ts');
    const { Physics } = await import('/src/core/Physics.ts');
    const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const source = await new GLTFLoader().loadAsync('/assets/poly-pizza-people/adventurer.glb');
    const roll = source.animations.find(c => c.name.endsWith('|Roll'));
    const adapted = lib.spawn('adventurer').actions.get('Jump_Idle').getClip();
    if (JSON.stringify(adapted.toJSON().tracks) !== JSON.stringify(roll.toJSON().tracks)) throw Error('Jump does not use original Roll tracks');
    const character = new Character(new THREE.Scene(), await Physics.create(), new THREE.Vector3(0,3,0), lib);
    for (let i=0; i<18; i++) character.animate(1/60,5,false);
    const action = character.currentAction;
    if (character.currentClip !== 'Jump_Idle' || action.time < .25 || action.loop !== THREE.LoopOnce) throw Error('Roll restarts or loops');
    for (let i=0; i<180; i++) character.animate(1/60,5,false);
    if (Math.abs(action.time-adapted.duration) > .001) throw Error('Roll did not finish once');
    character.animate(1/60,0,true);
    if (character.currentClip !== 'Idle') throw Error('Landing did not restore idle');
    character.animate(1/60,5,false);
    if (character.currentAction.time > .05 || character.currentAction.paused) throw Error('Next jump cannot replay roll');
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x263340);
    scene.add(new THREE.HemisphereLight(0xffffff,0x707080,2));
    const light = new THREE.DirectionalLight(0xffffff,3); light.position.set(4,8,-7); scene.add(light);
    const stats = [];
    for (const [i,type] of ['adventurer','animated-woman','man'].entries()) {
      const person = lib.spawn(type), other = lib.spawn(type);
      const bones = [], otherBones = [];
      person.root.traverse(o=>{if(o.isBone)bones.push(o);});
      other.root.traverse(o=>{if(o.isBone)otherBones.push(o);});
      if(bones[0]===otherBones[0])throw Error('Skeleton is shared');
      if(!person.handSlotR || person.handSlotR===person.root)throw Error('No hand anchor');
      for (const [name,action] of person.actions) {
        person.mixer.stopAllAction(); action.reset().play(); person.mixer.update(.3);
        person.root.updateMatrixWorld(true);
        for(const bone of bones)if(!bone.matrixWorld.elements.every(Number.isFinite))throw Error(type+': '+name+' invalid bone');
      }
      person.mixer.stopAllAction(); person.actions.get('Idle').reset().play(); person.mixer.update(.1);
      person.root.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(person.root, true).getSize(new THREE.Vector3());
      const expected = type === 'adventurer' ? 1.86 : 1.76;
      if(Math.abs(size.y-expected)>.06)throw Error('Wrong animated person height: '+type+' '+size.y);
      stats.push({type,height:size.y,actions:[...person.actions.keys()],bones:bones.length});
      person.root.position.set((i-1)*2.5,0,0); scene.add(person.root);
      other.actions.get('Sit_Chair_Idle').play(); other.mixer.update(.3);
      other.root.position.set((i-1)*2.5,0,2.5); scene.add(other.root);
    }
    const renderer = new THREE.WebGLRenderer({antialias:true}); renderer.setSize(1200,800); document.body.append(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(42,1.5,.1,100);camera.position.set(7,4,-10);camera.lookAt(0,.8,1);
    renderer.render(scene,camera);
    return stats;
  });
  await page.screenshot({path:'scratchpad/imported-people.png'});
  if(errors.length)throw Error(errors.join('\n'));
  fs.writeFileSync('scratchpad/imported-people-result.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally { await context.close(); }
