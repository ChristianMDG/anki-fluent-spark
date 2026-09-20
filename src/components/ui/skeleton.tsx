import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-xl bg-white/[0.06] border border-white/[0.05]", className)}
      {...props}
    />
  );
}

export { Skeleton };

