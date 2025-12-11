import React, { useState, useCallback, useRef, useMemo } from 'react';

import { toast } from 'sonner';
import { PDFCanvasViewer, DetectedRegion } from './PDFCanvasViewer';
import { SeriesSlot, SeriesSlotData, LetterStyle } from './SeriesSlot';
import { TicketToolbar } from './TicketToolbar';
import { TicketPropertiesPanel } from './TicketPropertiesPanel';
import { TicketOutputPreview } from './TicketOutputPreview';

interface TicketEditorProps {
  pdfUrl?: string | null;
  fileType?: 'pdf' | 'svg';
  documentId?: string;
}

export interface TicketOnPage {
  seriesValue: string;
  letterStyles: { fontSize: number }[];
}

export interface TicketOutputPage {
  pageNumber: number;
  ticketImageData: string; // Single ticket image
  ticketRegion: { x: number; y: number; width: number; height: number }; // Ticket position in percentage
  seriesSlot: SeriesSlotData; // Slot position relative to ticket
  tickets: TicketOnPage[]; // 4 tickets per page
}

export interface MasterSlotConfig {
  pageNumber: number;
  region: {
    xPercent: number;
    yPercent: number;
    widthPercent: number;
    heightPercent: number;
  };
  seriesSlot: {
    xPercent: number;
    yPercent: number;
    widthPercent: number;
    heightPercent: number;
    rotation: number;
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    textAlign: 'left' | 'center' | 'right';
    fontFamily: string;
    defaultFontSize: number;
    color: string;
    perLetterFontSizes: number[];
  };
}

