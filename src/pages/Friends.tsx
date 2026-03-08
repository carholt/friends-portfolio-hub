import { useQuery } from "@tanstack/react-query";
import AppLayout from "@/components/AppLayout";
import { FriendList } from "@/components/FriendList";
import { supabase } from "@/integrations/supabase/client";

export default function FriendsPage() {
  const { data: friends = [] } = useQuery({
    queryKey: ["friends"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as { from: (table: string) => ReturnType<typeof supabase.from> }).from("friends").select("id,friend_user_id,created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <AppLayout>
      <h1 className="text-2xl font-bold">Friends</h1>
      <FriendList friends={friends} />
    </AppLayout>
  );
}
