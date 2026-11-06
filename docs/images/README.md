# Demo captures

These PNGs show actual output from source commit `c146f51`, captured on
2026-11-06 after `pnpm run build`. They are terminal-output rasterizations,
not native terminal-window screenshots or concept mockups.

| Image           | Capture command and state                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashboard.png` | `node dist/cli/main.js view examples/markup/service-command-center.teml --theme dark --width 100 --color`; excerpt ending after the service-health table |
| `chat.png`      | `node examples/apps/chat/deepseek-chat.mjs --mock --theme dark`; 88 columns; send “Show me what TeML can render.” and wait for completion                |
| `snake.png`     | `node examples/apps/snake/game.mjs`; 68 columns; press P to pause; food placement varies per run                                                         |

Apps ran through a pseudoterminal with truecolor enabled. The final complete
ANSI frame was rendered to PNG with Pillow and Menlo at 20 px, 12 × 24 px cells,
and a dark terminal palette. The title strip identifies each capture; text,
layout, and canvas pixels come from the demo output. Terminal restoration was
checked after exit. No API credentials or external chat service were used.

Keep these assets in the repository only; they are not copied into `dist/`.
When refreshing them, capture current output and inspect every image before
updating the gallery. Preserve the mock-data and excerpt labels.
