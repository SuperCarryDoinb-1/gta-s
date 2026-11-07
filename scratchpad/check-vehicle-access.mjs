import {chromium} from 'file:///C:/Users/17920/AppData/Local/npm-cache/_npx/c61c9351a0dbcfa7/node_modules/playwright/index.mjs';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/access-check',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0"></body>'}));
 await page.goto('http://127.0.0.1:5175/access-check');
 console.log(await page.evaluate(async()=>{
  const THREE=await import('/node_modules/.vite/deps/three.js');
  const {CarLibrary,PersonLibrary,PropLibrary}=await import('/src/core/Loader.ts');
  const {Physics,RAPIER}=await import('/src/core/Physics.ts');
  const {Vehicle}=await import('/src/entities/Vehicle.ts');
  const {Character}=await import('/src/entities/Character.ts');
  const {WantedSystem}=await import('/src/gameplay/Wanted.ts');
  const {PlayerManager}=await import('/src/gameplay/PlayerManager.ts');
  const {ChunkManager}=await import('/src/world/ChunkManager.ts');
  const [lib,people,props,physics]=await Promise.all([CarLibrary.load(),PersonLibrary.load(),PropLibrary.load(),Physics.create()]);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x384350);
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1000,.1,1000).setTranslation(0,-.1,0));
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshStandardMaterial({color:0x4b535e}));floor.rotation.x=-Math.PI/2;scene.add(floor);
  const character=new Character(scene,physics,new THREE.Vector3(1.8,.95,0),people);
  const owned=[new Vehicle(scene,physics,new THREE.Vector3(15,1,10),lib)];
  const keys=new Set();const input={wasPressed:k=>{const yes=keys.has(k);keys.delete(k);return yes;},isDown:k=>keys.has(k)};
  const controller={fixedUpdate(){},reset(){},knock(){}};
  const traffic={findNearest:()=>-1,distanceTo:()=>Infinity};
  const audio={door(){},gunshot(){}};
  const wanted=new WantedSystem(scene,physics,audio,lib,people,controller,{panicAt(){}});
  const chunks=new ChunkManager(new THREE.Scene(),await Physics.create(),new THREE.Vector3(0,1,0),props,lib);
  const manager=new PlayerManager(character,controller,owned,traffic,{setExcludeCollider(){},blendTarget(){}},input);
  manager.connectWorldVehicles(wanted,chunks,(x,y,z,yaw,type)=>{const v=new Vehicle(scene,physics,new THREE.Vector3(x,y+.9,z),lib);v.setCarType(type);v.teleportTo(x,z,yaw,y+.9);return v;});
  const car=wanted.cars[0];car.active=true;car.body.setEnabled(true);car.group.visible=true;car.currPos.set(0,0,0);car.prevPos.copy(car.currPos);car.body.setTranslation({x:0,y:0,z:0},false);
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1200,800);renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff,0x445566,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(4,8,5);scene.add(light);
  const camera=new THREE.PerspectiveCamera(45,1.5,.1,2000);camera.position.set(7,4,6);camera.lookAt(0,1,0);
  const step=()=>{character.beginStep();owned.forEach(v=>v.beginStep());manager.fixedUpdate(1/60);physics.step(1/60);character.endStep();owned.forEach(v=>v.endStep());wanted.endStep();manager.update(1/60);character.animate(1/60,0,true);character.syncVisual(1);owned.forEach(v=>v.syncVisual(1));manager.syncVisual();wanted.update(1/60,1);renderer.render(scene,camera);};
  keys.add('KeyE');manager.update(1/60);if(!manager.isCarjacking)throw Error('Police takeover did not start');
  for(let i=0;i<65;i++)step();
  window.access={THREE,scene,renderer,camera,manager,wanted,character,owned,keys,car,step,chunks,physics};
  return {phase:'pulling',occupants:car.seats.filter(s=>s.occupied).length};
 }));
 await page.screenshot({path:'scratchpad/police-pull.png'});
 console.log(await page.evaluate(()=>{
  const {manager,step,car,wanted,owned,keys,character,chunks,THREE}=window.access;
  for(let i=0;i<145;i++)step();
  if(!manager.isDriving||manager.activeVehicle.carType!=='police')throw Error('Police not driveable after takeover');
  if(car.active||car.body.isEnabled()||car.seats.some(s=>s.occupied))throw Error('Original police car or occupants remain');
  if(wanted.cops.filter(c=>c.active&&!c.car).length!==2)throw Error('Officers were not released into world');
  keys.add('KeyW');for(let i=0;i<180;i++)step();keys.delete('KeyW');
  if(manager.activeVehicle.speedKmh<15)throw Error('Police cannot accelerate');
  keys.add('KeyE');manager.update();for(let i=0;i<30;i++)step();if(manager.isDriving||!character.collider.isEnabled())throw Error('Exit failed');
  manager.activeVehicle; // primary getter is intentionally different on foot
  const stolen=owned.at(-1);stolen.teleportTo(0,0,0);character.teleport(new THREE.Vector3(1.8,.95,0));
  keys.add('KeyE');manager.update();if(!manager.isDriving||manager.activeVehicle!==stolen)throw Error('Re-entry failed');
  manager.forceExit();
  let candidate;
  for(const chunk of chunks.chunks.values()){candidate=chunk.parkedCars.find(c=>!c.taken);if(candidate)break;}
  if(!candidate)throw Error('No parked test vehicle');
  character.teleport(new THREE.Vector3(candidate.spec.x+1.5,1.1,candidate.spec.z));
  keys.add('KeyE');manager.update();
  if(!manager.isDriving||!candidate.taken)throw Error('Parked car cannot be taken');
  if(chunks.nearestParked(new THREE.Vector3(candidate.spec.x,1,candidate.spec.z),.1))throw Error('Parked duplicate remains');
  manager.forceExit();
  car.active=true;car.seized=false;car.seats.forEach(s=>s.occupied=true);car.body.setEnabled(true);car.group.visible=true;
  stolen.teleportTo(40,40,0);
  character.teleport(new THREE.Vector3(-1.8,.95,0));keys.add('KeyE');manager.update();
  if(!manager.isCarjacking)throw Error('Second takeover did not start');
  for(let i=0;i<30;i++)step();manager.forceExit();
  if(manager.isCarjacking||car.seized||!character.collider.isEnabled())throw Error('Death/cancel leaves lock');
  const released=wanted.cops.filter(c=>c.active&&!c.car);
  for(let i=0;i<240;i++){for(const cop of released)wanted.updateCop(cop,1/60,2);window.access.physics.step(1/60);}
  if(released.some(c=>c.state==='down'))throw Error('Released cops did not recover');
  car.seats.forEach(s=>s.occupied=false);character.teleport(new THREE.Vector3(-1.8,.95,0));keys.add('KeyE');manager.update();manager.update();
  if(!manager.isDriving||manager.activeVehicle.carType!=='police')throw Error('Empty police car inaccessible');
  return {driving:'passed',officers:2,parked:'passed',reentry:'passed',cancel:'passed',recovery:'passed',emptyPolice:'passed',owned:owned.length};
 }));
 if(errors.length)throw Error(errors.join('\n'));console.log('Vehicle access checks passed; pageerrors: []');
}finally{await browser.close();}
