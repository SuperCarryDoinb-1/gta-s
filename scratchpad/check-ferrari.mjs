import { chromium } from 'file:///C:/Users/17920/AppData/Local/npm-cache/_npx/c61c9351a0dbcfa7/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/vehicle-check', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0"></body></html>' }));
  await page.goto('http://127.0.0.1:5175/vehicle-check');
  if (process.argv.includes('--palette')) {
    console.log(await page.evaluate(async () => {
      const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const out = {};
      for (const type of ['sedan','suv','suv-luxury','taxi','hatchback-sports','delivery']) {
        const { scene } = await new GLTFLoader().loadAsync('/models/cars/'+type+'.glb');
        const body = scene.getObjectByName('body');
        const tex = body.material.map;
        const canvas = document.createElement('canvas'); canvas.width=tex.image.width;canvas.height=tex.image.height;
        const ctx = canvas.getContext('2d');ctx.drawImage(tex.image,0,0);
        const p=body.geometry.attributes.position, uv=body.geometry.attributes.uv, index=body.geometry.index;
        const weights={}; const a=new THREE.Vector3(),b=a.clone(),c=a.clone();
        for(let i=0;i<(index?.count??p.count);i+=3){
          const ids=[0,1,2].map(n=>index?index.getX(i+n):i+n);
          a.fromBufferAttribute(p,ids[0]);b.fromBufferAttribute(p,ids[1]);c.fromBufferAttribute(p,ids[2]);
          const area=b.sub(a).cross(c.sub(a)).length()/2;
          const v=new THREE.Vector2(ids.reduce((s,k)=>s+uv.getX(k),0)/3,ids.reduce((s,k)=>s+uv.getY(k),0)/3);
          tex.transformUv(v);
          const rgba=ctx.getImageData(Math.min(canvas.width-1,Math.floor(v.x*canvas.width)),Math.min(canvas.height-1,Math.floor(v.y*canvas.height)),1,1).data;
          const hex='#'+Array.from(rgba).slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join('');
          weights[hex]=(weights[hex]??0)+area;
        }
        out[type]=Object.entries(weights).sort((a,b)=>b[1]-a[1]).slice(0,5);
      }
      return out;
    }));
    await browser.close(); process.exit(0);
  }
  console.log(await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { CarLibrary } = await import('/src/core/Loader.ts');
    const { Vehicle } = await import('/src/entities/Vehicle.ts');
    const { Physics, RAPIER } = await import('/src/core/Physics.ts');
    const lib = await CarLibrary.load();
    const physics = await Physics.create();
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1000,.1,1000).setTranslation(0,-.1,0));
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x333b45);
    const renderer = new THREE.WebGLRenderer({ antialias:true }); renderer.setSize(1200,800);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.body.append(renderer.domElement); lib.setupSportsReflections(renderer);
    scene.add(new THREE.HemisphereLight(0xe6efff,0x45403c,2));
    const sun = new THREE.DirectionalLight(0xffffff,3); sun.position.set(4,8,5); scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshStandardMaterial({color:0x555962,roughness:.85}));
    floor.rotation.x=-Math.PI/2; scene.add(floor);
    const car = new Vehicle(scene,physics,new THREE.Vector3(0,2,0),lib);
    const step = drive => { car.beginStep(); car.fixedUpdate(1/60,drive); physics.step(1/60); car.endStep(); car.syncVisual(1); };
    for(let i=0;i<180;i++)step({throttle:0,steer:0,brake:false});
    const camera = new THREE.PerspectiveCamera(40,1.5,.1,2000); camera.position.set(5,2.8,6);camera.lookAt(0,.7,0);
    renderer.render(scene,camera);
    window.ferrariCheck={car,step,renderer,scene,camera,lib,THREE};
    return {body:!!car.mesh.getObjectByName('body'),wheelCenters:lib.sportsWheels().map(w=>w.center.toArray()),height:car.chassisBody.translation().y};
  }));
  await page.screenshot({path:'scratchpad/ferrari-preview.png'});
  console.log(await page.evaluate(()=>{
    const {car,step}=window.ferrariCheck;
    for(let i=0;i<240;i++)step({throttle:1,steer:0,brake:false});
    const speed=car.speedKmh;
    if(speed<20)throw Error('Car failed to accelerate');
    for(let i=0;i<45;i++)step({throttle:1,steer:.5,brake:true});
    if(!Number.isFinite(car.chassisBody.translation().y))throw Error('Drift produced invalid physics');
    car.setCarType('police'); if(car.carType!=='police'||car.mesh.getObjectByName('glass'))throw Error('Ferrari body remained after police swap');
    car.setCarType('sedan-sports'); if(!car.mesh.getObjectByName('glass'))throw Error('Ferrari missing on return');
    return {speed,swap:'passed',drift:'passed'};
  }));
  console.log(await page.evaluate(async ()=>{
    const {car,lib,scene,camera,renderer,THREE}=window.ferrariCheck;
    const {CAR_PAINT}=await import('/src/core/Loader.ts');
    scene.remove(car.mesh);
    const types=[...Object.keys(CAR_PAINT),'police'];
    for(let i=0;i<types.length;i++){
      const type=types[i], model=lib.clone(type,false);
      if(type!=='police'){
        if(!model.getObjectByName('glass'))throw Error('Missing Ferrari: '+type);
        if(model.getObjectByName('body').material.color.getHex()!==CAR_PAINT[type])throw Error('Paint mismatch: '+type);
        car.setCarType(type);
        if(car.mesh.getObjectByName('body').material.color.getHex()!==CAR_PAINT[type])throw Error('Swap paint mismatch: '+type);
        const shared=lib.bakedParts('sedan-sports');
        if(!lib.bakedParts(type).every((p,j)=>p.geometry===shared[j].geometry))throw Error('Unshared geometry: '+type);
      }else if(model.getObjectByName('glass'))throw Error('Police was replaced');
      model.position.set((i%4-1.5)*3.1,0,Math.floor(i/4)*6);
      scene.add(model);
    }
    camera.position.set(13,16,20);camera.lookAt(0,0,3);renderer.render(scene,camera);
    return {variants:7,paint:'passed',police:'unchanged',sharedParkedGeometry:'passed'};
  }));
  await page.screenshot({path:'scratchpad/ferrari-fleet.png'});
  let result;
  page.on('console',msg=>{if(msg.text().includes('AUTOTEST')) result=msg.text();});
  await page.goto('http://127.0.0.1:5175/?autotest', {waitUntil:'networkidle'});
  for(let i=0;i<90&&!result;i++)await page.waitForTimeout(1000);
  if(!result?.includes('PASS'))throw Error(result??'Driving autotest timed out');
  console.log(result);
  if(errors.length)throw Error(errors.join('\n'));
  console.log('Ferrari checks passed; pageerrors: []');
} finally {await browser.close();}
