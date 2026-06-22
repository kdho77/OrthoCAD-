import { chromium } from "playwright";

async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:5180", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8000);
    const info = await page.evaluate(() => {
        const labels = [...document.querySelectorAll("label")].map((l) => l.textContent?.trim());
        const ranges = [...document.querySelectorAll('input[type="range"]')].map((r, i) => ({
            i,
            min: r.min,
            max: r.max,
            value: r.value,
            prev: r.closest(".space-y-1")?.querySelector("label")?.textContent?.trim(),
        }));
        return { labels: labels.filter(Boolean), ranges };
    });
    console.log(JSON.stringify(info, null, 2));
    await browser.close();
}

main();
