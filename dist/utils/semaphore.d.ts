export declare class Semaphore {
    private max;
    private counter;
    private waiting;
    private abortSignal;
    constructor(max: number, abortSignal?: AbortSignal);
    private take;
    acquire(): Promise<void>;
    release(): void;
    withSemaphore<T>(fn: () => Promise<T>, onTiming?: (ms: number) => void): Promise<T>;
    withRetrySemaphore<T>(fn: () => Promise<T>, onTiming?: (ms: number) => void, retries?: number): Promise<T>;
}
//# sourceMappingURL=semaphore.d.ts.map