/** Schedule at most one callback per animation frame. */
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
        if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(run);
        }
    }) as T;
}

/** Debounce with optional leading edge suppression. */
export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return ((...args: Parameters<T>) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    }) as T;
}
