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

export default function SettingsPage() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("SEK");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("display_name, default_currency")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setDisplayName(data.display_name || "");
          setDefaultCurrency(data.default_currency);
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
      <Card className="max-w-lg">
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
    </AppLayout>
  );
}
