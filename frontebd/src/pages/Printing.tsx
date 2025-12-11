import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import throttle from 'lodash/throttle';
import { ArrowLeft, Printer, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

interface AssignedDoc {
  id: string;
  documentId: string | null;
  documentTitle: string;
  assignedQuota: number;
  usedPrints: number;
  remainingPrints: number | null;
  sessionToken: string | null;
  documentType: 'pdf' | 'svg' | string;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  stage?: 'pending' | 'rendering' | 'merging' | 'completed' | 'failed';
  totalPages?: number;
  completedPages?: number;
}

const Printing = () => {
  const navigate = useNavigate();
  const { token } = useAuth();

  const [assignedDocs, setAssignedDocs] = useState<AssignedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<number | null>(null);
  const pollingStoppedRef = useRef(false);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    tokenRef.current = token ?? null;
  }, [token]);

  const fetchAssignedDocs = useCallback(async () => {
    try {
      setError(null);

      const res = await fetch('http://localhost:4000/api/docs/assigned', {
        headers: {
          'Content-Type': 'application/json',
          ...(tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {}),
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({} as any));
        const message = (data as any).message || 'Failed to load assigned documents';

        if (res.status === 403 && message.toLowerCase().includes('ip is blocked')) {
          setError(message);
          if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          pollingStoppedRef.current = true;
          if (loading) setLoading(false);
          return;
        }

        throw new Error(message);
      }

      const data: AssignedDoc[] = await res.json();
      setAssignedDocs(data);

      if (loading) setLoading(false);
    } catch (err) {
      console.error('Assigned docs error:', err);

      const msg = err instanceof Error ? err.message : 'Failed to load assigned documents';
      setError(msg);

      if (msg.toLowerCase().includes('ip is blocked')) {
        if (intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        pollingStoppedRef.current = true;
      }

      if (loading) setLoading(false);
    }
  }, [loading]);

  const throttledFetch = useCallback(throttle(fetchAssignedDocs, 3000), [fetchAssignedDocs]);

  useEffect(() => {
    if (!tokenRef.current || pollingStoppedRef.current) {
      return;
    }

    if (intervalRef.current !== null) {
      return;
    }

    throttledFetch();

    const id = window.setInterval(() => {
      throttledFetch();
    }, 3000);

    intervalRef.current = id;

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [throttledFetch]);

  useEffect(() => {
    if (pollingStoppedRef.current) return;

    if (!assignedDocs || assignedDocs.length === 0) return;

    const allCompleted = assignedDocs.every((doc) => doc.stage === 'completed');

    if (allCompleted && intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
      pollingStoppedRef.current = true;
    }
  }, [assignedDocs]);

  const handleViewAndPrint = (doc: AssignedDoc) => {
    navigate('/viewer', {
      state: {
        sessionToken: doc.sessionToken,
        documentTitle: doc.documentTitle,
        documentId: doc.documentId,
        remainingPrints: doc.remainingPrints,
        maxPrints: doc.assignedQuota,
        documentType: doc.documentType,
      },
    });
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto">
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
          className="mb-6"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <div className="bg-card p-8 rounded-lg shadow-md border border-border">
          <div className="mb-6">
            <h1 className="text-2xl font-bold mb-1">Printing</h1>
            <p className="text-muted-foreground">
              Yahan aapko woh saare documents dikhengi jo admin ne aapke email par assign kiye hain.
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Loading assigned documents...
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          ) : assignedDocs.length === 0 ? (
            <div className="border border-dashed border-border rounded-lg p-8 text-center text-muted-foreground">
              Abhi tak admin ne aapke liye koi document assign nahi kiya hai.
            </div>
          ) : (
            <div className="space-y-4">
              {assignedDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="border border-border rounded-lg p-4 bg-background/60 flex items-center justify-between gap-4"
                >
                  <div>
                    <h2 className="text-lg font-semibold">{doc.documentTitle}</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Admin ne aapko <span className="font-medium">{doc.assignedQuota}</span> pages assign kiye hain.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {doc.status && doc.status !== 'completed' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                          {doc.stage === 'rendering' && 'Rendering pages…'}
                          {doc.stage === 'merging' && 'Merging PDF…'}
                          {!doc.stage && doc.status === 'pending' && 'Processing…'}
                          {!doc.stage && doc.status === 'processing' && 'Generating PDF…'}
                          {doc.status === 'failed' && 'Failed'}
                        </span>
                      ) : (
                        <>Remaining: {doc.remainingPrints} / {doc.assignedQuota} pages</>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {(() => {
                        if (doc.totalPages && doc.totalPages > 0) {
                          const percent = Math.round(
                            ((doc.completedPages ?? 0) / doc.totalPages) * 100
                          );
                          return `Generation progress: ${percent}%`;
                        }

                        if (!doc.assignedQuota) return null;
                        const remaining = doc.remainingPrints ?? doc.assignedQuota;
                        const used = Math.max(0, doc.assignedQuota - remaining);
                        const percent = Math.round((used / doc.assignedQuota) * 100);
                        return `Completed: ${percent}%`;
                      })()}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Button
                      size="sm"
                      disabled={
                        !doc.documentId ||
                        !doc.sessionToken ||
                        (doc.remainingPrints ?? 0) <= 0
                      }
                      onClick={() => handleViewAndPrint(doc)}
                      className="gap-2"
                    >
                      <Printer className="h-4 w-4" />
                      {!doc.documentId || !doc.sessionToken
                        ? 'Processing…'
                        : (doc.remainingPrints ?? 0) > 0
                        ? 'View & Print'
                        : 'No Prints Left'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Printing;
