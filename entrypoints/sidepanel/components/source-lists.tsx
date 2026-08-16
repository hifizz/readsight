import { useState } from 'react';
import { ChevronRight, ExternalLink, Folder, FolderCog, MoreHorizontal, NotebookPen, Pin, PinOff, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { InboxRange, Project, Source } from '../types';
import { domainFor, relativeTime } from '../utils';

type SourceActions = { onAnalyze: (s: Source) => void; onEditMembership: (s: Source) => void; onEditMemo: (s: Source) => void; onTogglePin: (s: Source) => void };

export function SourceAvatar({ source, className = 'size-7' }: { source: Source; className?: string }) {
  return <span className={`grid shrink-0 place-items-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground ${className}`}>{source.faviconUrl ? <img className="size-4 rounded object-contain" src={source.faviconUrl} alt=""/> : 'R'}</span>;
}

export function SourceIdentity({ source }: { source: Source }) {
  return <div className="flex min-w-0 flex-1 items-center gap-2"><SourceAvatar source={source}/><div className="min-w-0"><span className="block truncate text-xs font-medium">{source.title}</span><p className="truncate text-[10px] text-muted-foreground">{domainFor(source.originalUrl)} · {relativeTime(source.addedAt)}</p></div></div>;
}

export function SourceActionsMenu({ source, onAnalyze, onEditMembership, onEditMemo, onTogglePin }: { source: Source } & SourceActions) {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-xs" variant="ghost" aria-label={`${source.title} 的更多操作`} data-source-row-action onClick={(e) => e.stopPropagation()}><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" data-source-row-action onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <DropdownMenuItem onSelect={() => onTogglePin(source)}>{source.pinnedAt ? <PinOff/> : <Pin/>}{source.pinnedAt ? '取消置顶' : '置顶'}</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => onEditMemo(source)}><NotebookPen/>{source.memo ? '编辑 Memo' : '添加 Memo'}</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => onAnalyze(source)}><Sparkles/>分析与讨论</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => onEditMembership(source)}><FolderCog/>关联 Project</DropdownMenuItem>
    <DropdownMenuItem asChild><a href={source.originalUrl} target="_blank" rel="noreferrer"><ExternalLink/>打开链接</a></DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>;
}

export function InboxGroup({ range, onRangeChange, loading, sources, ...actions }: { range: InboxRange; onRangeChange: (r: InboxRange) => void; loading: boolean; sources: Source[] } & SourceActions) {
  return <section><div className="flex items-center px-3 py-2"><h2 className="text-xs font-medium">Inbox</h2><span className="ml-1.5 text-xs text-muted-foreground">{sources.length}</span><Select value={range} onValueChange={(v) => onRangeChange(v as InboxRange)}><SelectTrigger size="sm" className="ml-auto h-6 w-auto border-transparent bg-transparent text-[10px]"><SelectValue/></SelectTrigger><SelectContent align="end"><SelectItem value="today">今天</SelectItem><SelectItem value="7d">近 7 天</SelectItem><SelectItem value="30d">近 30 天</SelectItem><SelectItem value="all">全部</SelectItem></SelectContent></Select></div>{loading ? <Skeleton className="h-20"/> : sources.length ? <SourceRows sources={sources} {...actions}/> : <p className="px-1 py-3 text-xs text-muted-foreground">这个时间范围内没有未归类链接。</p>}</section>;
}

export function ProjectList({ projects, sourcesByProject, ...actions }: { projects: Project[]; sourcesByProject: Map<string, Source[]> } & SourceActions) {
  return <section><div className="flex items-center px-3 py-2"><h2 className="text-xs font-medium">Projects</h2><span className="ml-1.5 text-xs text-muted-foreground">{projects.length}</span></div>{projects.map((project) => <ProjectItem key={project.id} project={project} sources={sourcesByProject.get(project.id) ?? []} {...actions}/>)}</section>;
}

function ProjectItem({ project, sources, ...actions }: { project: Project; sources: Source[] } & SourceActions) {
  const [open, setOpen] = useState(false);
  return <Collapsible open={open} onOpenChange={setOpen}><CollapsibleTrigger asChild><Button variant="ghost" className="w-full justify-start gap-1"><ChevronRight className={`size-3.5 ${open ? 'rotate-90' : ''}`}/><Folder className="size-4 text-primary"/><span className="truncate text-xs">{project.name}</span><span className="ml-auto text-[10px]">{sources.length}</span></Button></CollapsibleTrigger><CollapsibleContent><div className="ml-3 border-l pl-1">{sources.length ? <SourceRows sources={sources} {...actions}/> : <p className="p-2 text-[11px] text-muted-foreground">暂无链接。</p>}</div></CollapsibleContent></Collapsible>;
}

function SourceRows({ sources, ...actions }: { sources: Source[] } & SourceActions) { return <ul>{sources.map((source) => <li key={source.id} className="group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted" tabIndex={0} role="link" onClick={(e) => { if (!e.defaultPrevented && !(e.target as HTMLElement).closest('[data-source-row-action]')) void chrome.tabs.create({ url: source.originalUrl }); }} onKeyDown={(e) => { if (!e.defaultPrevented && e.target === e.currentTarget && e.key === 'Enter') void chrome.tabs.create({ url: source.originalUrl }); }}><SourceIdentity source={source}/><SourceActionsMenu source={source} {...actions}/></li>)}</ul>; }

export function PinnedSources({ sources, ...actions }: { sources: Source[] } & SourceActions) {
  if (!sources.length) return null;
  return <section><h2 className="px-3 py-2 text-xs font-medium">Pinned</h2><div className="flex flex-wrap gap-2 px-2">{sources.map((source) => <PinnedItem key={source.id} source={source} {...actions}/>)}</div></section>;
}

function PinnedItem({ source, ...actions }: { source: Source } & SourceActions) {
  const [open, setOpen] = useState(false);
  return <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}><button className="rounded-md focus-visible:ring-2" aria-label={`预览 ${source.title}`}><SourceAvatar source={source} className="size-9"/></button>{open && <div className="absolute bottom-full left-0 z-50 mb-1 w-64 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-3 shadow-md"><div className="flex items-start gap-2"><SourceIdentity source={source}/><SourceActionsMenu source={source} {...actions}/></div>{source.memo && <p className="mt-2 whitespace-pre-wrap text-xs">{source.memo}</p>}<p className="mt-2 text-[10px] text-muted-foreground">Projects: {source.projects.map((p) => p.name).join(', ') || 'Inbox'}</p><p className="text-[10px] text-muted-foreground">Added {new Date(source.addedAt).toLocaleDateString()}</p></div>}</div>;
}

export function SourceListSkeleton() { return <div className="space-y-2">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-10 w-full"/>)}</div>; }
