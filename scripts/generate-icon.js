'use strict';

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const OUT_DIR = path.join(__dirname, '..', 'assets', 'icons');
fs.mkdirSync(OUT_DIR, { recursive: true });

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  const s = size / 1024; // scale factor

  // ── 背景：角丸正方形 ──────────────────────────
  const radius = 180 * s;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.arcTo(size, 0, size, radius, radius);
  ctx.lineTo(size, size - radius);
  ctx.arcTo(size, size, size - radius, size, radius);
  ctx.lineTo(radius, size);
  ctx.arcTo(0, size, 0, size - radius, radius);
  ctx.lineTo(0, radius);
  ctx.arcTo(0, 0, radius, 0, radius);
  ctx.closePath();
  ctx.fillStyle = '#0d0d1f';
  ctx.fill();

  // ── グラデーションオーバーレイ ─────────────────
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, 'rgba(255,255,255,0.05)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fill();

  // ── ハブ＆スポーク ────────────────────────────
  const cx = size / 2;
  const cy = size / 2;
  const hubR = 32 * s;
  const spokeLen = 160 * s;
  const smallR = 18 * s;
  const tinyLen = 60 * s;
  const tinyR = 8 * s;

  const spokeAngles = [
    -Math.PI / 2,          // 上
    -Math.PI / 6,          // 右上
    Math.PI / 6,           // 右下
    Math.PI / 2,           // 下
    Math.PI * 5 / 6,       // 左下
    -Math.PI * 5 / 6,      // 左上
  ];

  const smallColors = [
    '#ffffff', // 上
    '#6677ff', // 右上
    '#4455ff', // 右下
    '#ffffff', // 下
    '#6677ff', // 左下
    '#4455ff', // 左上
  ];

  // スポーク線
  ctx.lineWidth = 2.5 * s;
  ctx.strokeStyle = 'rgba(68,85,255,0.7)';
  for (const angle of spokeAngles) {
    const ex = cx + Math.cos(angle) * spokeLen;
    const ey = cy + Math.sin(angle) * spokeLen;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }

  // 外周の小円と更に外の細線・極小円
  for (let i = 0; i < spokeAngles.length; i++) {
    const angle = spokeAngles[i];
    const ex = cx + Math.cos(angle) * spokeLen;
    const ey = cy + Math.sin(angle) * spokeLen;

    // 外方向の細線
    const ex2 = ex + Math.cos(angle) * tinyLen;
    const ey2 = ey + Math.sin(angle) * tinyLen;
    ctx.lineWidth = 1.5 * s;
    ctx.strokeStyle = 'rgba(68,85,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex2, ey2);
    ctx.stroke();

    // 極小円
    ctx.beginPath();
    ctx.arc(ex2, ey2, tinyR, 0, Math.PI * 2);
    ctx.fillStyle = '#8899ff';
    ctx.fill();

    // 小円
    ctx.beginPath();
    ctx.arc(ex, ey, smallR, 0, Math.PI * 2);
    ctx.fillStyle = smallColors[i];
    ctx.fill();
  }

  // 中央ハブ円
  ctx.beginPath();
  ctx.arc(cx, cy, hubR, 0, Math.PI * 2);
  ctx.fillStyle = '#4455ff';
  ctx.fill();
  ctx.lineWidth = 2 * s;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();

  // 中央の「O」テキスト
  if (size >= 32) {
    const fontSize = Math.max(10, Math.round(28 * s));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('O', cx, cy);
  }

  return canvas;
}

for (const size of SIZES) {
  const canvas = drawIcon(size);
  const outName = size === 1024 ? 'icon.png' : `${size}x${size}.png`;
  const outPath = path.join(OUT_DIR, outName);
  // also save 1024x1024 as 1024x1024.png
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buf);
  if (size === 1024) {
    fs.writeFileSync(path.join(OUT_DIR, '1024x1024.png'), buf);
  }
  console.log(`✓ ${outPath}`);
}

console.log('Done! Icons generated in assets/icons/');
