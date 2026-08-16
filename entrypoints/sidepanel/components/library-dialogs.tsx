import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth';
import {
  BACKEND,
  saveSources,
  sourceItemFromTab,
  type SourceSaveResult
} from '@/lib/source-saving';
import type { Project, Source } from '../types';

type OpenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CaptureDialog({
  open,
  onOpenChange,
  projects,
  onCaptured
}: OpenDialogProps & {
  projects: Project[];
  onCaptured: (results: SourceSaveResult[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-1rem)] gap-3 p-3">
        <DialogHeader className="gap-1">
          <DialogTitle>保存当前链接</DialogTitle>
          <DialogDescription>Memo 和 Project 都是可选的。</DialogDescription>
        </DialogHeader>
        <CaptureForm projects={projects} onResult={onCaptured} />
      </DialogContent>
    </Dialog>
  );
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated
}: OpenDialogProps & { onCreated: (project: Project) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-1rem)] gap-3 p-3">
        <DialogHeader className="gap-1">
          <DialogTitle>创建 Project</DialogTitle>
          <DialogDescription>用于组织围绕同一目标保存的 Sources。</DialogDescription>
        </DialogHeader>
          <ProjectForm onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  );
}

export function MembershipDialog({
  source,
  projects,
  onOpenChange,
  onSaved
}: {
  source: Source | null;
  projects: Project[];
  onOpenChange: (open: boolean) => void;
  onSaved: (sourceId: string, projectIds: string[]) => void;
}) {
  return (
    <Dialog open={source !== null} onOpenChange={onOpenChange}>
      {source && (
        <DialogContent className="max-w-[calc(100%-1rem)] gap-3 p-3">
          <DialogHeader className="gap-1">
            <DialogTitle>关联 Project</DialogTitle>
            <DialogDescription className="line-clamp-2">
              {source.title}
            </DialogDescription>
          </DialogHeader>
          <MembershipForm source={source} projects={projects} onSaved={onSaved} />
        </DialogContent>
      )}
    </Dialog>
  );
}

export function MemoDialog({ source, onOpenChange, onSaved }: { source: Source | null; onOpenChange: (open: boolean) => void; onSaved: (source: Pick<Source, 'id' | 'memo'>) => void }) {
  return <Dialog open={source !== null} onOpenChange={onOpenChange}>{source && <DialogContent className="max-w-[calc(100%-1rem)] gap-3 p-3"><DialogHeader><DialogTitle>{source.memo ? '编辑 Memo' : '添加 Memo'}</DialogTitle><DialogDescription className="line-clamp-2">{source.title}</DialogDescription></DialogHeader><MemoForm source={source} onSaved={onSaved} /></DialogContent>}</Dialog>;
}

function MemoForm({ source, onSaved }: { source: Source; onSaved: (source: Pick<Source, 'id' | 'memo'>) => void }) {
  const [memo, setMemo] = useState(source.memo ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const response = await authFetch(`${BACKEND}/api/sources/${source.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memo: memo.trim() || null }) });
      if (!response.ok) throw new Error('无法更新 Memo。');
      const body = await response.json() as { source: Pick<Source, 'id' | 'memo'> };
      onSaved(body.source);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '无法更新 Memo。'); }
    finally { setSaving(false); }
  };
  return <form className="grid gap-3" onSubmit={(event) => void submit(event)}><Textarea value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={4_000} autoFocus placeholder="为什么保存它？"/><FormError error={error}/><DialogFormFooter submitting={saving} submitLabel="保存 Memo" pendingLabel="保存中…"/></form>;
}

function CaptureForm({
  projects,
  onResult
}: {
  projects: Project[];
  onResult: (results: SourceSaveResult[]) => void;
}) {
  const [memo, setMemo] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });
      const item = tab ? sourceItemFromTab(tab) : null;
      if (!item) throw new Error('当前标签页无法保存。');
      onResult(
        await saveSources([
          { ...item, memo: memo.trim() || undefined, projectIds }
        ])
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '当前标签页无法保存。'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-1.5">
        <Label htmlFor="source-memo">
          Memo <span className="font-normal text-muted-foreground">可选</span>
        </Label>
        <Textarea
          id="source-memo"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          placeholder="为什么保存它？"
          className="min-h-16 text-xs"
          maxLength={4_000}
        />
      </div>
      <ProjectCheckboxes
        projects={projects}
        selected={projectIds}
        onChange={setProjectIds}
      />
      <FormError error={error} />
      <DialogFormFooter
        submitting={saving}
        submitLabel="保存链接"
        pendingLabel="保存中…"
      />
    </form>
  );
}

function ProjectForm({ onCreated }: { onCreated: (project: Project) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await authFetch(`${BACKEND}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description.trim() || null })
      });
      if (!response.ok) throw new Error('无法创建 Project。');
      const body = await response.json() as { project: Project };
      onCreated(body.project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法创建 Project。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-1.5">
        <Label htmlFor="project-name">名称</Label>
        <Input
          id="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={32}
          autoFocus
          required
        />
        <p className="text-[10px] text-muted-foreground">最多 32 个字符</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="project-description">
          说明 <span className="font-normal text-muted-foreground">可选</span>
        </Label>
        <Textarea
          id="project-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={2_000}
          className="min-h-16 text-xs"
        />
      </div>
      <FormError error={error} />
      <DialogFormFooter
        submitting={saving}
        submitLabel="创建 Project"
        pendingLabel="创建中…"
        submitDisabled={!name.trim()}
      />
    </form>
  );
}

