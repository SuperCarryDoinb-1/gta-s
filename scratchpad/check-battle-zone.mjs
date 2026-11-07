import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BattleZone } from '../src/gameplay/BattleZone.ts';
const zone=new BattleZone();assert.equal(zone.state.radius,144);assert.equal(zone.state.next,100);
zone.advance(45);assert.equal(zone.state.remaining,60);assert.equal(zone.state.radius,144);
zone.advance(30);assert.equal(zone.state.radius,122);assert.equal(zone.state.next,100);
assert.equal(zone.outside({x:138,z:16}),false);assert.equal(zone.outside({x:139,z:16}),true);
zone.advance(30);assert.equal(zone.state.radius,100);assert.equal(zone.state.next,64);
const before=zone.elapsed;zone.advance(-50);assert.equal(zone.elapsed,before);
let previous=zone.state.radius;for(let i=0;i<240;i++){zone.advance(1);assert.ok(zone.state.radius<=previous);previous=zone.state.radius;}
assert.equal(zone.state.radius,0);assert.equal(zone.state.damage,20);
const result={passed:true,initialRadius:144,firstMidpoint:122,finalRadius:zone.state.radius,terminalDamage:zone.state.damage,monotonic:true};
fs.writeFileSync('scratchpad/battle-zone-result.json',JSON.stringify(result,null,2));console.log('PASS',JSON.stringify(result));
