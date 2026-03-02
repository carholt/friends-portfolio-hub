import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Users, Mail, Check, X } from "lucide-react";
import { toast } from "sonner";

export default function Groups() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [showInvite, setShowInvite] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");

  const fetchData = async () => {
    if (!user) return;
    // Fetch groups where user is member
    const { data: memberships } = await supabase
      .from("group_members")
      .select("group_id, role, group:groups(id, name, owner_user_id, created_at)")
      .eq("user_id", user.id);

    setGroups(memberships?.map(m => ({ ...m.group, role: m.role })) || []);

    // Fetch pending invites for this user
    const { data: inv } = await supabase
      .from("group_invites")
      .select("*, group:groups(name)")
      .eq("invited_user_id", user.id)
      .eq("status", "pending");

    setInvites(inv || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user]);

  const createGroup = async () => {
    if (!user || !newGroupName.trim()) return;
    const { error } = await supabase.from("groups").insert({
      owner_user_id: user.id,
      name: newGroupName.trim(),
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Grupp skapad!");
      setNewGroupName("");
      setShowCreate(false);
      fetchData();
    }
  };

  const sendInvite = async (groupId: string) => {
    if (!user || !inviteEmail.trim()) return;

    const { error } = await supabase.from("group_invites").insert({
      group_id: groupId,
      invited_email: inviteEmail.trim(),
      invited_by_user_id: user.id,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Inbjudan skickad!");
      setInviteEmail("");
      setShowInvite(null);
    }
  };

  const respondInvite = async (inviteId: string, accept: boolean) => {
    if (!user) return;
    const { error } = await supabase
      .from("group_invites")
      .update({ status: accept ? "accepted" : "declined", responded_at: new Date().toISOString() })
      .eq("id", inviteId);

    if (error) {
      toast.error(error.message);
      return;
    }

    if (accept) {
      const invite = invites.find(i => i.id === inviteId);
      if (invite) {
        await supabase.from("group_members").insert({
          group_id: invite.group_id,
          user_id: user.id,
          role: "member",
        });
      }
    }

    toast.success(accept ? "Inbjudan accepterad!" : "Inbjudan avvisad");
    fetchData();
  };

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Vängrupper</h1>
        </div>
        <Button variant="hero" onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Ny grupp
        </Button>
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <Card className="mb-6 border-primary/30">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><Mail className="h-4 w-4" /> Inbjudningar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {invites.map(inv => (
              <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg bg-muted">
                <span className="font-medium">{inv.group?.name || "Okänd grupp"}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="default" onClick={() => respondInvite(inv.id, true)} className="gap-1">
                    <Check className="h-3 w-3" /> Acceptera
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => respondInvite(inv.id, false)} className="gap-1">
                    <X className="h-3 w-3" /> Avvisa
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Groups list */}
      {loading ? (
        <div className="animate-pulse space-y-4">
          {[1, 2].map(i => <div key={i} className="h-20 bg-muted rounded-lg" />)}
        </div>
      ) : groups.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Inga grupper ännu</h3>
            <p className="text-muted-foreground mb-4">Skapa en grupp och bjud in dina vänner!</p>
            <Button onClick={() => setShowCreate(true)}>Create group</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map(g => (
            <Card key={g.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <h3 className="font-semibold">{g.name}</h3>
                  <Badge variant="secondary" className="text-xs mt-1">{g.role === "owner" ? "Ägare" : "Medlem"}</Badge>
                </div>
                {g.role === "owner" && (
                  <Button variant="outline" size="sm" onClick={() => setShowInvite(g.id)} className="gap-1">
                    <Mail className="h-3 w-3" /> Bjud in
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create group dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Skapa ny grupp</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Gruppnamn</Label>
              <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Mining-gänget" />
            </div>
            <Button variant="hero" className="w-full" onClick={createGroup} disabled={!newGroupName.trim()}>Skapa grupp</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Invite dialog */}
      <Dialog open={!!showInvite} onOpenChange={() => setShowInvite(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bjud in till gruppen</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>E-postadress</Label>
              <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="van@email.se" type="email" />
            </div>
            <Button variant="hero" className="w-full" onClick={() => showInvite && sendInvite(showInvite)} disabled={!inviteEmail.trim()}>Skicka inbjudan</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
