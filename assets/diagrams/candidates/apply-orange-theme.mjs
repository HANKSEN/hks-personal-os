import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const markerStart = '<style id="hks-orange-editorial">';
const markerEnd = "</style>";
const cssPath = new URL("./orange-editorial.css", import.meta.url);
const css = await readFile(cssPath, "utf8");

for (const input of process.argv.slice(2)) {
  const target = resolve(input);
  let html = await readFile(target, "utf8");
  const injected = `${markerStart}\n${css}\n${markerEnd}`;

  if (html.includes(markerStart)) {
    const start = html.indexOf(markerStart);
    const end = html.indexOf(markerEnd, start) + markerEnd.length;
    html = `${html.slice(0, start)}${injected}${html.slice(end)}`;
  } else {
    html = html.replace("</head>", `${injected}\n</head>`);
  }

  await writeFile(target, html, "utf8");
  process.stdout.write(`themed ${target}\n`);
}
