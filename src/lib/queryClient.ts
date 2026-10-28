import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        // Retrying client errors (401/403/404/409) only delays the message the employee needs.
        retry: (failureCount, error) => !(error instanceof ApiError && error.status < 500) && failureCount < 2,
        refetchOnWindowFocus: true,
      },
    },
  });
}
