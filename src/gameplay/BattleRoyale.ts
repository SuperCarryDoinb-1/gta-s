import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import type { PersonInstance, PersonLibrary } from '../core/Loader';
import type { GameAudio } from '../core/Audio';
import type { HealthSystem } from './Health';
import type { SurvivalSession } from './SurvivalSession';
import { HealthBar3D } from '../ui/HealthBar3D';
import { makeTracer } from './fx';
import { BattleZone } from './BattleZone';

interface Competitor {
  id:number;name:string;body:RAPIER.RigidBody;collider:RAPIER.Collider;person:PersonInstance;gun:THREE.Mesh;
  hp:number;ammo:number;armed:boolean;looting:number;cooldown:number;think:number;target:number|null;
  previous:THREE.Vector3;waypoint:THREE.Vector3;goal:THREE.Vector3;yaw:number;clip:string;action:THREE.AnimationAction|null;bar:HealthBar3D;
}
type MatchState = 'waiting'|'running'|'won'|'lost';
const snap = (n:number) => 16+Math.round((n-16)/32)*32;

/** An isolated solo match. Bot weapons/ammo are taken from the same world loot as the player. */
export class BattleRoyale {
  readonly zone = new BattleZone();
  state:MatchState = 'waiting';
  kills = 0;
  rank = 0;
  onFinish:(()=>void)|null = null;
  onPlayerHit:((amount:number)=>void)|null = null;
  private readonly bots:Competitor[] = [];
  private readonly scene:THREE.Scene;
  private readonly physics:Physics;
  private readonly audio:GameAudio;
  private readonly health:HealthSystem;
  private readonly session:SurvivalSession;
  private readonly panel = document.createElement('aside');
  private readonly result = document.createElement('section');
  private readonly wall:THREE.Mesh;
  private readonly ring:THREE.Mesh;
  private readonly ray = new RAPIER.Ray({x:0,y:0,z:0},{x:0,y:0,z:1});
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly player = new THREE.Vector3();
  private zoneTick = 0;
  private readonly feed:string[] = [];
  private lastPanel = '';
  private readonly tracers:Array<{mesh:THREE.Mesh;life:number}> = [];

