// Mechanical exports. Edit icons.mjs, then run this script.
// The icon browser itself is rendered live by ../site/icons.cow.
import { mkdir, writeFile } from 'node:fs/promises';
import { cowIcon, icons, variants } from './icons.mjs';
const output = new URL('../site/assets/icons/', import.meta.url);
await mkdir(output, { recursive: true });
for (const variant of variants) {
  await mkdir(new URL(variant + '/', output), { recursive: true });
  for (const name of Object.keys(icons)) await writeFile(new URL(variant + '/' + name + '.svg', output), cowIcon(name, { variant }) + '\n');
}
const symbols = variants.flatMap(variant => Object.keys(icons).map(name => {
  const svg = cowIcon(name, { variant });
  return '<symbol id="cow-' + name + '-' + variant + '" viewBox="0 0 24 24">' + svg.slice(svg.indexOf('>') + 1, -6) + '</symbol>';
}));
await writeFile(new URL('sprite.svg', output), '<svg xmlns="http://www.w3.org/2000/svg">' + symbols.join('\n') + '</svg>');
console.log(`Exported ${Object.keys(icons).length} icons in ${variants.length} styles (${Object.keys(icons).length * variants.length} SVGs) and the sprite.`);
