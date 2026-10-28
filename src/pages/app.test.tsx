import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderSummary } from "../lib/types";
import { emptyDashboard, me, mockApi, renderApp } from "../test/render";

afterEach(() => vi.unstubAllGlobals());

const RECEPTION = ["view_customers", "manage_customers", "view_orders", "create_orders", "confirm_orders", "view_payments", "record_payments"];
const OPERATIONS = ["view_customers", "view_orders", "update_order_status", "assign_drivers", "view_kitchen_reports"];

function order(overrides: Partial<OrderSummary>): OrderSummary {
  return {
    id: "o1", number: "ORD-2026-0001", orderType: "individual", status: "confirmed", customerId: "c1",
    customerName: "محمد", customerPhone: "+966512345678", fulfillmentType: "delivery",
    scheduledAt: "2026-10-28T16:00:00.000Z", total: 12_500, deliveryStatus: "unassigned", driver: null,
    archivedAt: null, version: 2, updatedAt: "2026-10-28T10:00:00.000Z", ...overrides,
  };
}

describe("authentication", () => {
  it("redirects anonymous visitors to the sign-in page", async () => {
    mockApi({ "GET /auth/me": () => ({ status: 401, body: { error: { code: "UNAUTHENTICATED", message: "" } } }) });
    renderApp("/orders");
    expect(await screen.findByRole("heading", { name: "تسجيل دخول الموظفين" })).toBeInTheDocument();
  });

  it("asks for an authenticator code when the account uses MFA, then signs in", async () => {
    let loggedIn = false;
    const calls = mockApi({
      "GET /auth/me": () => loggedIn ? { body: { data: me("admin", ["view_orders"]) } } : { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "" } } },
      "POST /auth/login": ({ body }) => {
        if (!(body as { totpCode?: string }).totpCode) return { status: 401, body: { error: { code: "MFA_REQUIRED", message: "" } } };
        loggedIn = true;
        return { body: { data: me("admin", ["view_orders"]) } };
      },
      "GET /dashboard": () => ({ body: emptyDashboard }),
    });
    const user = userEvent.setup();
    renderApp("/login");
    await user.type(await screen.findByLabelText("رقم الجوال"), "0500000001");
    await user.type(screen.getByLabelText("كلمة المرور"), "secret-password");
    await user.click(screen.getByRole("button", { name: "دخول" }));
    const code = await screen.findByLabelText("رمز التحقق (تطبيق المصادقة)");
    await user.type(code, "123456");
    await user.click(screen.getByRole("button", { name: "دخول" }));
    expect(await screen.findByRole("heading", { name: "لوحة التحكم" })).toBeInTheDocument();
    const login = calls.filter((call) => call.path === "/auth/login");
    expect(login[1]!.body).toEqual({ phone: "0500000001", password: "secret-password", totpCode: "123456" });
    // Every state-changing request carries the CSRF header the backend requires.
    expect(login.every((call) => call.headers.get("X-Requested-With") === "rms")).toBe(true);
  });

  it("forces a temporary-password change before anything else", async () => {
    mockApi({ "GET /auth/me": () => ({ body: { data: { ...me("reception", RECEPTION), setupRequired: "PASSWORD_CHANGE_REQUIRED" } } }) });
    renderApp("/orders");
    expect(await screen.findByText("غيّر كلمة المرور المؤقتة")).toBeInTheDocument();
  });
});

describe("orders page", () => {
  it("lists orders from the API and sends combined filters as query parameters", async () => {
    const calls = mockApi({
      "GET /auth/me": () => ({ body: { data: me("reception", RECEPTION) } }),
      "GET /dashboard": () => ({ body: emptyDashboard }),
      "GET /orders": () => ({
        body: { data: [order({ paymentStatus: "partially_paid", paidAmount: 5_000 })], pagination: { page: 1, pageSize: 25, total: 1 } },
      }),
    });
    const user = userEvent.setup();
    renderApp("/orders");
    const row = (await screen.findByText("ORD-2026-0001")).closest("tr")!;
    expect(within(row).getByText("محمد")).toBeInTheDocument();
    expect(within(row).getByText("125.00 ر.س")).toBeInTheDocument();
    expect(within(row).getByText("مدفوع جزئياً")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("حالة الطلب"), "confirmed");
    await user.selectOptions(screen.getByLabelText("طريقة الاستلام"), "pickup");
    await waitFor(() => {
      const last = calls.filter((call) => call.path === "/orders").at(-1)!;
      expect(last.search.get("status")).toBe("confirmed");
      expect(last.search.get("fulfillmentType")).toBe("pickup");
    });
  });

  it("shows a clear empty state when filters match nothing", async () => {
    mockApi({
      "GET /auth/me": () => ({ body: { data: me("reception", RECEPTION) } }),
      "GET /dashboard": () => ({ body: emptyDashboard }),
      "GET /orders": () => ({ body: { data: [], pagination: { page: 1, pageSize: 25, total: 0 } } }),
    });
    renderApp("/orders?status=cancelled");
    expect(await screen.findByText("لا توجد طلبات تطابق الفلاتر")).toBeInTheDocument();
  });

  it("hides payment information and actions from staff without payment permissions", async () => {
    mockApi({
      "GET /auth/me": () => ({ body: { data: me("operations", OPERATIONS) } }),
      "GET /dashboard": () => ({ body: emptyDashboard }),
      "GET /orders": () => ({ body: { data: [order({})], pagination: { page: 1, pageSize: 25, total: 1 } } }),
    });
    renderApp("/orders");
    await screen.findByText("ORD-2026-0001");
    expect(screen.queryByLabelText("حالة الدفع")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "الدفع" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "طلب جديد" })).not.toBeInTheDocument();
  });

  it("opens the order drawer and keeps the list filters when it closes", async () => {
    mockApi({
      "GET /auth/me": () => ({ body: { data: me("operations", OPERATIONS) } }),
      "GET /dashboard": () => ({ body: emptyDashboard }),
      "GET /orders": () => ({ body: { data: [order({})], pagination: { page: 1, pageSize: 25, total: 1 } } }),
      "GET /orders/o1": () => ({
        body: { data: { ...order({}), lines: [], subtotal: 10_000, discountAmount: 0, deliveryFee: 2_500, vatAmount: 1_630,
          discountType: "none", discountValue: 0, discountReason: null, kitchenNotes: "بدون بصل", deliveryAddress: "الرياض",
          deliveryMapsUrl: null, deliveryNotes: null, guestCount: null, cancelReason: null } },
      }),
      "GET /orders/o1/audit": () => ({ body: { data: [] } }),
    });
    const user = userEvent.setup();
    renderApp("/orders?status=confirmed");
    await user.click(await screen.findByText("ORD-2026-0001"));
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText("بدون بصل")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "بدء التحضير" })).toBeInTheDocument();
    expect(within(drawer).queryByRole("tab", { name: "المدفوعات" })).not.toBeInTheDocument();
    await user.click(within(drawer).getAllByRole("button", { name: "إغلاق" })[0]!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("حالة الطلب")).toHaveValue("confirmed");
  });
});
