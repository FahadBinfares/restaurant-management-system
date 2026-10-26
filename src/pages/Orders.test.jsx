import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Orders from "./Orders";
import { mockOrders } from "../data/mockOrdes";

// Reverse only the test input so sorting cannot pass on pre-sorted data.
vi.mock("../data/mockOrdes", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, mockOrders: [...original.mockOrders].reverse() };
});

function visibleOrderIds() {
  return screen.queryAllByRole("heading", { name: /^ID:/ })
    .map((heading) => heading.textContent.trim());
}

function setDate(container, value) {
  // Date inputs have no implicit ARIA role; the current UI has no label.
  fireEvent.change(container.querySelector('input[type="date"]'), {
    target: { value },
  });
}

describe("Orders regression baseline", () => {
  const baselineOrders = structuredClone(mockOrders);

  beforeEach(() => {
    // Give each test fresh fixtures, including after the same-date scenario.
    mockOrders.splice(0, mockOrders.length, ...structuredClone(baselineOrders));
  });

  it("shows every order sorted by scheduled time without mutating the source", () => {
    const originalIds = mockOrders.map((order) => order.id);
    render(<Orders />);

    expect(visibleOrderIds()).toEqual(["ID: 1001", "ID: 1002", "ID: 1003"]);
    expect(mockOrders.map((order) => order.id)).toEqual(originalIds);
    expect(screen.getByRole("combobox")).toHaveValue("all");
  });

  it("filters by scheduled date", () => {
    const { container } = render(<Orders />);
    setDate(container, "2026-10-21");
    expect(visibleOrderIds()).toEqual(["ID: 1002"]);
  });

  it("sorts orders on the same date by time rather than input order or ID", () => {
    const timesById = {
      1001: "2026-10-21T18:30:00",
      1002: "2026-10-21T09:00:00",
      1003: "2026-10-21T13:15:00",
    };
    mockOrders.forEach((order) => {
      order.scheduledAt = timesById[order.id];
    });
    const originalIds = mockOrders.map((order) => order.id);
    render(<Orders />);

    expect(visibleOrderIds()).toEqual(["ID: 1002", "ID: 1003", "ID: 1001"]);
    expect(mockOrders.map((order) => order.id)).toEqual(originalIds);
  });

  it.each([
    ["confirmed", "ID: 1001"],
    ["delivered", "ID: 1002"],
    ["cancelled", "ID: 1003"],
  ])("filters by %s status", async (status, expectedId) => {
    const user = userEvent.setup();
    render(<Orders />);
    await user.selectOptions(screen.getByRole("combobox"), status);
    expect(visibleOrderIds()).toEqual([expectedId]);
  });

  it("applies date and status together and rejects mismatched combinations", async () => {
    const user = userEvent.setup();
    const { container } = render(<Orders />);
    setDate(container, "2026-10-21");
    await user.selectOptions(screen.getByRole("combobox"), "delivered");
    expect(visibleOrderIds()).toEqual(["ID: 1002"]);

    await user.selectOptions(screen.getByRole("combobox"), "confirmed");
    expect(visibleOrderIds()).toEqual([]);
    expect(screen.getByText("لايوجد طلبات في التاريخ المحدد")).toBeInTheDocument();
  });

  it("shows the Arabic empty state when no date matches", () => {
    const { container } = render(<Orders />);
    setDate(container, "2026-11-01");
    expect(visibleOrderIds()).toEqual([]);
    expect(screen.getByText("لايوجد طلبات في التاريخ المحدد")).toBeInTheDocument();
  });

  it("resets both controls and restores every order from an empty result", async () => {
    const user = userEvent.setup();
    const { container } = render(<Orders />);
    const statusSelect = screen.getByRole("combobox");
    setDate(container, "2026-10-21");
    await user.selectOptions(statusSelect, "confirmed");
    expect(statusSelect).toHaveValue("confirmed");
    expect(visibleOrderIds()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "All Orders" }));
    expect(container.querySelector('input[type="date"]')).toHaveValue("");
    expect(statusSelect).toHaveValue("all");
    expect(screen.getByRole("option", { name: "جميع الطلبات" }).selected).toBe(true);
    expect(visibleOrderIds()).toEqual(["ID: 1001", "ID: 1002", "ID: 1003"]);
    expect(screen.queryByText("لايوجد طلبات في التاريخ المحدد")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "cancelled");
    expect(visibleOrderIds()).toEqual(["ID: 1003"]);
  });
});
