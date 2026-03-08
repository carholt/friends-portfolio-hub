import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EmptyState } from "@/components/feedback/EmptyState";

describe("EmptyState", () => {
  it("renders primary and secondary CTAs", () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    render(<EmptyState title="No items" message="Nothing here yet" ctaLabel="Create" onCta={onPrimary} secondaryCtaLabel="Import" onSecondaryCta={onSecondary} />);

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });
});
