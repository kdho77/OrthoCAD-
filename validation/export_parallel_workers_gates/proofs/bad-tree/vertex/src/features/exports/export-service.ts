export async function exportDesign() {
    const parts = [];
    for (const side of ["left", "right"]) parts.push(await side);
    return parts;
}
