// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { Box, Rotate3d } from "lucide-react";
import { type PointerEvent, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ballBandGeometry, contourLegend } from "@/lib/cnc/band";
import { evaluateAllPlacements, placeWorkpieces, transformOutline, worldPoint } from "@/lib/cnc/placement";
import { bboxOf } from "@/lib/cnc/polygon";
import { reconcileMillingProfile, toolRadiusMm } from "@/lib/cnc/profile";
import type { MillingProfile, PlacedPart, Point } from "@/lib/cnc/types";
import { cn } from "@/lib/utils";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { type MillTableViewMode, useMillingProfileStore } from "@/stores/milling-profile-store";
import type { Side } from "@/types";
import { MillOrbitCanvas } from "./MillOrbitCanvas";
import { useMillWorkpieces } from "./use-mill-workpieces";

function svgPath(pts: Point[]): string {
    if (pts.length < 2) return "";
    return `M ${pts.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(" L ")} Z`;
}

function clientToView(svg: SVGSVGElement, clientX: number, clientY: number): Point | null {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
}

function pointInPoly(x: number, y: number, poly: Point[]): boolean {
    let inside = false;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const pa = poly[a];
        const pb = poly[b];
        if (!pa || !pb) continue;
        if (pa.y > y !== pb.y > y && x < ((pb.x - pa.x) * (y - pa.y)) / (pb.y - pa.y + 1e-18) + pa.x) {
            inside = !inside;
        }
    }
    return inside;
}

function hitPart(x: number, y: number, placed: PlacedPart[]): PlacedPart | null {
    for (let i = placed.length - 1; i >= 0; i--) {
        const part = placed[i];
        if (!part) continue;
        if (pointInPoly(x, y, transformOutline(part.outline, part))) return part;
    }
    return null;
}

function handleLocal(part: PlacedPart): Point {
    const bb = bboxOf(part.outline);
    return { x: bb.maxX + 12, y: part.cy };
}

function handleWorld(part: PlacedPart): Point {
    return worldPoint(handleLocal(part), part);
}

function partFill(invalid: boolean, selected: boolean, opaque = false): string {
    if (invalid) return opaque ? "rgb(239 68 68 / 0.7)" : "rgb(239 68 68 / 0.45)";
    if (selected) return opaque ? "rgb(74 222 128 / 0.95)" : "rgb(74 222 128 / 0.9)";
    return opaque ? "rgb(228 228 231 / 0.98)" : "rgb(212 212 216 / 0.92)";
}

function partStroke(invalid: boolean, selected: boolean): string {
    if (invalid) return "#ef4444";
    if (selected) return "#4ade80";
    return "#a1a1aa";
}

function worldLoop(pts: Point[], part: PlacedPart): Point[] {
    return pts.map((p) => worldPoint(p, part));
}

function ringPath(outer: Point[], inner: Point[]): string {
    if (outer.length < 3) return "";
    const fwd = svgPath(outer);
    if (inner.length < 3) return fwd;
    return `${fwd} ${svgPath(inner.slice().reverse())}`;
}

function labelAt(pts: Point[], part: PlacedPart, text: string, fill: string) {
    if (pts.length === 0) return null;
    let heel = pts[0]!;
    for (const p of pts) if (p.x < heel.x) heel = p;
    const w = worldPoint(heel, part);
    return (
        <text
            x={0}
            y={0}
            transform={`translate(${(w.x + 2).toFixed(2)} ${(w.y + 3).toFixed(2)}) scale(1 -1)`}
            fontSize="3.1"
            fill={fill}
        >
            {text}
        </text>
    );
}

