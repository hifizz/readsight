import { useState } from 'react';
import {
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  FolderCog,
  FolderMinus,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Pin,
  PinOff,
  Sparkles,
  Trash2
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
  onAnalyze: (s: Source) => void;
  onEditMembership: (s: Source) => void;
  onEditMemo: (s: Source) => void;
  onTogglePin: (s: Source) => void;
  onDeleteSource: (s: Source) => void;
  onRemoveFromProject: (source: Source, projectId: string) => void;
};
type ProjectActions = {
  onRenameProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
};

export function SourceAvatar({
  source,
  className = 'size-8'
}: {
  source: Source;
  className?: string;
}) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground ${className}`}
    >
      {source.faviconUrl ? (
        <img
          className="size-5 rounded object-contain"
          src={source.faviconUrl}
          alt=""
        />
      ) : (
        'R'
      )}
    </span>
  );
}

export function SourceIdentity({
  source,
  showMemo = false
}: {
  source: Source;
  showMemo?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2">
      <SourceAvatar source={source} />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">
          {source.title}
        </span>
        <p className="truncate text-[10px] text-muted-foreground">
          {domainFor(source.originalUrl)} · {relativeTime(source.addedAt)}
        </p>
        {showMemo && source.memo && (
          <p className="mt-1 -ml-2 line-clamp-2 whitespace-pre-line break-words rounded bg-muted/80 px-1.5 py-1 text-xs leading-4 text-foreground/70">
            {source.memo}
          </p>
        )}
      </div>
    </div>
  );
}

export function SourceActionsMenu({
  source,
  showInboxCopyActions = false,
  projectContextId,
  onAnalyze,
  onEditMembership,
  onEditMemo,
  onTogglePin,
  onDeleteSource,
  onRemoveFromProject
}: {
  source: Source;
  showInboxCopyActions?: boolean;
  projectContextId?: string;
} & SourceActions) {
  const itemClass = 'h-7 gap-1.5 px-2 py-1 text-xs';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-xs"
          variant="ghost"
          className="hover:bg-neutral-200"
          aria-label={`${source.title} 的更多操作`}
          data-source-row-action
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-36 p-1 text-xs"
        data-source-row-action
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DropdownMenuItem
          className={itemClass}
          onSelect={() => onTogglePin(source)}
        >
          {source.pinnedAt ? (
            <PinOff className="size-3" />
          ) : (
            <Pin className="size-3" />
          )}
          {source.pinnedAt ? '取消置顶' : '置顶'}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass}
          onSelect={() => onEditMemo(source)}
        >
          <NotebookPen className="size-3" />
          {source.memo ? '编辑 Memo' : '添加 Memo'}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass}
          onSelect={() => onAnalyze(source)}
        >
          <Sparkles className="size-3" />
          分析与讨论
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass}
          onSelect={() => onEditMembership(source)}
        >
          <FolderCog className="size-3" />
          关联 Project
        </DropdownMenuItem>
        {projectContextId && (
          <DropdownMenuItem
            className={itemClass}
            onSelect={() => onRemoveFromProject(source, projectContextId)}
          >
            <FolderMinus className="size-3" />
            移出 Project
          </DropdownMenuItem>
        )}
        {showInboxCopyActions && (
          <>
            <DropdownMenuItem
              className={itemClass}
              onSelect={() => void copySource(source, false)}
            >
              <Copy className="size-3" />
              复制链接
            </DropdownMenuItem>
            <DropdownMenuItem
              className={itemClass}
              onSelect={() => void copySource(source, true)}
            >
              <FileText className="size-3" />
              复制链接与标题
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem className={itemClass} asChild>
          <a href={source.originalUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3" />
            打开链接
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass}
          variant="destructive"
          onSelect={() => onDeleteSource(source)}
        >
          <Trash2 className="size-3" />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function InboxGroup({
  range,
  onRangeChange,
  loading,
  sources,
  ...actions
}: {
  range: InboxRange;
  onRangeChange: (r: InboxRange) => void;
  loading: boolean;
  sources: Source[];
} & SourceActions) {
  return (
    <section>
      <div className="flex items-center px-3">
        <h2 className="text-xs font-medium">Inbox</h2>
        <span className="ml-1.5 text-xs text-muted-foreground">
          {sources.length}
        </span>
        <Select
          value={range}
          onValueChange={(v) => onRangeChange(v as InboxRange)}
        >
          <SelectTrigger
            size="sm"
            className="ml-auto h-6 w-auto border-transparent bg-transparent text-[10px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="today">今天</SelectItem>
            <SelectItem value="7d">近 7 天</SelectItem>
            <SelectItem value="30d">近 30 天</SelectItem>
            <SelectItem value="all">全部</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {loading ? (
        <Skeleton className="h-20" />
      ) : sources.length ? (
        <SourceRows sources={sources} showInboxCopyActions {...actions} />
      ) : (
        <p className="px-1 py-3 text-xs text-muted-foreground">
          这个时间范围内没有未归类链接。
        </p>
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
} & SourceActions &
  ProjectActions) {
  return (
    <section>
      <div className="flex items-center px-3 py-2">
        <h2 className="text-xs font-medium">Projects</h2>
        <span className="ml-1.5 text-xs text-muted-foreground">
          {projects.length}
        </span>
      </div>
      {projects.map((project) => (
        <ProjectItem
          key={project.id}
          project={project}
          sources={sourcesByProject.get(project.id) ?? []}
          {...actions}
        />
      ))}
    </section>
  );
}

function ProjectItem({
  project,
  sources,
  onRenameProject,
  onDeleteProject,
  ...actions
}: { project: Project; sources: Source[] } & SourceActions & ProjectActions) {
  const [open, setOpen] = useState(false);
  const projectItemClass = 'h-7 gap-1.5 px-2 py-1 text-xs';
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group flex items-center">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="min-w-0 flex-1 justify-start gap-1"
          >
            <ChevronRight className={`size-3.5 ${open ? 'rotate-90' : ''}`} />
            <Folder className="size-3.5 text-primary" />
            <span className="truncate text-xs">{project.name}</span>
            <span className="ml-auto text-[10px]">{sources.length}</span>
          </Button>
        </CollapsibleTrigger>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              className="mr-2 opacity-60 group-hover:opacity-100"
              aria-label={`${project.name} 的更多操作`}
            >
              <MoreHorizontal className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44 p-1 text-xs">
            <DropdownMenuItem
              className={projectItemClass}
              disabled={!sources.length}
              onSelect={() => void copyProjectSources(sources, false)}
            >
              <Copy className="size-3" />
              复制所有链接
            </DropdownMenuItem>
            <DropdownMenuItem
              className={projectItemClass}
              disabled={!sources.length}
              onSelect={() => void copyProjectSources(sources, true)}
            >
              <FileText className="size-3" />
              复制所有链接（带 Title）
            </DropdownMenuItem>
            <DropdownMenuItem
              className={projectItemClass}
              onSelect={() => onRenameProject(project)}
            >
              <Pencil className="size-3" />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem
              className={projectItemClass}
              variant="destructive"
              onSelect={() => onDeleteProject(project)}
            >
              <Trash2 className="size-3" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <CollapsibleContent>
        <div className="ml-3 border-l pl-1">
          {sources.length ? (
            <SourceRows
              sources={sources}
              projectContextId={project.id}
              {...actions}
            />
          ) : (
            <p className="p-2 text-[11px] text-muted-foreground">暂无链接。</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

async function copyProjectSources(sources: Source[], withTitle: boolean) {
  const text = sources
    .map((source) => formatSource(source, withTitle))
    .join('\n');
  await navigator.clipboard.writeText(text);
}

async function copySource(source: Source, withTitle: boolean) {
  await navigator.clipboard.writeText(formatSource(source, withTitle));
}

function formatSource(source: Source, withTitle: boolean) {
  return withTitle
    ? `- [${escapeMarkdownTitle(source.title)}](${escapeMarkdownUrl(source.originalUrl)})`
    : source.originalUrl;
}

function escapeMarkdownTitle(value: string) {
  return value.replace(/([\\\[\]])/g, '\\$1');
}

function escapeMarkdownUrl(value: string) {
  return value.replace(/([\\()])/g, '\\$1');
}

function SourceRows({
  sources,
  showInboxCopyActions = false,
  projectContextId,
  ...actions
}: {
  sources: Source[];
  showInboxCopyActions?: boolean;
  projectContextId?: string;
} & SourceActions) {
  return (
    <ul>
      {sources.map((source) => (
        <li
          key={source.id}
          className="group flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted"
          tabIndex={0}
          role="link"
          onClick={(e) => {
            if (
              !e.defaultPrevented &&
              !(e.target as HTMLElement).closest('[data-source-row-action]')
            )
              void chrome.tabs.create({ url: source.originalUrl });
          }}
          onKeyDown={(e) => {
            if (
              !e.defaultPrevented &&
              e.target === e.currentTarget &&
              e.key === 'Enter'
            )
              void chrome.tabs.create({ url: source.originalUrl });
          }}
        >
          <SourceIdentity source={source} showMemo />
          <SourceActionsMenu
            source={source}
            showInboxCopyActions={showInboxCopyActions}
            projectContextId={projectContextId}
            {...actions}
          />
        </li>
      ))}
    </ul>
  );
}

export function PinnedSources({
  sources,
  ...actions
}: { sources: Source[] } & SourceActions) {
  if (!sources.length) return null;
  return (
    <section>
      <h2 className="px-3 py-2 text-xs font-medium">Pinned</h2>
      <div className="flex flex-wrap gap-2 px-2">
        {sources.map((source) => (
          <PinnedItem key={source.id} source={source} {...actions} />
        ))}
      </div>
    </section>
  );
}

function PinnedItem({
  source,
  ...actions
}: { source: Source } & SourceActions) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        className="rounded-md focus-visible:ring-2"
        aria-label={`预览 ${source.title}`}
      >
        <SourceAvatar source={source} className="size-9" />
      </button>
      {open && (
        <div className="absolute bottom-[calc(100%-1px)] left-0 z-50 w-64 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-3 shadow-md">
          <div className="flex items-start gap-2">
            <SourceIdentity source={source} />
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`取消置顶 ${source.title}`}
              title="取消置顶"
              onClick={() => actions.onTogglePin(source)}
            >
              <PinOff />
            </Button>
          </div>
          {source.memo && (
            <p className="mt-2 whitespace-pre-wrap text-xs">{source.memo}</p>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            Projects: {source.projects.map((p) => p.name).join(', ') || 'Inbox'}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Added {new Date(source.addedAt).toLocaleDateString()}
          </p>
        </div>
      )}
    </div>
  );
}

export function SourceListSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
