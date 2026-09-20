import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

// SKIPPED: these tests were written for the local-only (IndexedDB, no login, offline) version.
// The app now requires a Google sign-in and stores data in Supabase, so they need a mocked
// Supabase (or a dedicated test project) before they can run again. Never point them at real data.
test.skip(true, "e2e suite pending rewrite for Supabase auth/storage");

async function open(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "ชื่อโน้ต", exact: true }),
  ).toBeEditable();
}
async function newNote(page: Page, title: string, text: string) {
  await page
    .getByRole("button", { name: "สร้างโน้ตใหม่", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "ชื่อโน้ต", exact: true })
    .fill(title);
  await page
    .getByRole("textbox", { name: "เนื้อหาโน้ต", exact: true })
    .fill(text);
  await expect(page.getByText("บันทึกแล้ว", { exact: true })).toBeVisible();
}
async function selectText(page: Page, text: string) {
  await page.locator(".note-prose").evaluate((el, value) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf(value) ?? -1;
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + value.length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        (el as HTMLElement).focus();
        return;
      }
    }
    throw new Error("Selection not found");
  }, text);
  await page.getByRole("button", { name: "สรุปส่วนนี้", exact: true }).click();
}
async function configureAI(page: Page) {
  await page.getByRole("button", { name: "ตั้งค่า", exact: true }).click();
  await page
    .getByLabel("Base URL", { exact: true })
    .fill("https://llm.example/v1");
  await page.getByLabel("Model ID", { exact: true }).fill("mock-model");
  await page
    .getByPlaceholder("เว้นว่างได้สำหรับ local endpoint ที่ไม่ต้องใช้ key")
    .fill("test-secret-key");
  await page
    .getByRole("button", { name: "บันทึกการตั้งค่า", exact: true })
    .click();
  await expect(
    page.getByText("บันทึกการตั้งค่าแล้ว", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ปิด", exact: true }).click();
}

test("Thai editing, formatting, images persist across reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await newNote(page, "ทดสอบความคิด", "ข้อความภาษาไทยที่ต้องเก็บไว้");
  await page.getByLabel("ระดับหัวข้อ", { exact: true }).selectOption("2");
  await expect(page.locator(".note-prose h2")).toHaveText(
    "ข้อความภาษาไทยที่ต้องเก็บไว้",
  );
  await page
    .getByLabel("อัปโหลดรูปภาพ", { exact: true })
    .setInputFiles("public/icon-192.png");
  await expect(page.locator(".note-prose img")).toBeVisible();
  await expect(page.getByText("บันทึกแล้ว", { exact: true })).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "เปิดโน้ต ทดสอบความคิด", exact: true })
    .click();
  await expect(page.locator(".note-prose h2")).toHaveText(
    "ข้อความภาษาไทยที่ต้องเก็บไว้",
  );
  await expect(page.locator(".note-prose img")).toBeVisible();
  expect(errors).toEqual([]);
});

