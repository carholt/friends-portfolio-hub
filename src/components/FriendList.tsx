import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type FriendRow = { id: string; friend_user_id: string; created_at: string };

export function FriendList({ friends }: { friends: FriendRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Friends</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {friends.length === 0 ? <p className="text-sm text-muted-foreground">No friends added yet.</p> : null}
        {friends.map((friend) => (
          <div key={friend.id} className="rounded-md border p-3 text-sm">
            <p className="font-medium">{friend.friend_user_id}</p>
            <p className="text-muted-foreground">Connected {new Date(friend.created_at).toLocaleDateString()}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
