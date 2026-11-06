#!/usr/bin/env node
// PROTOTYPE: a neon fireworks scene drawn entirely with canvas fillRect calls.
import { readFileSync } from "node:fs";
import { runInteractiveApp } from "../../../dist/interactive/host.js";

if (!process.stdin.isTTY) {
  process.stderr.write("canvas-fireworks: run directly in a real terminal.\n");
  process.exit(1);
}

let seed = 0x5eed;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}

const stars = Array.from({ length: 22 }, () => ({
  x: Math.floor(random() * 48),
  y: Math.floor(random() * 15),
  color: random() > 0.5 ? "#444466" : "#333344",
}));
const palette = ["#ff5555", "#50fa7b", "#8be9fd", "#f1fa8c", "#bd93f9", "#ff79c6"];
const rockets = [];
const particles = [];
let frame = 0;
let timer;

function explode(rocket) {
  for (let index = 0; index < 32; index += 1) {
    const angle = (Math.PI * 2 * index) / 32 + random() * 0.2;
    const speed = 0.25 + random() * 0.65;
    particles.push({
      x: rocket.x,
      y: rocket.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: rocket.color,
      life: 12 + Math.floor(random() * 12),
    });
  }
}

try {
  await runInteractiveApp(readFileSync(new URL("./animation.html", import.meta.url), "utf8"), {
    format: "html",
    mouse: false,
    handlers: {
      onReady(ctx) {
        const canvas = ctx.canvas("game");
        timer = setInterval(() => {
          frame += 1;
          canvas.clear();

          for (const star of stars) {
            canvas.fillStyle(star.color);
            canvas.fillRect(star.x, star.y, 1, 1);
          }

          if (frame % 32 === 0) {
            rockets.push({
              x: 5 + random() * 38,
              y: 15,
              target: 2 + random() * 5,
              color: palette[Math.floor(random() * palette.length)],
            });
          }

          for (let index = rockets.length - 1; index >= 0; index -= 1) {
            const rocket = rockets[index];
            rocket.y -= 0.45;
            canvas.fillStyle("#aaaaaa");
            canvas.fillRect(Math.round(rocket.x), Math.min(15, Math.round(rocket.y + 1)), 1, 1);
            canvas.fillStyle(rocket.color);
            canvas.fillRect(Math.round(rocket.x), Math.round(rocket.y), 1, 1);
            if (rocket.y <= rocket.target) {
              explode(rocket);
              rockets.splice(index, 1);
            }
          }

          for (let index = particles.length - 1; index >= 0; index -= 1) {
            const particle = particles[index];
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.vy += 0.025;
            particle.life -= 1;
            if (particle.life <= 0 || particle.x < 0 || particle.x > 47 || particle.y > 15) {
              particles.splice(index, 1);
              continue;
            }
            canvas.fillStyle(particle.life < 6 ? "#666666" : particle.color);
            canvas.fillRect(Math.round(particle.x), Math.round(particle.y), 1, 1);
          }
          canvas.present();
        }, 66);
      },
      onChar(char, ctx) {
        if (char.toLowerCase() === "q") ctx.exit();
      },
    },
  });
} finally {
  if (timer) clearInterval(timer);
}
