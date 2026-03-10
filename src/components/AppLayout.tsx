import { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Home, Briefcase, Trophy, Users, Settings, LogOut, UserPlus, GitCompareArrows, Lightbulb } from "lucide-react";
import { useAppBootstrap } from "@/hooks/useAppBootstrap";
import { DebugPanel } from "@/components/DebugPanel";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: Home },
  { to: "/home", label: "Home", icon: Home },
  { to: "/portfolios", label: "Portfolios", icon: Briefcase },
  { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/friends", label: "Friends", icon: UserPlus },
  { to: "/compare", label: "Compare", icon: GitCompareArrows },
  { to: "/ideas", label: "Ideas", icon: Lightbulb },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: bootstrap } = useAppBootstrap();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const appEnv = import.meta.env.MODE;
  const appVersion = import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_COMMIT_HASH || "dev";

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-7xl gap-6 px-4 pb-24 pt-6 md:pb-6">
        <aside className="sticky top-6 hidden h-fit w-56 space-y-4 md:block">
          <div className="rounded-xl border bg-card p-3">
            <p className="truncate text-sm font-medium">{user?.email}</p>
            <Button variant="ghost" className="mt-2 w-full justify-start gap-2" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
          <nav className="space-y-1 rounded-xl border bg-card p-2">
            {navItems.map((item) => (
              <Link key={item.to} to={item.to}>
                <Button
                  variant={location.pathname.startsWith(item.to) ? "secondary" : "ghost"}
                  className="w-full justify-start gap-2"
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Button>
              </Link>
            ))}
          </nav>
        </aside>

        <main className="w-full space-y-4">
          {bootstrap?.profileMissing && (
            <div className="rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900">
              We’re still setting up your account.
            </div>
          )}
          {children}
          <DebugPanel bootstrap={bootstrap} />
          <div className="pt-2 text-xs text-muted-foreground">Environment: {appEnv} · Version: {appVersion}</div>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 p-2 backdrop-blur md:hidden">
        <div className="grid grid-cols-4 gap-1">
          {navItems.map((item) => (
            <Link key={item.to} to={item.to}>
              <Button
                variant={location.pathname.startsWith(item.to) ? "secondary" : "ghost"}
                className="h-12 w-full flex-col gap-1 px-1 text-xs"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Button>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
