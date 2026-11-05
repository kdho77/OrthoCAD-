/**
 * VO upload-to-order handoff for `build_design_exported_payload`.
 * OrthoCAD never writes VO order status. Shape is MCP/VO-specific (not the outbound webhook envelope).
 */

export interface VoHandoffFile {
    side: string;
    machine: string;
    format: string;
    material: string;
    download_url: string;
    expires_at: string;
    content_type: string;
    filename: string;
}

/** Exact VO handoff object returned by the MCP tool. */
export interface VoDesignExportedHandoff {
    design_id: string;
    external_order_id: string;
    tenant_id: string;
    source: "vo2";
    files: VoHandoffFile[];
}

export interface BuildDesignExportedPayloadInput {
    design_id: string;
    external_order_id: string;
    tenant_id: string;
    source: "vo2";
    files: VoHandoffFile[];
}

export function buildDesignExportedPayload(input: BuildDesignExportedPayloadInput): VoDesignExportedHandoff {
    if (input.source !== "vo2") {
        throw new Error('source must be "vo2" for VO handoff payloads');
    }
    return {
        design_id: input.design_id,
        external_order_id: input.external_order_id,
        tenant_id: input.tenant_id,
        source: "vo2",
        files: input.files.map((file) => ({
            side: file.side,
            machine: file.machine,
            format: file.format,
            material: file.material,
            download_url: file.download_url,
            expires_at: file.expires_at,
            content_type: file.content_type,
            filename: file.filename,
        })),
    };
}
