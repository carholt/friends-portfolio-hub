import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useSessionGuard(errorMessage?: string | null) {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!errorMessage) return;
    const looksExpired = /jwt|session|expired|refresh token/i.test(errorMessage);
    if (!looksExpired) return;

    toast.error("Your session expired. Please sign in again.");
    signOut().finally(() => navigate("/login", { replace: true }));
  }, [errorMessage, navigate, signOut]);
}
