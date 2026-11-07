import fs from 'node:fs';import path from 'node:path';import {chromium} from './browser-tools/node_modules/playwright/index.mjs';
const dir=path.resolve('scratchpad/swim-correction-review');fs.mkdirSync(dir,{recursive:true});process.env.TEMP=process.env.TMP=path.join(dir,'tmp');fs.mkdirSync(process.env.TEMP,{recursive:true});
const context=await chromium.launchPersistentContext(path.join(dir,`profile-${Date.now()}`),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1100,height:800}});
try{
 const page=context.pages()[0];const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('ERROR',e.message);});
 await page.route('**/rig-review',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0;background:#1e333b"><div id="label" style="position:absolute;top:16px;left:20px;color:white;font:20px sans-serif"></div></body>'}));
 await page.goto('http://127.0.0.1:5186/rig-review');
 await page.evaluate(async()=>{
  const moduleText=await(await fetch('/src/core/Loader.ts')).text();const threeUrl=moduleText.match(/import \* as THREE from "([^"]+)"/)[1];
  const THREE=await import(threeUrl),{PersonLibrary}=await import('/src/core/Loader.ts');const library=await PersonLibrary.load();
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1100,800);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;document.body.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x233b46);scene.add(new THREE.HemisphereLight(0xd7efff,0x8b9b91,2));const light=new THREE.DirectionalLight(0xffe4c7,3);light.position.set(2,5,3);scene.add(light);
  const camera=new THREE.PerspectiveCamera(42,1100/800,.01,100);camera.position.set(4,1.7,1.8);camera.lookAt(0,.9,0);
  window.rig={THREE,library,renderer,scene,camera,person:null};
 });
 const records=[];
 for(const type of ['adventurer','animated-woman','man'])for(const clip of ['Swim_Forward','Swim_Idle'])for(const phase of [0,.25,.5,.75]){
  const data=await page.evaluate(({type,clip,phase})=>{
   const q=window.rig;if(q.person)q.scene.remove(q.person.root);const p=q.library.spawn(type);q.person=p;q.scene.add(p.root);const action=p.actions.get(clip);action.play();action.paused=true;action.time=action.getClip().duration*phase;p.mixer.update(0);p.root.updateMatrixWorld(true);q.renderer.render(q.scene,q.camera);
   const joints={};p.root.traverse(o=>{if(o.isBone&&/^(Body|Hips|Head|UpperArm[LR]|LowerArm[LR]|Wrist[LR]|Palm[LR]|UpperLeg[LR]|LowerLeg[LR]|Foot[LR]|LowerLeg[LR]_end)$/.test(o.name))joints[o.name]=o.getWorldPosition(new q.THREE.Vector3()).toArray();});
   document.querySelector('#label').textContent=`${type} · ${clip} · ${phase*100}%`;return{type,clip,phase,duration:action.getClip().duration,joints,source:p.root.userData.swimAnimationSource};
  },{type,clip,phase});records.push(data);
  await page.screenshot({path:path.join(dir,`${type}-${clip}-${phase}.png`)});
 }
 fs.writeFileSync(path.join(dir,'rigs.json'),JSON.stringify({records,errors},null,2));console.log('RIG REVIEW',JSON.stringify({errors,first:records[0],idle:records[4]}));
 const video=await page.evaluate(async()=>{
  const q=window.rig;q.scene.remove(q.person.root);const p=q.library.spawn('adventurer');q.scene.add(p.root);
  const forward=p.actions.get('Swim_Forward'),idle=p.actions.get('Swim_Idle');forward.play();
  const stream=q.renderer.domElement.captureStream(30),chunks=[];const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();
  await new Promise(resolve=>{let start,previous,changed=false;const tick=now=>{start??=now;previous??=now;const elapsed=(now-start)/1000,dt=Math.min(.05,(now-previous)/1000);previous=now;
   if(elapsed>3&&!changed){idle.reset().play().crossFadeFrom(forward,.3,false);changed=true;}
   document.querySelector('#label').textContent=changed?'Authored swim idle / 原地踩水':'Authored breaststroke / 蛙泳前进';
   p.mixer.update(dt);q.renderer.render(q.scene,q.camera);if(elapsed>=6)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});
  await new Promise(resolve=>{recorder.onstop=resolve;recorder.stop();});stream.getTracks().forEach(t=>t.stop());
  const bytes=new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());let result='';for(let i=0;i<bytes.length;i+=32768)result+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(result);
 });fs.writeFileSync(path.join(dir,'authored-swimming-preview.webm'),Buffer.from(video,'base64'));
}finally{await context.close();}
