import { defineConfig } from 'vite';

// rapier3d-compat 将 WASM 以 base64 内嵌，无需 wasm/top-level-await 插件
// （且这两个插件依赖 rollup，与 Vite 8 / Rolldown 不兼容）
export default defineConfig({
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
