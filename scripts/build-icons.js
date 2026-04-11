#!/usr/bin/env node
// Converts assets/central-tracking-icon.svg into platform icon files.
// Run once locally after changing the SVG, then commit the outputs:
//
//   npm run build:icons
//   git add assets/icon.png assets/mac/ assets/win/
//   git commit -m "Update app icons"
//
// Requires macOS to generate the .icns (uses built-in iconutil).

const { Resvg } = require('@resvg/resvg-js');
const toIco = require('png-to-ico');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'assets', 'central-tracking-icon.svg');
const svg = fs.readFileSync(svgPath);

function renderPng(size) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return resvg.render().asPng();
}

// Save a 1024px PNG for reference
fs.writeFileSync(path.join(root, 'assets', 'icon.png'), renderPng(1024));
console.log('  → assets/icon.png');

// macOS .icns via iconutil (macOS only)
if (process.platform === 'darwin') {
  console.log('Generating macOS icon...');
  const iconsetDir = path.join(root, 'assets', 'icon.iconset');
  fs.mkdirSync(iconsetDir, { recursive: true });

  for (const [size, name] of [
    [16,   'icon_16x16.png'],
    [32,   'icon_16x16@2x.png'],
    [32,   'icon_32x32.png'],
    [64,   'icon_32x32@2x.png'],
    [128,  'icon_128x128.png'],
    [256,  'icon_128x128@2x.png'],
    [256,  'icon_256x256.png'],
    [512,  'icon_256x256@2x.png'],
    [512,  'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ]) {
    fs.writeFileSync(path.join(iconsetDir, name), renderPng(size));
  }

  fs.mkdirSync(path.join(root, 'assets', 'mac'), { recursive: true });
  execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(root, 'assets', 'mac', 'icon.icns')}"`);
  fs.rmSync(iconsetDir, { recursive: true });
  console.log('  → assets/mac/icon.icns');
} else {
  console.log('Skipping .icns — run on macOS to generate assets/mac/icon.icns');
}

// Windows .ico
console.log('Generating Windows icon...');
fs.mkdirSync(path.join(root, 'assets', 'win'), { recursive: true });
toIco([16, 32, 48, 256].map(renderPng))
  .then(buf => {
    fs.writeFileSync(path.join(root, 'assets', 'win', 'icon.ico'), buf);
    console.log('  → assets/win/icon.ico');
    console.log('Done. Commit assets/icon.png, assets/mac/, and assets/win/');
  });
