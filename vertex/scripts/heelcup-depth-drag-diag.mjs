/** Depth drag with rAF flush so previewCorrection lands before rebuild. */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const logs = [];

async function pushConsole(msg) {
    if (!msg.text().includes("[HEELCUP-DIAG]")) return;
    const args = await Promise.all(msg.args().map((a) => a.jsonValue().catch(() => null)));
    logs.push({ ts: Date.now(), args });
}

async function rafFlush(page) {
    await page.evaluate(
        () =>
            new Promise((r) => {
                requestAnimationFrame(() => requestAnimationFrame(r));
            }),
    );
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on("console", (msg) => void pushConsole(msg));
    await page.goto("http://127.0.0.1:5180", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(25_000);

    await page.evaluate(() => {
        const range = document.querySelectorAll('input[type="range"]')[15];
        range.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    await rafFlush(page);

    for (const v of [2, 4, 6]) {
        await page.evaluate((val) => {
            const range = document.querySelectorAll('input[type="range"]')[15];
            range.value = String(val);
            range.dispatchEvent(new Event("input", { bubbles: true }));
        }, v);
        await rafFlush(page);
        await page.waitForTimeout(100);
    }
    await page.waitForTimeout(2_000);

    await page.evaluate(() => {
        const range = document.querySelectorAll('input[type="range"]')[15];
        range.value = "6";
        range.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await page.waitForTimeout(3_000);

    writeFileSync("/tmp/heelcup-depth-drag-logs.json", JSON.stringify(logs, null, 2));
    for (const l of logs) console.log(JSON.stringify(l.args));
    await browser.close();
}

main();