function InsoleGraphic({
    part,
    profile,
    selected,
    invalid,
}: {
    part: PlacedPart;
    profile: MillingProfile;
    selected: boolean;
    invalid: boolean;
}) {
    const band = ballBandGeometry(
        part.outline,
        toolRadiusMm(profile.contourCutter.diameterMm),
        profile.chordTolMm,
        profile.topOffsetMm,
    );
    const outer = worldLoop(band.outerEdge, part);
    const inner = worldLoop(band.innerEdge, part);
    const centre = worldLoop(band.centreline, part);
    const knife = worldLoop(band.knifeLine, part);
    const overrun = worldLoop(band.overrunEdge, part);
    const fill = partFill(invalid, selected);
    const stroke = partStroke(invalid, selected);
    const handle = selected ? handleWorld(part) : null;
    return (
        <g>
            {outer.length > 2 ? (
                <path
                    d={ringPath(outer, inner)}
                    fill="#0f172a"
                    fillOpacity={0.78}
                    fillRule="evenodd"
                    stroke="#94a3b8"
                    strokeWidth={0.25}
                />
            ) : null}
            {overrun.length > 2 ? (
                <path
                    d={ringPath(overrun, knife)}
                    fill="#e7e5e4"
                    fillOpacity={0.72}
                    fillRule="evenodd"
                    stroke="none"
                />
            ) : null}
            <path d={svgPath(knife)} fill={fill} stroke="#f8fafc" strokeWidth={0.4} />
            {centre.length > 2 ? (
                <path
                    d={svgPath(centre)}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth={0.28}
                    strokeDasharray="1.4 0.9"
                />
            ) : null}
            {band.uncutCorners.map((corner) => (
                <path
                    key={`uncut-${part.side}-${corner.deviationMm.toFixed(3)}-${corner.points[0]?.x.toFixed(2)}`}
                    d={svgPath(worldLoop(corner.points, part))}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth={0.85}
                />
            ))}
            {labelAt(band.knifeLine, part, "knife line", "#f8fafc")}
            {band.uncutCorners[0]
                ? labelAt(band.uncutCorners[0].points, part, "uncut corner", "#fbbf24")
                : null}
            {handle ? (
                <g>
                    <line
                        x1={part.cx + part.tx}
                        y1={part.cy + part.ty}
                        x2={handle.x}
                        y2={handle.y}
                        stroke={stroke}
                        strokeWidth={0.7}
                    />
                    <circle
                        cx={handle.x}
                        cy={handle.y}
                        r={5}
                        fill={stroke}
                        stroke="#18181b"
                        strokeWidth={0.6}
                    />
                </g>
            ) : null}
        </g>
    );
}

type DragState =
    | { kind: "move"; side: Side; x: number; y: number; tx: number; ty: number; rotationDeg: number }
    | {
          kind: "rotate";
          side: Side;
          cx: number;
          cy: number;
          startAngle: number;
          startRot: number;
          tx: number;
          ty: number;
      };

