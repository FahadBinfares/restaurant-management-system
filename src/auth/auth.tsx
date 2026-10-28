import { useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { Loading } from "../components/ui";
import { sessionEvents } from "../lib/api";
import { AuthContext, ME_QUERY_KEY, useCan, useMeQuery } from "./hooks";

/** Renders children only for a signed-in employee with completed account setup. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const { data: me, isPending } = useMeQuery();

  useEffect(() => {
    const expire = () => {
      queryClient.setQueryData(ME_QUERY_KEY, null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
    };
    sessionEvents.addEventListener("expired", expire);
    return () => sessionEvents.removeEventListener("expired", expire);
  }, [queryClient]);

  if (isPending) return <Loading />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (me.setupRequired && location.pathname !== "/account/setup") return <Navigate to="/account/setup" replace />;
  return <AuthContext value={me}>{children}</AuthContext>;
}

export function Can({ permission, children }: { permission: string; children: ReactNode }) {
  return useCan()(permission) ? children : null;
}
