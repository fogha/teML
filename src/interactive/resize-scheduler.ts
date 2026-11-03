export type ResizeDimensions = {
  width: number;
  height: number;
};

const RESIZE_REDRAW_INTERVAL_MS = 34;

function sameDimensions(left: ResizeDimensions | undefined, right: ResizeDimensions): boolean {
  return left?.width === right.width && left.height === right.height;
}

export class LatestResizeScheduler {
  private pending: ResizeDimensions | undefined;
  private lastSent: ResizeDimensions | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextSendAt = 0;
  private inFlight = false;
  private stopped = false;

  constructor(private readonly send: (dimensions: ResizeDimensions) => void) {}

  request(dimensions: ResizeDimensions): void {
    if (this.stopped) return;
    if (sameDimensions(this.lastSent, dimensions)) {
      this.pending = undefined;
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      return;
    }
    this.pending = { ...dimensions };
    this.schedule();
  }

  complete(): void {
    if (this.stopped || !this.inFlight) return;
    this.inFlight = false;
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    this.pending = undefined;
    this.inFlight = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (this.stopped || this.inFlight || !this.pending || this.timer) return;
    const delay = Math.max(0, this.nextSendAt - Date.now());
    if (delay === 0) {
      this.flush();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, delay);
  }

  private flush(): void {
    if (this.stopped || this.inFlight || !this.pending) return;
    const next = this.pending;
    this.pending = undefined;
    this.lastSent = next;
    this.inFlight = true;
    this.nextSendAt = Date.now() + RESIZE_REDRAW_INTERVAL_MS;
    this.send(next);
  }
}
