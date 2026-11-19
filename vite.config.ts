import { defineConfig } from "vite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Keep Blender's stable source/export paths, while production URLs identify
// exact bytes and can be cached without revalidation across deployments.
const models = ["archive-cassette", "archive-assembly"].map(name => {
  const source = readFileSync(`public/assets/${name}.glb`);
  const hash = createHash("sha256").update(source).digest("hex").slice(0,16);
  return { key:`assets/${name}.glb`, fileName:`assets/${name}.${hash}.glb`, source };
});
const hasNovecento = ["Normal", "DemiBold", "Bold"].every(weight =>
  existsSync(`public/fonts/novecento/webFonts/NovecentoSansWide${weight}/font.woff2`),
);
function licenseNotices() {
  const { packages } = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
    packages: Record<string, { dev?: boolean; version?: string }>;
  };
  const notices = [readFileSync("LICENSE", "utf8")];
  for (const [path, metadata] of Object.entries(packages)) {
    if (!path || metadata.dev || !existsSync(path)) continue;
    const files = readdirSync(path).filter(name => /^(license|licence|copying|notice)(\.|$)/i.test(name));
    for (const file of files) {
      const name = path.split("node_modules/").at(-1);
      notices.push(name + " " + metadata.version + "\n" + readFileSync(path + "/" + file, "utf8"));
    }
  }
  return notices.join("\n\n");
}

export default defineConfig(({ mode }) => ({
  base: mode === "wallpaper" ? "./" : "/",
  define: {
    __RHINE_MODELS__: JSON.stringify(Object.fromEntries(models.map(model => [model.key,model.fileName]))),
    __RHINE_NOVECENTO__: JSON.stringify(hasNovecento),
  },
  plugins: [{
    name: "versioned-model-assets", apply: "build",
    buildStart() { for (const model of models) this.emitFile({type:"asset",fileName:model.fileName,source:model.source}); },
  }, {
    name: "redistribution-notices", apply: "build",
    buildStart() {
      this.emitFile({ type: "asset", fileName: "licenses/third-party-notices.txt", source: licenseNotices() });
    },
  }, ...(mode === "wallpaper" ? [{
    name: "wallpaper-host",
    transformIndexHtml(html: string) {
      return { html: html.replace(/\s*<link rel="manifest"[^>]*>/, ""), tags: [{
        tag: "script", children: readFileSync("wallpaper/host.js", "utf8"), injectTo: "head-prepend" as const,
      }] };
    },
  }] : [])],
}));
