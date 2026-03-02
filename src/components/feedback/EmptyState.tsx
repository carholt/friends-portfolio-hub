import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Inbox } from "lucide-react";

interface Props {
  title: string;
  message: string;
  ctaLabel: string;
  onCta: () => void;
}

export function EmptyState({ title, message, ctaLabel, onCta }: Props) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <Inbox className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-muted-foreground mb-4">{message}</p>
        <Button onClick={onCta}>{ctaLabel}</Button>
      </CardContent>
    </Card>
  );
}
