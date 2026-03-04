import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Trophy, TrendingUp, Users, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

const previewLeaders = [
  { name: "Lina", returnPct: 18.2, absolute: 124000 },
  { name: "Max", returnPct: 14.7, absolute: 101300 },
  { name: "Ari", returnPct: 12.9, absolute: 88210 },
];

export default function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate("/home");
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="container py-6 flex justify-between items-center">
        <h1 className="text-xl font-bold">Portfolio Tracker 2026</h1>
        <div className="flex gap-2"><Link to="/login"><Button variant="ghost">Login</Button></Link><Link to="/register"><Button>Sign up</Button></Link></div>
      </header>

      <main className="container space-y-8 pb-16">
        <section className="rounded-2xl border p-8 bg-gradient-to-br from-primary/10 to-background">
          <p className="text-sm uppercase tracking-widest text-muted-foreground">Social investing dashboard</p>
          <h2 className="text-4xl font-extrabold mt-2">Track. Trade. Compete with friends.</h2>
          <p className="text-muted-foreground mt-3 max-w-2xl">Run your portfolios with auditable buy/sell operations, import Nordea spreadsheets, and compare group performance in real time.</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link to="/register"><Button>Create portfolio</Button></Link>
            <Link to="/register"><Button variant="outline">Import (Nordea .xlsx)</Button></Link>
            <Link to="/register"><Button variant="outline">Join group</Button></Link>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-xl border p-4"><Sparkles className="h-4 w-4 mb-2 text-primary" /><p className="text-xs text-muted-foreground">Total value</p><p className="text-2xl font-bold">7.42M SEK</p></div>
          <div className="rounded-xl border p-4"><TrendingUp className="h-4 w-4 mb-2 text-emerald-500" /><p className="text-xs text-muted-foreground">Today change</p><p className="text-2xl font-bold">+1.8%</p></div>
          <div className="rounded-xl border p-4"><Trophy className="h-4 w-4 mb-2 text-amber-500" /><p className="text-xs text-muted-foreground">Best performer</p><p className="text-2xl font-bold">Lina +18.2%</p></div>
          <div className="rounded-xl border p-4"><Users className="h-4 w-4 mb-2 text-rose-500" /><p className="text-xs text-muted-foreground">Worst performer</p><p className="text-2xl font-bold">Noah -2.9%</p></div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border p-4">
            <h3 className="font-semibold mb-3">Leaderboard preview</h3>
            <div className="space-y-2">
              {previewLeaders.map((l, idx) => <div key={l.name} className="flex justify-between rounded bg-muted/50 px-3 py-2"><span>{idx + 1}. {l.name}</span><span>{l.returnPct}% · {l.absolute.toLocaleString()} SEK</span></div>)}
            </div>
          </div>
          <div className="rounded-xl border p-4">
            <h3 className="font-semibold mb-3">Highlights</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>• Auditable transaction ledger with buy/sell/adjust/remove</li>
              <li>• Group board for persistent investing notes</li>
              <li>• Nordea ISIN resolver to avoid unpriced holdings</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
