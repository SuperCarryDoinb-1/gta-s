import * as THREE from 'three';

/** Local signs and small street details for the two new collision-backed districts. */
export function addExpansionDetails(scene: THREE.Scene): void {
  const root = new THREE.Group(); root.name = 'Shanghai-Expanded-Districts'; scene.add(root);
  const sign = (title: string, subtitle: string, x: number, y: number, z: number, width: number, yaw: number) => {
    const c = document.createElement('canvas'); c.width = 768; c.height = 192;
    const g = c.getContext('2d')!; g.fillStyle = '#29443c'; g.fillRect(0, 0, 768, 192);
    g.strokeStyle = '#ccb88f'; g.lineWidth = 6; g.strokeRect(6, 6, 756, 180);
    g.textAlign = 'center'; g.fillStyle = '#ede4c7'; g.font = 'bold 56px Microsoft YaHei,sans-serif'; g.fillText(title, 384, 86);
    g.font = '23px Microsoft YaHei,sans-serif'; g.fillText(subtitle, 384, 147);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    // Keep the shop fascia above the doorway and camera, rather than a large
    // double-sided billboard hanging across the player's interior view.
    const fascia = x === -88.8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, fascia ? .7 : width / 4), new THREE.MeshBasicMaterial({ map: t }));
    m.position.set(x, fascia ? 3.55 : y, z); m.rotation.y = yaw; root.add(m);
  };
  sign('里弄老街', 'LILONG / 海派生活街区', -83.6, 3, 17, 5, Math.PI / 2);
  sign('弄堂小铺', '衣装 / 日用 / 医疗补给', -88.8, 3, 32, 6.5, Math.PI / 2);
  sign('浦东港区', 'WAREHOUSE / 仓储码头', 178, 3.8, 174, 7, Math.PI);
  sign('三号仓库', '装备补给 / 入口常开', 186.7, 5.1, 192, 8, -Math.PI / 2);
  const metal = new THREE.MeshStandardMaterial({ color: 0x6d746b, roughness: .8 });
  for (const z of [-11, 21]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 10, 6), metal);
    rail.rotation.z = Math.PI / 2; rail.position.set(-96, 5.4, z); root.add(rail);
    for (let i = 0; i < 5; i++) {
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(.7, 1), new THREE.MeshStandardMaterial({ color: [0xa5b8b2,0xc89b7c,0x6d8798][i % 3], side: THREE.DoubleSide, roughness: 1 }));
      cloth.position.set(-100 + i * 1.9, 4.85, z); root.add(cloth);
    }
  }
}
