import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PublicOnlyRoute from "@/components/auth/PublicOnlyRoute";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import HomePage from "./pages/Home";
import PortfoliosPage from "./pages/Portfolios";
import PortfolioDetail from "./pages/PortfolioDetail";
import PublicPortfolio from "./pages/PublicPortfolio";
import Leaderboard from "./pages/Leaderboard";
import Groups from "./pages/Groups";
import SettingsPage from "./pages/Settings";
import FriendsPage from "./pages/Friends";
import ComparePage from "./pages/Compare";
import IdeasPage from "./pages/Ideas";
import AssetCompanyPage from "./pages/AssetCompany";
import NotFound from "./pages/NotFound";
import { envError } from "@/config/env";
import { ErrorState } from "@/components/feedback/ErrorState";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

const App = () => {
  if (envError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-xl w-full">
          <ErrorState title="Environment setup needed" message={`${envError}. Please set env vars and redeploy.`} actionLabel="Reload" onAction={() => window.location.reload()} />
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route element={<PublicOnlyRoute />}>
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
              </Route>

              <Route element={<ProtectedRoute />}>
                <Route path="/home" element={<HomePage />} />
                <Route path="/portfolios" element={<PortfoliosPage />} />
                <Route path="/dashboard" element={<Navigate to="/portfolios" replace />} />
                <Route path="/portfolio/:id" element={<PortfolioDetail />} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/groups" element={<Groups />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/friends" element={<FriendsPage />} />
                <Route path="/compare" element={<ComparePage />} />
                <Route path="/ideas" element={<IdeasPage />} />
                <Route path="/assets/:symbol" element={<AssetCompanyPage />} />
              </Route>

              <Route path="/p/:slug" element={<PublicPortfolio />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
