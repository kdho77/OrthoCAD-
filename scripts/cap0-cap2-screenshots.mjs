import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.CLIENT_E2E_URL ?? "http://127.0.0.1:5180";
const out = process.env.CLIENT_E2E_OUT ?? "/opt/cursor/artifacts/create-client-shoe-nav";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
});

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(`${base}/clients`, { waitUntil: "domcontentloaded" });
await mobile.locator('[data-testid="new-client"].fixed').click();
await mobile.getByRole("heading", { name: "New client" }).waitFor();
await mobile.getByLabel("Display name or initials").fill("Jane Doe");
await mobile.getByTestId("shoe-size").fill("");
await mobile.getByTestId("shoe-size-error").waitFor();
await mobile.locator('[role="dialog"]').screenshot({
    path: path.join(out, "create-client-shoe-validation.png"),
});
await mobile.getByTestId("shoe-size-split").check();
await mobile.getByTestId("shoe-size-left").waitFor();
await mobile.locator('[role="dialog"]').screenshot({
    path: path.join(out, "create-client-lr-toggle.png"),
});
await mobile.close();

const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await desktop.goto(`${base}/clients`, { waitUntil: "domcontentloaded" });
await desktop.getByTestId("new-client").first().click();
await desktop.getByLabel("Display name or initials").fill("List Demo");
await desktop.getByLabel("Client reference").fill("REF-9");
await desktop.locator("button", { hasText: /^Save$/ }).click();
await desktop.waitForURL(/\/clients\/[0-9a-f-]{36}\/?$/i);
await desktop.getByRole("button", { name: "Clients" }).first().click();
await desktop.getByText("List Demo").waitFor();
await desktop.getByText("Ordered by").first().waitFor();
await desktop.locator('[data-testid="client-list"]').screenshot({
    path: path.join(out, "client-list-ordered-by-column.png"),
});
await desktop.getByRole("cell", { name: "List Demo" }).click();
await desktop.getByTestId("client-file-header-meta").waitFor();
await desktop
    .locator('[data-testid="client-file"] section')
    .first()
    .screenshot({
        path: path.join(out, "client-file-header.png"),
    });

await browser.close();
