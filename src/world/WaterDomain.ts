import { RIVER_EAST, RIVER_WEST } from './ShanghaiLayout';

export const WATER_LEVEL = -.06;
export const SURFACE_SWIM_Y = .28;
let waterTime=0;
export function setWaterTime(time:number):void {waterTime=time;}
export function waterSurfaceHeight(x:number,z:number,time=waterTime):number {
  const tau=Math.PI*2;
  return WATER_LEVEL+.12*Math.sin(x/96*tau*3-time*1.4)+
    .065*Math.sin((x-z)/96*tau*2-time)+.04*Math.sin(-z/96*tau*5+time*2.1);
}
export function inWaterColumn(x:number):boolean {return x>RIVER_WEST&&x<RIVER_EAST;}

/** A continuous concave bed: shallow shore, sloping banks, deep central channel. */
export function seabedHeight(x:number,z:number):number {
  const distance=Math.max(0,Math.min(x-RIVER_WEST,RIVER_EAST-x));
  const t=Math.min(1,distance/34);
  const slope=t*t*(3-2*t);
  return -.8-11.5*slope+(Math.sin(z*.025)*.5+Math.sin(x*.19+z*.085)*.35)*slope;
}
