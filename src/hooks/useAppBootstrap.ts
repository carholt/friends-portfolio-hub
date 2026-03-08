import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { env } from "@/config/env";

const PROFILE_RETRY_DELAY_MS = 350;

export interface AppBootstrapData {
  authLoaded: boolean;
  userLoaded: boolean;
  profileLoaded: boolean;
  profileMissing: boolean;
  profileError: string | null;
  onboardingCompleted: boolean;
  portfolioCount: number;
  portfolioError: string | null;
  paywallEnabled: boolean;
  subscriptionTier: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useAppBootstrap() {
  const { loading: authLoading, user } = useAuth();

  return useQuery<AppBootstrapData>({
    queryKey: ["app-bootstrap", user?.id, env.paywallEnabled],
    enabled: !authLoading && !!user,
    staleTime: 20_000,
    queryFn: async () => {
      const base: AppBootstrapData = {
        authLoaded: !authLoading,
        userLoaded: !!user,
        profileLoaded: false,
        profileMissing: false,
        profileError: null,
        onboardingCompleted: false,
        portfolioCount: 0,
        portfolioError: null,
        paywallEnabled: env.paywallEnabled,
        subscriptionTier: "free",
      };

      if (!user) return base;

      const loadProfile = async () => supabase
        .from("profiles")
        .select("onboarding_completed,subscription_tier")
        .eq("user_id", user.id)
        .maybeSingle();

      let profileResponse = await loadProfile();
      if (!profileResponse.data && !profileResponse.error) {
        await sleep(PROFILE_RETRY_DELAY_MS);
        profileResponse = await loadProfile();
      }

      if (profileResponse.error) {
        base.profileError = profileResponse.error.message;
        base.profileLoaded = false;
      } else if (!profileResponse.data) {
        base.profileMissing = true;
        base.profileLoaded = false;
      } else {
        base.profileLoaded = true;
        base.onboardingCompleted = !!profileResponse.data.onboarding_completed;
        base.subscriptionTier = String(profileResponse.data.subscription_tier || "free").toLowerCase();
      }

      const portfoliosResponse = await supabase
        .from("portfolios")
        .select("id", { count: "exact", head: true });

      if (portfoliosResponse.error) {
        base.portfolioError = portfoliosResponse.error.message;
      } else {
        base.portfolioCount = portfoliosResponse.count ?? 0;
      }

      return base;
    },
  });
}
