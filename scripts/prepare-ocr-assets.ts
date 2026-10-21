import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
const target = path.resolve("public/ocr");
await mkdir(target, { recursive: true });
await copyFile(
  "node_modules/tesseract.js/dist/worker.min.js",
  path.join(target, "worker.min.js"),
);
for (const file of await readdir("node_modules/tesseract.js-core")) {
  if (/\.wasm(?:\.js)?$/.test(file))
    await copyFile(
      path.join("node_modules/tesseract.js-core", file),
      path.join(target, file),
    );
}
for (const lang of ["tha", "eng"]) {
  await copyFile(
    `node_modules/@tesseract.js-data/${lang}/4.0.0/${lang}.traineddata.gz`,
    path.join(target, `${lang}.traineddata.gz`),
  );
}
await copyFile(
  "node_modules/tesseract.js/LICENSE.md",
  path.join(target, "TESSERACT-LICENSE.md"),
);
await copyFile(
  "node_modules/tesseract.js-core/LICENSE",
  path.join(target, "CORE-LICENSE"),
);
console.log("Local Thai/English OCR assets prepared.");