test("nested categories, note move, search, trash and restore", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "สร้างหมวดหมู่", exact: true })
    .click();
  await page.getByLabel("ชื่อหมวดหมู่", { exact: true }).fill("Learning");
  await page
    .getByRole("button", { name: "บันทึกหมวดหมู่", exact: true })
    .click();
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await page
    .getByRole("button", { name: "เพิ่มหมวดย่อย", exact: true })
    .click();
  await page.getByLabel("ชื่อหมวดหมู่", { exact: true }).fill("JavaScript");
  await page
    .getByRole("button", { name: "บันทึกหมวดหมู่", exact: true })
    .click();
  await page.getByRole("button", { name: "JavaScript", exact: true }).click();
  await newNote(page, "Async notes", "Await makes asynchronous work readable.");
  await expect(page.getByLabel("ย้ายโน้ตไปหมวดหมู่")).toHaveValue(/.+/);
  await page.getByLabel("ค้นหาโน้ต", { exact: true }).fill("asynchronous");
  await expect(
    page.getByRole("button", { name: "เปิดโน้ต Async notes", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ล้างการค้นหา", exact: true }).click();
  await page.getByRole("button", { name: "ลบโน้ต", exact: true }).click();
  await page
    .getByRole("button", { name: "ย้ายเข้าถังขยะ", exact: true })
    .click();
  await page.getByRole("button", { name: /^ถังขยะ/ }).click();
  await page.getByRole("button", { name: "กู้คืน", exact: true }).click();
  await page.getByRole("button", { name: /^โน้ตทั้งหมด/ }).click();
  await expect(
    page.getByRole("button", { name: "เปิดโน้ต Async notes", exact: true }),
  ).toBeVisible();
});

test("AI sends only selected text, previews, replaces and undoes once", async ({
  page,
}) => {
  await open(page);
  await newNote(
    page,
    "AI test",
    "Keep before. Only summarize this sentence. Keep after.",
  );
  await configureAI(page);
  let payload: any;
  await page.route("https://llm.example/v1/chat/completions", async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({
      json: { choices: [{ message: { content: "สรุปสั้น" } }] },
    });
  });
  await selectText(page, "Only summarize this sentence.");
  await page.getByRole("button", { name: "สร้างสรุป", exact: true }).click();
  await expect(page.locator(".result-text")).toHaveText("สรุปสั้น");
  expect(payload.messages[1].content).toBe("Only summarize this sentence.");
  expect(JSON.stringify(payload)).not.toContain("Keep before");
  await expect(page.locator(".note-prose")).toHaveText(
    "Keep before. Only summarize this sentence. Keep after.",
  );
  await page
    .getByRole("button", { name: "แทนที่ส่วนที่เลือก", exact: true })
    .click();
  await expect(page.locator(".note-prose")).toHaveText(
    "Keep before. สรุปสั้น Keep after.",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".note-prose")).toHaveText(
    "Keep before. Only summarize this sentence. Keep after.",
  );
});

test("AI section stops at peer heading and inserts summary without changing source", async ({
  page,
}) => {
  await open(page);
  await configureAI(page);
  let payload: any;
  await page.route("https://llm.example/v1/chat/completions", async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({
      json: { choices: [{ message: { content: "สรุปเรื่องการจด" } }] },
    });
  });
  await page.getByRole("button", { name: "สารบัญ", exact: true }).click();
  await page
    .getByRole("button", {
      name: "สรุปหัวข้อ 01 / เริ่มจากสิ่งที่อยู่ในหัว",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "สร้างสรุป", exact: true }).click();
  await expect(page.locator(".result-text")).toBeVisible();
  expect(payload.messages[1].content).toContain("ไฮไลต์สิ่งที่สำคัญ");
  expect(payload.messages[1].content).not.toContain("02 /");
  await page
    .getByRole("button", { name: "แทรกใต้ส่วนนี้", exact: true })
    .click();
  await expect(page.locator(".summary-block")).toContainText("สรุปเรื่องการจด");
  await expect(page.locator(".note-prose")).toContainText("ไฮไลต์สิ่งที่สำคัญ");
});

test("stale source disables AI replacement; provider errors preserve source", async ({
  page,
}) => {
  await open(page);
  await newNote(page, "stale", "Original selected text.");
  await configureAI(page);
  await page.route("https://llm.example/v1/chat/completions", (route) =>
    route.fulfill({ json: { choices: [{ message: { content: "Summary" } }] } }),
  );
  await selectText(page, "Original selected text.");
  await page.getByRole("button", { name: "สร้างสรุป", exact: true }).click();
  await expect(page.locator(".result-text")).toBeVisible();
  await page.locator(".note-prose").fill("Changed after the request.");
  await expect(
    page.getByRole("button", { name: "แทนที่ส่วนที่เลือก", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".ai-panel .warning")).toContainText(
    "ต้นฉบับมีการแก้ไข",
  );
  await page.unroute("https://llm.example/v1/chat/completions");
  await page.route("https://llm.example/v1/chat/completions", (route) =>
    route.fulfill({ status: 401, json: { error: "invalid key" } }),
  );
  await selectText(page, "Changed after the request.");
  await page.getByRole("button", { name: "สร้างสรุป", exact: true }).click();
  await expect(page.locator(".ai-panel .error")).toHaveText(
    "API key ไม่ถูกต้อง",
  );
  await expect(page.locator(".note-prose")).toHaveText(
    "Changed after the request.",
  );
});

test("ZIP round trip includes images and excludes API secrets", async ({
  page,
}) => {
  await open(page);
  await newNote(page, "Backup image note", "Backup content");
  await page
    .getByLabel("อัปโหลดรูปภาพ", { exact: true })
    .setInputFiles("public/icon-192.png");
  await expect(page.locator(".note-prose img")).toBeVisible();
  await configureAI(page);
  await page.getByRole("button", { name: "ตั้งค่า", exact: true }).click();
  await page
    .getByRole("button", { name: "ข้อมูลและสำรอง", exact: true })
    .click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "สำรองข้อมูล ZIP", exact: true })
    .click();
  const download = await pending;
  const path = (await download.path())!;
  const zip = await JSZip.loadAsync(await readFile(path));
  const manifest = await zip.file("manifest.json")!.async("string");
  expect(manifest).not.toContain("test-secret-key");
  expect(JSON.parse(manifest).assets).toHaveLength(1);
  await page.getByLabel("นำเข้าไฟล์สำรอง", { exact: true }).setInputFiles(path);
  await expect(page.getByText(/นำเข้า 2 โน้ตในหมวดใหม่แล้ว/)).toBeVisible();
  await page.getByRole("button", { name: "ปิด", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "เปิดโน้ต Backup image note",
      exact: true,
    }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "เปิดโน้ต Backup image note", exact: true })
    .first()
    .click();
  await expect(page.locator(".note-prose img")).toBeVisible();
});

