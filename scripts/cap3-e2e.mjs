import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.CLIENT_E2E_URL ?? "http://127.0.0.1:5180";
const out = process.env.CAP3_E2E_OUT ?? "/opt/cursor/artifacts/cap3";
mkdirSync(out, { recursive: true });
const scanFile = path.join(out, "left.stl");
writeFileSync(scanFile, "solid left\nendsolid left\n");

async function pass(width, height, tag) {
    const browser = await chromium.launch({
        headless: true,
        args: ["--use-gl=angle", "--use-angle=swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(30000);
    const shot = (name) => page.screenshot({ path: path.join(out, `${tag}-${name}.png`), fullPage: true });
    page.on("pageerror", (error) => {
        console.error(`[${tag}] pageerror`, error.message);
    });

    await page.goto(`${base}/?e2eLogin=1`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    await page.getByRole("textbox", { name: "Email" }).fill("clinician@example.com");
    await page.getByRole("textbox", { name: "Password" }).fill("local-dev");
    await page.getByTestId("login-submit").click();
    await page.waitForURL(/\/clients\/?(\?.*)?$/);
    await page.getByRole("button", { name: "New client" }).click();
    await page.getByLabel("Display name or initials").fill("Doe, Jane");
    await page.getByLabel("Client reference").fill("C-2002");
    await page.getByRole("button", { name: "Create client" }).click();
    await page.getByTestId("client-file").waitFor();
    await page.getByTestId("shoe-size-split").check();
    await page.getByTestId("shoe-size-left").waitFor();
    await shot("01-chart-size");

    await page.getByTestId("client-file").getByTestId("type-insole").click();
    await page.getByTestId("start-choice").waitFor();
    await shot("02-start-choice");

    await page.getByTestId("start-from-scan").click();
    await page.getByTestId("scan-retention-notice").waitFor();
    await page.getByTestId("scan-file-left").setInputFiles(scanFile);
    await page.getByTestId("scan-countdown-left").waitFor();
    const pad = page.getByTestId("scan-dots-left");
    await pad.click({ position: { x: 80, y: 40 } });
    await pad.click({ position: { x: 140, y: 48 } });
    await pad.click({ position: { x: 110, y: 200 } });
    await pad.click({ position: { x: 150, y: 120 } });
    await page.getByTestId("dot-left-archApex").waitFor();
    await shot("03-scan-dots");

    await page.goto(`${base}/production/queue?e2eRetention=1`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=gcode-countdown]:visible").first().waitFor();
    await shot("04-queue-countdown");
    await page.goto(`${base}/production/history?e2eRetention=1`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=gcode-countdown]:visible").first().waitFor();
    await shot("05-history-countdown");

    await browser.close();
}

await pass(1024, 768, "1024");
await pass(360, 740, "360");
console.log(`cap3 screenshots in ${out}`);