export const TicketEditor: React.FC<TicketEditorProps> = ({ pdfUrl, fileType = 'pdf', documentId }) => {
  const [pdfCanvas, setPdfCanvas] = useState<HTMLCanvasElement | null>(null);
  const [pdfDimensions, setPdfDimensions] = useState({ width: 0, height: 0 });

  const DEFAULT_FONT_FAMILIES = [
    'Arial',
    'Times New Roman',
    'Courier New',
    'Georgia',
    'Verdana',
    'Helvetica',
    'Trebuchet MS',
    'Impact',
    'Comic Sans MS',
    'Monaco',
  ];

  const [customFonts, setCustomFonts] = useState<{ family: string; dataUrl: string }[]>([]);

  // Detected ticket region (user can adjust this)
  const [ticketRegion, setTicketRegion] = useState<DetectedRegion | null>(null);
  const [isRegionDragging, setIsRegionDragging] = useState(false);
  const [isRegionResizing, setIsRegionResizing] = useState<string | null>(null);
  const [regionDragStart, setRegionDragStart] = useState({ x: 0, y: 0, regionX: 0, regionY: 0 });
  const [regionResizeStart, setRegionResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0, regionX: 0, regionY: 0 });

  // Series slot state
  const [seriesSlot, setSeriesSlot] = useState<SeriesSlotData | null>(null);
  const [isSlotSelected, setIsSlotSelected] = useState(false);

  // Series config - support any characters including spaces
  const [startingSeries, setStartingSeries] = useState('A001');
  const [totalPages, setTotalPages] = useState(5);

  // Output state
  const [outputPages, setOutputPages] = useState<TicketOutputPage[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Drag/resize state for series slot
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, slotX: 0, slotY: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0, slotX: 0, slotY: 0 });

  const [overlayImage, setOverlayImage] = useState<string | null>(null);
  const [overlayImagePosition, setOverlayImagePosition] = useState({ x: 5, y: 5, width: 20 });
  const [isOverlayDragging, setIsOverlayDragging] = useState(false);
  const [overlayDragStart, setOverlayDragStart] = useState({ x: 0, y: 0, startX: 5, startY: 5 });
  const [isOverlaySelected, setIsOverlaySelected] = useState(false);
  const [isOverlayResizing, setIsOverlayResizing] = useState(false);
  const [overlayResizeStart, setOverlayResizeStart] = useState({ x: 0, y: 0, width: 20 });

  // Calculate ending series
  const calculateEndingSeries = useCallback((start: string, totalTickets: number): string => {
    const match = start.match(/^(.*?)(\d+)$/);
    if (match) {
      const [, prefix, numStr] = match;
      const startNum = parseInt(numStr, 10);
      const endNum = startNum + totalTickets - 1;
      return `${prefix}${endNum.toString().padStart(numStr.length, '0')}`;
    }
    return start;
  }, []);

  // 4 tickets per page
  const endingSeries = calculateEndingSeries(startingSeries, totalPages * 4);

  // Track the actual displayed size of the PDF canvas for accurate drag calculations
  const [displayedPdfSize, setDisplayedPdfSize] = useState({ width: 0, height: 0 });

  const masterSlotConfig = useMemo<MasterSlotConfig | null>(() => {
    if (!ticketRegion || !seriesSlot) return null;

    const slotRelativeX = ((seriesSlot.x - ticketRegion.x) / ticketRegion.width) * 100;
    const slotRelativeY = ((seriesSlot.y - ticketRegion.y) / ticketRegion.height) * 100;
    const slotRelativeWidth = (seriesSlot.width / ticketRegion.width) * 100;
    const slotRelativeHeight = (seriesSlot.height / ticketRegion.height) * 100;

    const perLetterFontSizes = seriesSlot.letterStyles.map((ls) => ls.fontSize);

    return {
      pageNumber: 1,
      region: {
        xPercent: ticketRegion.x,
        yPercent: ticketRegion.y,
        widthPercent: ticketRegion.width,
        heightPercent: ticketRegion.height,
      },
      seriesSlot: {
        xPercent: slotRelativeX,
        yPercent: slotRelativeY,
        widthPercent: slotRelativeWidth,
        heightPercent: slotRelativeHeight,
        rotation: seriesSlot.rotation,
        backgroundColor: seriesSlot.backgroundColor,
        borderColor: seriesSlot.borderColor,
        borderWidth: seriesSlot.borderWidth,
        paddingTop: seriesSlot.paddingTop,
        paddingRight: seriesSlot.paddingRight,
        paddingBottom: seriesSlot.paddingBottom,
        paddingLeft: seriesSlot.paddingLeft,
        textAlign: seriesSlot.textAlign,
        fontFamily: seriesSlot.fontFamily,
        defaultFontSize: seriesSlot.defaultFontSize,
        color: seriesSlot.color,
        perLetterFontSizes,
      },
    };
  }, [ticketRegion, seriesSlot]);

  const handlePdfRendered = useCallback((canvas: HTMLCanvasElement, width: number, height: number) => {
    setPdfCanvas(canvas);
    setPdfDimensions({ width, height });

    // Get actual displayed size
    const rect = canvas.getBoundingClientRect();
    setDisplayedPdfSize({ width: rect.width, height: rect.height });
  }, []);

  const handleRegionsDetected = useCallback((regions: DetectedRegion[]) => {
    if (regions.length > 0 && !ticketRegion) {
      setTicketRegion(regions[0]);
      toast.success('Ticket area detected. You can adjust the selection.');
    }
  }, [ticketRegion]);

  // Increment series - preserve spaces and other characters
  const incrementSeries = (value: string, increment: number): string => {
    const match = value.match(/^(.*?)(\d+)$/);
    if (match) {
      const [, prefix, numStr] = match;
      const num = parseInt(numStr, 10);
      const endNum = num + increment;
      return `${prefix}${endNum.toString().padStart(numStr.length, '0')}`;
    }
    return value;
  };

  const handleAddSeriesSlot = useCallback(() => {
    if (seriesSlot) {
      toast.error('Only one series slot allowed');
      return;
    }

    const letterStyles: LetterStyle[] = startingSeries.split('').map(() => ({
      fontSize: 24,
    }));

    // Position relative to the detected ticket region
    const newSlot: SeriesSlotData = {
      id: Date.now().toString(),
      x: ticketRegion ? ticketRegion.x + ticketRegion.width * 0.6 : 50,
      y: ticketRegion ? ticketRegion.y + ticketRegion.height * 0.4 : 30,
      width: 20,
      height: 8,
      value: startingSeries,
      letterStyles,
      defaultFontSize: 24,
      fontFamily: 'Arial',
      color: '#000000',
      rotation: 0,
      backgroundColor: 'transparent',
      borderColor: '#10b981',
      borderWidth: 2,
      borderRadius: 4,
      paddingTop: 4,
      paddingBottom: 4,
      paddingLeft: 8,
      paddingRight: 8,
      textAlign: 'center',
    };

    setSeriesSlot(newSlot);
    setIsSlotSelected(true);
    toast.success('Series slot added. Drag to position on ticket.');
  }, [seriesSlot, startingSeries, ticketRegion]);

  const handleDeleteSeriesSlot = useCallback(() => {
    setSeriesSlot(null);
    setIsSlotSelected(false);
    setOutputPages([]);
    toast.success('Series slot deleted');
  }, []);

  const handleUpdateSlot = useCallback((updates: Partial<SeriesSlotData>) => {
    if (!seriesSlot) return;
    
    if (updates.value && updates.value !== seriesSlot.value) {
      const newLength = updates.value.length;
      const currentStyles = seriesSlot.letterStyles;
      
      const newLetterStyles: LetterStyle[] = [];
      for (let i = 0; i < newLength; i++) {
        newLetterStyles.push(currentStyles[i] || { fontSize: seriesSlot.defaultFontSize });
      }
      updates.letterStyles = newLetterStyles;
    }
    
    setSeriesSlot({ ...seriesSlot, ...updates });
  }, [seriesSlot]);

  const handleUpdateLetterFontSize = useCallback((index: number, fontSize: number) => {
    if (!seriesSlot) return;
    
    const newLetterStyles = [...seriesSlot.letterStyles];
    newLetterStyles[index] = { ...newLetterStyles[index], fontSize };
    
    setSeriesSlot({ ...seriesSlot, letterStyles: newLetterStyles });
  }, [seriesSlot]);

  // Series slot drag handling
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!seriesSlot) return;
    e.preventDefault();
    
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      slotX: seriesSlot.x,
      slotY: seriesSlot.y,
    });
  }, [seriesSlot]);

  const handleResizeStart = useCallback((e: React.MouseEvent, corner: string) => {
    if (!seriesSlot) return;
    e.preventDefault();
    e.stopPropagation();
    
    setIsResizing(corner);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: seriesSlot.width,
      height: seriesSlot.height,
      slotX: seriesSlot.x,
      slotY: seriesSlot.y,
    });
  }, [seriesSlot]);

  // Ticket region drag/resize handlers
  const handleRegionDragStart = useCallback((e: React.MouseEvent) => {
    if (!ticketRegion) return;
    e.preventDefault();
    e.stopPropagation();
    
    setIsRegionDragging(true);
    setRegionDragStart({
      x: e.clientX,
      y: e.clientY,
      regionX: ticketRegion.x,
      regionY: ticketRegion.y,
    });
  }, [ticketRegion]);

  const handleRegionResizeStart = useCallback((e: React.MouseEvent, corner: string) => {
    if (!ticketRegion) return;
    e.preventDefault();
    e.stopPropagation();
    
    setIsRegionResizing(corner);
    setRegionResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: ticketRegion.width,
      height: ticketRegion.height,
      regionX: ticketRegion.x,
      regionY: ticketRegion.y,
    });
  }, [ticketRegion]);

  const handleOverlayDragStart = useCallback((e: React.MouseEvent) => {
    if (!overlayImage || displayedPdfSize.width === 0) return;
    e.preventDefault();
    e.stopPropagation();

    setIsOverlayDragging(true);
    setOverlayDragStart({
      x: e.clientX,
      y: e.clientY,
      startX: overlayImagePosition.x,
      startY: overlayImagePosition.y,
    });
  }, [overlayImage, overlayImagePosition, displayedPdfSize.width]);

  const handleOverlayResizeStart = useCallback((e: React.MouseEvent) => {
    if (!overlayImage || displayedPdfSize.width === 0) return;
    e.preventDefault();
    e.stopPropagation();

    setIsOverlayResizing(true);
    setOverlayResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: overlayImagePosition.width,
    });
  }, [overlayImage, overlayImagePosition.width, displayedPdfSize.width]);

  const handleOverlayWheel = useCallback((e: React.WheelEvent) => {
    if (!overlayImage) return;
    e.preventDefault();
    e.stopPropagation();

    const delta = e.deltaY > 0 ? -2 : 2;
    setOverlayImagePosition((prev) => {
      const newWidth = Math.max(5, Math.min(80, prev.width + delta));
      return { ...prev, width: newWidth };
    });
  }, [overlayImage]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (displayedPdfSize.width === 0) return;

    // Handle series slot drag - use displayed size for accurate positioning
    if (isDragging && seriesSlot) {
      const dx = ((e.clientX - dragStart.x) / displayedPdfSize.width) * 100;
      const dy = ((e.clientY - dragStart.y) / displayedPdfSize.height) * 100;
      
      const newX = Math.max(0, Math.min(100 - seriesSlot.width, dragStart.slotX + dx));
      const newY = Math.max(0, Math.min(100 - seriesSlot.height, dragStart.slotY + dy));
      
      setSeriesSlot({ ...seriesSlot, x: newX, y: newY });
    }

    // Handle series slot resize
    if (isResizing && seriesSlot) {
      const dx = ((e.clientX - resizeStart.x) / displayedPdfSize.width) * 100;
      const dy = ((e.clientY - resizeStart.y) / displayedPdfSize.height) * 100;
      
      let newWidth = resizeStart.width;
      let newHeight = resizeStart.height;
      let newX = resizeStart.slotX;
      let newY = resizeStart.slotY;

      if (isResizing.includes('e')) newWidth = Math.max(5, resizeStart.width + dx);
      if (isResizing.includes('w')) {
        const widthChange = Math.min(dx, resizeStart.width - 5);
        newWidth = resizeStart.width - widthChange;
        newX = resizeStart.slotX + widthChange;
      }
      if (isResizing.includes('s')) newHeight = Math.max(3, resizeStart.height + dy);
      if (isResizing.includes('n')) {
        const heightChange = Math.min(dy, resizeStart.height - 3);
        newHeight = resizeStart.height - heightChange;
        newY = resizeStart.slotY + heightChange;
      }

      setSeriesSlot({ ...seriesSlot, x: newX, y: newY, width: newWidth, height: newHeight });
    }

    // Handle ticket region drag
    if (isRegionDragging && ticketRegion) {
      const dx = ((e.clientX - regionDragStart.x) / displayedPdfSize.width) * 100;
      const dy = ((e.clientY - regionDragStart.y) / displayedPdfSize.height) * 100;
      
      const newX = Math.max(0, Math.min(100 - ticketRegion.width, regionDragStart.regionX + dx));
      const newY = Math.max(0, Math.min(100 - ticketRegion.height, regionDragStart.regionY + dy));
      
      setTicketRegion({ ...ticketRegion, x: newX, y: newY });
    }

    // Handle ticket region resize
    if (isRegionResizing && ticketRegion) {
      const dx = ((e.clientX - regionResizeStart.x) / displayedPdfSize.width) * 100;
      const dy = ((e.clientY - regionResizeStart.y) / displayedPdfSize.height) * 100;
      
      let newWidth = regionResizeStart.width;
      let newHeight = regionResizeStart.height;
      let newX = regionResizeStart.regionX;
      let newY = regionResizeStart.regionY;

      if (isRegionResizing.includes('e')) newWidth = Math.max(10, regionResizeStart.width + dx);
      if (isRegionResizing.includes('w')) {
        const widthChange = Math.min(dx, regionResizeStart.width - 10);
        newWidth = regionResizeStart.width - widthChange;
        newX = regionResizeStart.regionX + widthChange;
      }
      if (isRegionResizing.includes('s')) newHeight = Math.max(10, regionResizeStart.height + dy);
      if (isRegionResizing.includes('n')) {
        const heightChange = Math.min(dy, regionResizeStart.height - 10);
        newHeight = regionResizeStart.height - heightChange;
        newY = regionResizeStart.regionY + heightChange;
      }

      setTicketRegion({ ...ticketRegion, x: newX, y: newY, width: newWidth, height: newHeight });
    }

    // Handle overlay image drag
    if (isOverlayDragging && overlayImage) {
      const dx = ((e.clientX - overlayDragStart.x) / displayedPdfSize.width) * 100;
      const dy = ((e.clientY - overlayDragStart.y) / displayedPdfSize.height) * 100;

      const newX = Math.max(0, Math.min(100 - overlayImagePosition.width, overlayDragStart.startX + dx));
      const newY = Math.max(0, Math.min(100, overlayDragStart.startY + dy));

      setOverlayImagePosition((prev) => ({ ...prev, x: newX, y: newY }));
    }

    // Handle overlay image resize (width only)
    if (isOverlayResizing && overlayImage) {
      const dx = ((e.clientX - overlayResizeStart.x) / displayedPdfSize.width) * 100;
      const newWidth = Math.max(5, Math.min(80, overlayResizeStart.width + dx));
      setOverlayImagePosition((prev) => ({ ...prev, width: newWidth }));
    }
  }, [
    isDragging,
    isResizing,
    isRegionDragging,
    isRegionResizing,
    isOverlayDragging,
    isOverlayResizing,
    seriesSlot,
    ticketRegion,
    overlayImage,
    overlayImagePosition.width,
    displayedPdfSize,
    dragStart,
    resizeStart,
    regionDragStart,
    regionResizeStart,
    overlayDragStart,
    overlayResizeStart,
  ]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(null);
    setIsRegionDragging(false);
    setIsRegionResizing(null);
    setIsOverlayDragging(false);
    setIsOverlayResizing(false);
  }, []);

  const handleGenerateOutput = useCallback(async () => {
    // ...

    setIsGenerating(true);

    try {
      // Crop only the selected ticket region from the full PDF canvas
      const sourceWidth = pdfCanvas.width;
      const sourceHeight = pdfCanvas.height;

      const cropX = (ticketRegion.x / 100) * sourceWidth;
      const cropY = (ticketRegion.y / 100) * sourceHeight;
      const cropWidth = (ticketRegion.width / 100) * sourceWidth;
      const cropHeight = (ticketRegion.height / 100) * sourceHeight;

      const ticketCanvas = document.createElement('canvas');
      ticketCanvas.width = cropWidth;
      ticketCanvas.height = cropHeight;

      const ticketCtx = ticketCanvas.getContext('2d');
      if (!ticketCtx) {
        toast.error('Failed to prepare ticket canvas');
        setIsGenerating(false);
        return;
      }

      ticketCtx.drawImage(
        pdfCanvas,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        cropWidth,
        cropHeight
      );

      // Composite overlay image (logo/SVG) onto the ticket canvas so it appears in print
      if (overlayImage) {
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            try {
              // overlayImagePosition is relative to full page; convert to ticket-relative
              const relX = (overlayImagePosition.x - ticketRegion.x) / ticketRegion.width;
              const relY = (overlayImagePosition.y - ticketRegion.y) / ticketRegion.height;
              const relWidth = overlayImagePosition.width / ticketRegion.width;

              const drawX = relX * ticketCanvas.width;
              const drawY = relY * ticketCanvas.height;
              const drawWidth = relWidth * ticketCanvas.width;
              const aspect = img.width > 0 ? img.height / img.width : 1;
              const drawHeight = drawWidth * aspect;

              ticketCtx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
            } catch (err) {
              console.error('Error drawing overlay image on ticket canvas:', err);
            }
            resolve();
          };
          img.onerror = () => {
            console.error('Failed to load overlay image for compositing');
            resolve();
          };
          img.src = overlayImage;
        });
      }

      const ticketImageData = ticketCanvas.toDataURL('image/png', 1.0);

      // Calculate total tickets and pages (4 tickets per page)
      const totalTickets = totalPages * 4;
      const pages: TicketOutputPage[] = [];

      // ...
      for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
        const tickets: TicketOnPage[] = [];
        
        for (let ticketIdx = 0; ticketIdx < 4; ticketIdx++) {
          const globalIdx = pageIdx * 4 + ticketIdx;
          const seriesValue = incrementSeries(startingSeries, globalIdx);
          
          const letterStyles = seriesValue.split('').map((_, idx) => {
            return seriesSlot.letterStyles[idx] || { fontSize: seriesSlot.defaultFontSize };
          });

          tickets.push({ seriesValue, letterStyles });
        }

        // Convert the series slot to be relative to the ticket region (0-100)
        const ticketRelativeSlot = {
          ...seriesSlot,
          x: ((seriesSlot.x - ticketRegion.x) / ticketRegion.width) * 100,
          y: ((seriesSlot.y - ticketRegion.y) / ticketRegion.height) * 100,
          width: (seriesSlot.width / ticketRegion.width) * 100,
          height: (seriesSlot.height / ticketRegion.height) * 100,
        } as SeriesSlotData;

        pages.push({
          pageNumber: pageIdx + 1,
          ticketImageData,
          // Ticket region is now the full cropped ticket image
          ticketRegion: {
            x: 0,
            y: 0,
            width: 100,
            height: 100,
          },
          seriesSlot: ticketRelativeSlot,
          tickets,
        });
      }

      setOutputPages(pages);
      const endSeries = incrementSeries(startingSeries, totalTickets - 1);
      toast.success(`Generated ${pages.length} pages, ${totalTickets} tickets (${startingSeries} → ${endSeries})`);
    } catch (err) {
      console.error('Error generating output:', err);
      toast.error('Failed to generate output');
    } finally {
      setIsGenerating(false);
    }
  }, [seriesSlot, pdfCanvas, ticketRegion, startingSeries, totalPages, incrementSeries]);

  const handleShowPreview = useCallback(() => {
    setShowPreview(true);
  }, [outputPages]);

  const handleUploadFont = useCallback((file: File) => {
    if (!file) return;

    const allowedTypes = [
      'font/ttf',
      'font/otf',
      'font/woff',
      'font/woff2',
      'application/x-font-ttf',
      'application/x-font-otf',
      'application/font-woff',
      'application/font-woff2',
    ];

    if (!allowedTypes.includes(file.type) && !/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/.test(file.name)) {
      toast.error('Upload a valid font file (.ttf, .otf, .woff, .woff2)');
      return;
    }

    const fontFamilyName = file.name.replace(/\.[^.]+$/, '') || 'Custom Font';

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const dataUrl = typeof e.target?.result === 'string' ? e.target.result : null;
        if (!dataUrl) {
          toast.error('Failed to read font file');
          return;
        }

        const fontFace = new FontFace(fontFamilyName, `url(${dataUrl})`);
        const loaded = await fontFace.load();
        (document as any).fonts.add(loaded);

        setCustomFonts((prev) => {
          if (prev.some((f) => f.family === fontFamilyName)) return prev;
          return [...prev, { family: fontFamilyName, dataUrl }];
        });

        toast.success(`Font "${fontFamilyName}" added`);
      } catch (error) {
        console.error('Error loading font:', error);
        toast.error('Failed to load font');
      }
    };

    reader.readAsDataURL(file);
  }, []);

  const handleUploadImage = useCallback((file: File) => {
    if (!file) return;

    const allowedTypes = [
      'image/svg+xml',
      'image/png',
      'image/jpeg',
    ];

    const lowered = file.name.toLowerCase();
    if (!allowedTypes.includes(file.type) && !/(\.svg|\.png|\.jpe?g)$/.test(lowered)) {
      toast.error('Upload SVG, PNG, or JPG image');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = typeof e.target?.result === 'string' ? e.target.result : null;
      if (!result) {
        toast.error('Failed to read image file');
        return;
      }
      setOverlayImage(result);
      setOverlayImagePosition({ x: 5, y: 5, width: 20 });
      toast.success('Image added on ticket');
    };
    reader.readAsDataURL(file);
  }, []);

  if (!pdfUrl) {
    return (
      <div className="flex h-full bg-background">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-24 h-32 mx-auto mb-4 rounded border-2 border-dashed border-border flex items-center justify-center">
              <span className="text-4xl text-muted-foreground">📄</span>
            </div>
            <p className="text-sm text-muted-foreground">Upload a PDF or SVG to start editing</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full bg-background">
        {/* Left Toolbar */}
        <TicketToolbar
          hasSeriesSlot={!!seriesSlot}
          startingSeries={startingSeries}
          endingSeries={endingSeries}
          totalPages={totalPages}
          isGenerating={isGenerating}
          hasOutput={outputPages.length > 0}
          onAddSeriesSlot={handleAddSeriesSlot}
          onDeleteSeriesSlot={handleDeleteSeriesSlot}
          onStartingSeriesChange={setStartingSeries}
          onTotalPagesChange={setTotalPages}
          onGenerateOutput={handleGenerateOutput}
          onShowPreview={handleShowPreview}
          onUploadFont={handleUploadFont}
          onUploadImage={handleUploadImage}
        />

        {/* Center - PDF Canvas */}
        <div 
          ref={containerRef}
          className="flex-1 min-h-0 p-4 relative overflow-auto bg-muted/30 flex items-start justify-center"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <PDFCanvasViewer
            pdfUrl={pdfUrl}
            fileType={fileType}
            onPdfRendered={handlePdfRendered}
            onRegionDetected={handleRegionsDetected}
          >
            {/* Detected/Adjustable Ticket Region */}
            {ticketRegion && displayedPdfSize.width > 0 && (
              <div
                className="absolute border-2 border-dashed border-blue-500 cursor-move bg-blue-500/5"
                style={{
                  left: `${ticketRegion.x}%`,
                  top: `${ticketRegion.y}%`,
                  width: `${ticketRegion.width}%`,
                  height: `${ticketRegion.height}%`,
                }}
                onMouseDown={handleRegionDragStart}
              >
                <span className="absolute -top-6 left-0 text-[10px] bg-blue-500 text-white px-2 py-0.5 rounded whitespace-nowrap">
                  Ticket Area (drag to adjust)
                </span>
                
                {/* Resize handles for ticket region */}
                {['nw', 'ne', 'sw', 'se'].map((corner) => (
                  <div
                    key={corner}
                    className="absolute w-3 h-3 bg-blue-500 rounded-full cursor-pointer"
                    style={{
                      top: corner.includes('n') ? -6 : 'auto',
                      bottom: corner.includes('s') ? -6 : 'auto',
                      left: corner.includes('w') ? -6 : 'auto',
                      right: corner.includes('e') ? -6 : 'auto',
                    }}
                    onMouseDown={(e) => handleRegionResizeStart(e, corner)}
                  />
                ))}
              </div>
            )}
            
            {/* Series Slot */}
            {seriesSlot && displayedPdfSize.width > 0 && (
              <SeriesSlot
                slot={seriesSlot}
                isSelected={isSlotSelected}
                containerWidth={displayedPdfSize.width}
                containerHeight={displayedPdfSize.height}
                onSelect={() => setIsSlotSelected(true)}
                onDragStart={handleDragStart}
                onValueChange={(value) => handleUpdateSlot({ value })}
                onResizeStart={handleResizeStart}
              />
            )}
            
            {overlayImage && displayedPdfSize.width > 0 && (
              <div
                className="absolute group"
                style={{
                  left: `${overlayImagePosition.x}%`,
                  top: `${overlayImagePosition.y}%`,
                  width: `${overlayImagePosition.width}%`,
                }}
              >
                <img
                  src={overlayImage}
                  alt="Overlay"
                  className="w-full h-auto select-none cursor-move"
                  onMouseDown={handleOverlayDragStart}
                  onWheel={handleOverlayWheel}
                />
                {/* Resize handle for overlay image (bottom-right) */}
                <div
                  className="absolute -right-2 -bottom-2 w-4 h-4 bg-primary rounded-full cursor-se-resize shadow-md border-2 border-background opacity-0 group-hover:opacity-100 transition-opacity"
                  onMouseDown={handleOverlayResizeStart}
                />
              </div>
            )}
          </PDFCanvasViewer>
        </div>

        {/* Right Properties Panel */}
        <TicketPropertiesPanel
          slot={seriesSlot}
          availableFonts={[...DEFAULT_FONT_FAMILIES, ...customFonts.map((f) => f.family)]}
          onUpdateSlot={handleUpdateSlot}
          onUpdateLetterFontSize={handleUpdateLetterFontSize}
        />

      </div>

      {/* Output Preview */}
      {showPreview && (
        <TicketOutputPreview
          pages={outputPages}
          customFonts={customFonts}
          onClose={() => setShowPreview(false)}
          documentId={documentId}
        />
      )}
    </>
  );
};