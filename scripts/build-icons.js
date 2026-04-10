#!/usr/bin/env node
// Converts assets/central-tracking-icon-v2.svg → assets/icon.png,
// then generates assets/mac/icon.icns and assets/win/icon.ico.
//
// Run once locally after updating the SVG, then commit the outputs:
//   npm run build:icons
//   git add assets/icon.png assets/mac assets/win
//   git commit -m "Update app icons"

const { Resvg } = require('@resvg/resvg-js');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'assets', 'central-tracking-icon-v2.svg');
const pngPath = path.join(root, 'assets', 'icon.png');

// Rasterize SVG → 1024×1024 PNG
console.log('Rasterizing SVG...');
const svg = fs.readFileSync(svgPath);
const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } });
const rendered = resvg.render();
fs.writeFileSync(pngPath, rendered.asPng());
console.log('  → assets/icon.png');

// Generate .icns and .ico from the PNG
console.log('Generating platform icons...');
execSync(
  `npx electron-icon-builder --input="${pngPath}" --output="${path.join(root, 'assets')}"`,
  { stdio: 'inherit', cwd: root }
);
console.log('  → assets/mac/icon.icns');
console.log('  → assets/win/icon.ico');
console.log('Done. Commit assets/icon.png, assets/mac/, and assets/win/');
