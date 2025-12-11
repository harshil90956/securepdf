import React, { useRef, useState } from 'react';
import { X, Printer, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

import type { TicketOutputPage, TicketOnPage } from './TicketEditor';

interface TicketOutputPreviewProps {
  pages: TicketOutputPage[];
  onClose: () => void;
  customFonts?: { family: string; dataUrl: string }[];
  documentId?: string;
}

// A4 dimensions
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const A4_FOOTER_PX = 40; // space at bottom for page number
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

const computeSeriesSlotRelative = (page: TicketOutputPage) => {
  const slotRelativeWidth = (page.seriesSlot.width / page.ticketRegion.width) * 100;
  const slotRelativeHeight = (page.seriesSlot.height / page.ticketRegion.height) * 100;

  let slotRelativeX =
    ((page.seriesSlot.x - page.ticketRegion.x) / page.ticketRegion.width) * 100;
  let slotRelativeY =
    ((page.seriesSlot.y - page.ticketRegion.y) / page.ticketRegion.height) * 100;

  slotRelativeX = Math.min(100 - slotRelativeWidth, Math.max(0, slotRelativeX));
  slotRelativeY = Math.min(100 - slotRelativeHeight, Math.max(0, slotRelativeY));

  return {
    slotRelativeX,
    slotRelativeY,
    slotRelativeWidth,
    slotRelativeHeight,
  };
};

export const TicketOutputPreview: React.FC<TicketOutputPreviewProps> = ({ pages, onClose, customFonts, documentId }) => {
  const [currentPage, setCurrentPage] = useState(0);
  const printContainerRef = useRef<HTMLDivElement>(null);
  const { user, token } = useAuth();

  const [assignEmail, setAssignEmail] = useState('');
  const [assignPages, setAssignPages] = useState('500');
  const [assignLoading, setAssignLoading] = useState(false);

  const totalTickets = pages.length * 4;

  const handleAssignToUser = async () => {
    if (!user || user.role !== 'admin') return;

    if (!assignEmail || !assignPages) {
      toast.error('Email aur pages dono required hai');
      return;
    }

    const pagesNum = Number(assignPages);
    if (Number.isNaN(pagesNum) || pagesNum <= 0) {
      toast.error('Pages positive number hone chahiye');
      return;
    }

    try {
      setAssignLoading(true);
      if (!token) {
        toast.error('Missing auth token');
        return;
      }

      // 1) Upload unique ticket images to backend so we only send S3 references in the job
      const uniqueImages = new Map<string, string>(); // base64 -> s3://key

      for (const page of pages) {
        const src = page.ticketImageData;
        if (!src || typeof src !== 'string') continue;
        if (!src.startsWith('data:image')) continue;
        if (uniqueImages.has(src)) continue;

        try {
          const uploadRes = await fetch('http://localhost:4000/api/admin/upload-ticket-image', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ base64: src }),
          });

          const uploadData = await uploadRes.json().catch(() => ({}));

          if (!uploadRes.ok || !uploadData.key) {
            const message = uploadData.message || 'Failed to upload ticket image';
            throw new Error(message);
          }

          // Store as a lightweight s3:// reference (worker knows how to resolve this)
          uniqueImages.set(src, `s3://${uploadData.key}`);
        } catch (err) {
          console.error('Upload ticket image error:', err);
          throw err instanceof Error ? err : new Error('Failed to upload ticket image');
        }
      }

      // 2) Build lightweight layout JSON using only S3-based src values
      // We mirror the same 3-cars-per-page layout used in this preview, including series text.
      const ticketHeightPx = (A4_HEIGHT_PX - A4_FOOTER_PX) / 4;
      const layoutPages = pages.map((page) => {
        const s3Src = uniqueImages.get(page.ticketImageData) || '';

        const { slotRelativeX, slotRelativeY, slotRelativeWidth, slotRelativeHeight } =
          computeSeriesSlotRelative(page);

        const items: Array<
          | { type: 'image'; src: string; x: number; y: number; width: number; height: number }
          | { type: 'text'; text: string; x: number; y: number; fontSize: number }
        > = [];

        page.tickets.forEach((ticket, idx) => {
          const baseY = ticketHeightPx * idx;

          // Ticket image area
          items.push({
            type: 'image',
            src: s3Src,
            x: 0,
            y: baseY,
            width: A4_WIDTH_PX,
            height: ticketHeightPx,
          });

          // Series number text positioned using the same relative slot as the preview
          const slotX = (slotRelativeX / 100) * A4_WIDTH_PX;
          const slotY = baseY + (slotRelativeY / 100) * ticketHeightPx;
          const fontSize =
            ticket.letterStyles?.[0]?.fontSize || page.seriesSlot.defaultFontSize;

          items.push({
            type: 'text',
            text: ticket.seriesValue,
            x: slotX,
            y: slotY + fontSize,
            fontSize,
          });
        });

        return { items };
      });

      // 3) Create background assignment job (no synchronous PDF generation, only S3 references)
      const res = await fetch('http://localhost:4000/api/admin/assign-job', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: assignEmail, assignedQuota: pagesNum, layoutPages }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = data.message || 'Assignment failed';
        throw new Error(message);
      }

      // Bigger custom toast so admin ko clear feedback mile
      toast.custom(
        (id) => (
          <div
            className="rounded-lg border border-emerald-500/60 bg-background px-4 py-3 shadow-lg flex flex-col gap-1 text-sm max-w-sm"
            onClick={() => toast.dismiss(id)}
          >
            <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">
              Assignment Started
            </span>
            <span className="text-foreground">
              {pagesNum} pages assignment queued for <span className="font-medium">{assignEmail}</span>.
            </span>
            <span className="text-[11px] text-muted-foreground">
              PDF background me generate ho raha hai. User login karke <span className="font-semibold">/printing</span> page par
              apne assigned prints dekh sakta hai jab job complete ho jaye.
            </span>
          </div>
        ),
        { duration: 4000 }
      );
    } catch (err) {
      console.error('Assign error:', err);
      toast.error(err instanceof Error ? err.message : 'Assignment failed');
    } finally {
      setAssignLoading(false);
    }
  };

  const renderTicketHtml = (
    page: TicketOutputPage,
    ticket: TicketOnPage,
    ticketHeight: number
  ) => {
    const lettersHtml = ticket.seriesValue.split('').map((letter, idx) => {
      const fontSize = ticket.letterStyles[idx]?.fontSize || page.seriesSlot.defaultFontSize;
      const displayLetter = letter === ' ' ? '&nbsp;' : letter;
      return `<span style="
        font-size: ${fontSize}px;
        font-family: ${page.seriesSlot.fontFamily};
        color: ${page.seriesSlot.color};
        display: inline-block;
        white-space: pre;
      ">${displayLetter}</span>`;
    }).join('');

    const { slotRelativeX, slotRelativeY, slotRelativeWidth, slotRelativeHeight } =
      computeSeriesSlotRelative(page);

    return `
      <div class="ticket" style="height: ${ticketHeight}mm;">
        <div class="ticket-inner">
          <img src="${page.ticketImageData}" class="ticket-image" style="
            width: 100%;
            height: 100%;
            object-fit: contain;
          " />

          <div class="series-slot" style="
            left: ${slotRelativeX}%;
            top: ${slotRelativeY}%;
            width: ${slotRelativeWidth}%;
            height: ${slotRelativeHeight}%;
            background-color: ${page.seriesSlot.backgroundColor};
            border: ${page.seriesSlot.borderWidth}px solid ${page.seriesSlot.borderColor};
            border-radius: ${page.seriesSlot.borderRadius}px;
            padding: ${page.seriesSlot.paddingTop}px ${page.seriesSlot.paddingRight}px ${page.seriesSlot.paddingBottom}px ${page.seriesSlot.paddingLeft}px;
            transform: rotate(${page.seriesSlot.rotation}deg);
            transform-origin: center center;
            display: flex;
            align-items: center;
            justify-content: ${page.seriesSlot.textAlign === 'left' ? 'flex-start' : page.seriesSlot.textAlign === 'right' ? 'flex-end' : 'center'};
          ">
            <div class="series-letters">${lettersHtml}</div>
          </div>
        </div>
      </div>
    `;
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print.');
      return;
    }

    const ticketHeight = A4_HEIGHT_MM / 4;

    const fontFaceCss = (customFonts || [])
      .map(
        (font) => `@font-face {
  font-family: "${font.family}";
  src: url(${font.dataUrl});
  font-weight: normal;
  font-style: normal;
}`
      )
      .join('\n');

    const pagesHtml = pages.map((page) => {
      const ticketsHtml = page.tickets.map((ticket) =>
        renderTicketHtml(page, ticket, ticketHeight)
      ).join('');

      return `
        <div class="page">
          ${ticketsHtml}
        </div>
      `;
    }).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Ticket Output</title>
          <style>
            ${fontFaceCss}
            @page {
              size: A4;
              margin: 0;
            }
            * {
              box-sizing: border-box;
              margin: 0;
              padding: 0;
            }
            body {
              font-family: Arial, sans-serif;
            }
            .page {
              width: ${A4_WIDTH_MM}mm;
              height: ${A4_HEIGHT_MM}mm;
              page-break-after: always;
              display: flex;
              flex-direction: column;
              background: white;
            }
            .page:last-child {
              page-break-after: avoid;
            }
            .ticket {
              flex: 1;
              position: relative;
              overflow: hidden;
              border-bottom: 1px dashed #ccc;
            }
            .ticket:last-child {
              border-bottom: none;
            }
            .ticket-inner {
              position: absolute;
              inset: 0;
              overflow: hidden;
            }
            .ticket-image {
              position: absolute;
              top: 0;
              left: 0;
            }
            .series-slot {
              position: absolute;
              display: flex;
              align-items: center;
              overflow: visible;
              transform-origin: center center;
            }
            .series-letters {
              display: flex;
              align-items: baseline;
              white-space: pre;
            }
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .ticket { border-bottom: none; }
            }
          </style>
        </head>
        <body>
          ${pagesHtml}
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 500);
  };

  const currentPageData = pages[currentPage];

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-2">
            <X className="h-4 w-4" />
            Close
          </Button>
          <div className="h-4 w-px bg-border" />
          <span className="text-sm text-muted-foreground">
            Output: {pages.length} pages, {totalTickets} tickets
          </span>
        </div>
        <Button onClick={handlePrint} size="sm" className="gap-2">
          <Printer className="h-4 w-4" />
          Print All Pages
        </Button>
      </div>

      {/* Preview Content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Page Navigation */}
        <div className="w-48 border-r border-border p-3 overflow-y-auto bg-card/50">
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Pages</p>
          <div className="space-y-1">
            {pages.map((page, idx) => (
              <button
                key={page.pageNumber}
                onClick={() => setCurrentPage(idx)}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  currentPage === idx
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-foreground'
                }`}
              >
                Page {page.pageNumber} ({page.tickets[0].seriesValue} - {page.tickets[3].seriesValue})
              </button>
            ))}
          </div>
        </div>

        {/* Page Preview with Scroll */}
        <div className="flex-1 min-h-0">
          <div className="h-full overflow-auto p-6 bg-muted/30 flex justify-center">
            <div
              ref={printContainerRef}
              className="bg-white shadow-2xl relative flex flex-col rounded-md"
              style={{
                width: A4_WIDTH_PX,
                minHeight: A4_HEIGHT_PX,
              }}
            >
              {currentPageData && (
                <div className="flex flex-col h-full">
                  {currentPageData.tickets.map((ticket, ticketIdx) => {
                    const ticketHeightPx = (A4_HEIGHT_PX - A4_FOOTER_PX) / 4;
                    const {
                      slotRelativeX,
                      slotRelativeY,
                      slotRelativeWidth,
                      slotRelativeHeight,
                    } = computeSeriesSlotRelative(currentPageData);

                    return (
                      <div
                        key={ticketIdx}
                        className="relative overflow-hidden border-b border-dashed border-muted-foreground/30 last:border-b-0"
                        style={{ height: ticketHeightPx }}
                      >
                        {/* Ticket image area with overlay */}
                        <div className="absolute inset-0">
                          <div className="relative w-full h-full rounded-sm bg-white overflow-hidden">
                            <img
                              src={currentPageData.ticketImageData}
                              alt="Ticket"
                              className="absolute inset-0 w-full h-full select-none"
                              style={{ objectFit: 'contain' }}
                            />

                            {/* Series Slot Overlay */}
                            <div
                              className="absolute flex items-center overflow-visible"
                              style={{
                                left: `${slotRelativeX}%`,
                                top: `${slotRelativeY}%`,
                                width: `${slotRelativeWidth}%`,
                                height: `${slotRelativeHeight}%`,
                                backgroundColor: currentPageData.seriesSlot.backgroundColor,
                                border: `${currentPageData.seriesSlot.borderWidth}px solid ${currentPageData.seriesSlot.borderColor}`,
                                borderRadius: currentPageData.seriesSlot.borderRadius,
                                padding: `${currentPageData.seriesSlot.paddingTop}px ${currentPageData.seriesSlot.paddingRight}px ${currentPageData.seriesSlot.paddingBottom}px ${currentPageData.seriesSlot.paddingLeft}px`,
                                transform: `rotate(${currentPageData.seriesSlot.rotation}deg)`,
                                transformOrigin: 'center center',
                                justifyContent:
                                  currentPageData.seriesSlot.textAlign === 'left'
                                    ? 'flex-start'
                                    : currentPageData.seriesSlot.textAlign === 'right'
                                    ? 'flex-end'
                                    : 'center',
                              }}
                            >
                              <div
                                className="flex items-baseline"
                                style={{ justifyContent: 'inherit', whiteSpace: 'pre' }}
                              >
                                {ticket.seriesValue.split('').map((letter, letterIdx) => (
                                  <span
                                    key={letterIdx}
                                    style={{
                                      fontSize:
                                        ticket.letterStyles[letterIdx]?.fontSize ||
                                        currentPageData.seriesSlot.defaultFontSize,
                                      fontFamily: currentPageData.seriesSlot.fontFamily,
                                      color: currentPageData.seriesSlot.color,
                                      display: 'inline-block',
                                      whiteSpace: 'pre',
                                    }}
                                  >
                                    {letter === ' ' ? '\u00A0' : letter}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Page number */}
              <div className="absolute bottom-2 right-4 text-xs text-muted-foreground bg-white/80 px-2 py-1 rounded shadow-sm">
                Page {currentPageData?.pageNumber} of {pages.length}
              </div>
            </div>
          </div>
        </div>

        {/* Assign panel on right for admin */}
        {user?.role === 'admin' && (
          <div className="w-72 border-l border-border p-4 bg-card/50">
            <h2 className="text-sm font-semibold mb-2">Assign to User</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Iss generated layout (3 cars per page) ke base document ko kisi user ke email par
              pages ke saath assign karein. User login karke <span className="font-semibold">/printing</span> page par
              apne assigned prints dekhega.
            </p>

            <div className="space-y-2 mb-3">
              <Label htmlFor="assignEmail" className="text-xs">User Email</Label>
              <Input
                id="assignEmail"
                type="email"
                placeholder="user@example.com"
                value={assignEmail}
                onChange={(e) => setAssignEmail(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-2 mb-4">
              <Label htmlFor="assignPages" className="text-xs">Pages to assign</Label>
              <Input
                id="assignPages"
                type="number"
                min={1}
                value={assignPages}
                onChange={(e) => setAssignPages(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <Button
              size="sm"
              className="w-full text-xs"
              disabled={assignLoading}
              onClick={handleAssignToUser}
            >
              {assignLoading ? 'Assigning...' : 'Assign Pages'}
            </Button>
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="flex items-center justify-center gap-4 px-4 py-3 border-t border-border bg-card">
        <Button
          variant="outline"
          onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
          disabled={currentPage === 0}
          className="gap-1"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {currentPage + 1} of {pages.length}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage(Math.min(pages.length - 1, currentPage + 1))}
          disabled={currentPage === pages.length - 1}
          className="gap-1"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};