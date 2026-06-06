import { Stats } from "@react-three/drei";
import { usePerformanceStore } from "@/stores/performance-store";

/** Optional FPS / GPU timing overlay (drei Stats). */
export function PerformanceMonitorOverlay() {
    const show = usePerformanceStore((s) => s.showPerformanceMonitor);
    if (!show) return null;
    return <Stats className="!left-auto !right-2 !top-auto !bottom-14" showPanel={0} />;
}
