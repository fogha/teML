const PALETTE = {
  boardA: "#10151d",
  boardB: "#161d26",
  border: "#285e68",
  corner: "#8be9fd",
  head: "#50fa7b",
  body: "#2aa198",
  eye: "#0b0f14",
  food: "#ff5555",
  foodHighlight: "#ffb86c",
};

const STATUS_LABELS = {
  running: "Running",
  paused: "Paused",
  "game-over": "Game over",
  won: "You win",
};

const EYE_OFFSETS = {
  right: { x: 1, y: 0 },
  left: { x: 0, y: 0 },
  up: { x: 0, y: 0 },
  down: { x: 0, y: 1 },
};

export function snakeView(state) {
  const operations = [{ op: "clear" }];
  const rect = (x, y, width, height) => operations.push({ op: "fillRect", x, y, width, height });
  const color = (value) => operations.push({ op: "fillStyle", color: value });
  const cell = (x, y, value) => {
    color(value);
    rect(x * 2 + 1, y * 2 + 1, 2, 2);
  };

  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      cell(x, y, (x + y) % 2 === 0 ? PALETTE.boardA : PALETTE.boardB);
    }
  }

  color(PALETTE.border);
  rect(0, 0, 48, 1);
  rect(0, 23, 48, 1);
  rect(0, 0, 1, 24);
  rect(47, 0, 1, 24);
  color(PALETTE.corner);
  rect(0, 0, 1, 1);
  rect(47, 0, 1, 1);
  rect(0, 23, 1, 1);
  rect(47, 23, 1, 1);

  if (state.food) {
    const x = state.food.x * 2 + 1;
    const y = state.food.y * 2 + 1;
    color(PALETTE.food);
    rect(x, y, 2, 2);
    color(PALETTE.foodHighlight);
    rect(x + 1, y + 1, 1, 1);
  }

  for (const cellState of state.snake.slice(1)) cell(cellState.x, cellState.y, PALETTE.body);
  const head = state.snake[0];
  cell(head.x, head.y, PALETTE.head);
  const eye = EYE_OFFSETS[state.direction] ?? EYE_OFFSETS.right;
  color(PALETTE.eye);
  rect(head.x * 2 + 1 + eye.x, head.y * 2 + 1 + eye.y, 1, 1);

  return {
    score: String(state.score).padStart(4, "0"),
    status: STATUS_LABELS[state.status] ?? state.status,
    operations,
  };
}
