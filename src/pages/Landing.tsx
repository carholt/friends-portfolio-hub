import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TrendingUp, Shield, Users, BarChart3, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate("/home");
  }, [user, loading, navigate]);

  const features = [
    { icon: TrendingUp, title: "Prisuppdatering", desc: "Dagliga priser för aktier, ETF:er, guld och silver via Twelve Data." },
    { icon: Shield, title: "Full kontroll", desc: "Private, grupp, authenticated eller publika portföljer – du bestämmer." },
    { icon: Users, title: "Vängrupper", desc: "Skapa grupper, bjud in vänner och jämför era portföljer." },
    { icon: BarChart3, title: "Leaderboard", desc: "Se vem som presterar bäst – period för period." },
  ];

  return (
    <div className="min-h-screen bg-gradient-hero">
      {/* Hero */}
      <header className="container flex items-center justify-between py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-gold">
            <TrendingUp className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold text-foreground">PortfolioTracker</span>
        </div>
        <div className="flex gap-2">
          <Link to="/login"><Button variant="ghost" size="sm">Logga in</Button></Link>
          <Link to="/register"><Button variant="hero" size="sm">Skapa konto</Button></Link>
        </div>
      </header>

      <section className="container py-20 md:py-32 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
        >
          <h1 className="text-4xl md:text-6xl font-extrabold leading-tight mb-6">
            Följ, jämför &<br />
            <span className="text-gradient-gold">dominera marknaden</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            Guld, silver, mining-aktier och mer – håll koll på dina och dina vänners portföljer med dagliga prisuppdateringar och leaderboard.
          </p>
          <div className="flex gap-3 justify-center">
            <Link to="/register">
              <Button variant="hero" size="lg" className="gap-2">
                Kom igång gratis <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="/login">
              <Button variant="glass" size="lg">Logga in</Button>
            </Link>
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section className="container pb-20">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1, duration: 0.5 }}
              className="glass rounded-xl p-6"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mb-4">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
