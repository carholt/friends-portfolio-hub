import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";

export default function PublicOnlyRoute() {
  const { user, loading } = useAuth();

  if (loading) return <div className="p-6 space-y-3"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-24 w-full" /></div>;

  if (user) return <Navigate to="/home" replace />;

  return <Outlet />;
}
