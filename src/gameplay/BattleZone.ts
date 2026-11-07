const PHASES = [
  { seconds:45, from:144, to:144, label:'准备搜装', damage:1 },
  { seconds:60, from:144, to:100, label:'第 1 次缩圈', damage:2 },
  { seconds:20, from:100, to:100, label:'安全区停留', damage:2 },
  { seconds:50, from:100, to:64, label:'第 2 次缩圈', damage:3 },
  { seconds:15, from:64, to:64, label:'安全区停留', damage:3 },
  { seconds:45, from:64, to:32, label:'第 3 次缩圈', damage:5 },
  { seconds:10, from:32, to:32, label:'决战准备', damage:5 },
  { seconds:40, from:32, to:12, label:'决战缩圈', damage:8 },
  { seconds:15, from:12, to:12, label:'最后决战', damage:8 },
  { seconds:40, from:12, to:0, label:'最终收缩', damage:12 },
] as const;

export class BattleZone {
  readonly x = 16;
  readonly z = 16;
  elapsed = 0;
  advance(dt:number):void { this.elapsed += Math.max(0,dt); }
  get state(): { radius:number;next:number;remaining:number;label:string;damage:number } {
    let time = this.elapsed;
    for (const [index,phase] of PHASES.entries()) {
      if (time < phase.seconds) return { radius:phase.from+(phase.to-phase.from)*time/phase.seconds,next:phase.from===phase.to ? PHASES[index+1]?.to ?? phase.to : phase.to,remaining:Math.ceil(phase.seconds-time),label:phase.label,damage:phase.damage };
      time -= phase.seconds;
    }
    return { radius:0,next:0,remaining:0,label:'最终决战',damage:20 };
  }
  outside(pos:{x:number;z:number}):boolean { return Math.hypot(pos.x-this.x,pos.z-this.z)>this.state.radius; }
}
