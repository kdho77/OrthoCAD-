import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.CLIENT_E2E_URL ?? "http://127.0.0.1:5180";
const out = process.env.CLIENT_E2E_OUT ?? "/opt/cursor/artifacts/client-file-header";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${base}/clients`, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "Clients" }).waitFor();
await page.locator('[data-testid="new-client"].fixed').click();
await page.getByLabel("Display name or initials").fill("Doe, Jane");
await page.getByLabel("Client reference").fill("C-1001");
await page.locator("button", { hasText: /^Save$/ }).click();
await page.waitForURL(/\/clients\/[0-9a-f-]{36}\/?$/i);
await page.getByTestId("client-file-header-meta").waitFor();
const meta = await page.getByTestId("client-file-header-meta").innerText();
if (!meta.includes("US men's")) {
    throw new Error(`header meta missing shoe size: ${meta}`);
}
if (!meta.includes("Ref C-1001")) {
    throw new Error(`header meta missing reference: ${meta}`);
}
if (!meta.includes("Ordered by")) {
    throw new Error(`header meta missing Ordered by: ${meta}`);
}
await page
    .locator('[data-testid="client-file"] section')
    .first()
    .screenshot({
        path: path.join(out, "client-file-header.png"),
    });
await browser.close();
