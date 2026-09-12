export class RateLimiter {
  private queue: (() => void)[] = [];
  private inFlight = 0;
  private maxConcurrent: number;
  private minDelayMs: number;
  private lastRequestTime = 0;

  constructor(maxConcurrent: number, minDelayMs: number) {
    this.maxConcurrent = maxConcurrent;
    this.minDelayMs = minDelayMs;
  }

  async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      const attempt = () => {
        const now = Date.now();
        const timeSinceLast = now - this.lastRequestTime;

        if (this.inFlight < this.maxConcurrent && timeSinceLast >= this.minDelayMs) {
          this.inFlight++;
          this.lastRequestTime = Date.now();
          resolve();
        } else {
          const waitTime = Math.max(
            this.minDelayMs - timeSinceLast,
            25
          );
          setTimeout(attempt, waitTime);
        }
      };

      this.queue.push(attempt);
      this.processQueue();
    });
  }

  async runExclusive<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  release(): void {
    this.inFlight--;
    this.processQueue();
  }

  private processQueue(): void {
    if (this.queue.length > 0 && this.inFlight < this.maxConcurrent) {
      const now = Date.now();
      const timeSinceLast = now - this.lastRequestTime;
      if (timeSinceLast >= this.minDelayMs) {
         const next = this.queue.shift();
         if (next) next();
      } else {
         setTimeout(() => this.processQueue(), this.minDelayMs - timeSinceLast);
      }
    }
  }
}

export const globalAiLimiter = new RateLimiter(5, 0); // Allow 5 concurrent with no forced delay
