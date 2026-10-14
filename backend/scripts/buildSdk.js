const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const srcPath = path.join(__dirname, "../../sdk/src/livepulse.js");
const outDir = path.join(__dirname, "../public/sdk");
const outPath = path.join(outDir, "livepulse.js");

fs.mkdirSync(outDir, { recursive: true });

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
