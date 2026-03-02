import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

interface Props {
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function ErrorState({ title = "Something went wrong", message, actionLabel = "Try again", onAction }: Props) {
  return (
    <Card>
      <CardContent className="py-10 text-center space-y-3">
        <AlertTriangle className="h-10 w-10 mx-auto text-destructive" />
        <h3 className="font-semibold text-lg">{title}</h3>
        <p className="text-sm text-muted-foreground">{message}</p>
        {onAction && <Button onClick={onAction}>{actionLabel}</Button>}
      </CardContent>
    </Card>
  );
}
