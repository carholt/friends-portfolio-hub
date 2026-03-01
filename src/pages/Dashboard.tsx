import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Briefcase, TrendingUp, TrendingDown } from "lucide-react";
import CreatePortfolioDialog from "@/components/CreatePortfolioDialog";

interface Portfolio {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  base_currency: string;
  updated_at: string;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchPortfolios = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("portfolios")
      .select("*")
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: false });
    setPortfolios(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchPortfolios();
  }, [user]);

  const visibilityLabel = (v: string) => {
    const map: Record<string, string> = {
      private: "Privat",
      authenticated: "Inloggade",
      group: "Grupp",
      public: "Publik",
    };
    return map[v] || v;
  };

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Mina portföljer</h1>
          <p className="text-muted-foreground">Hantera och följ dina investeringar</p>
        </div>
        <Button variant="hero" onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Ny portfölj
        </Button>
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader><div className="h-5 w-32 bg-muted rounded" /></CardHeader>
              <CardContent><div className="h-4 w-24 bg-muted rounded" /></CardContent>
            </Card>
          ))}
        </div>
      ) : portfolios.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Briefcase className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Inga portföljer ännu</h3>
            <p className="text-muted-foreground mb-4">Skapa din första portfölj och börja följa dina investeringar.</p>
            <Button variant="hero" onClick={() => setShowCreate(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Skapa portfölj
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {portfolios.map((p) => (
            <Link key={p.id} to={`/portfolio/${p.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <CardTitle className="text-lg">{p.name}</CardTitle>
                  <Badge variant={p.visibility as any}>{visibilityLabel(p.visibility)}</Badge>
                </CardHeader>
                <CardContent>
                  {p.description && <p className="text-sm text-muted-foreground mb-2">{p.description}</p>}
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{p.base_currency}</span>
                    <span>Uppdaterad: {new Date(p.updated_at).toLocaleDateString("sv-SE")}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <CreatePortfolioDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={fetchPortfolios}
      />
    </AppLayout>
  );
}
