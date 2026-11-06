// PROTOTYPE: can a pure JavaScript state machine driven at game speed feel
// playable when TeML re-renders the complete board on every tick?
// This module deliberately has no terminal or TeML dependencies.

export const BOARD_WIDTH = 24;
export const BOARD_HEIGHT = 12;

const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

function freeCells(snake, width, height) {
  const occupied = new Set(snake.map((cell) => `${cell.x},${cell.y}`));
  const cells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!occupied.has(`${x},${y}`)) cells.push({ x, y });
    }
  }
  return cells;
}

function spawnFood(state, rng) {
  const available = freeCells(state.snake, state.width, state.height);
  if (available.length === 0) return null;
  const index = Math.min(available.length - 1, Math.floor(rng() * available.length));
  return available[index];
}

export function createGame({ width = BOARD_WIDTH, height = BOARD_HEIGHT, rng = Math.random } = {}) {
  const y = Math.floor(height / 2);
  const x = Math.floor(width / 2);
  const state = {
    width,
    height,
    snake: [
      { x, y },
      { x: x - 1, y },
      { x: x - 2, y },
    ],
    direction: "right",
    pendingDirection: "right",
    food: null,
    score: 0,
    ticks: 0,
    status: "running",
  };
  state.food = spawnFood(state, rng);
  return state;
}

export function changeDirection(state, direction) {
  if (!(direction in DIRECTIONS) || state.status === "game-over") return state;
  if (state.pendingDirection !== state.direction) return state;
  if (OPPOSITE[state.direction] === direction) return state;
  return { ...state, pendingDirection: direction };
}

export function togglePause(state) {
  if (state.status === "running") return { ...state, status: "paused" };
  if (state.status === "paused") return { ...state, status: "running" };
  return state;
}

export function stepGame(state, rng = Math.random) {
  if (state.status !== "running") return state;
  const direction = state.pendingDirection;
  const delta = DIRECTIONS[direction];
  const head = state.snake[0];
  const next = { x: head.x + delta.x, y: head.y + delta.y };
  const eating = state.food?.x === next.x && state.food?.y === next.y;
  const body = eating ? state.snake : state.snake.slice(0, -1);
  const collision =
    next.x < 0 ||
    next.y < 0 ||
    next.x >= state.width ||
    next.y >= state.height ||
    body.some((cell) => cell.x === next.x && cell.y === next.y);
  if (collision) return { ...state, direction, status: "game-over" };

  const nextState = {
    ...state,
    snake: [next, ...body],
    direction,
    food: eating ? null : state.food,
    score: state.score + (eating ? 10 : 0),
    ticks: state.ticks + 1,
  };
  if (eating) {
    nextState.food = spawnFood(nextState, rng);
    if (!nextState.food) nextState.status = "won";
  }
  return nextState;
}
