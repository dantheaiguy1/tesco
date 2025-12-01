// vite.config.ts
import build from "file:///home/user/webapp/node_modules/@hono/vite-build/dist/adapter/cloudflare-pages/index.js";
import devServer from "file:///home/user/webapp/node_modules/@hono/vite-dev-server/dist/index.js";
import adapter from "file:///home/user/webapp/node_modules/@hono/vite-dev-server/dist/adapter/cloudflare.js";
import { defineConfig } from "file:///home/user/webapp/node_modules/vite/dist/node/index.js";
var vite_config_default = defineConfig({
  plugins: [
    build({
      outputDir: "dist",
      staticPaths: ["/static/*", "/images/*"]
    }),
    devServer({
      adapter,
      entry: "src/index.tsx"
    })
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS91c2VyL3dlYmFwcFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvdXNlci93ZWJhcHAvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL2hvbWUvdXNlci93ZWJhcHAvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgYnVpbGQgZnJvbSAnQGhvbm8vdml0ZS1idWlsZC9jbG91ZGZsYXJlLXBhZ2VzJ1xuaW1wb3J0IGRldlNlcnZlciBmcm9tICdAaG9uby92aXRlLWRldi1zZXJ2ZXInXG5pbXBvcnQgYWRhcHRlciBmcm9tICdAaG9uby92aXRlLWRldi1zZXJ2ZXIvY2xvdWRmbGFyZSdcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnXG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtcbiAgICBidWlsZCh7XG4gICAgICBvdXRwdXREaXI6ICdkaXN0JyxcbiAgICAgIHN0YXRpY1BhdGhzOiBbJy9zdGF0aWMvKicsICcvaW1hZ2VzLyonXVxuICAgIH0pLFxuICAgIGRldlNlcnZlcih7XG4gICAgICBhZGFwdGVyLFxuICAgICAgZW50cnk6ICdzcmMvaW5kZXgudHN4J1xuICAgIH0pXG4gIF1cbn0pXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXFPLE9BQU8sV0FBVztBQUN2UCxPQUFPLGVBQWU7QUFDdEIsT0FBTyxhQUFhO0FBQ3BCLFNBQVMsb0JBQW9CO0FBRTdCLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVM7QUFBQSxJQUNQLE1BQU07QUFBQSxNQUNKLFdBQVc7QUFBQSxNQUNYLGFBQWEsQ0FBQyxhQUFhLFdBQVc7QUFBQSxJQUN4QyxDQUFDO0FBQUEsSUFDRCxVQUFVO0FBQUEsTUFDUjtBQUFBLE1BQ0EsT0FBTztBQUFBLElBQ1QsQ0FBQztBQUFBLEVBQ0g7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
