// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Dogfood belt decisions. Missing clinical numbers and hardness ask the user.
// They are never filled in from a template default.

import { HARDNESS_NAMES, type HardnessName } from "./print-recipe/print-recipe.js";

export interface DogfoodHardnessProvenance {
    hardness: HardnessName | null;
    hardnessSource: "prescribed" | "unspecified";
}

export interface UserQuestion {
    ok: false;
    ask: "user";
    relay: "none";
    questions: Array<{ field: string; prompt: string }>;
}

const HARDNESS_BY_KEY = new Map(HARDNESS_NAMES.map((name) => [name.toLowerCase(), name]));

export function canonicalMaterialHardness(value: unknown): HardnessName | null {
    if (typeof value !== "string") return null;
    const key = value.trim().toLowerCase().replace(/\s+/g, " ");
    if (!key) return null;
    return HARDNESS_BY_KEY.get(key) ?? null;
}

export function hardnessQuestion(prompt: string): UserQuestion {
    return {
        ok: false,
        ask: "user",
        relay: "none",
        questions: [{ field: "hardness", prompt }],
    };
}

export function patientNameQuestion(): UserQuestion {
    return {
        ok: false,
        ask: "user",
        relay: "none",
        questions: [
            {
                field: "patient_name",
                prompt: "A patient name is required on the bottom of the printed device. What name should be engraved?",
            },
        ],
    };
}

/**
 * Prescribed hardness on the saved design, or an explicit request, may proceed.
 * An omitted hardness stays unspecified. A name outside the ladder is a question.
 */
export function decideDogfoodHardness(args: {
    provenance: DogfoodHardnessProvenance | null;
    requested: unknown;
}): { ok: true; hardness: HardnessName; source: "prescribed" | "requested" } | UserQuestion {
    const requestedText = typeof args.requested === "string" ? args.requested.trim() : "";
    if (args.requested !== undefined && args.requested !== null && requestedText !== "") {
        const named = canonicalMaterialHardness(args.requested);
        if (!named) {
            return hardnessQuestion(
                `Material hardness "${requestedText}" is not one of ${HARDNESS_NAMES.join(", ")}. Which hardness should this pair use?`,
            );
        }
        return { ok: true, hardness: named, source: "requested" };
    }
    if (args.provenance?.hardnessSource === "prescribed" && args.provenance.hardness) {
        return { ok: true, hardness: args.provenance.hardness, source: "prescribed" };
    }
    return hardnessQuestion(
        "Material hardness is not on this order. Which hardness should this pair use: Extra Soft, Soft, Medium, Hard, or Extra Hard?",
    );
}

export class DogfoodUserQuestion extends Error {
    readonly payload: UserQuestion;

    constructor(payload: UserQuestion) {
        super(payload.questions.map((question) => question.prompt).join(" "));
        this.name = "DogfoodUserQuestion";
        this.payload = payload;
    }
}
