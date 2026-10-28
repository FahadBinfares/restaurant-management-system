export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

/** Fires when the server says the session is gone, so the app can return to sign-in. */
export const sessionEvents = new EventTarget();

export async function api<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  options: { body?: unknown; query?: Query; headers?: Record<string, string> } = {},
): Promise<T> {
  const response = await fetch(withQuery(`/api${path}`, options.query), {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      // Required by the backend's CSRF guard on state-changing requests.
      "X-Requested-With": "rms",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const body: ApiErrorBody = json?.error ?? { code: "HTTP_ERROR", message: response.statusText };
    if (response.status === 401 && body.code === "UNAUTHENTICATED") sessionEvents.dispatchEvent(new Event("expired"));
    throw new ApiError(response.status, body);
  }
  return json as T;
}

export const get = <T>(path: string, query?: Query) => api<T>("GET", path, { query });
export const post = <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
  api<T>("POST", path, { body: body ?? {}, headers });
export const patch = <T>(path: string, body: unknown) => api<T>("PATCH", path, { body });
export const put = <T>(path: string, body: unknown) => api<T>("PUT", path, { body });
export const del = <T>(path: string) => api<T>("DELETE", path);
