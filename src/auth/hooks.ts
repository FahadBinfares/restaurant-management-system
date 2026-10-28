import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { ApiError, get } from "../lib/api";
import type { Me } from "../lib/types";

export const AuthContext = createContext<Me | null>(null);

export const ME_QUERY_KEY = ["auth", "me"] as const;

export function useMeQuery() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      try {
        return (await get<{ data: Me }>("/auth/me")).data;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useMe() {
  const me = useContext(AuthContext);
  if (!me) throw new Error("useMe must be used inside RequireAuth");
  return me;
}

/** UI convenience only — the backend enforces every permission independently. */
export function useCan() {
  const me = useMe();
  return (permission: string) => me.permissions.includes(permission);
}
