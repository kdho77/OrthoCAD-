import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.CLIENT_E2E_URL ?? "http://127.0.0.1:5180";
const out = process.env.CLIENT_E2E_OUT ?? "/opt/cursor/artifacts/client-list";
mkdirSync(out, { recursive: true });

async function pass(width, height, tag) {
    const browser = await chromium.launch({
        headless: true,
        args: ["--use-gl=angle", "--use-angle=swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(30000);
    const shot = (name) => page.screenshot({ path: path.join(out, `${tag}-${name}.png`), fullPage: true });
    const failures = [];
    page.on("pageerror", (error) => {
        failures.push(error.message);
        console.error(`[${tag}] pageerror`, error.message);
    });
    page.on("console", (msg) => {
        if (msg.type() === "error") console.error(`[${tag}] console`, msg.text());
    });

    await page.goto(`${base}/?e2eLogin=1`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    await page.getByRole("textbox", { name: "Email" }).fill("clinician@example.com");
    await page.getByRole("textbox", { name: "Password" }).fill("local-dev");
    await shot("01-login");
    await page.getByTestId("login-submit").click();
    await page.waitForURL(/\/clients\/?(\?.*)?$/);
    await page.getByRole("heading", { name: "Clients" }).waitFor();
    await page.getByText("Add your first client").waitFor();
    if ((await page.title()) !== "OrthoCAD · Client") {
        throw new Error(`unexpected title ${await page.title()}`);
    }
    await shot("02-client-list");

    await page.getByRole("button", { name: "New client" }).click();
    await page.getByLabel("Display name or initials").fill("Doe, Jane");
    await page.getByLabel("Client reference").fill("C-1001");
    await page.getByTestId("create-and-design").click();
    await page.getByTestId("type-insole").click();
    await page.getByTestId("start-from-template").click();
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}\/designs\/[0-9a-f-]{36}/i);
    await page.getByTestId("breadcrumb-client").waitFor();
    const crumb = await page.getByTestId("breadcrumb-client").innerText();
    if (!crumb.includes("Doe, Jane")) throw new Error(`breadcrumb was ${crumb}`);
    await shot("03-editor");
    await page.getByTestId("breadcrumb-client").click();
    const leave = page.getByRole("button", { name: "Save and leave" });
    if (await leave.isVisible().catch(() => false)) await leave.click();
    await page.waitForURL((url) => /\/clients\/[0-9a-f-]{36}\/?$/i.test(url.pathname));
    try {
        await page.getByTestId("client-file").waitFor();
    } catch (error) {
        console.error("url", page.url());
        console.error("text", (await page.locator("body").innerText()).slice(0, 800));
        await shot("fail-client-file");
        throw error;
    }
    await shot("04-breadcrumb-back");

    const notes = page.getByTestId("design-notes");
    if ((await notes.count()) > 0) {
        await notes.click();
        await notes.fill("Heel pain note");
        await notes.blur();
        await page.getByText("Saved", { exact: true }).waitFor();
        await notes.fill("temporary");
        await notes.press("Escape");
        if ((await notes.inputValue()) !== "Heel pain note") {
            throw new Error(`escape did not revert notes: ${await notes.inputValue()}`);
        }
    } else {
        await page.getByText("C-1001").waitFor();
    }
    await shot("05-notes-saved");

    await page.getByRole("button", { name: "Design actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByText("This can't be undone.").waitFor();
    await shot("06-delete-confirm");
    await browser.close();
    if (failures.length) console.warn(`[${tag}] page errors`, failures);
    console.log(`[${tag}] ok`);
}

await pass(1024, 768, "1024");
await pass(360, 740, "360");
console.log(`screenshots in ${out}`);
