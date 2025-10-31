export class Semaphore {
    max;
    counter = 0;
    waiting = [];
    abortSignal;
    constructor(max, abortSignal) {
        this.max = max;
        this.abortSignal = abortSignal || new AbortController().signal;
    }
    take() {
        if (this.waiting.length > 0 && this.counter < this.max) {
            this.counter++;
            const w = this.waiting.shift();
            w && w.resolve();
        }
    }
    acquire() {
        if (this.counter < this.max) {
            this.counter++;
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            this.waiting.push({ resolve, reject });
        });
    }
    release() {
        this.counter--;
        this.take();
    }
    async withSemaphore(fn, onTiming) {
        await this.acquire();
        const start = Date.now();
        try {
            if (this.abortSignal.aborted)
                return Promise.reject("Aborted");
            return await fn();
        }
        finally {
            this.release();
            if (onTiming)
                onTiming(Date.now() - start);
        }
    }
    async withRetrySemaphore(fn, onTiming, retries = 3) {
        if (this.abortSignal.aborted)
            return Promise.reject("Aborted");
        for (let i = 1; i < retries; i++) {
            try {
                return await this.withSemaphore(fn, onTiming);
            }
            catch {
                await new Promise((r) => setTimeout(r, 200 * i));
            }
        }
        return this.withSemaphore(fn, onTiming);
    }
}
//# sourceMappingURL=semaphore.js.map