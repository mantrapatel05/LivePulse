const path = require("path");
const fs = require("fs");

const srcPath = path.join(__dirname, "../../sdk/src/livepulse.js");
const outDir = path.join(__dirname, "../public/sdk");
const outPath = path.join(outDir, "livepulse.js");

fs.mkdirSync(outDir, { recursive: true });

if (!fs.existsSync(srcPath)) {
  if (fs.existsSync(outPath)) {
    const { size } = fs.statSync(outPath);
    console.log(
      `[build:sdk] using existing artifact ${path.relative(process.cwd(), outPath)} (${(size / 1024).toFixed(1)} KB)`,
    );
    process.exit(0);
  }
  console.error(`[build:sdk] source not found at ${srcPath} and no pre-built artifact exists`);
  process.exit(1);
}

let esbuild;
try {
  esbuild = require("esbuild");
} catch {
  if (fs.existsSync(outPath)) {
    const { size } = fs.statSync(outPath);
    console.log(
      `[build:sdk] esbuild not available, using existing artifact ${path.relative(process.cwd(), outPath)} (${(size / 1024).toFixed(1)} KB)`,
    );
    process.exit(0);
  }
  console.error("[build:sdk] esbuild is required to build SDK from source");
  process.exit(1);
}

esbuild
  .build({
    entryPoints: [srcPath],
    outfile: outPath,
    bundle: false,
    minify: true,
    target: ["es2018"],
    legalComments: "none",
  })
  .then(() => {
    const { size } = fs.statSync(outPath);
    console.log(
      `[build:sdk] wrote ${path.relative(process.cwd(), outPath)} (${(size / 1024).toFixed(1)} KB minified)`,
    );
  })
  .catch((err) => {
    console.error("[build:sdk] failed:", err);
    process.exit(1);
  });
