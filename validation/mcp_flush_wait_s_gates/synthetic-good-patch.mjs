/**
 * Local control patch used only by the bad-change proof.
 * It is not the candidate and it is not applied to the product branch.
 */
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";

const ORIGINAL_BEGIN = `    const work = args.execute(claimed.row);
    args.schedule(work);
    return { productionId: claimed.row.id, status: "pending", side: args.insert.side };`;

const GOOD_BEGIN = `    const row = claimed.row;
    const work = new Promise((resolve, reject) => {
        setImmediate(() => {
            Promise.resolve(args.execute(row)).then(resolve, reject);
        });
    });
    args.schedule(work);
    return { productionId: row.id, status: "pending", side: args.insert.side };`;

const TIMEOUT_BEGIN = `    const row = claimed.row;
    const work = new Promise((resolve, reject) => {
        setTimeout(() => {
            Promise.resolve(args.execute(row)).then(resolve, reject);
        }, 0);
    });
    args.schedule(work);
    return { productionId: row.id, status: "pending", side: args.insert.side };`;

const ORIGINAL_PAIR = `                const files: Array<ReturnType<typeof gcodeFileFromResult>> = [];
                for (const side of sides) {
                    const exportFileName = mcpGcodeExportFilename(
                        side,
                        input.patient_name,
                        material,
                        input.file_name,
                        exportBase,
                    );
                    try {
                        const result = await manufacturing.generateFromSavedDesign({
                            designId: input.design_id,
                            side,
                            presetId,
                            material,
                            fileName: exportFileName,
                            patientName: input.patient_name,
                            hardness: input.hardness,
                            forceNewSlice: input.force_new_slice === true,
                        });
                        if (isUserQuestion(result)) {
                            if (files.length > 0) {
                                throw new Error(
                                    \`Belt pair failed on the \${side} foot. No partial pair is returned.\`,
                                );
                            }
                            return result;
                        }
                        files.push(gcodeFileFromResult(side, result, exportFileName));
                    } catch (error) {
                        if (sides.length > 1) {
                            throw new Error(
                                \`Belt pair failed on the \${side} foot. No partial pair is returned. \${
                                    error instanceof Error ? error.message : String(error)
                                }\`,
                            );
                        }
                        throw error;
                    }
                }
                if (files.length !== sides.length) {
                    throw new Error("Belt pair did not produce both feet");
                }
                return { ok: true, format: "gcode", files };`;

const GOOD_PAIR = `                /* GATE_GOOD_PAIR_START */
                const sideOutcomes = await Promise.all(
                    sides.map(async (side) => {
                        const exportFileName = mcpGcodeExportFilename(
                            side,
                            input.patient_name,
                            material,
                            input.file_name,
                            exportBase,
                        );
                        const result = await manufacturing.generateFromSavedDesign({
                            designId: input.design_id,
                            side,
                            presetId,
                            material,
                            fileName: exportFileName,
                            patientName: input.patient_name,
                            hardness: input.hardness,
                            forceNewSlice: input.force_new_slice === true,
                        });
                        return { side, exportFileName, result };
                    }),
                );
                const files: Array<ReturnType<typeof gcodeFileFromResult>> = [];
                for (const entry of sideOutcomes) {
                    if (isUserQuestion(entry.result)) {
                        if (files.length > 0) {
                            throw new Error(
                                \`Belt pair failed on the \${entry.side} foot. No partial pair is returned.\`,
                            );
                        }
                        return entry.result;
                    }
                    files.push(gcodeFileFromResult(entry.side, entry.result, entry.exportFileName));
                }
                if (files.length !== sideOutcomes.length) {
                    throw new Error("Belt pair did not produce both feet");
                }
                /* GATE_GOOD_PAIR_RETURN */
                return { ok: true, format: "gcode", files };`;

const ORIGINAL_SCHEMA = `export const getProductionInputSchema = z.object({
    production_id: z.string().uuid(),
});`;

const GOOD_SCHEMA = `export const getProductionInputSchema = z.object({
    production_id: z.string().uuid(),
    wait_s: z.number().min(0).max(300).optional(),
});`;

const CAP_120_SCHEMA = `export const getProductionInputSchema = z.object({
    production_id: z.string().uuid(),
    wait_s: z.number().min(0).max(120).optional(),
});`;

const ORIGINAL_GET = `            return publicProductionFromResult(await manufacturing.getProduction(input.production_id));`;

const GOOD_GET = `            const waitS = input.wait_s ?? 0;
            let result = await manufacturing.getProduction(input.production_id);
            let payload = publicProductionFromResult(result);
            if (waitS <= 0) return payload;
            const deadline = Date.now() + waitS * 1000;
            while (payload.status !== "succeeded" && payload.status !== "failed") {
                const remaining = deadline - Date.now();
                if (remaining <= 0) break;
                await new Promise((resolve) => setTimeout(resolve, Math.min(2000, remaining)));
                if (Date.now() >= deadline) break;
                result = await manufacturing.getProduction(input.production_id);
                payload = publicProductionFromResult(result);
            }
            return payload;`;

function replaceOnce(file, from, to) {
    const text = readFileSync(file, "utf8");
    const count = text.split(from).length - 1;
    if (count !== 1) {
        throw new Error(`expected 1 match in ${file}, found ${count}`);
    }
    writeFileSync(file, text.replace(from, to));
}

function handlers(tree) {
    return path.join(tree, "packages/mcp/src/tools/handlers.ts");
}

function schemas(tree) {
    return path.join(tree, "packages/mcp/src/tools/schemas.ts");
}

function beginFile(tree) {
    return path.join(tree, "vertex/server/src/lib/cad-operator-production.ts");
}

export function applyGood(tree) {
    replaceOnce(beginFile(tree), ORIGINAL_BEGIN, GOOD_BEGIN);
    replaceOnce(handlers(tree), ORIGINAL_PAIR, GOOD_PAIR);
    replaceOnce(schemas(tree), ORIGINAL_SCHEMA, GOOD_SCHEMA);
    replaceOnce(handlers(tree), ORIGINAL_GET, GOOD_GET);
}

export function removeSetImmediate(tree) {
    replaceOnce(beginFile(tree), GOOD_BEGIN, ORIGINAL_BEGIN);
}

export function useSetTimeoutZero(tree) {
    replaceOnce(beginFile(tree), GOOD_BEGIN, TIMEOUT_BEGIN);
}

export function capAt120(tree) {
    replaceOnce(schemas(tree), GOOD_SCHEMA, CAP_120_SCHEMA);
}

export function waitForLoftBeforeReturn(tree) {
    replaceOnce(
        handlers(tree),
        "                /* GATE_GOOD_PAIR_RETURN */\n                return { ok: true, format: \"gcode\", files };",
        "                await new Promise((resolve) => setTimeout(resolve, 6000));\n                /* GATE_GOOD_PAIR_RETURN */\n                return { ok: true, format: \"gcode\", files };",
    );
}

export function restoreSequentialEnqueue(tree) {
    replaceOnce(handlers(tree), GOOD_PAIR, ORIGINAL_PAIR);
}

export function flipStockLoftByte(tree) {
    const file = path.join(tree, "tests/fixtures/SAMPLE_Top.glb");
    const buf = readFileSync(file);
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff;
    writeFileSync(file, buf);
}

export function touchGeometrySource(tree) {
    appendFileSync(
        path.join(tree, "vertex/src/lib/geometry/procedural-wall/ring-seam.ts"),
        "\n// bad-change geometry probe\n",
    );
}