export function MillTableView() {
    const { parts, loading } = useMillWorkpieces();
    const rawProfile = useMillingProfileStore((s) => s.profile);
    const profile = useMemo(() => reconcileMillingProfile(rawProfile), [rawProfile]);
    const placements = useMillingProfileStore((s) => s.placements);
    const millView = useMillingProfileStore((s) => s.millView);
    const millSelected = useMillingProfileStore((s) => s.millSelected);
    const setMillView = useMillingProfileStore((s) => s.setMillView);
    const setMillSelected = useMillingProfileStore((s) => s.setMillSelected);
    const setProfile = useMillingProfileStore((s) => s.setProfile);
    const patchPlacement = useMillingProfileStore((s) => s.patchPlacement);
    const svgRef = useRef<SVGSVGElement>(null);
    const drag = useRef<DragState | null>(null);
    const pointerIdRef = useRef<number | null>(null);

    const releaseDragCapture = (pointerId?: number) => {
        drag.current = null;
        const svg = svgRef.current;
        const id = pointerId ?? pointerIdRef.current;
        pointerIdRef.current = null;
        if (!svg || id == null) return;
        try {
            if (svg.hasPointerCapture(id)) svg.releasePointerCapture(id);
        } catch {
            /* already released on unmount */
        }
    };

    const selectSide = (side: Side | null) => {
        setMillSelected(side);
        if (side && !useClinicalWorkflowStore.getState().footSideExplicitlyChosen) {
            useClinicalWorkflowStore.getState().acknowledgeExplicitFootSide(side);
        }
    };

    const changeView = (view: MillTableViewMode) => {
        releaseDragCapture();
        setMillView(view);
    };

    useEffect(() => {
        if (
            rawProfile.tableWidthMm !== profile.tableWidthMm ||
            rawProfile.tableLengthMm !== profile.tableLengthMm ||
            rawProfile.pockets.length !== profile.pockets.length
        ) {
            setProfile(profile);
        }
    }, [rawProfile, profile, setProfile]);

    const placed = useMemo(() => {
        try {
            return placeWorkpieces(profile, parts, placements, { validate: false });
        } catch {
            return [];
        }
    }, [profile, parts, placements]);

    const issues = useMemo(() => evaluateAllPlacements(placed, profile), [placed, profile]);

    const tw = profile.tableWidthMm;
    const tl = profile.tableLengthMm;
    const h = profile.materialHeightMm;

    const toTable = (clientX: number, clientY: number): Point | null => {
        const svg = svgRef.current;
        if (!svg) return null;
        const p = clientToView(svg, clientX, clientY);
        if (!p) return null;
        return { x: p.x, y: tl - p.y };
    };

    const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
        if (millView !== "top") return;
        const p = toTable(e.clientX, e.clientY);
        if (!p) return;
        const selected = placed.find((x) => x.side === millSelected);
        if (selected) {
            const handle = handleWorld(selected);
            if (Math.hypot(p.x - handle.x, p.y - handle.y) <= 8) {
                selectSide(selected.side);
                drag.current = {
                    kind: "rotate",
                    side: selected.side,
                    cx: selected.cx + selected.tx,
                    cy: selected.cy + selected.ty,
                    startAngle: Math.atan2(
                        p.y - (selected.cy + selected.ty),
                        p.x - (selected.cx + selected.tx),
                    ),
                    startRot: selected.rotationDeg,
                    tx: selected.tx,
                    ty: selected.ty,
                };
                pointerIdRef.current = e.pointerId;
                svgRef.current?.setPointerCapture(e.pointerId);
                return;
            }
        }
        const hit = hitPart(p.x, p.y, placed);
        if (!hit) {
            selectSide(null);
            return;
        }
        selectSide(hit.side);
        drag.current = {
            kind: "move",
            side: hit.side,
            x: p.x,
            y: p.y,
            tx: hit.tx,
            ty: hit.ty,
            rotationDeg: hit.rotationDeg,
        };
        pointerIdRef.current = e.pointerId;
        svgRef.current?.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
        if (!drag.current || millView !== "top") return;
        const p = toTable(e.clientX, e.clientY);
        if (!p) return;
        const d = drag.current;
        if (d.kind === "move") {
            patchPlacement(d.side, {
                tx: d.tx + (p.x - d.x),
                ty: d.ty + (p.y - d.y),
                rotationDeg: d.rotationDeg,
            });
            return;
        }
        const ang = Math.atan2(p.y - d.cy, p.x - d.cx);
        const delta = ((ang - d.startAngle) * 180) / Math.PI;
        patchPlacement(d.side, {
            tx: d.tx,
            ty: d.ty,
            rotationDeg: d.startRot + delta,
        });
    };

    const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
        releaseDragCapture(e.pointerId);
    };

    return (
        <div className="relative h-full w-full bg-[hsl(222_28%_7%)]">
            <nav className="absolute left-3 top-3 z-10 flex items-center gap-1" aria-label="Mill table views">
                <Button
                    type="button"
                    size="sm"
                    variant={millView === "top" ? "default" : "secondary"}
                    className="h-7 px-2"
                    onClick={() => changeView("top")}
                >
                    <Box className="h-3.5 w-3.5" />
                    Top
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={millView === "orbit" ? "default" : "secondary"}
                    className="h-7 px-2"
                    onClick={() => changeView("orbit")}
                >
                    <Rotate3d className="h-3.5 w-3.5" />
                    Orbit
                </Button>
            </nav>
            <div className="pointer-events-none absolute left-3 top-12 z-10">
                <span className="w-fit rounded bg-panel/80 px-2 py-0.5 text-[11px] font-medium text-foreground shadow backdrop-blur">
                    {millView === "top" ? "Top" : "Orbit"} view
                </span>
            </div>
            {loading ? (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    Loading mill layout…
                </div>
            ) : millView === "orbit" ? (
                <div className="absolute inset-0 touch-none">
                    <MillOrbitCanvas
                        profile={profile}
                        placed={placed}
                        issues={issues}
                        millSelected={millSelected}
                        onSelect={selectSide}
                    />
                </div>
            ) : (
                <svg
                    ref={svgRef}
                    className="h-full w-full touch-none"
                    viewBox={`0 0 ${tw} ${tl}`}
                    aria-label="Milling table top view"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                >
                    <g transform={`translate(0 ${tl}) scale(1 -1)`}>
                        <rect x={0} y={0} width={tw} height={tl} fill="#52525b" />
                        {profile.pockets.map((pk) => (
                            <rect
                                key={`pk-${pk.x}-${pk.y}-${pk.width}-${pk.length}`}
                                x={pk.x}
                                y={pk.y}
                                width={pk.width}
                                height={pk.length}
                                fill="#3f3f46"
                                stroke="#d4d4d8"
                                strokeWidth={0.7}
                            />
                        ))}
                        {placed.map((part) => (
                            <InsoleGraphic
                                key={part.side}
                                part={part}
                                profile={profile}
                                selected={millSelected === part.side}
                                invalid={issues[part.side]?.ok === false}
                            />
                        ))}
                    </g>
                </svg>
            )}
            <div className="pointer-events-none absolute bottom-12 left-3 max-w-[340px] rounded bg-panel/85 px-2 py-1 text-[11px] leading-snug text-foreground shadow backdrop-blur">
                <p>{contourLegend(profile)}</p>
                <p className="mt-0.5 text-muted-foreground">
                    Dark band: R ball slot. Light band: {profile.topOffsetMm.toFixed(1)} mm overrun. Dashed:
                    centreline. Solid: knife line.
                </p>
            </div>
            <div
                className={cn(
                    "pointer-events-none absolute bottom-3 left-3 rounded bg-panel/80 px-2 py-0.5 text-[11px] text-foreground shadow backdrop-blur",
                )}
            >
                {tw.toFixed(1)} × {tl.toFixed(1)} × {h.toFixed(0)} mm
                {placed.length === 0 && !loading ? " · no insole geometry" : ""}
            </div>
        </div>
    );
}
