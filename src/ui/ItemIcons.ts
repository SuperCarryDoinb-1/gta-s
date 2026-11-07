import type { LootKind } from '../gameplay/SurvivalInventory';

/** Original vector illustrations; no third-party game artwork is bundled. */
export function itemIcon(kind: LootKind | 'person' | 'armor' | 'helmet'): string {
  const shapes: Record<typeof kind, string> = {
    jacket: '<path fill="#3c83a2" d="m29 18 13-5 6 8 6-8 13 5 17 34-14 7-8-19v35H34V40l-8 19-14-7z"/><path stroke="#bed3d6" d="M48 22v51M33 50h10M54 50h10M35 20l7 14 6-12 6 12 7-14"/>',
    workwear: '<path fill="#cc773b" d="m29 18 13-5 6 8 6-8 13 5 17 34-14 7-8-19v35H34V40l-8 19-14-7z"/><path stroke="#ead39b" stroke-width="5" d="M34 42h28M21 42l7 4M68 46l7-4"/><path d="M48 22v51M36 55h9v10h-9M52 55h9v10h-9"/>',
    pistol: '<path fill="#b8c4c4" d="M16 28h59v13H46l-5 5H22v-7h-6z"/><path fill="#647478" d="m27 42 18 1-7 25H23z"/><path d="M48 42v10H38M19 32h51"/><path fill="#d9b56e" d="M22 29h8v8h-8z"/>',
    mg: '<path fill="#b8c4c4" d="M23 32h45v13H23z"/><path fill="#657579" d="m8 31 17 5v11H8zm29 14h9l-4 20H32zm14 0h13l-4 20H48z"/><path fill="#d9b56e" d="M67 34h17v7H67z"/><path d="M84 37h8M30 28h22M39 24v8M58 28v5"/>',
    grenade: '<path fill="#6e8275" d="M35 33c-15 7-14 35 10 38 25-3 26-31 10-38z"/><path fill="#c1c7b1" d="M39 23h15v15H39z"/><path d="m49 24 15 9 6 23M35 46h22M31 56h30M44 39v26"/><circle cx="60" cy="21" r="7"/>',
    backpack: '<path fill="#6a8b7e" d="M25 34q0-16 23-16t23 16v38H25z"/><path fill="#8fac99" d="M31 48h34v21H31z"/><path d="M38 18v-6h20v6M25 36h46M32 56h32M20 37v24M76 37v24M38 25v9M58 25v9"/><path fill="#d9b56e" d="M44 51h8v8h-8z"/>',
    bandage: '<path fill="#c9c9b4" d="M24 25h48v46H24z"/><path fill="#9caa9d" d="M24 25h48v11H24z"/><path fill="#e3e3ce" d="M31 39h34v27H31z"/><path stroke="#bd7668" stroke-width="7" d="M48 42v20M38 52h20"/><path d="M29 29h36"/>',
    pistolAmmo: '<path fill="#6b7f7a" d="M18 47h62v26H18z"/><path fill="#b89a63" d="M25 23h10v35H25zm18 0h10v35H43zm18 0h10v35H61z"/><path fill="#d9c18b" d="m25 23 5-10 5 10zm18 0 5-10 5 10zm18 0 5-10 5 10z"/><path d="M24 64h49"/>',
    mgAmmo: '<path fill="#697d76" d="M14 48h70v26H14z"/><path fill="#b89a63" d="M22 21h9v38h-9zm15 0h9v38h-9zm15 0h9v38h-9zm15 0h9v38h-9z"/><path fill="#d9c18b" d="m22 21 4.5-12L31 21zm15 0 4.5-12L46 21zm15 0 4.5-12L61 21zm15 0 4.5-12L76 21z"/><path d="M22 65h54"/>',
    helmet: '<path fill="#7c8981" d="M20 51q0-33 28-33t28 33l-12 8H32z"/><path d="M18 51h60M33 58v13h15M48 19v23"/>',
    armor: '<path fill="#7c8981" d="m26 17 15-4v10h14V13l15 4 7 53H19z"/><path d="M29 30h38v29H29zM48 30v29M29 44h38"/>',
    person: '<circle cx="48" cy="21" r="12"/><path d="M36 35h24l10 27-9 4-5-15v30H40V51l-5 15-9-4z"/>',
  };
  return `<svg viewBox="0 0 96 88" fill="none" stroke="#344340" stroke-width="2" stroke-linejoin="round" aria-hidden="true">${shapes[kind]}</svg>`;
}

export const survivorFigure = `<svg class="survivor-figure" viewBox="0 0 220 430" aria-hidden="true">
  <defs><linearGradient id="suit" x2="1" y2="1"><stop stop-color="#84918a"/><stop offset="1" stop-color="#35463f"/></linearGradient></defs>
  <ellipse cx="110" cy="407" rx="66" ry="10" fill="#06100d" opacity=".6"/>
  <g stroke="#a8b6a4" stroke-width="1.2" stroke-linejoin="round">
  <path fill="#b7b49b" d="m93 31 7-12h23l9 14-4 29-18 10-17-11z"/>
  <path fill="#3c4c42" d="m90 35 5-18 14-7 21 11 5 20-14-10-17 1z"/>
  <path fill="url(#suit)" d="m84 73 25-8 28 8 22 17-12 103-37 19-41-18-7-102z"/>
  <path fill="#384d43" d="m84 76 8-4 6 52h25l6-52 9 5 8 102-36 18-37-18z"/>
  <path fill="#657568" d="M83 117h23v36H81zm31 0h23l2 36h-25zM80 161h58v17H80z"/>
  <path fill="url(#suit)" d="m63 89-15 12-16 78 8 49 15-4-2-45 21-59zm94 0 15 12 16 78-8 49-15-4 2-45-21-59z"/>
  <path fill="#b7b49b" d="m40 224 15-2 4 22-9 12-11-8zm125-2 15 2 1 24-11 8-9-12z"/>
  <path fill="#4b5d50" d="m72 190 38 11 37-11-6 94-16 95-23-1 2-96-6-38-9 40 2 93-24 2-9-98z"/>
  <path fill="#77816a" d="m65 236 23 2-2 40-24-1zm53 2 24-2 2 41-24 1z"/>
  <path fill="#283c33" d="m67 371 24-1 1 29-37 2-1-12zm35-1 23 1 15 18-1 12-37-2z"/>
  <path fill="none" opacity=".45" d="m100 38 7 3m10 0 6-3M103 54h15M69 109l-17 67m105-67 12 67M76 298l5 60m42-60-10 60"/>
  </g></svg>`;