  constructor(scene:THREE.Scene,physics:Physics,library:PersonLibrary,audio:GameAudio,health:HealthSystem,session:SurvivalSession) {
    this.scene=scene;this.physics=physics;this.audio=audio;this.health=health;this.session=session;
    this.wall=new THREE.Mesh(new THREE.CylinderGeometry(1,1,70,96,1,true),new THREE.MeshBasicMaterial({color:0x5ca7d4,transparent:true,opacity:.09,side:THREE.DoubleSide,depthWrite:false}));
    this.wall.position.set(this.zone.x,35,this.zone.z);this.wall.visible=false;scene.add(this.wall);
    this.ring=new THREE.Mesh(new THREE.TorusGeometry(1,.006,4,128),new THREE.MeshBasicMaterial({color:0x91c6df}));
    this.ring.rotation.x=-Math.PI/2;this.ring.position.set(this.zone.x,.07,this.zone.z);this.ring.visible=false;scene.add(this.ring);
    this.panel.id='battle-hud';this.panel.hidden=true;document.body.append(this.panel);
    this.result.id='battle-result';this.result.hidden=true;this.result.setAttribute('role','dialog');this.result.setAttribute('aria-modal','true');document.body.append(this.result);
    this.session.createLoot([{kind:'backpack',count:1},{kind:'pistol',count:1},{kind:'pistolAmmo',count:24},{kind:'bandage',count:3}],new THREE.Vector3(18,.05,19));
    for(const [i,x,z]of [[1,-16,-112],[2,16,-80],[3,-48,-16],[4,-80,48],[5,-16,112],[6,16,80],[7,-48,80]]) {
      const person=library.spawn('adventurer');person.root.getObjectByName('Backpack')!.visible=false;person.root.visible=false;scene.add(person.root);
      person.root.traverse(o=>{if(o instanceof THREE.Mesh){const tint=(m:THREE.Material)=>{if(!(m instanceof THREE.MeshStandardMaterial)||!/Green/.test(m.name))return m;const n=m.clone();n.color.setHex([0x785858,0x547b8a,0x8d7850][i!%3]!);return n;};o.material=Array.isArray(o.material)?o.material.map(tint):tint(o.material);}});
      const gun=new THREE.Mesh(new THREE.BoxGeometry(.065,.09,.3),new THREE.MeshStandardMaterial({color:0x263033}));gun.rotation.x=Math.PI/2;gun.position.y=.08;gun.visible=false;person.handSlotR?.add(gun);
      const body=physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x!,1,z!).lockRotations().setCcdEnabled(true).setLinearDamping(.3));
      const collider=physics.world.createCollider(RAPIER.ColliderDesc.capsule(.55,.32).setMass(70),body);body.setEnabled(false);
      const position=new THREE.Vector3(x,1,z);
      this.bots.push({id:i!,name:`探索者 ${String(i!+1).padStart(2,'0')}`,body,collider,person,gun,hp:100,ammo:0,armed:false,looting:0,cooldown:2,think:0,target:null,previous:position.clone(),waypoint:position.clone(),goal:position.clone(),yaw:0,clip:'',action:null,bar:new HealthBar3D(scene)});
      this.session.createLoot([{kind:'pistol',count:1},{kind:'pistolAmmo',count:24}],new THREE.Vector3(x!+1.5,.05,z!+1));
    }
    for(const [x,z]of [[16,48],[-16,16],[16,-48],[-48,48]]) {
      this.session.createLoot([{kind:'bandage',count:3},{kind:'pistolAmmo',count:24},{kind:'armor',count:1,durability:100}],new THREE.Vector3(x!+2,.05,z!+1));
    }
  }

  get remaining():number {return this.bots.filter(b=>b.hp>0).length+(this.health.dead?0:1);}
  get finished():boolean {return this.state==='won'||this.state==='lost';}
  start():void {if(this.state!=='waiting')return;this.state='running';this.bots.forEach(b=>b.body.setEnabled(true));this.wall.visible=this.ring.visible=true;this.panel.hidden=false;}

  private visible(bot:Competitor,target:{x:number;y:number;z:number},body:RAPIER.RigidBody):boolean {
    const p=bot.body.translation(),dx=target.x-p.x,dy=target.y+.25-p.y-.45,dz=target.z-p.z,distance=Math.hypot(dx,dy,dz);
    if(distance<.01)return false;
    Object.assign(this.ray.origin,{x:p.x,y:p.y+.45,z:p.z});Object.assign(this.ray.dir,{x:dx/distance,y:dy/distance,z:dz/distance});
    const hit=this.physics.world.castRay(this.ray,distance,true,undefined,undefined,bot.collider,bot.body);
    return !hit||hit.collider.parent()?.handle===body.handle;
  }

  fixedUpdate(dt:number,player:THREE.Vector3,playerBody:RAPIER.RigidBody,ensure:(p:THREE.Vector3)=>void):void {
    if(this.state!=='running')return;this.player.copy(player);this.zone.advance(dt);
    this.zoneTick+=dt;
    if(this.zoneTick>=1){this.zoneTick-=1;const damage=this.zone.state.damage;
      if(this.zone.outside(player))this.health.damage(damage,'zone');
      if(this.finished)return;
      for(const bot of this.bots)if(bot.hp>0&&this.zone.outside(bot.body.translation()))this.hurt(bot,damage,'安全区');
    }
    for(const bot of this.bots){
      if(bot.hp<=0)continue;const p=bot.body.translation(),v=bot.body.linvel();bot.previous.set(p.x,p.y,p.z);ensure(bot.previous);
      bot.cooldown-=dt;bot.think-=dt;
      const urgent=this.zone.outside(p)||Math.hypot(p.x-this.zone.x,p.z-this.zone.z)>Math.max(5,this.zone.state.radius-8);
      let targetBody:RAPIER.RigidBody|null=null,targetPosition:{x:number;y:number;z:number}|null=null;
      if(bot.think<=0){bot.think=.2;bot.target=null;let nearest=28;
        if(!this.health.dead){const d=Math.hypot(player.x-p.x,player.y-p.y,player.z-p.z);if(d<nearest&&this.visible(bot,player,playerBody)){nearest=d;bot.target=0;}}
        for(const other of this.bots)if(other!==bot&&other.hp>0){const t=other.body.translation(),d=Math.hypot(t.x-p.x,t.y-p.y,t.z-p.z);if(d<nearest&&this.visible(bot,t,other.body)){nearest=d;bot.target=other.id;}}
      }
      if(bot.target===0&&!this.health.dead){targetBody=playerBody;targetPosition=player;}
      else if(bot.target){const other=this.bots.find(b=>b.id===bot.target&&b.hp>0);if(other){targetBody=other.body;targetPosition=other.body.translation();}}
      bot.goal.set(this.zone.x,1,this.zone.z);
      let looting=false;
      if(!bot.armed||bot.ammo===0){
        const kind=bot.armed?'pistolAmmo':'pistol';
        const items=this.session.worldLoot.filter(item=>item.kind===kind).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z));
        const item=items[0];
        if(item&&(!urgent||Math.hypot(item.x-p.x,item.z-p.z)<5)){
          bot.goal.set(item.x,1,item.z);looting=true;
          if(Math.hypot(item.x-p.x,item.z-p.z)<1.8){bot.looting+=dt;if(bot.looting>=1.5){
            const taken=this.session.takeWorldItem(item.id);bot.looting=0;
            if(taken){if(kind==='pistol'){bot.armed=true;bot.gun.visible=true;}else bot.ammo+=taken.count;}
          }}else bot.looting=0;
        }
      } else if(targetPosition&&!urgent)bot.goal.set(targetPosition.x,1,targetPosition.z);
      const distance=targetPosition?Math.hypot(targetPosition.x-p.x,targetPosition.z-p.z):Infinity;
      const aiming=bot.armed&&bot.ammo>0&&targetPosition&&targetBody&&distance<26&&this.visible(bot,targetPosition,targetBody);
      const stationary=!!aiming&&distance<13&&!urgent;
      if(aiming&&bot.cooldown<=0){
        bot.cooldown=1.25+Math.random()*.3;bot.ammo--;
        this.from.set(p.x,p.y+.45,p.z);this.to.set(targetPosition!.x,targetPosition!.y+.25,targetPosition!.z);
        const hit=Math.random()<.68;if(!hit)this.to.x+=1.8;
        const tracer=makeTracer(this.from,this.to);this.scene.add(tracer);this.tracers.push({mesh:tracer,life:.08});this.audio.gunshot(false);
        if(hit){if(bot.target===0)this.onPlayerHit?.(12);else {const target=this.bots.find(b=>b.id===bot.target);if(target)this.hurt(target,18,bot.name);}}
        if(this.finished)return;
      }
      if(bot.previous.distanceToSquared(bot.waypoint)<1.3||this.zone.elapsed<.1||looting){
        const gx=snap(bot.goal.x),gz=snap(bot.goal.z),sx=snap(p.x),sz=snap(p.z);
        if(looting&&Math.hypot(bot.goal.x-p.x,bot.goal.z-p.z)<7)bot.waypoint.copy(bot.goal);
        else if(Math.abs(p.x-sx)>1.5&&Math.abs(p.z-sz)>1.5)bot.waypoint.set(sx,1,p.z);
        else if(Math.abs(p.x-gx)>3)bot.waypoint.set(sx+Math.sign(gx-sx)*32,1,sz);
        else if(Math.abs(p.z-gz)>3)bot.waypoint.set(sx,1,sz+Math.sign(gz-sz)*32);
        else bot.waypoint.set(gx,1,gz);
      }
      let dx=bot.waypoint.x-p.x,dz=bot.waypoint.z-p.z,length=Math.hypot(dx,dz),vx=0,vz=0;
      if(!stationary&&length>.65){vx=dx/length*3.1;vz=dz/length*3.1;
        Object.assign(this.ray.origin,{x:p.x,y:p.y,z:p.z});Object.assign(this.ray.dir,{x:dx/length,y:0,z:dz/length});
        if(this.physics.world.castRay(this.ray,1.4,true,undefined,undefined,bot.collider,bot.body)){
          if(!looting&&length<5){
            // A parked vehicle can occupy an intersection itself. Continue to
            // the next road node while flanking, rather than circling inside it.
            const gx=snap(bot.goal.x),gz=snap(bot.goal.z),wx=snap(bot.waypoint.x),wz=snap(bot.waypoint.z);
            if(Math.abs(gx-wx)>1)bot.waypoint.set(wx+Math.sign(gx-wx)*32,1,wz);
            else if(Math.abs(gz-wz)>1)bot.waypoint.set(wx,1,wz+Math.sign(gz-wz)*32);
          }
          const old=vx;vx=-vz;vz=old;
        }
      }
      bot.body.setLinvel({x:vx,y:v.y,z:vz},true);
      if(aiming){dx=targetPosition!.x-p.x;dz=targetPosition!.z-p.z;length=Math.hypot(dx,dz);}
      if(length>.1){const yaw=Math.atan2(-dx,-dz);bot.yaw+=Math.atan2(Math.sin(yaw-bot.yaw),Math.cos(yaw-bot.yaw))*(1-Math.exp(-8*dt));}
      const clip=stationary?'1H_Ranged_Aiming':Math.hypot(vx,vz)>0?'Running_A':'Idle';
      if(bot.clip!==clip){const action=bot.person.actions.get(clip);if(action){bot.action?.fadeOut(.15);action.reset().fadeIn(.15).play();bot.action=action;bot.clip=clip;}}
    }
    if(!this.health.dead&&this.bots.every(b=>b.hp<=0))this.finish(true);
  }

  private hurt(bot:Competitor,amount:number,killer:string):void {
    if(bot.hp<=0)return;bot.hp=Math.max(0,bot.hp-amount);
    if(bot.hp===0){bot.body.setEnabled(false);bot.person.root.visible=false;bot.bar.hide();
      const p=bot.body.translation();this.session.createLoot([{kind:'bandage',count:1},...(bot.armed?[{kind:'pistol' as const,count:1}]:[]),...(bot.ammo>0?[{kind:'pistolAmmo' as const,count:Math.min(24,bot.ammo)}]:[])],new THREE.Vector3(p.x,.05,p.z));
      if(killer==='你')this.kills++;this.feed.unshift(`${killer} 淘汰了 ${bot.name}`);this.feed.length=Math.min(4,this.feed.length);
    }
  }

  applyDamage(body:RAPIER.RigidBody,amount:number):boolean {
    const bot=this.bots.find(b=>b.body.handle===body.handle);if(!bot)return false;
    if(this.state==='running'){this.hurt(bot,amount,'你');if(!this.health.dead&&this.bots.every(b=>b.hp<=0))this.finish(true);}return true;
  }
  explosion(center:THREE.Vector3):void {if(this.state!=='running')return;for(const bot of this.bots){const p=bot.body.translation(),d=Math.hypot(p.x-center.x,p.y-center.y,p.z-center.z);if(d<8)this.hurt(bot,100*(1-d/8),'你');}if(!this.health.dead&&this.bots.every(b=>b.hp<=0))this.finish(true);}
  playerEliminated():void {if(this.state==='running')this.finish(false);}
  private finish(won:boolean):void {
    if(this.finished)return;this.state=won?'won':'lost';this.rank=won?1:this.bots.filter(b=>b.hp>0).length+1;
    this.result.hidden=false;this.result.innerHTML=`<div class="battle-result-card"><small>SHANGHAI / SOLO BATTLE</small><h1>${won?'胜利 · 最后生还者':'本局结束'}</h1><div class="battle-result-stats"><span>排名 <b>#${this.rank} / 8</b></span><span>淘汰 <b>${this.kills}</b></span><span>生存 <b>${Math.floor(this.zone.elapsed/60)}分${Math.floor(this.zone.elapsed%60)}秒</b></span></div><p>本局装备与战绩独立，自由模式存档保留。</p><a id="battle-restart" href="?mode=battle">再来一局</a><a id="battle-return" href="./">返回自由生存</a></div>`;
    this.onFinish?.();this.result.querySelector<HTMLAnchorElement>('#battle-restart')?.focus();
  }

  update(dt:number,alpha:number):void {
    if(this.state==='waiting')return;const zone=this.zone.state;
    this.wall.scale.set(Math.max(.02,zone.radius),1,Math.max(.02,zone.radius));this.ring.scale.setScalar(Math.max(.02,zone.radius));
    for(const bot of this.bots){bot.person.root.visible=bot.hp>0;const p=bot.body.translation();if(bot.hp>0){bot.person.root.position.lerpVectors(bot.previous,this.from.set(p.x,p.y,p.z),alpha).y-=.87;bot.person.root.rotation.y=bot.yaw;bot.person.mixer.update(dt);}bot.bar.update(p.x,p.y+1.1,p.z,bot.hp/100,bot.hp>0,this.player);}
    for(let i=this.tracers.length-1;i>=0;i--){const t=this.tracers[i]!;t.life-=dt;if(t.life<=0){this.scene.remove(t.mesh);this.tracers.splice(i,1);}}
    const outside=this.zone.outside(this.player);
    const html=`<div class="battle-status"><b>单人吃鸡</b><span>剩余 <strong>${this.remaining} / 8</strong></span><span>淘汰 ${this.kills}</span></div><div class="battle-zone ${outside?'outside':''}"><strong>${outside?'圈外持续掉血':zone.label}</strong><span>${zone.remaining}s · 安全区 ${Math.ceil(zone.radius)}m</span><small>${outside?'向蓝色安全区中心转移':'蓝圈为当前边界，虚线为下一圈'}</small></div><div class="battle-feed">${this.feed.map(s=>`<span>${s}</span>`).join('')}</div>`;
    if(html!==this.lastPanel){this.panel.innerHTML=html;this.lastPanel=html;}
  }
  forEachBot(cb:(x:number,z:number)=>void):void {for(const b of this.bots)if(b.hp>0){const p=b.body.translation();cb(p.x,p.z);}}
}