test("one writer per note and explicit handover between tabs", async ({
  page,
  context,
}) => {
  await open(page);
  const second = await context.newPage();
  await second.goto("/");
  await expect(
    second.getByRole("textbox", { name: "ชื่อโน้ต", exact: true }),
  ).not.toBeEditable();
  await expect(second.locator(".lock-banner")).toContainText("อีกแท็บ");
  await second
    .getByRole("button", { name: "ขอสิทธิ์แก้ไข", exact: true })
    .click();
  await expect(
    second.getByRole("textbox", { name: "ชื่อโน้ต", exact: true }),
  ).toBeEditable();
  await expect(
    page.getByRole("textbox", { name: "ชื่อโน้ต", exact: true }),
  ).not.toBeEditable();
  await second
    .getByRole("textbox", { name: "ชื่อโน้ต", exact: true })
    .fill("Updated by second tab");
  await expect(second.getByText("บันทึกแล้ว", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "ชื่อโน้ต", exact: true }),
  ).toHaveValue("Updated by second tab");
});

test("PWA shell and notes reopen offline", async ({ page, context }) => {
  await open(page);
  await newNote(page, "Offline note", "ข้อมูลที่เปิดอ่านโดยไม่มีอินเทอร์เน็ต");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "เปิดโน้ต Offline note", exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await page
    .getByRole("button", { name: "เปิดโน้ต Offline note", exact: true })
    .click();
  await expect(page.locator(".note-prose")).toContainText(
    "ข้อมูลที่เปิดอ่านโดยไม่มีอินเทอร์เน็ต",
  );
  await expect(
    page.getByRole("textbox", { name: "ชื่อโน้ต", exact: true }),
  ).toBeEditable();
});

test("responsive navigation and desktop visual", async ({ page }) => {
  await open(page);
  await page.screenshot({
    path: "test-results/clever-note-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "หมวดหมู่", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "เปิดโน้ต A little space for big ideas",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("textbox", { name: "เนื้อหาโน้ต", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/clever-note-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "กลับไปรายการโน้ต", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "หมวดหมู่", exact: true }),
  ).toBeVisible();
});

test("save failure remains visible and unsaved text can be exported", async ({
  page,
}) => {
  await open(page);
  await newNote(page, "Storage recovery", "Saved original");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restoreWrites: () => void }).restoreWrites = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "notes")
        throw new DOMException("Simulated disk full", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await page
    .locator(".note-prose")
    .fill("Unsaved text that must not disappear");
  await expect(
    page.getByText("บันทึกไม่สำเร็จ", { exact: true }),
  ).toBeVisible();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ส่งออก Markdown", exact: true })
    .click();
  const path = (await (await pending).path())!;
  const archive = await JSZip.loadAsync(await readFile(path));
  expect(await archive.file("note.md")!.async("string")).toContain(
    "Unsaved text that must not disappear",
  );
  await page.evaluate(() =>
    (window as unknown as { restoreWrites: () => void }).restoreWrites(),
  );
  await page
    .getByRole("button", { name: "ลองบันทึกใหม่", exact: true })
    .click();
  await expect(page.getByText("บันทึกแล้ว", { exact: true })).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "เปิดโน้ต Storage recovery", exact: true })
    .click();
  await expect(page.locator(".note-prose")).toContainText(
    "Unsaved text that must not disappear",
  );
});

