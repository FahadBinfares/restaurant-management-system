import { expect, test, type Page } from "@playwright/test";

// Synthetic accounts created by server/src/scripts/e2e-prepare.ts.
const PASSWORD = "e2e-password-123";
const RECEPTION = "0500000102";
const OPERATIONS = "0500000103";

async function signIn(page: Page, phone: string) {
  await page.goto("/login");
  await page.getByLabel("رقم الجوال").fill(phone);
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "لوحة التحكم" })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "تسجيل دخول الموظفين" })).toBeVisible();
}

/** Tomorrow at 19:30 Riyadh time, as a datetime-local value. */
function tomorrowEvening() {
  const riyadh = new Date(Date.now() + 3 * 3_600_000 + 86_400_000);
  return `${riyadh.toISOString().slice(0, 10)}T19:30`;
}

test("a banquet order goes from creation to the kitchen with a partial payment", async ({ page }) => {
  await signIn(page, RECEPTION);

  // Create the order with a brand-new customer.
  await page.getByRole("link", { name: "طلب جديد" }).first().click();
  await expect(page.getByRole("heading", { name: "طلب جديد" })).toBeVisible();
  await page.getByRole("button", { name: "عميل جديد" }).click();
  const customerDialog = page.getByRole("dialog", { name: "عميل جديد" });
  await customerDialog.getByLabel("اسم العميل").fill("عميل الاختبار الآلي");
  await customerDialog.getByLabel("رقم الجوال").fill("055 444 3322");
  await customerDialog.getByLabel("العنوان", { exact: true }).fill("الرياض، حي الياسمين، قاعة الاختبار");
  await customerDialog.getByRole("button", { name: "حفظ العميل" }).click();
  await expect(page.getByText("عميل الاختبار الآلي")).toBeVisible();

  await page.getByLabel("نوع الطلب").selectOption("banquet");
  await page.getByLabel("عدد الضيوف (اختياري)").fill("20");
  await page.getByLabel("موعد التسليم (توقيت الرياض)").fill(tomorrowEvening());
  await page.getByLabel("إضافة باقة").selectOption({ label: "وليمة 20 شخص (2,800.00 ر.س)" });
  await page.getByLabel("إضافة منتج", { exact: true }).selectOption({ label: "المشروبات — مياه (كرتون) (18.00 ر.س)" });
  await page.getByLabel("كمية مياه (كرتون)").fill("2");
  await page.getByLabel("رسوم التوصيل (ر.س)").fill("50");
  await page.getByLabel("ملاحظات المطبخ").fill("تقديم الرز في صواني كبيرة");
  await expect(page.getByText("2,886.00 ر.س")).toBeVisible();

  // Review screen shows the server-calculated totals before confirmation.
  await page.getByRole("button", { name: "مراجعة وتأكيد" }).click();
  await expect(page.getByRole("heading", { name: /مراجعة الطلب ORD-\d{4}-\d{4,} قبل التأكيد/ })).toBeVisible();
  await expect(page.getByText("2,886.00 ر.س").first()).toBeVisible();
  await page.getByRole("button", { name: "تأكيد الطلب" }).click();

  // The drawer opens on the confirmed order.
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("مؤكد", { exact: true })).toBeVisible();
  const orderNumber = (await drawer.locator("span.font-mono").first().textContent())!.trim();
  expect(orderNumber).toMatch(/^ORD-\d{4}-\d{4,}$/);

  // Record a partial cash payment.
  await drawer.getByRole("tab", { name: "المدفوعات" }).click();
  await drawer.getByLabel("المبلغ (ر.س)").fill("1000");
  await drawer.getByRole("button", { name: "تسجيل دفعة" }).click();
  await expect(drawer.getByText("مدفوع جزئياً")).toBeVisible();
  await expect(drawer.getByText("1,886.00 ر.س")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await signOut(page);

  // Operations sees it in tomorrow's kitchen report and starts preparation.
  await signIn(page, OPERATIONS);
  await page.getByRole("link", { name: "تقرير المطبخ" }).click();
  await page.getByLabel("التاريخ").fill(tomorrowEvening().slice(0, 10));
  const card = page.locator("article", { hasText: orderNumber });
  await expect(card).toContainText("وليمة 20 شخص");
  await expect(card).toContainText("تقديم الرز في صواني كبيرة");
  await expect(card).not.toContainText("ر.س"); // No prices in the kitchen report.

  await page.getByRole("link", { name: "الطلبات" }).click();
  await page.getByLabel("بحث").fill(orderNumber);
  await page.getByRole("button", { name: orderNumber }).click();
  await page.getByRole("dialog").getByRole("button", { name: "بدء التحضير" }).click();
  await page.getByRole("dialog", { name: "بدء التحضير" }).getByRole("button", { name: "تأكيد" }).click();
  await expect(page.getByRole("dialog").getByText("قيد التحضير").first()).toBeVisible();

  // The audit tab shows who did what.
  await page.getByRole("dialog").getByRole("tab", { name: "سجل التعديلات" }).click();
  await expect(page.getByRole("dialog").getByText("تأكيد الطلب")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("تغيير الحالة")).toBeVisible();
});

test("operations staff cannot reach payment or catalog features", async ({ page }) => {
  await signIn(page, OPERATIONS);
  await expect(page.getByRole("link", { name: "المنتجات والباقات" })).toHaveCount(0);
  const response = await page.request.get("/api/payments?date=2026-10-28");
  expect(response.status()).toBe(403);
});
