export class PrintRecipeProfileRequiredError extends Error {
    constructor(message = "profile required") {
        super(message);
        this.name = "PrintRecipeProfileRequiredError";
    }
}

export function gyroidInfillPctForHardness() {
    return 26;
}

export function resolveGyroidManufacturingPrintRecipe() {
    return {
        version: 1,
        pattern: "gyroid",
        profileId: "apex-v2-insole-95a",
        defaultHardness: "Hard",
        zones: [],
    };
}
