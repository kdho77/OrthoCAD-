/** Capture preview-vs-commit depth sequence with HEELCUP-DIAG logs. */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const logs = [];

async function pushConsole(msg) {
    const text = msg.text();
    if (!text.includes("[HEELCUP-DIAG]")) return;
    const args = await Promise.all(msg.args().map((a) => a.jsonValue().catch(() => null)));
    logs.push({ ts: Date.now(), text, args });
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on("console", (msg) => void pushConsole(msg));

    await page.goto("http://127.0.0.1:5180", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(25_000);

    await page.evaluate(() => {
        const range = document.querySelectorAll('input[type="range"]')[15];
        if (!range) throw new Error("no depth slider");
        range.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        for (const v of [2, 4, 6]) {
            range.value = String(v);
            range.dispatchEvent(new Event("input", { bubbles: true }));
        }
    });
    await page.waitForTimeout(2_000);

    await page.evaluate(() => {
        const range = document.querySelectorAll('input[type="range"]')[15];
        range.value = "6";
        range.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await page.waitForTimeout(3_000);

    writeFileSync("/tmp/heelcup-depth-preview-logs.json", JSON.stringify(logs, null, 2));
    for (const l of logs) console.log(JSON.stringify(l.args));
    await browser.close();
}

main();
