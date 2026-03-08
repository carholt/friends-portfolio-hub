import { useEffect, useMemo, useState } from "react";
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
  const [defaultVisibility, setDefaultVisibility] = useState("private");
  const [loading, setLoading] = useState(false);
  const [subscriptionTier, setSubscriptionTier] = useState("free");

  const loginProviders = useMemo(() => user?.app_metadata?.providers || ["email"], [user]);

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
    else toast.success("Settings saved.");
    setLoading(false);
  };

  return (
    <AppLayout>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <Card className="max-w-lg mb-6">
        <CardHeader><CardTitle>Account</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={user?.email || ""} disabled className="text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <Label>Display name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Default currency</Label>
            <Select value={defaultCurrency} onValueChange={setDefaultCurrency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SEK">SEK</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Default portfolio visibility</Label>
            <Select value={defaultVisibility} onValueChange={setDefaultVisibility}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private (safe default)</SelectItem>
                <SelectItem value="authenticated">Logged-in users</SelectItem>
                <SelectItem value="group">Group</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm">
            <p className="font-medium">Login providers</p>
            <p className="text-muted-foreground">{loginProviders.join(", ")}</p>
          </div>
          <Button variant="hero" onClick={save} disabled={loading} className="w-full">
            {loading ? "Saving…" : "Save"}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => supabase.auth.signOut()}>Sign out</Button>
            <Button variant="outline" onClick={() => toast.info("Data export endpoint is not enabled yet.")}>Data export</Button>
            <Button variant="outline" onClick={() => toast.info("Disconnect provider is only available for OAuth connections.")}>Disconnect provider</Button>
            <Button variant="destructive" onClick={() => toast.warning("Account deletion flow is not implemented yet. Contact support.")}>Delete account (placeholder)</Button>
          </div>
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
