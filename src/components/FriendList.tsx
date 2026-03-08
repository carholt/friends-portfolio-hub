import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type FriendRow = { id: string; friend_user_id: string; created_at: string };

export function FriendList({ friends, onChanged }: { friends: FriendRow[]; onChanged?: () => void }) {
  const [pendingDelete, setPendingDelete] = useState<FriendRow | null>(null);

  const removeFriend = async () => {
    if (!pendingDelete) return;
    const { error } = await supabase.from("friends").delete().eq("id", pendingDelete.id);
    if (error) {
      toast.error(`Could not remove friend: ${error.message}`);
      return;
    }
    toast.success("Friend removed.");
    setPendingDelete(null);
    onChanged?.();
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Friends</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {friends.length === 0 ? <p className="text-sm text-muted-foreground">No friends added yet.</p> : null}
          {friends.map((friend) => (
            <div key={friend.id} className="rounded-md border p-3 text-sm flex items-center justify-between gap-2">
              <div>
                <p className="font-medium">{friend.friend_user_id}</p>
                <p className="text-muted-foreground">Connected {new Date(friend.created_at).toLocaleDateString()}</p>
              </div>
              <Button variant="destructive" size="sm" onClick={() => setPendingDelete(friend)}>Remove</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove friend?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the friend relationship and shared friend-based visibility.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={removeFriend}>Remove friend</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
