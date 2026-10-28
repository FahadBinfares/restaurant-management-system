import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { AppRoutes } from "../App";
import type { Me } from "../lib/types";

export interface MockCall { method: string; path: string; search: URLSearchParams; body: unknown; headers: Headers }
type Handler = (call: MockCall) => { status?: number; body?: unknown } | undefined;

/**
 * Replaces fetch with an in-memory API. Handlers are matched by "METHOD /path"
 * (path without the /api prefix and query string). Unmatched calls return 404.
 */
export function mockApi(handlers: Record<string, Handler>) {
  const calls: MockCall[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, "http://localhost");
    const call: MockCall = {
      method: init.method ?? "GET",
      path: url.pathname.replace(/^\/api/, ""),
      search: url.searchParams,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: new Headers(init.headers),
    };
    calls.push(call);
    const result = handlers[`${call.method} ${call.path}`]?.(call)
      ?? { status: 404, body: { error: { code: "NOT_FOUND", message: "Not found" } } };
    const status = result.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(result.body ?? {}), {
      status, headers: { "Content-Type": "application/json" },
    });
  }));
  return calls;
}

export function me(role: Me["employee"]["role"], permissions: string[]): Me {
  return {
    employee: { id: "e1", name: "موظف اختبار", phone: "+966500000001", role, mustChangePassword: false, totpEnabled: false },
    permissions,
    setupRequired: null,
    sessionId: "s1",
    settings: { sessionIdleMinutes: 30, alertLeadMinutes: 60 },
  };
}

export const emptyDashboard = {
  data: {
    date: "2026-10-28", alertLeadMinutes: 60,
    today: { total: 0, confirmed: 0, preparing: 0, ready: 0, completed: 0, cancelled: 0, drafts: 0 },
    upcoming: [], delayed: [], deliveryProblems: [],
  },
};

export function renderApp(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
