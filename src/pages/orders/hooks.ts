import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get } from "../../lib/api";
import type { Order } from "../../lib/types";

export function useOrder(orderId: string | undefined) {
  return useQuery({
    queryKey: ["order", orderId],
    queryFn: () => get<{ data: Order }>(`/orders/${orderId}`).then((response) => response.data),
    enabled: Boolean(orderId),
  });
}

/** Refreshes everything that shows this order after a change. */
export function useInvalidateOrder(orderId: string) {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["order", orderId] }),
    queryClient.invalidateQueries({ queryKey: ["orders"] }),
    queryClient.invalidateQueries({ queryKey: ["order-audit", orderId] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  ]);
}
