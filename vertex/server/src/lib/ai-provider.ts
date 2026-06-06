import { prescriptionParseSchema, type PrescriptionParse } from "./prescription-schema";

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
    const provider = (process.env.AI_PROVIDER as AiProvider | undefined) ?? "anthropic";
    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) return null;
    const model =
        process.env.AI_MODEL ?? (provider === "xai" ? "grok-2-vision-1212" : "claude-3-5-sonnet-latest");
    return { provider, apiKey, model };
}

const SYSTEM_PROMPT = `You are a podiatric orthotics assistant. Read the foot-orthotic prescription (text and/or image) and output ONLY a JSON object describing the corrections and elements to build a custom insole.

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
    const userContent: unknown[] = [{ type: "text", text: input.text || "Parse the attached prescription image." }];
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
