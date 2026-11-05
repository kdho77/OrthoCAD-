/**
 * VO handoff payload aligned with vertex/server/src/webhooks/design-exported.ts
 * (buildDesignExportedEvent). Kept in-repo duplicate to avoid pulling the full server graph into MCP tsc.
 */

export interface ExportedFile {
    side: string;
    machine: string;
    format: string;
    material: string;
    download_url: string;
}

export interface DesignExportedEvent {
    id: string;
    type: "design.exported";
    tenant_id: string;
    design_id: string;
    source: "vo2" | "orthocloud";
    external_order_id: string;
    files: ExportedFile[];
}

export interface BuildDesignExportedPayloadInput {
    id: string;
    design_id: string;
    tenant_id: string;
    source: "vo2" | "orthocloud";
    external_order_id: string;
    files: ExportedFile[];
}

export function buildDesignExportedPayload(input: BuildDesignExportedPayloadInput): DesignExportedEvent {
    return {
        id: input.id,
        type: "design.exported",
        tenant_id: input.tenant_id,
        design_id: input.design_id,
        source: input.source,
        external_order_id: input.external_order_id,
        files: input.files.map((file) => ({
            side: file.side,
            machine: file.machine,
            format: file.format,
            material: file.material,
            download_url: file.download_url,
        })),
    };
}
