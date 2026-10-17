// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Box, Rotate3d } from "lucide-react";
import { type PointerEvent, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { evaluatePlacedPart, placeWorkpieces, transformOutline, worldPoint } from "@/lib/cnc/placement";
import { bboxOf, offsetClosed } from "@/lib/cnc/polygon";
import type { PlacedPart, Point } from "@/lib/cnc/types";
import { cn } from "@/lib/utils";
import { useMillingProfileStore } from "@/stores/milling-profile-store";
import type { Side } from "@/types";
import { useMillWorkpieces } from "./use-mill-workpieces";

function svgPath(pts: Point[]): string {
    if (pts.length < 2) return "";
    return `M ${pts.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(" L ")} Z`;
}

function iso(x: number, y: number, z = 0): Point {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    return { x: (x - y) * c, y: (x + y) * s - z };
}

function isoPath(pts: Point[], z = 0): string {
    return svgPath(pts.map((p) => iso(p.x, p.y, z)));
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

function InsoleGraphic({
    part,
    profileTopOffset,
    selected,
    invalid,
}: {
    part: PlacedPart;
    profileTopOffset: number;
    selected: boolean;
    invalid: boolean;
}) {
    const world = transformOutline(part.outline, part);
    const ring = offsetClosed(world, profileTopOffset, 0.3);
    const fill = partFill(invalid, selected);
    const stroke = partStroke(invalid, selected);
    const handle = selected ? handleWorld(part) : null;
    return (
        <g>
            {ring.length > 2 ? (
                <path d={svgPath(ring)} fill="none" stroke={stroke} strokeWidth={0.6} opacity={0.85} />
            ) : null}
            <path d={svgPath(world)} fill={fill} stroke={stroke} strokeWidth={0.45} />
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
    const profile = useMillingProfileStore((s) => s.profile);
    const placements = useMillingProfileStore((s) => s.placements);
    const millView = useMillingProfileStore((s) => s.millView);
    const millSelected = useMillingProfileStore((s) => s.millSelected);
    const setMillView = useMillingProfileStore((s) => s.setMillView);
    const setMillSelected = useMillingProfileStore((s) => s.setMillSelected);
    const patchPlacement = useMillingProfileStore((s) => s.patchPlacement);
    const svgRef = useRef<SVGSVGElement>(null);
    const drag = useRef<DragState | null>(null);

    const placed = useMemo(() => {
        try {
            return placeWorkpieces(profile, parts, placements, { validate: false });
        } catch {
            return [];
        }
    }, [profile, parts, placements]);

    const issues = useMemo(
        () =>
            Object.fromEntries(placed.map((p) => [p.side, evaluatePlacedPart(p, profile)])) as Record<
                string,
                ReturnType<typeof evaluatePlacedPart>
            >,
        [placed, profile],
    );

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
                setMillSelected(selected.side);
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
                svgRef.current?.setPointerCapture(e.pointerId);
                return;
            }
        }
        const hit = hitPart(p.x, p.y, placed);
        if (!hit) {
            setMillSelected(null);
            return;
        }
        setMillSelected(hit.side);
        drag.current = {
            kind: "move",
            side: hit.side,
            x: p.x,
            y: p.y,
            tx: hit.tx,
            ty: hit.ty,
            rotationDeg: hit.rotationDeg,
        };
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
        drag.current = null;
        svgRef.current?.releasePointerCapture(e.pointerId);
    };

    const isoCorners = [
        iso(0, 0, 0),
        iso(tw, 0, 0),
        iso(tw, tl, 0),
        iso(0, tl, 0),
        iso(0, 0, h),
        iso(tw, 0, h),
        iso(tw, tl, h),
        iso(0, tl, h),
    ];
    const isoMinX = Math.min(...isoCorners.map((p) => p.x));
    const isoMaxX = Math.max(...isoCorners.map((p) => p.x));
    const isoMinY = Math.min(...isoCorners.map((p) => p.y));
    const isoMaxY = Math.max(...isoCorners.map((p) => p.y));
    const isoPad = 18;

    return (
        <div className="relative h-full w-full bg-[hsl(222_28%_7%)]">
            <nav className="absolute left-3 top-3 z-10 flex items-center gap-1" aria-label="Mill table views">
                <Button
                    type="button"
                    size="sm"
                    variant={millView === "top" ? "default" : "secondary"}
                    className="h-7 px-2"
                    onClick={() => setMillView("top")}
                >
                    <Box className="h-3.5 w-3.5" />
                    Top
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={millView === "orbit" ? "default" : "secondary"}
                    className="h-7 px-2"
                    onClick={() => setMillView("orbit")}
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
                <svg
                    className="h-full w-full"
                    viewBox={`${isoMinX - isoPad} ${isoMinY - isoPad} ${isoMaxX - isoMinX + 2 * isoPad} ${isoMaxY - isoMinY + 2 * isoPad}`}
                    aria-label="Milling block orbit view"
                >
                    <path
                        d={isoPath([
                            { x: 0, y: 0 },
                            { x: tw, y: 0 },
                            { x: tw, y: tl },
                            { x: 0, y: tl },
                        ])}
                        fill="#3f3f46"
                    />
                    <path
                        d={svgPath([iso(0, 0, 0), iso(tw, 0, 0), iso(tw, 0, h), iso(0, 0, h)])}
                        fill="#27272a"
                    />
                    <path
                        d={svgPath([iso(tw, 0, 0), iso(tw, tl, 0), iso(tw, tl, h), iso(tw, 0, h)])}
                        fill="#18181b"
                    />
                    <path
                        d={isoPath(
                            [
                                { x: 0, y: 0 },
                                { x: tw, y: 0 },
                                { x: tw, y: tl },
                                { x: 0, y: tl },
                            ],
                            h,
                        )}
                        fill="#52525b"
                        stroke="#a1a1aa"
                        strokeWidth={0.6}
                    />
                    {profile.pockets.map((pk) => (
                        <path
                            key={`pk-${pk.x}-${pk.y}-${pk.width}-${pk.length}`}
                            d={isoPath(
                                [
                                    { x: pk.x, y: pk.y },
                                    { x: pk.x + pk.width, y: pk.y },
                                    { x: pk.x + pk.width, y: pk.y + pk.length },
                                    { x: pk.x, y: pk.y + pk.length },
                                ],
                                h,
                            )}
                            fill="none"
                            stroke="#d4d4d8"
                            strokeWidth={0.5}
                        />
                    ))}
                    {placed.map((part) => {
                        const world = transformOutline(part.outline, part);
                        const invalid = issues[part.side]?.ok === false;
                        const selected = millSelected === part.side;
                        const zTop = h;
                        const zBot = h - Math.min(h - 2, Math.max(4, part.zMax));
                        return (
                            <g key={part.side}>
                                <path
                                    d={isoPath(world, zBot)}
                                    fill={partFill(invalid, selected, true)}
                                    opacity={0.55}
                                />
                                <path
                                    d={isoPath(world, zTop)}
                                    fill={partFill(invalid, selected, true)}
                                    stroke={partStroke(invalid, selected)}
                                    strokeWidth={0.45}
                                />
                            </g>
                        );
                    })}
                    <text
                        x={(iso(0, 0, h).x + iso(tw, 0, h).x) / 2}
                        y={iso(0, 0, 0).y + 10}
                        fill="#a1a1aa"
                        fontSize={8}
                        textAnchor="middle"
                    >
                        {h.toFixed(0)} mm
                    </text>
                </svg>
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
                                profileTopOffset={profile.topOffsetMm}
                                selected={millSelected === part.side}
                                invalid={issues[part.side]?.ok === false}
                            />
                        ))}
                    </g>
                </svg>
            )}
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
