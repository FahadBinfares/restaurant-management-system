import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "./index.css";
import { RequireAuth } from "./auth/auth";
import { createQueryClient } from "./lib/queryClient";
import MainLayout from "./layouts/MainLayout";
import AccountPage, { AccountSetupPage } from "./pages/AccountPage";
import AdminPage from "./pages/AdminPage";
import CatalogPage from "./pages/CatalogPage";
import CustomersPage from "./pages/customers/CustomersPage";
import DashboardPage from "./pages/DashboardPage";
import DeliveryPage from "./pages/DeliveryPage";
import KitchenReportPage from "./pages/KitchenReportPage";
import LoginPage from "./pages/LoginPage";
import OrderEditorPage from "./pages/orders/OrderEditorPage";
import OrdersPage from "./pages/orders/OrdersPage";

const queryClient = createQueryClient();

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/account/setup" element={<RequireAuth><AccountSetupPage /></RequireAuth>} />
      <Route element={<RequireAuth><MainLayout /></RequireAuth>}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/new" element={<OrderEditorPage />} />
        <Route path="/orders/:id/edit" element={<OrderEditorPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/kitchen" element={<KitchenReportPage />} />
        <Route path="/delivery" element={<DeliveryPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/account" element={<AccountPage />} />
        {/* Links from the earlier prototype. */}
        <Route path="/Orders" element={<Navigate to="/orders" replace />} />
        <Route path="/reports/daily" element={<Navigate to="/kitchen" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