function MembershipForm({
  source,
  projects,
  onSaved
}: {
  source: Source;
  projects: Project[];
  onSaved: (sourceId: string, projectIds: string[]) => void;
}) {
  const [selected, setSelected] = useState(source.projectIds);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await authFetch(
        `${BACKEND}/api/sources/${source.id}/projects`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectIds: selected })
        }
      );
      if (!response.ok) throw new Error('无法更新 Project 关联。');
      const body = await response.json() as { sourceId: string; projectIds: string[] };
      onSaved(body.sourceId, body.projectIds);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '无法更新 Project 关联。'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
      <ProjectCheckboxes
        projects={projects}
        selected={selected}
        onChange={setSelected}
      />
      <p className="text-[11px] text-muted-foreground">
        不选择任何 Project 时，Source 会回到 Inbox。
      </p>
      <FormError error={error} />
      <DialogFormFooter
        submitting={saving}
        submitLabel="保存关联"
        pendingLabel="保存中…"
      />
    </form>
  );
}

function ProjectCheckboxes({
  projects,
  selected,
  onChange
}: {
  projects: Project[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  if (projects.length === 0) {
    return <p className="text-xs text-muted-foreground">尚无 Project，将保存到 Inbox。</p>;
  }

  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1 text-xs font-medium">关联到 Project</legend>
      {projects.map((project) => {
        const checked = selected.includes(project.id);
        return (
          <Label
            key={project.id}
            className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 font-normal hover:bg-muted"
          >
            <Checkbox
              checked={checked}
              onCheckedChange={() =>
                onChange(
                  checked
                    ? selected.filter((id) => id !== project.id)
                    : [...selected, project.id]
                )
              }
            />
            <span className="truncate">{project.name}</span>
          </Label>
        );
      })}
    </fieldset>
  );
}

function FormError({ error }: { error: string | null }) {
  return error ? (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;
}

function DialogFormFooter({
  submitting,
  submitLabel,
  pendingLabel,
  submitDisabled = false
}: {
  submitting: boolean;
  submitLabel: string;
  pendingLabel: string;
  submitDisabled?: boolean;
}) {
  return (
    <DialogFooter className="-mx-3 -mb-3 p-3">
      <DialogClose asChild>
        <Button type="button" variant="outline" size="sm">
          取消
        </Button>
      </DialogClose>
      <Button type="submit" size="sm" disabled={submitting || submitDisabled}>
        {submitting ? pendingLabel : submitLabel}
      </Button>
    </DialogFooter>
  );
}

export function CaptureResults({
  results,
  onDismiss
}: {
  results: SourceSaveResult[];
  onDismiss: () => void;
}) {
  const failures = results.filter((item) => !item.ok);
  if (failures.length === 0) return null;
  return (
    <Alert className="mb-2">
      <AlertDescription className="flex items-start gap-2">
        <span className="flex-1">
          {failures.map((item) => (
            <span key={item.clientRequestId} className="block text-destructive">
              {item.message}
            </span>
          ))}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onDismiss}
          aria-label="关闭结果"
        >
          ×
        </Button>
      </AlertDescription>
    </Alert>
  );
}
