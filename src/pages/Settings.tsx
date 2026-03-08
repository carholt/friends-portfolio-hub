import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { env } from "@/config/env";
import { Link } from "react-router-dom";

export default function SettingsPage() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("SEK");
  const [loading, setLoading] = useState(false);
  const [subscriptionTier, setSubscriptionTier] = useState("free");

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("display_name, default_currency, subscription_tier")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setDisplayName(data.display_name || "");
          setDefaultCurrency(data.default_currency);
          setSubscriptionTier((data.subscription_tier || "free").toLowerCase());
        }
      });
  }, [user]);

  const save = async () => {
    if (!user) return;
    setLoading(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim(), default_currency: defaultCurrency })
      .eq("user_id", user.id);
    if (error) toast.error(error.message);
    else toast.success("Profil sparad!");
    setLoading(false);
  };

  return (
    <AppLayout>
      <h1 className="text-2xl font-bold mb-6">Inställningar</h1>
      <Card className="max-w-lg mb-6">
        <CardHeader><CardTitle>Profil</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>E-post</Label>
            <Input value={user?.email || ""} disabled className="text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <Label>Visningsnamn</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Standardvaluta</Label>
            <Select value={defaultCurrency} onValueChange={setDefaultCurrency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SEK">SEK</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="hero" onClick={save} disabled={loading} className="w-full">
            {loading ? "Sparar…" : "Spara"}
          </Button>
        </CardContent>
      </Card>



      <Card className="max-w-lg mt-6">
        <CardHeader><CardTitle>Symbol resolution admin</CardTitle></CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link to="/settings/symbol-resolution">Open symbol resolution tool</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader><CardTitle>Debug</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><span className="font-medium">Paywall status:</span> {env.paywallEnabled ? "ON" : "OFF"}</p>
          <p><span className="font-medium">Your tier:</span> {subscriptionTier}</p>
        </CardContent>
      </Card>
    </AppLayout>
  );
}
