#!/usr/bin/env node
// PROTOTYPE: host-driven animation through the shared canvas operation protocol.
import { readFileSync } from "node:fs";
import { runInteractiveApp } from "../../../dist/interactive/host.js";

if (!process.stdin.isTTY) {
  process.stderr.write("canvas-animation: run directly in a real terminal.\n");
  process.exit(1);
}

const particles = [
  { x: 2, y: 2, dx: 1, dy: 1, color: "#50fa7b" },
  { x: 36, y: 10, dx: -1, dy: -1, color: "#ff5555" },
  { x: 20, y: 4, dx: 1, dy: -1, color: "#8be9fd" },
];
let timer;

try {
  await runInteractiveApp(readFileSync(new URL("./animation.html", import.meta.url), "utf8"), {
    format: "html",
    mouse: false,
    handlers: {
      onReady(ctx) {
        const canvas = ctx.canvas("game");
        timer = setInterval(() => {
          canvas.clear();
          for (const particle of particles) {
            if (particle.x <= 0 || particle.x >= 46) particle.dx *= -1;
            if (particle.y <= 0 || particle.y >= 14) particle.dy *= -1;
            particle.x += particle.dx;
            particle.y += particle.dy;
            canvas.fillStyle(particle.color);
            canvas.fillRect(particle.x, particle.y, 2, 2);
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
