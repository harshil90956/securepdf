import { useState, useEffect, useCallback, useRef } from 'react';

import { useLocation, Navigate, Link } from 'react-router-dom';
import { Shield, ArrowLeft, AlertCircle, Printer } from 'lucide-react';
import { SecurePrintDialog } from '@/components/SecurePrintDialog';
import { TicketEditor } from '@/components/editor/TicketEditor';
import { PDFCanvasViewer } from '@/components/editor/PDFCanvasViewer';

import { Button } from '@/components/ui/button';

import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

const Viewer = () => {
  const location = useLocation();
  const { sessionToken, documentTitle, remainingPrints: initialPrints, maxPrints, documentType = 'pdf', documentId } = location.state || {};
  const { token, user } = useAuth();

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remainingPrints, setRemainingPrints] = useState(initialPrints || 0);
  const [isPrinting, setIsPrinting] = useState(false);
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const printPdfRef = useRef<ArrayBuffer | null>(null);

  // Redirect if no session token provided
  if (!sessionToken) {
    return <Navigate to="/upload" replace />;
  }

  // Fetch PDF through backend secure-render endpoint
  useEffect(() => {
    const fetchSecurePDF = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch('http://localhost:4000/api/docs/secure-render', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ sessionToken }),
        });

        if (!res.ok) {
          let message = 'Failed to load document';
          try {
            const data = await res.json();
            if (data && data.message) message = data.message;
          } catch {
            // ignore JSON parse errors for non-JSON responses
          }
          throw new Error(message);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);

      } catch (err) {
        console.error('Error fetching PDF:', err);
        setError(err instanceof Error ? err.message : 'Failed to load document');
      } finally {
        setLoading(false);
      }
    };

    fetchSecurePDF();

    // Cleanup blob URL on unmount
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [sessionToken, token]);

  // Block default browser shortcuts for save / print so user sirf hamara flow use kare
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const isModifier = e.ctrlKey || e.metaKey;
      if (!isModifier) return;

      const key = e.key.toLowerCase();
      if (key === 's' || key === 'p') {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const handlePrintClick = () => {
    if (remainingPrints > 0) {
      setShowPrintDialog(true);
    } else {
      toast.error('Print limit exceeded');
    }
  };

  const handleConfirmPrint = useCallback(async () => {
    if (remainingPrints <= 0) {
      toast.error('Print limit exceeded');
      return;
    }

    setIsPrinting(true);
    
    try {
      const res = await fetch('http://localhost:4000/api/docs/secure-print', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionToken }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message = data.message || 'Print request failed';
        if (message.includes('Print limit exceeded')) {
          setRemainingPrints(0);
          toast.error('Print limit exceeded');
          return;
        }
        throw new Error(message);
      }

      const data = await res.json();

      const newRemaining = data.remainingPrints ?? remainingPrints - 1;
      setRemainingPrints(newRemaining);

      const pdfUrl = data.fileUrl;

      const printWindow = window.open('', '_blank', 'width=900,height=700');
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Secure Print - ${documentTitle}</title>
              <style>
                html, body {
                  margin: 0;
                  padding: 0;
                  height: 100%;
                  width: 100%;
                }
                iframe {
                  border: 0;
                  width: 100%;
                  height: 100%;
                }
              </style>
            </head>
            <body oncontextmenu="return false" ondragstart="return false">
              <iframe id="printFrame" src="${pdfUrl}"></iframe>
              <script>
                const iframe = document.getElementById('printFrame');
                iframe.onload = function () {
                  try {
                    iframe.contentWindow.focus();
                    iframe.contentWindow.print();
                  } catch (e) {
                    console.error('Print failed', e);
                  }
                };
              </script>
            </body>
          </html>
        `);
        printWindow.document.close();
      }

      setShowPrintDialog(false);
      toast.success(`Print ready. ${newRemaining} prints remaining.`);

    } catch (err) {
      console.error('Print error:', err);
      toast.error(err instanceof Error ? err.message : 'Print failed');
    } finally {
      setIsPrinting(false);
    }
  }, [sessionToken, remainingPrints, documentTitle]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center animate-fade-in">
          <div className="mb-4 h-12 w-12 mx-auto rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-muted-foreground">Loading secure document...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center animate-fade-in max-w-md">
          <div className="mb-4 h-12 w-12 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <p className="text-destructive mb-4">{error}</p>
          <Link 
            to="/upload" 
            className="text-primary hover:underline"
          >
            Return to Upload
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-screen flex flex-col bg-background overflow-hidden"
      // Disable right-click so user context menu se save / print na kare
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Compact Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/50 flex-shrink-0">
        <Link 
          to="/upload" 
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </Link>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-xs text-muted-foreground truncate max-w-[220px]">
              {documentTitle}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-primary">
              <Shield className="h-4 w-4" />
              <span className="text-xs font-medium">Protected</span>
            </div>
            <Button
              size="sm"
              variant="default"
              className="gap-2"
              disabled={remainingPrints <= 0}
              onClick={handlePrintClick}
            >
              <Printer className="h-4 w-4" />
              {remainingPrints > 0 ? 'Print' : 'No Prints Left'}
            </Button>
          </div>
        </div>
      </div>

      {/* Main content: editor only for admin, pure viewer for regular users */}
      <div className="flex-1 overflow-hidden flex flex-row">
        <div className="flex-1 overflow-hidden">
          {user?.role === 'admin' ? (
            <TicketEditor pdfUrl={pdfUrl} fileType={documentType} documentId={documentId} />
          ) : (
            <div className="h-full w-full bg-muted/10 flex items-center justify-center overflow-auto">
              <div className="w-full h-full max-w-6xl">
                <PDFCanvasViewer
                  pdfUrl={pdfUrl}
                  fileType={documentType}
                  onPdfRendered={() => {}}
                  onRegionDetected={() => {}}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Custom Print Dialog */}
      <SecurePrintDialog
        open={showPrintDialog}
        onOpenChange={setShowPrintDialog}
        onConfirmPrint={handleConfirmPrint}
        remainingPrints={remainingPrints}
        maxPrints={maxPrints}
        documentTitle={documentTitle}
        isPrinting={isPrinting}
      />
    </div>
  );
};

export default Viewer;