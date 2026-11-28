import { type PrescriptionParse, prescriptionParseSchema } from "./prescription-schema.js";

// Server-side AI provider abstraction. Calls Anthropic (Claude) or xAI (Grok)
// to parse a free-text / image orthotic prescription into structured
// corrections + elements. API keys never leave the server.

export type AiProvider = "anthropic" | "xai";

export interface AiConfig {
    provider: AiProvider;
    apiKey: string;
    model: string;
}

export function getAiConfig(): AiConfig | null {
    const provider = (process.env.AI_PROVIDER as AiProvider | undefined) ?? "xai";
    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) return null;
    const model =
        process.env.AI_MODEL ?? (provider === "xai" ? "grok-2-vision-latest" : "claude-3-5-sonnet-latest");
    return { provider, apiKey, model };
}

export const SYSTEM_PROMPT = `You are a podiatric orthotics assistant. Read the foot-orthotic prescription (text and/or image) and output ONLY a JSON object describing the corrections and elements to build a custom insole.

Schema (all numeric corrections are per-foot; positive posting = pronation/varus):
{
  "pattern": "full_contact"|"prefab_3d"|"flat"|"custom"  (optional),
  "method": "printing_solid"|"printing_shell"|"milling_3axis"  (optional),
  "thicknessMm": number (optional),
  "unit": "mm"|"deg" (optional),
  "corrections": {
    "left":  { forefootPostingDeg, rearfootPostingDeg, medialSkiveMm, lateralSkiveMm, archFillMm, archHeightMm, heelCupDepthMm, heelCupHeightMm, apexMoveMm, medialFlangeMm, lateralFlangeMm },
    "right": { ...same keys... }
  },
  "elements": [ { "kind": "met_pad"|"met_bar"|"cluffy_wedge"|"mortons_extension"|"reverse_mortons"|"heel_sink"|"navicular_sink"|"kinetic_wedge", "side": "left"|"right" } ],
  "notes": string,
  "confidence": number 0..1
}

Vertex standardized arch tiers (parametric archHeightMm delta from the 23.5 mm Medium shell default):
- High arch (high arch, pes cavus, or measured scan arch height > 25.0 mm, targeting 26.5 mm shell): set archHeightMm to 3 (+3.0 mm).
- Medium / Average arch (normal, average, medium arch, or measured scan arch height 21.75–25.0 mm, targeting 23.5 mm shell): leave at default — omit archHeightMm or set 0.
- Low arch (low arch, flat foot, pes planus, or measured scan arch height < 21.75 mm, targeting 20.0 mm shell): set archHeightMm to -3.5 (-3.5 mm).

Fulcrum-first clinical philosophy:
- Patients do not tolerate heavy arch pressure. Do NOT raise archHeightMm above the patient's comfortable standardized tier to correct pronation, flat foot, or mechanical alignment.
- Apply mechanical corrections at plantar weight-bearing fulcrums (rearfoot post/wedge, medial or lateral heel skive, forefoot post/wedge) while keeping the arch in its comfortable standardized tier.

Clinical guardrails:
- For arch sensitivity, arch intolerance, Charcot foot, neuropathic foot, or diabetic ulceration risk, cap the arch at Low (archHeightMm: -3.5) unless the clinician explicitly specifies a numeric mm arch height.
- If the clinician explicitly prescribes a specific numeric mm arch height, honor it; if it differs by more than 5 mm from the expected tier shell target, note the mismatch in notes for clinician review.
- Keep left and right feet independent: never copy a unilateral arch tier or correction onto the other foot unless prescribed for both.

Only include correction keys that the prescription specifies. If a value applies to both feet, set it on both left and right. Output JSON only, no prose, no code fences.`;

function extractJson(raw: string): unknown {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : raw;
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("AI response contained no JSON object");
    return JSON.parse(body.slice(start, end + 1));
}

interface CallInput {
    text?: string;
    image?: { dataBase64: string; mediaType: string };
}

async function callAnthropic(cfg: AiConfig, input: CallInput): Promise<string> {
    const content: unknown[] = [];
    if (input.image) {
        content.push({
            type: "image",
            source: { type: "base64", media_type: input.image.mediaType, data: input.image.dataBase64 },
        });
    }
    content.push({ type: "text", text: input.text || "Parse the attached prescription image." });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-api-key": cfg.apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: cfg.model,
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content }],
        }),
    });
    if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((c) => c.type === "text")?.text;
    if (!text) throw new Error("Anthropic returned no text content");
    return text;
}

async function callXai(cfg: AiConfig, input: CallInput): Promise<string> {
    const userContent: unknown[] = [
        { type: "text", text: input.text || "Parse the attached prescription image." },
    ];
    if (input.image) {
        userContent.push({
            type: "image_url",
            image_url: { url: `data:${input.image.mediaType};base64,${input.image.dataBase64}` },
        });
    }

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
            model: cfg.model,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userContent },
            ],
        }),
    });
    if (!res.ok) throw new Error(`xAI API error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("xAI returned no content");
    return text;
}

export async function parsePrescriptionWithAi(cfg: AiConfig, input: CallInput): Promise<PrescriptionParse> {
    const raw = cfg.provider === "xai" ? await callXai(cfg, input) : await callAnthropic(cfg, input);
    return prescriptionParseSchema.parse(extractJson(raw));
}
