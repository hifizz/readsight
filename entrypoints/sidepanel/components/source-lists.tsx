import { useState } from 'react';
import {
  ChevronRight,
  ExternalLink,
  Folder,
  FolderCog,
  MoreHorizontal,
  Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { InboxRange, Project, Source } from '../types';
import { domainFor, relativeTime } from '../utils';

type SourceActions = {
  onAnalyze: (source: Source) => void;
  onEditMembership: (source: Source) => void;
};

export function InboxGroup({
  range,
  onRangeChange,
  loading,
  sources,
  ...actions
}: {
  range: InboxRange;
  onRangeChange: (range: InboxRange) => void;
  loading: boolean;
  sources: Source[];
} & SourceActions) {
  return (
    <section>
      <div className="flex h-7 items-center ">
        <h2 className="text-xs font-medium px-3">Inbox</h2>
        <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
          {sources.length}
        </span>
        <Select
          value={range}
          onValueChange={(value) => onRangeChange(value as InboxRange)}
        >
          <SelectTrigger
            size="sm"
            aria-label="Inbox 时间范围"
            className="ml-auto h-6 w-auto gap-0.5 border-transparent bg-transparent px-1.5 text-[10px] text-muted-foreground shadow-none hover:bg-muted focus-visible:border-transparent focus-visible:bg-muted focus-visible:ring-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" className="min-w-24">
            <SelectItem value="today">今天</SelectItem>
            <SelectItem value="7d">近 7 天</SelectItem>
            <SelectItem value="30d">近 30 天</SelectItem>
            <SelectItem value="all">全部</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {loading ? (
        <div className="space-y-1 py-1">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : sources.length === 0 ? (
        <p className="px-1 py-3 text-xs text-muted-foreground">
          这个时间范围内没有未归类链接。
        </p>
      ) : (
        <SourceRows sources={sources} {...actions} />
      )}
    </section>
  );
}

export function ProjectList({
  projects,
  sourcesByProject,
  ...actions
}: {
  projects: Project[];
  sourcesByProject: Map<string, Source[]>;
} & SourceActions) {
  return (
    <section>
      <div className="flex h-7 items-center ">
        <h2 className="text-xs font-medium px-3">Projects</h2>
        <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
          {projects.length}
        </span>
      </div>
      {projects.length === 0 ? (
        <p className="px-1 py-3 text-xs text-muted-foreground">
          创建 Project 后会显示在这里。
        </p>
      ) : (
        <div className="">
          {projects.map((project) => (
            <ProjectListItem
              key={project.id}
              project={project}
              sources={sourcesByProject.get(project.id) ?? []}
              {...actions}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectListItem({
  project,
  sources,
  ...actions
}: {
  project: Project;
  sources: Source[];
} & SourceActions) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-start gap-1 rounded-lg px-2 py-2 text-xs font-normal "
          title={project.name}
        >
          <ChevronRight
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <Folder className="size-4 shrink-0 text-primary" />
          <span className="max-w-[180px] min-w-0 flex-1 truncate text-left font-medium">
            {project.name}
          </span>
          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {sources.length}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-5 border-l pl-1 border-dashed">
          {sources.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">
              暂无链接。
            </p>
          ) : (
            <SourceRows sources={sources} {...actions} />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SourceRows({ sources, ...actions }: { sources: Source[] } & SourceActions) {
  return (
    <ul className="">
      {sources.map((source) => (
        <SourceRow key={source.id} source={source} {...actions} />
      ))}
    </ul>
  );
}

function SourceRow({
  source,
  onAnalyze,
  onEditMembership
}: { source: Source } & SourceActions) {
  return (
    <li className="group flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded-lg cursor-pointer">
      {source.faviconUrl ? (
        <img
          className="size-7 rounded-md bg-muted object-contain"
          src={source.faviconUrl}
          alt=""
        />
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">
          R
        </span>
      )}
      <div className="min-w-0 flex-1">
        <a
          className="block truncate text-xs font-medium hover:underline"
          href={source.originalUrl}
          target="_blank"
          rel="noreferrer"
          title={source.title}
        >
          {source.title}
        </a>
        <p className="truncate text-[10px] text-muted-foreground">
          {domainFor(source.originalUrl)} · {relativeTime(source.lastCapturedAt)}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            className="opacity-60 group-hover:opacity-100"
            aria-label={`${source.title} 的更多操作`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" >
          <DropdownMenuItem onSelect={() => onAnalyze(source)} className="text-xs text-muted-foreground">
            <Sparkles className='size-3.5' />
            分析与讨论
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onEditMembership(source)} className="text-xs text-muted-foreground">
            <FolderCog className='size-3.5' />
            关联 Project
          </DropdownMenuItem>
          {/* <DropdownMenuSeparator /> */}
          <DropdownMenuItem asChild className="text-xs text-muted-foreground">
            <a href={source.originalUrl} target="_blank" rel="noreferrer">
              <ExternalLink className='size-3.5' />
              打开链接
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

const SOURCE_SKELETON_ROWS = [1, 2, 3, 4] as const;

export function SourceListSkeleton() {
  return (
    <div className="space-y-2 pt-1">
      {SOURCE_SKELETON_ROWS.map((item) => (
        <div key={item} className="flex items-center gap-2 py-1.5">
          <Skeleton className="size-7 rounded-md" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
