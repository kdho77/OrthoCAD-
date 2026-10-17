// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import JSZip from "jszip";
import type { DesignState, Side } from "@/types";
import { canonicalizeJson, sha256Utf8 } from "./hash";
import { fmtMm, type TriangleMesh } from "./mesh";
import { volumeSettingsFor } from "./report";
import type { ResolvedModifier } from "./resolve";

const DOS_EPOCH = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));
const IDENTITY = "1 0 0 0 1 0 0 0 1 0 0 0";

/** Zero DOS + extra-field timestamps so two packs of the same files are byte-identical. */
function freezeZipTimestamps(src: Uint8Array): Uint8Array {
    const out = new Uint8Array(src);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    let i = 0;
    while (i + 4 <= out.length) {
        const sig = view.getUint32(i, true);
        if (sig === 0x04034b50) {
            view.setUint16(i + 10, 0, true);
            view.setUint16(i + 12, 0, true);
            const nameLen = view.getUint16(i + 26, true);
            const extraLen = view.getUint16(i + 28, true);
            const compSize = view.getUint32(i + 18, true);
            for (let k = 0; k < extraLen; k++) out[i + 30 + nameLen + k] = 0;
            i += 30 + nameLen + extraLen + compSize;
            continue;
        }
        if (sig === 0x02014b50) {
            view.setUint16(i + 12, 0, true);
            view.setUint16(i + 14, 0, true);
            const nameLen = view.getUint16(i + 28, true);
            const extraLen = view.getUint16(i + 30, true);
            const commentLen = view.getUint16(i + 32, true);
            for (let k = 0; k < extraLen; k++) out[i + 46 + nameLen + k] = 0;
            i += 46 + nameLen + extraLen + commentLen;
            continue;
        }
        if (sig === 0x06054b50) break;
        i += 1;
    }
    return out;
}

function xmlEscape(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function meshXml(mesh: TriangleMesh): string {
    const verts: string[] = [];
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
        verts.push(`<vertex x="${fmtMm(p[i]!)}" y="${fmtMm(p[i + 1]!)}" z="${fmtMm(p[i + 2]!)}"/>`);
    }
    const tris: string[] = [];
    const ix = mesh.indices;
    for (let t = 0; t < ix.length; t += 3) {
        tris.push(`<triangle v1="${ix[t]}" v2="${ix[t + 1]}" v3="${ix[t + 2]}"/>`);
    }
    return `<mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh>`;
}

function contentTypesXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
<Default Extension="config" ContentType="application/octet-stream"/>
<Default Extension="json" ContentType="application/json"/>
<Override PartName="/3D/3dmodel.model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
}

function relsXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel-model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
<Relationship Target="/Metadata/model_settings.config" Id="rel-settings" Type="http://schemas.slic3r.org/package/2012/3mf-settings"/>
</Relationships>`;
}

function modelXml(shell: TriangleMesh, modifiers: ResolvedModifier[]): string {
    const objects: string[] = [];
    objects.push(`<object id="2" type="model">${meshXml(shell)}</object>`);
    let nextId = 3;
    const componentIds = ["2"];
    for (const m of modifiers) {
        if (m.status !== "present" || m.mesh.indices.length === 0) continue;
        objects.push(`<object id="${nextId}" type="model">${meshXml(m.mesh)}</object>`);
        componentIds.push(String(nextId));
        nextId += 1;
    }
    const components = componentIds
        .map((id) => `<component objectid="${id}" transform="${IDENTITY}"/>`)
        .join("");
    objects.push(`<object id="1" type="model"><components>${components}</components></object>`);
    return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
<metadata name="Application">OrthoCAD</metadata>
<resources>${objects.join("")}</resources>
<build><item objectid="1" transform="${IDENTITY}"/></build>
</model>`;
}

function partMetadata(lines: Array<[string, string]>): string {
    return lines
        .map(([k, v]) => `<metadata type="volume" key="${xmlEscape(k)}" value="${xmlEscape(v)}"/>`)
        .join("");
}

export function modelSettingsXml(modifiers: ResolvedModifier[], designHash: string): string {
    const parts: string[] = [];
    parts.push(
        `<part id="2" subtype="normal_part">${partMetadata([
            ["name", "shell"],
            ["matrix", "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"],
        ])}</part>`,
    );
    let partId = 3;
    for (const m of modifiers) {
        if (m.status !== "present" || m.mesh.indices.length === 0) continue;
        const vs = volumeSettingsFor(m.region);
        const meta: Array<[string, string]> = [
            ["name", m.region.label ?? m.region.regionId],
            ["matrix", "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"],
            ["sparse_infill_density", `${vs.densityPct}%`],
            ["sparse_infill_pattern", vs.pattern],
            ["regionId", m.region.regionId],
            ["kind", m.region.kind],
            ["hardnessClass", m.region.hardnessClass],
            ["priority", String(m.region.priority)],
            ["depth", JSON.stringify(m.region.depth)],
            ["overrides", JSON.stringify(m.region.overrides ?? {})],
            ["sourceHash", m.sourceHash],
            ["meshSha", m.meshSha],
            ["designHash", designHash],
        ];
        if (vs.speedMmS !== undefined) {
            meta.splice(4, 0, ["sparse_infill_speed", vs.speedMmS.toFixed(1)]);
        }
        parts.push(`<part id="${partId}" subtype="modifier_part">${partMetadata(meta)}</part>`);
        partId += 1;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<config>
<object id="1">
<metadata type="object" key="name" value="orthotic"/>
${parts.join("\n")}
</object>
</config>
`;
}

export interface Packed3mf {
    bytes: Uint8Array;
    designJson: string;
    designHash: string;
}

export async function packHardness3mf(options: {
    design: DesignState;
    side: Side;
    shell: TriangleMesh;
    modifiers: ResolvedModifier[];
}): Promise<Packed3mf> {
    const designJson = canonicalizeJson({
        side: options.side,
        design: options.design,
    });
    const designHash = sha256Utf8(designJson);
    const files: Array<[string, string]> = [
        ["[Content_Types].xml", contentTypesXml()],
        ["_rels/.rels", relsXml()],
        ["3D/3dmodel.model", modelXml(options.shell, options.modifiers)],
        ["Metadata/model_settings.config", modelSettingsXml(options.modifiers, designHash)],
        ["Metadata/orthocad_design.json", designJson],
        ["Metadata/orthocad_design.sha256", `${designHash}\n`],
    ];
    files.sort((a, b) => a[0].localeCompare(b[0]));

    const zip = new JSZip();
    for (const [name, body] of files) {
        zip.file(name, body, {
            date: DOS_EPOCH,
            compression: "DEFLATE",
            compressionOptions: { level: 6 },
        });
    }
    const raw = await zip.generateAsync({
        type: "uint8array",
        platform: "DOS",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
    });
    return { bytes: freezeZipTimestamps(raw), designJson, designHash };
}

export async function readDesignFrom3mf(bytes: Uint8Array): Promise<{
    designJson: string;
    designHash: string;
    embeddedHash: string;
}> {
    const zip = await JSZip.loadAsync(bytes);
    const jsonFile = zip.file("Metadata/orthocad_design.json");
    const hashFile = zip.file("Metadata/orthocad_design.sha256");
    if (!jsonFile) throw new Error("3MF missing Metadata/orthocad_design.json");
    const designJson = await jsonFile.async("string");
    const embeddedHash = ((await hashFile?.async("string")) ?? "").trim();
    const designHash = sha256Utf8(designJson);
    return { designJson, designHash, embeddedHash };
}
