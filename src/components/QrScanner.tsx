import { useEffect, useRef, useState } from 'react';

interface QrScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

/**
 * Camera-based QR-Code scanner using the BarcodeDetector API
 * (supported in Chrome 83+, Edge 83+).
 * Falls back to a message if the API is unavailable.
 */
export function QrScanner({ onScan, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Check BarcodeDetector support
    if (!('BarcodeDetector' in window)) {
      setError(
        'BarcodeDetector API nicht verfügbar.',
      );
      return;
    }

    const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Scan loop
        const scanLoop = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              setScanning(false);
              onScan(barcodes[0].rawValue);
              return; // stop scanning after first successful read
            }
          } catch {
            // frame not ready yet, ignore
          }
          if (!cancelled) {
            requestAnimationFrame(scanLoop);
          }
        };

        // Wait for video to be ready
        videoRef.current?.addEventListener('loadeddata', () => {
          if (!cancelled) scanLoop();
        });
      } catch (err) {
        if (!cancelled) {
          setError(`Kamera-Zugriff fehlgeschlagen: ${(err as Error).message}`);
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [onScan]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-4 w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-900">QR-Code scannen</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>

        <div className="relative bg-black">
          {error ? (
            <div className="p-6 text-center text-sm text-red-600">{error}</div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="h-64 w-full object-cover"
                playsInline
                muted
                autoPlay
              />
              {scanning && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-40 w-40 rounded-lg border-2 border-white/70 shadow-lg" />
                </div>
              )}
              {!scanning && (
                <div className="absolute inset-0 flex items-center justify-center bg-green-500/30">
                  <span className="rounded-full bg-green-600 px-4 py-2 text-sm font-bold text-white">
                    ✓ Erkannt!
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 text-center text-xs text-gray-500">
          Halte den QR-Code eines Peers vor die Kamera
        </div>
      </div>
    </div>
  );
}
