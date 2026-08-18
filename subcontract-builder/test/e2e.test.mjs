/* Drives the real page in a real browser against a local Cloudflare runtime.
 * The point of this one is the last check: that the .docx the Send button uploads
 * actually contains the anchor strings DocuSign will look for. Everything else can
 * be reasoned about; that cannot.
 *
 * Requires `npm run dev` on port 8788 in another terminal.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const BASE = process.env.SCB_URL || "http://127.0.0.1:8788";
const launch = process.env.CHROME_PATH
  ? { executablePath: process.env.CHROME_PATH, args: ["--no-sandbox"] }
  : {};

const browser = await chromium.launch(launch);
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  // /api/docusign/ping 500s until real credentials are configured; that is not a bug.
  if (m.type() === "error" && !/500 \(Internal Server Error\)/.test(m.text())) errors.push("console: " + m.text());
});

await page.goto(BASE, { waitUntil: "networkidle" });

assert.equal(await page.title(), "Subcontract Agreement Builder");
assert.ok(await page.evaluate(() => typeof docx !== "undefined"), "the Word engine must load from lib/");
assert.match(await page.locator("#dsCard h2").textContent(), /Send for signature/);
assert.match(await page.locator("#dirStatus").textContent(), /Live|Saving|Saved/, "the hosted directory must connect");
console.log("  ok: page loads, Word engine and hosted directory both up");

const job = {
  contractor: "2306 Clark Lane LLC", subcontractor: "Casner Construction Inc",
  project: "2306 Clark Lane", site: "2306 Clark Lane, Marshallfield", price: "184500",
  sName: "Joshua Casner", sEmail: "josh@casner.example",
  cName: "Manoj Narang", cEmail: "mj@example.com",
};
for (const [id, v] of Object.entries(job)) await page.fill("#" + id, v);
await page.waitForTimeout(400);

assert.equal(await page.inputValue("#dsSignerName"), "Joshua Casner");
assert.equal(await page.inputValue("#dsSignerEmail"), "josh@casner.example");
assert.equal(await page.inputValue("#dsCounterName"), "Manoj Narang");
assert.match(await page.inputValue("#dsSubject"), /2306 Clark Lane.*Casner Construction Inc/);
assert.ok((await page.inputValue("#dsMessage")).includes("2306 Clark Lane"), "section 8 text must carry over");
console.log("  ok: section 9 tracks the form above");

// Once you type in a field it is yours; Refresh puts it back under auto-fill.
await page.fill("#dsSubject", "Hand-written subject");
await page.fill("#project", "2306 Clark Lane - Phase 2");
await page.waitForTimeout(400);
assert.equal(await page.inputValue("#dsSubject"), "Hand-written subject", "an edited field must not be overwritten");
assert.ok((await page.inputValue("#dsMessage")).includes("Phase 2"), "untouched fields keep tracking");
await page.click("#dsRefresh");
await page.waitForTimeout(200);
assert.match(await page.inputValue("#dsSubject"), /Phase 2/, "Refresh must re-derive everything");
console.log("  ok: edited fields are respected, Refresh resets them");

const doc = await page.evaluate(async () => {
  const { blob, name } = await genDocx(true);
  const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  return { name, size: blob.size, b64: url.slice(url.indexOf(",") + 1) };
});
assert.match(doc.name, /^Subcontract_Casner_Construction_Inc.*\.docx$/);
assert.ok(doc.size > 8000, "the generated document looks too small to be a real contract");

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "scb-")), "out.docx");
fs.writeFileSync(file, Buffer.from(doc.b64, "base64"));
const xml = execSync(`unzip -p ${file} word/document.xml`).toString();
const text = xml.replace(/<[^>]+>/g, "");

for (const anchor of ["/sn1/", "/cn1/"]) {
  assert.equal(text.split(anchor).length - 1, 1, `${anchor} must appear exactly once — DocuSign places one tab per anchor`);
}
assert.ok(
  /<w:color w:val="FFFFFF"\/>[\s\S]{0,120}?<w:sz w:val="2"\/>/.test(xml) ||
    /<w:sz w:val="2"\/>[\s\S]{0,120}?<w:color w:val="FFFFFF"\/>/.test(xml),
  "anchors must be white 1pt so they are invisible on paper"
);
assert.ok(text.includes("SUBCONTRACT AGREEMENT"), "contract body missing");
assert.ok(text.includes("Casner Construction Inc"), "subcontractor missing from the contract");
assert.match(text, /one hundred eighty[- ]four thousand five hundred/i, "price-to-words broken");
console.log("  ok: generated .docx carries both anchors, invisible, contract intact");

assert.deepEqual(errors, [], "the page must load without JavaScript errors");
await browser.close();
console.log("e2e.test.mjs — passed");
