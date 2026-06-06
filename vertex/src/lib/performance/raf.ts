/** Coalesce rapid callbacks to one invocation per animation frame. */
export function rafThrottle<T extends (...args: never[]) => void>(fn: T): T {
    let scheduled = false;
    let lastArgs: Parameters<T> | null = null;

    const run = () => {
        scheduled = false;
        if (lastArgs) fn(...lastArgs);
        lastArgs = null;
    };

    return ((...args: Parameters<T>) => {
        lastArgs = args;
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(run);
    }) as T;
}

/** Debounce trailing-edge invocations (e.g. idle full-quality rebuild). */
export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return ((...args: Parameters<T>) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, ms);
    }) as T;
}
