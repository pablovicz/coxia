import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Button } from '@coxia/ui/components/ui/button';
import { Dialog } from '@coxia/ui/components/ui/dialog';
import { Field } from '@coxia/ui/components/ui/field';
import { Input } from '@coxia/ui/components/ui/input';
import { centsToInput, formatBRL, formatCompetence, parseBRL, todayIn } from '@coxia/ui/lib/format';
import { ApiBodyError, apiSend, fetchIncomeProof, type ResidentDetails, uploadIncomeProof } from '@/lib/api';

type Payment = ResidentDetails['payments'][number];

const PROOF_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const br = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/**
 * Pagamento do residente: marcar como pago (com comprovante opcional) ou remover uma cobrança
 * errada. Recebido: mostra quando e quanto, e o comprovante (ou anexa um depois).
 */
export function ResidentPaymentDialog({ payment, residentId, tz, onClose }: { payment: Payment; residentId: string; tz: string; onClose: () => void }) {
  const qc = useQueryClient();
  const received = payment.status === 'received';
  const [amount, setAmount] = useState(centsToInput(payment.expectedAmountCents));
  const [receivedOn, setReceivedOn] = useState(todayIn(tz));
  const [file, setFile] = useState<File | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['resident', residentId] });
    void qc.invalidateQueries({ queryKey: ['residents'] });
    void qc.invalidateQueries({ queryKey: ['incomes'] });
    void qc.invalidateQueries({ queryKey: ['finance'] });
    void qc.invalidateQueries({ queryKey: ['overview'] });
  };
  const fail = (err: unknown) => setError(err instanceof ApiBodyError ? err.message : err instanceof Error ? err.message : 'Não foi possível agora.');

  function pickFile(f: File | null) {
    setError(null);
    if (f && !PROOF_TYPES.includes(f.type)) return setError('O comprovante deve ser PDF ou foto (JPG, PNG, WebP).');
    if (f && f.size > MAX_PROOF_BYTES) return setError('O comprovante deve ter até 10 MB.');
    setFile(f);
  }

  const pay = useMutation({
    mutationFn: async () => {
      const cents = parseBRL(amount);
      if (!cents) throw new Error('Valor recebido inválido');
      if (!receivedOn) throw new Error('Informe a data do pagamento');
      await apiSend(`/incomes/${payment.id}/receive`, 'POST', { amountCents: cents, receivedOn });
      // O pagamento fica registrado mesmo se o comprovante falhar: dá para anexar depois.
      if (file) {
        try {
          await uploadIncomeProof(payment.id, file);
        } catch {
          toast.error('Pagamento registrado, mas o comprovante não foi enviado. Anexe de novo.');
        }
      }
    },
    onSuccess: () => {
      toast.success('Pagamento registrado.');
      refresh();
      onClose();
    },
    onError: fail,
  });

  const attach = useMutation({
    mutationFn: () => uploadIncomeProof(payment.id, file!),
    onSuccess: () => {
      toast.success('Comprovante anexado.');
      refresh();
      onClose();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: () => apiSend(`/incomes/${payment.id}/cancel`, 'POST'),
    onSuccess: () => {
      toast.success('Cobrança removida.');
      refresh();
      onClose();
    },
    onError: fail,
  });

  async function openProof() {
    const tab = window.open('', '_blank');
    try {
      const url = URL.createObjectURL(await fetchIncomeProof(payment.id));
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch {
      tab?.close();
      toast.error('Não foi possível abrir o comprovante.');
    }
  }

  const title = payment.competence ? `Mensalidade de ${formatCompetence(payment.competence)}` : payment.description;
  const proofInput = (
    <Field label={received ? 'Anexar comprovante' : 'Comprovante (opcional)'} hint="PDF ou foto, até 10 MB">
      {(id, d) => <Input id={id} type="file" accept={PROOF_TYPES.join(',')} aria-describedby={d} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />}
    </Field>
  );

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={title}
      description={`${payment.description}${payment.space ? ` · ${payment.space.name}` : ''} · vence ${br(payment.expectedOn)}`}
      footer={
        received ? (
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
            {!payment.proof ? (
              <Button disabled={!file} loading={attach.isPending} onClick={() => attach.mutate()}>
                Anexar comprovante
              </Button>
            ) : null}
          </div>
        ) : confirmRemove ? (
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              Voltar
            </Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()}>
              Remover cobrança
            </Button>
          </div>
        ) : (
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" className="text-destructive" onClick={() => setConfirmRemove(true)}>
              <Trash2 aria-hidden /> Remover
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button loading={pay.isPending} onClick={() => (setError(null), pay.mutate())}>
                Marcar como pago
              </Button>
            </div>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-4 py-3">
          <span className="tabular text-lg font-semibold">{formatBRL(payment.amountCents)}</span>
          <Badge variant={received ? 'active' : payment.overdue ? 'late' : 'pending'}>{received ? 'Pago' : payment.overdue ? 'Atrasado' : 'Previsto'}</Badge>
        </div>

        {received ? (
          <>
            <p className="text-sm text-muted-foreground">Pago em {payment.receivedOn ? br(payment.receivedOn) : '—'}.</p>
            {payment.proof ? (
              <Button variant="outline" className="justify-start" onClick={openProof}>
                <FileText aria-hidden /> <span className="truncate">{payment.proof.fileName ?? 'Ver comprovante'}</span>
              </Button>
            ) : (
              proofInput
            )}
          </>
        ) : confirmRemove ? (
          <p className="text-sm">
            Remover esta cobrança? Ela sai dos pagamentos do residente e do Financeiro (fica cancelada no histórico). Use para cobranças erradas; não é gerada de novo.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Valor recebido (R$)">{(id) => <Input id={id} value={amount} inputMode="decimal" className="tabular" onChange={(e) => setAmount(e.target.value)} />}</Field>
            <Field label="Data do pagamento">{(id) => <Input id={id} type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />}</Field>
            <div className="sm:col-span-2">{proofInput}</div>
          </div>
        )}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
