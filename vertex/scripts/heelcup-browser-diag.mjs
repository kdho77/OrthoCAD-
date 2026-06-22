/**
 * Phase 1B: drive heel cup sliders and capture full [HEELCUP-DIAG] console payloads.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5180";
const logs = [];

async function pushConsole(msg) {
    const text = msg.text();
    if (!text.includes("[HEELCUP-DIAG]")) return;
    const args = await Promise.all(msg.args().map((a) => a.jsonValue().catch(() => null)));
    logs.push({ ts: Date.now(), type: msg.type(), text, args });
}

async function setRangeByIndex(page, index, value) {
    return page.evaluate(
        ({ index, value }) => {
            const range = document.querySelectorAll('input[type="range"]')[index];
            if (!range) return { ok: false, reason: "missing range" };
            const label = range.closest(".space-y-1")?.querySelector("label")?.textContent?.trim();
            range.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            range.value = String(value);
            range.dispatchEvent(new Event("input", { bubbles: true }));
            range.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
            return { ok: true, label, value: range.value };
        },
        { index, value },
    );
}

async function waitForLog(pattern, timeoutMs = 120_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (logs.some((l) => l.text.includes(pattern))) return true;
        await new Promise((r) => setTimeout(r, 200));
    }
    return false;
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on("console", (msg) => {
        void pushConsole(msg);
    });

    console.log(`Navigating to ${baseUrl} ...`);
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });

    console.log("Waiting for stock GLB load + initial rebuild ...");
    await page.waitForTimeout(25_000);

    // Left column heel sliders (from inspect-sliders.mjs): depth=15, width=16
    console.log("Depth drag+release → 6mm (range index 15) ...");
    console.log(await setRangeByIndex(page, 15, 6));
    await page.waitForTimeout(3_000);

    console.log("Depth drag+release → 7.5mm (range index 15) ...");
    console.log(await setRangeByIndex(page, 15, 7.5));
    await page.waitForTimeout(3_000);

    console.log("Width drag+release → 8mm (range index 16) ...");
    console.log(await setRangeByIndex(page, 16, 8));
    await page.waitForTimeout(5_000);

    const outPath = "/tmp/heelcup-diag-logs.json";
    writeFileSync(outPath, JSON.stringify(logs, null, 2));
    console.log(`\nCaptured ${logs.length} HEELCUP-DIAG entries → ${outPath}\n`);
    for (const line of logs) {
        console.log(JSON.stringify({ text: line.text, args: line.args }));
    }

    await browser.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
