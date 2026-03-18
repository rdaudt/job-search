import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const publicDir = path.join(distDir, "public");
const extensionDir = path.join(distDir, "extension");

rmSync(distDir, { force: true, recursive: true });
mkdirSync(publicDir, { recursive: true });
mkdirSync(path.join(distDir, "server"), { recursive: true });
mkdirSync(extensionDir, { recursive: true });

copyFileSync(path.join(rootDir, "src", "client", "index.html"), path.join(publicDir, "index.html"));
copyFileSync(path.join(rootDir, "src", "client", "styles.css"), path.join(publicDir, "styles.css"));
copyFileSync(
  path.join(rootDir, "src", "extension", "manifest.json"),
  path.join(extensionDir, "manifest.json"),
);

if (existsSync(path.join(rootDir, "searches.example.json"))) {
  copyFileSync(
    path.join(rootDir, "searches.example.json"),
    path.join(distDir, "searches.example.json"),
  );
}

await build({
  entryPoints: {
    index: path.join(rootDir, "src", "client", "index.ts")
  },
  outdir: publicDir,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  sourcemap: true
});

await build({
  entryPoints: {
    index: path.join(rootDir, "src", "server", "index.ts")
  },
  outfile: path.join(distDir, "server", "index.cjs"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: ["node20"],
  sourcemap: true,
  external: ["better-sqlite3"]
});

await build({
  entryPoints: {
    background: path.join(rootDir, "src", "extension", "background.ts"),
    content: path.join(rootDir, "src", "extension", "content.ts")
  },
  outdir: extensionDir,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  sourcemap: true
});
