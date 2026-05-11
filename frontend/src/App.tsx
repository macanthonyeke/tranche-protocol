import { Routes, Route } from "react-router-dom";
import { UserLayout } from "./components/UserLayout";
import { ArbiterLayout } from "./components/ArbiterLayout";
import { Dashboard } from "./pages/Dashboard";
import { CreateEscrow } from "./pages/CreateEscrow";
import { EscrowDetail } from "./pages/EscrowDetail";
import { Withdraw } from "./pages/Withdraw";
import { ArbiterDashboard } from "./pages/arbiter/ArbiterDashboard";
import { NotFound } from "./pages/NotFound";

export function App() {
  return (
    <Routes>
      <Route element={<UserLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="/create" element={<CreateEscrow />} />
        <Route path="/escrow/:id" element={<EscrowDetail />} />
        <Route path="/withdraw" element={<Withdraw />} />
      </Route>
      <Route element={<ArbiterLayout />}>
        <Route path="/arbiter" element={<ArbiterDashboard />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
