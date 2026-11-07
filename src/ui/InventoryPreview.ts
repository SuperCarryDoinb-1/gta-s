import './survival.css';
import { InventoryScreen, type NearbyLoot } from './InventoryScreen';
import { SurvivalInventory, LOOT_NAMES } from '../gameplay/SurvivalInventory';
import { DistrictMap } from './DistrictMap';

const inventory = new SurvivalInventory();
inventory.collect('backpack'); inventory.collect('pistol'); inventory.collect('mg');
inventory.collect('pistolAmmo', 48); inventory.collect('mgAmmo', 60);
inventory.collect('bandage', 3); inventory.collect('grenade', 2);
let hp = 65;
let current = 'none';
let nearby: NearbyLoot[] = [
  { id: 'sample:jacket', kind: 'jacket', count: 1, distance: .8 },
  { id: 'sample:armor', kind: 'armor', count: 1, distance: 1.4 },
  { id: 'sample:0', kind: 'bandage', count: 2, distance: 1.2 },
  { id: 'sample:1', kind: 'pistolAmmo', count: 24, distance: 1.8 },
  { id: 'sample:2', kind: 'grenade', count: 1, distance: 2.3 },
];
const screen = new InventoryScreen({
  preview: true, inventory, isPlaying: () => true,
  nearby: () => nearby,
  pickup: id => {
    const item = nearby.find(p => p.id === id);
    if (!item) return '物资已被拾取';
    const error = inventory.collect(item.kind, item.count);
    if (error) return error;
    nearby = nearby.filter(p => p.id !== id);
    return `已拾取${LOOT_NAMES[item.kind]}`;
  },
  heal: () => {
    if (hp >= 100) return '生命值已满';
    if (inventory.bandages <= 0) return '没有绷带';
    inventory.bandages--;hp = Math.min(100, hp + 25);return '使用绷带，恢复 25 HP';
  },
  equip: kind => { current = current === kind ? 'none' : kind; },
  currentWeapon: () => current, hp: () => hp,
  open: () => {}, close: () => {},
});
const map = new DistrictMap();
map.begin(16,16);map.loot(11,25,'#d4c18a');map.loot(11,40,'#b9d298');map.objective(11,25);map.end(0,-1);
document.getElementById('open-preview')!.addEventListener('click', () => screen.open());
screen.open();
