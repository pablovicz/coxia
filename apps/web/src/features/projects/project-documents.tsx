import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Paperclip, Ruler, Trash2, X } from 'lucide-react';
import { DateTime } from 'luxon';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/input';
import {
  api,
  apiSend,
  DOCUMENT_KINDS,
  DOCUMENT_TYPES,
  fetchProjectDocument,
  MAX_DOCUMENT_BYTES,
  type ProjectDocument,
  type ProjectDocumentKind,
  uploadProjectDocument,
} from '@/lib/api';
import { cn } from '@/lib/utils';

export interface PendingDocument {
  file: File;
  kind: ProjectDocumentKind;
}

const KIND_ICON: Record<ProjectDocumentKind, typeof FileText> = {
  document: FileText,
  sketch: Ruler,
  receipt: Paperclip,
};

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Confere tipo e tamanho antes de enviar; devolve a mensagem de erro ou null. */
export function checkDocument(file: File): string | null {
  if (!DOCUMENT_TYPES.includes(file.type))
    return `${file.name}: envie PDF, foto (JPG, PNG, WebP) ou arquivo do Word, Excel ou PowerPoint.`;
  if (file.size > MAX_DOCUMENT_BYTES) return `${file.name}: o arquivo deve ter até 20 MB.`;
  return null;
}

/** Envia os arquivos escolhidos (um de cada vez); devolve quantos subiram e os erros. */
export async function uploadPending(projectId: string, pending: PendingDocument[]) {
  let ok = 0;
  const errors: string[] = [];
  for (const p of pending) {
    try {
      await uploadProjectDocument(projectId, p.kind, p.file);
      ok++;
    } catch (e) {
      errors.push(`${p.file.name}: ${(e as Error).message}`);
    }
  }
  return { ok, errors };
}