test("empty scope never sends a request and cancellation never inserts content", async ({
  page,
}) => {
  await open(page);
  await newNote(page, "Cancel AI", "Only selected source.");
  await configureAI(page);
  let calls = 0;
  let complete!: () => void;
  const gate = new Promise<void>((resolve) => {
    complete = resolve;
  });
  await page.route("https://llm.example/v1/chat/completions", async (route) => {
    calls++;
    await gate;
    await route
      .fulfill({
        json: { choices: [{ message: { content: "Late response" } }] },
      })
      .catch(() => {});
  });
  await page.locator(".note-prose").click();
  await page.locator(".note-prose").press("End");
  await page.getByRole("button", { name: "สรุปส่วนนี้", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "สร้างสรุป", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(0);
  await selectText(page, "Only selected source.");
  const sent = page.waitForRequest("https://llm.example/v1/chat/completions");
  await page.getByRole("button", { name: "สร้างสรุป", exact: true }).click();
  await sent;
  await page
    .getByRole("button", { name: "กำลังสรุป… ยกเลิก", exact: true })
    .click();
  complete();
  await expect(page.locator(".ai-panel .error")).toContainText("ยกเลิกแล้ว");
  await expect(page.locator(".result-text")).toHaveCount(0);
  await expect(page.locator(".note-prose")).toHaveText("Only selected source.");
});

test("image scope allows insertion but prevents replacement", async ({
  page,
}) => {
  await open(page);
  await newNote(page, "Image scope", "Text beside a picture.");
  await page
    .getByLabel("อัปโหลดรูปภาพ", { exact: true })
    .setInputFiles("public/icon-192.png");
  await expect(page.locator(".note-prose img")).toBeVisible();
  await configureAI(page);
  await page.route("https://llm.example/v1/chat/completions", (route) =>
    route.fulfill({
      json: { choices: [{ message: { content: "Text summary" } }] },
    }),
  );
  await page.locator(".note-prose").click();
  await page.locator(".note-prose").press("ControlOrMeta+A");
  await page.getByRole("button", { name: "สรุปส่วนนี้", exact: true }).click();
  await page.getByRole("button", { name: "สร้างสรุป", exact: true }).click();
  await expect(page.locator(".result-text")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "แทนที่ส่วนที่เลือก", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "แทรกใต้ส่วนนี้", exact: true })
    .click();
  await expect(page.locator(".note-prose img")).toBeVisible();
  await expect(page.locator(".summary-block")).toContainText("Text summary");
});

test("category deletion cannot remove a note being edited in another tab", async ({
  page,
  context,
}) => {
  await open(page);
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.locator(".lock-banner")).toContainText("อีกแท็บ");
  await second
    .getByRole("button", { name: "จัดการ Getting started", exact: true })
    .click();
  await second
    .getByRole("button", { name: "ลบหมวดหมู่นี้…", exact: true })
    .click();
  await second
    .getByLabel("ย้ายโน้ตทั้งหมดเข้าถังขยะด้วย", { exact: true })
    .check();
  await second
    .getByRole("button", { name: "ยืนยันลบหมวดหมู่", exact: true })
    .click();
  await expect(second.locator("dialog .error")).toContainText("อีกแท็บ");
  await expect(
    page.getByRole("textbox", { name: "ชื่อโน้ต", exact: true }),
  ).toBeEditable();
});

test("highlight contrast and checklist controls work", async ({ page }) => {
  await open(page);
  await expect(page.locator(".note-prose mark")).toHaveCSS(
    "color",
    "rgb(23, 32, 11)",
  );
  const item = page.locator(".note-prose li[data-checked]").first();
  await expect(item).toHaveCSS("display", "flex");
  await item.getByRole("checkbox").check();
  await expect(item).toHaveAttribute("data-checked", "true");
  await expect(page.getByText("บันทึกแล้ว", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".note-prose li[data-checked]").first(),
  ).toHaveAttribute("data-checked", "true");
});
