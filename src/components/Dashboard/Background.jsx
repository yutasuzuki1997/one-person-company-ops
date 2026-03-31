import { useEffect, useRef } from 'react';

const PARTICLE_COUNT = 80;

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function createParticle(w, h) {
  return {
    x: randomBetween(0, w),
    y: randomBetween(0, h),
    vy: randomBetween(0.1, 0.4),
    vx: randomBetween(-0.1, 0.1),
    size: randomBetween(1, 3),
    alpha: randomBetween(0.2, 0.6),
    r: Math.floor(randomBetween(80, 140)),
    g: Math.floor(randomBetween(120, 200)),
    b: Math.floor(randomBetween(220, 255)),
  };
}

export default function Background() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;
    let particles = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      particles = Array.from({ length: PARTICLE_COUNT }, () =>
        createParticle(canvas.width, canvas.height)
      );
    }

    function draw() {
      const { width: w, height: h } = canvas;

      // 背景グラデーション
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#0a0a1a');
      grad.addColorStop(1, '#1a1a2e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // パーティクル
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${p.alpha})`;
        ctx.fill();

        p.y -= p.vy;
        p.x += p.vx;

        // 上端を超えたらリセット
        if (p.y < -p.size * 2) {
          p.y = h + p.size;
          p.x = randomBetween(0, w);
        }
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
      }

      animId = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: -1,
        display: 'block',
      }}
    />
  );
}