/** Escolha de arquivos para anexar, cada um com o tipo (documento, croqui, comprovante). */
export function PendingDocuments({
  value,
  onChange,
  onError,
}: {
  value: PendingDocument[];
  onChange: (v: PendingDocument[]) => void;
  onError: (msg: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  function add(files: FileList | null) {
    if (!files?.length) return;
    const ok: PendingDocument[] = [];
    for (const f of Array.from(files)) {
      const err = checkDocument(f);
      if (err) return onError(err);
      ok.push({
        file: f,
        kind: /croqui|planta|sketch/i.test(f.name)
          ? 'sketch'
          : /comprovante|recibo|nota/i.test(f.name)
            ? 'receipt'
            : 'document',
      });
    }
    onError(null);
    onChange([...value, ...ok]);
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium">Documentos (opcional)</legend>
      {value.length ? (
        <ul className="flex flex-col gap-2">
          {value.map((p, i) => (
            <li
              key={`${p.file.name}-${i}`}
              className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 pl-3"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{p.file.name}</span>
              <label className="sr-only" htmlFor={`doc-kind-${i}`}>
                Tipo de {p.file.name}
              </label>
              <Select
                id={`doc-kind-${i}`}
                className="w-40"
                value={p.kind}
                onChange={(e) =>
                  onChange(
                    value.map((x, j) =>
                      j === i ? { ...x, kind: e.target.value as ProjectDocumentKind } : x,
                    ),
                  )
                }
              >
                {(Object.keys(DOCUMENT_KINDS) as ProjectDocumentKind[]).map((k) => (
                  <option key={k} value={k}>
                    {DOCUMENT_KINDS[k].label}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Tirar ${p.file.name}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={input}
        type="file"
        multiple
        accept={DOCUMENT_TYPES.join(',')}
        className="sr-only"
        aria-label="Escolher documentos"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => input.current?.click()}
      >
        <Paperclip aria-hidden /> Anexar documentos
      </Button>
      <p className="text-xs text-muted-foreground">
        Documento, croqui ou comprovante: PDF, foto ou Word/Excel/PowerPoint, até 20 MB cada.
      </p>
    </fieldset>
  );
}

async function openDocument(projectId: string, d: ProjectDocument) {
  const tab = window.open('', '_blank');
  try {
    const blob = await fetchProjectDocument(projectId, d.id);
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch {
    tab?.close();
    toast.error('Não foi possível abrir o documento.');
  }
}

/** Documentos do projeto por tipo: abrir, anexar (equipe) e remover (administração). */
export function ProjectDocumentsCard({
  projectId,
  canUpload,
  canDelete,
}: {
  projectId: string;
  canUpload: boolean;
  canDelete: boolean;
}) {
  const qc = useQueryClient();
  const docs = useQuery({
    queryKey: ['projects', projectId, 'documents'],
    queryFn: () => api<ProjectDocument[]>(`/projects/${projectId}/documents`),
  });
  const [pending, setPending] = useState<PendingDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ProjectDocumentKind | 'all'>('all');
  const upload = useMutation({
    mutationFn: () => uploadPending(projectId, pending),
    onSuccess: ({ ok, errors }) => {
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'documents'] });
      setPending([]);
      if (ok) toast.success(ok === 1 ? 'Documento anexado.' : `${ok} documentos anexados.`);
      if (errors.length) setError(errors.join(' '));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiSend(`/projects/${projectId}/documents/${id}`, 'DELETE'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'documents'] });
      toast.success('Documento removido.');
    },
    onError: (e) => toast.error(e.message),
  });
  const list = (docs.data ?? []).filter((d) => filter === 'all' || d.kind === filter);
  const count = (k: ProjectDocumentKind) => (docs.data ?? []).filter((d) => d.kind === k).length;

  return (
    <section aria-label="Documentos do projeto">
      <Card>
        <CardHeader>
          <CardTitle>Documentos</CardTitle>
          <CardDescription>Documentos, croquis e comprovantes do projeto</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div
            role="radiogroup"
            aria-label="Tipo de documento"
            className="flex flex-wrap gap-1 rounded-md border bg-card p-1"
          >
            {(['all', ...Object.keys(DOCUMENT_KINDS)] as Array<ProjectDocumentKind | 'all'>).map(
              (k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={filter === k}
                  onClick={() => setFilter(k)}
                  className={cn(
                    'min-h-11 rounded-sm px-3 text-sm font-medium text-muted-foreground lg:min-h-9',
                    filter === k && 'bg-muted text-foreground',
                  )}
                >
                  {k === 'all' ? 'Todos' : DOCUMENT_KINDS[k].plural}
                  {docs.data && k !== 'all' ? (
                    <span className="tabular ml-1 opacity-80">({count(k)})</span>
                  ) : null}
                </button>
              ),
            )}
          </div>

          {docs.isPending ? (
            <Skeleton className="h-16" />
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {filter === 'all'
                ? 'Nenhum documento anexado.'
                : `Nenhum ${DOCUMENT_KINDS[filter].label.toLowerCase()} anexado.`}
            </p>
          ) : (
            <ul className="divide-y">
              {list.map((d) => {
                const Icon = KIND_ICON[d.kind];
                return (
                  <li key={d.id} className="flex items-center gap-2 py-2">
                    <button
                      type="button"
                      onClick={() => openDocument(projectId, d)}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm hover:underline"
                    >
                      <Icon size={16} aria-hidden className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{d.fileName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {sizeLabel(d.sizeBytes)} ·{' '}
                          {DateTime.fromISO(d.createdAt).toFormat('dd/LL/yyyy')}
                        </span>
                      </span>
                    </button>
                    <Badge variant="neutral" className="shrink-0">
                      {DOCUMENT_KINDS[d.kind].label}
                    </Badge>
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover ${d.fileName}`}
                        loading={remove.isPending && remove.variables === d.id}
                        onClick={() => remove.mutate(d.id)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {canUpload ? (
            <div className="flex flex-col gap-2 border-t pt-3">
              <PendingDocuments value={pending} onChange={setPending} onError={setError} />
              {pending.length ? (
                <Button
                  className="self-start"
                  loading={upload.isPending}
                  onClick={() => upload.mutate()}
                >
                  Enviar {pending.length === 1 ? 'documento' : `${pending.length} documentos`}
                </Button>
              ) : null}
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
