import { Download, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Button } from '@coxia/ui/components/ui/button';
import { Dialog } from '@coxia/ui/components/ui/dialog';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { RESIDENT_APP_URL, type Space } from '@/lib/api';

export const roomCheckInUrl = (spaceId: string) => `${RESIDENT_APP_URL}/sala/${spaceId}`;

/**
 * QR code de check-in para colar na sala: o residente escaneia, entra no workspace e faz o
 * check-in da reserva (ou usa a sala avulsa, se estiver livre).
 */
export function RoomQrDialog({ room, onClose }: { room: Space; onClose: () => void }) {
  const url = roomCheckInUrl(room.id);
  const [png, setPng] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // Preto no branco e margem larga: lê bem impresso em qualquer papel.
    void QRCode.toDataURL(url, { width: 1024, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }).then((d) => alive && setPng(d));
    return () => {
      alive = false;
    };
  }, [url]);

  function print() {
    if (!png) return;
    const w = window.open('', '_blank', 'noopener=no');
    if (!w) return;
    const name = room.name.replace(/[<>&"]/g, '');
    w.document.write(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>QR ${name}</title><style>body{font-family:Arial,sans-serif;text-align:center;padding:40px}img{width:70%;max-width:420px}h1{font-size:32px;margin:0 0 8px}p{font-size:18px;color:#333}</style></head><body><h1>${name}</h1><p>Check-in do residente</p><img src="${png}" alt=""><p>Aponte a câmera do celular, entre no workspace e faça o check-in.</p><script>window.onload=()=>{window.print()}<\/script></body></html>`,
    );
    w.document.close();
  }

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`QR code de check-in · ${room.name}`}
      description="Imprima e cole na sala. O residente escaneia antes de usar: com reserva, faz o check-in; sem reserva e com a sala livre, usa avulso."
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={!png} asChild={!!png}>
            {png ? (
              <a href={png} download={`qr-checkin-${room.slug}.png`}>
                <Download aria-hidden /> Baixar PNG
              </a>
            ) : (
              <span>Baixar PNG</span>
            )}
          </Button>
          <Button disabled={!png} onClick={print}>
            <Printer aria-hidden /> Imprimir
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-3">
        {png ? <img src={png} alt={`QR code que abre ${url}`} className="size-64 rounded-md border bg-white p-2" /> : <Skeleton className="size-64" />}
        <p className="tabular break-all text-center text-xs text-muted-foreground">{url}</p>
      </div>
    </Dialog>
  );
}
