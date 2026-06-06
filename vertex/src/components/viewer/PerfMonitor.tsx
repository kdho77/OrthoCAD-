import { Stats } from "@react-three/drei";

/** Lightweight FPS / MS / MB overlay (toggle from viewer settings). */
export function PerfMonitor() {
    return <Stats className="!left-auto !right-3 !top-14" showPanel={0} />;
}
