// Host-side full/patch frame reconstruction shared by the JavaScript
// reference host and its tests. It deliberately depends on no TeML internals:
// this is the complete algorithm another language's host must implement.

const FRAME_FORMATS = new Set(["ansi", "plain"]);

export function createFrameState(preferred = "ansi") {
  if (!FRAME_FORMATS.has(preferred)) {
    throw new Error(`preferred frame format must be "ansi" or "plain" (got ${preferred})`);
  }
  return {
    preferred,
    rows: [],
    lastSeq: 0,
    focusedId: null,
    viewport: null,
    scrollRegions: [],
    protocol: null,
    capabilities: [],
  };
}

function splitRows(rendered) {
  if (rendered === "") return [];
  const withoutFinalNewline = rendered.endsWith("\n") ? rendered.slice(0, -1) : rendered;
  return withoutFinalNewline.split("\n");
}

function payload(record, preferred) {
  return record[preferred] ?? record.ansi ?? record.plain ?? null;
}

function readViewport(frame, rowCount) {
  if (frame.viewport == null) return null;
  const { offset, height, total } = frame.viewport;
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(height) ||
    !Number.isInteger(total) ||
    offset < 0 ||
    height < 1 ||
    total < height ||
    offset + height > total ||
    height !== rowCount
  ) {
    throw new Error("invalid frame viewport");
  }
  return { offset, height, total };
}

function readScrollRegions(frame) {
  if (frame.scrollRegions == null) return [];
  if (!Array.isArray(frame.scrollRegions)) throw new Error("invalid frame scrollRegions");
  return frame.scrollRegions.map((region) => {
    const { id, offset, height, total } = region ?? {};
    if (
      typeof id !== "string" ||
      !Number.isInteger(offset) ||
      !Number.isInteger(height) ||
      !Number.isInteger(total) ||
      offset < 0 ||
      height < 1 ||
      total < 0 ||
      offset > Math.max(0, total - height)
    ) {
      throw new Error("invalid frame scroll region");
    }
    return { id, offset, height, total };
  });
}

export function applyFrame(state, frame) {
  if (frame?.type !== "frame" || !Number.isInteger(frame.seq) || frame.seq < 1) {
    throw new Error("invalid frame event");
  }
  if (frame.seq <= state.lastSeq) {
    throw new Error(`non-monotonic frame sequence: ${frame.seq} after ${state.lastSeq}`);
  }

  if (Array.isArray(frame.patches)) {
    if (state.lastSeq === 0) throw new Error("patch frame arrived before a full frame");
    if (frame.seq !== state.lastSeq + 1) {
      throw new Error(`patch frame sequence gap: expected ${state.lastSeq + 1}, got ${frame.seq}`);
    }
    if (!Number.isInteger(frame.rows) || frame.rows < 0) {
      throw new Error("patch frame needs a non-negative rows count");
    }

    for (const patch of frame.patches) {
      if (!Number.isInteger(patch.row) || patch.row < 0 || patch.row >= frame.rows) {
        throw new Error(`patch row ${patch.row} is outside the ${frame.rows}-row frame`);
      }
      const text = payload(patch, state.preferred);
      if (text === null) throw new Error(`patch row ${patch.row} has no usable payload`);
      state.rows[patch.row] = text;
    }
    state.rows.length = frame.rows;
  } else {
    const rendered = payload(frame, state.preferred);
    if (rendered === null) throw new Error("full frame has no usable payload");
    state.rows = splitRows(rendered);
  }

  state.viewport = readViewport(frame, state.rows.length);
  state.scrollRegions = readScrollRegions(frame);
  state.focusedId = typeof frame.focusedId === "string" ? frame.focusedId : null;
  if (
    frame.protocol &&
    Number.isInteger(frame.protocol.major) &&
    Number.isInteger(frame.protocol.minor)
  ) {
    state.protocol = { major: frame.protocol.major, minor: frame.protocol.minor };
  }
  if (Array.isArray(frame.capabilities)) {
    state.capabilities = frame.capabilities.filter((value) => typeof value === "string");
  }
  state.lastSeq = frame.seq;
  return state;
}

export function frameText(state) {
  return state.rows.join("\n");
}
