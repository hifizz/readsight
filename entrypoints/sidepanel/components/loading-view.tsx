import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

const LOADING_ROWS = [1, 2, 3] as const;

export function LoadingView() {
  return (
    <main className="p-3">
      <div className="flex h-9 items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-7 rounded-full" />
      </div>
      <Separator />
      <div className="space-y-2 pt-4">
        {LOADING_ROWS.map((item) => (
          <Skeleton key={item} className="h-12 w-full" />
        ))}
      </div>
    </main>
  );
}
