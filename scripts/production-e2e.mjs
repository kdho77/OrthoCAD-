import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.CLIENT_E2E_URL ?? "http://127.0.0.1:5180";
const out = process.env.PRODUCTION_E2E_OUT ?? "/opt/cursor/artifacts/production";
mkdirSync(out, { recursive: true });

async function pass(width, height, tag) {
    const browser = await chromium.launch({
        headless: true,
        args: ["--use-gl=angle", "--use-angle=swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(30000);
    const shot = (name) => page.screenshot({ path: path.join(out, `${tag}-${name}.png`), fullPage: true });
    page.on("pageerror", (error) => console.error(`[${tag}] pageerror`, error.message));

    await page.goto(`${base}/?e2eLogin=1`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    await page.getByRole("textbox", { name: "Email" }).fill("clinician@example.com");
    await page.getByRole("textbox", { name: "Password" }).fill("local-dev");
    await page.getByTestId("login-submit").click();
    await page.waitForURL(/\/clients\/?(\?.*)?$/);
    await page.getByRole("button", { name: "Production" }).click();
    await page.waitForURL(/\/production\/queue\/?$/);
    await page.getByRole("heading", { name: "Production" }).waitFor();
    await page.getByText("No jobs in the queue.").waitFor();
    if (width >= 768) {
        await page.getByRole("columnheader", { name: "Job" }).waitFor();
        await page.getByRole("columnheader", { name: "Client" }).waitFor();
        await page.getByRole("columnheader", { name: "Source" }).waitFor();
        await page.getByRole("columnheader", { name: "Process" }).waitFor();
        await page.getByRole("columnheader", { name: "Status" }).waitFor();
        await page.getByRole("columnheader", { name: "Assigned printer" }).waitFor();
        await page.getByRole("columnheader", { name: "Age" }).waitFor();
    }
    if (await page.getByRole("button", { name: "Orders" }).count()) {
        throw new Error("Orders tab is still in the nav");
    }
    await shot("01-queue");

    await page.getByRole("button", { name: "Printers" }).click();
    await page.waitForURL(/\/production\/printers\/?$/);
    await page.getByText("This page does not send printer commands.").waitFor();
    await page.getByText("No printers yet.").waitFor();
    await shot("02-printers");

    await page.getByRole("button", { name: "History" }).click();
    await page.waitForURL(/\/production\/history\/?$/);
    await page.getByRole("columnheader", { name: "Outcome" }).waitFor();
    await page.getByText("No completed jobs.").waitFor();
    await shot("03-history");

    await page.goto(`${base}/orders`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/production\/queue\/?$/);
    await page.goto(`${base}/production`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/production\/queue\/?$/);
    await browser.close();
    console.log(`[${tag}] ok`);
}

await pass(1024, 768, "1024");
await pass(360, 740, "360");
console.log(`screenshots in ${out}`);
