import React, { useState, useRef, useEffect, useCallback } from 'react';
import '../Canvas.css';
import type { ShortcutMap } from './CanvasShortcutsPanel';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface CanvasNode {
  id: string;
  type: 'note' | 'todo' | 'folder' | 'nested';
  x: number;
  y: number;
  title: string;
  content: any;
  color: string;
  shape?: 'rect' | 'circle';
  width?: number;
  height?: number;
  cornerRadii?: [number, number, number, number];
  borderRadius?: number; // legacy fallback
  borderWidth?: number;
  borderStyle?: string;
}

export interface CanvasConnection {
  id: string;
  from: string;
  fromPort: 'input' | 'output' | 'top' | 'bottom';
  fromSlot?: number;
  to: string;
  toPort: 'input' | 'output' | 'top' | 'bottom';
  toSlot?: number;
  routing?: 'bezier' | 'orthogonal' | 'rounded';
  waypoints?: { x: number; y: number }[];
}

export type WorkMode = 'default' | 'ue5' | 'appweb';

interface CanvasState {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
}

interface SubCanvasEntry {
  nodeId: string;
  title: string;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
}

interface MiuniverseCanvasProps {
  nodes: CanvasNode[];
  setNodes: React.Dispatch<React.SetStateAction<CanvasNode[]>>;
  connections: CanvasConnection[];
  setConnections: React.Dispatch<React.SetStateAction<CanvasConnection[]>>;
  workMode?: WorkMode;
  onWorkModeChange?: (mode: WorkMode) => void;
  shortcutMap?: ShortcutMap;
  onTextSelection?: () => void;
  onDoubleClickText?: (e: React.MouseEvent) => void;
}

export const isPlaceholderText = (text: string) => {
  const placeholders = ['Inhalt...', 'Neue Notiz', 'Todo Liste', 'Sub-Canvas', 'Neuer Ordner', 'Neues Item', 'Neues Todo-Item', 'Neues Item...'];
  return placeholders.includes(text?.trim());
};

export const handleContentEditableFocus = (e: React.FocusEvent<HTMLDivElement>) => {
  const text = e.currentTarget.innerText.trim();
  if (isPlaceholderText(text)) {
    setTimeout(() => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(e.currentTarget);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }, 10);
  }
};

export const handleContentEditableKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
  const text = e.currentTarget.innerText.trim();
  if (isPlaceholderText(text) && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.currentTarget.innerText = '';
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function buildBorderRadius(node: CanvasNode): string {
  if (node.shape === 'circle') return '50%';
  if (node.cornerRadii) {
    const [tl, tr, br, bl] = node.cornerRadii;
    return `${tl}px ${tr}px ${br}px ${bl}px`;
  }
  if (node.borderRadius !== undefined) return `${node.borderRadius}px`;
  return '8px';
}

function scaledHandleSize(zoom: number, base = 10): number {
  const scaled = base * Math.pow(zoom, 0.5);
  return Math.max(4, Math.min(20, scaled));
}

function getSlotPositions(length: number): number[] {
  const half = length / 2;
  const offset = half * 0.8;
  return [half - offset, half, half + offset];
}

function getAdjustedLocalPos(
  localX: number,
  localY: number,
  w: number,
  h: number,
  radii: [number, number, number, number],
  hasHeader: boolean,
  port: 'input' | 'output' | 'top' | 'bottom',
  shape?: string
) {
  if (shape === 'circle') {
    return { x: localX, y: localY };
  }
  const totalH = hasHeader ? 32 + 3 + h : h;
  const [R_tl, R_tr, R_br, R_bl] = radii;

  let x = localX;
  let y = localY;

  if (x < R_tl && y < R_tl) {
    if (port === 'top') {
      y = R_tl - Math.sqrt(Math.max(0, R_tl * R_tl - (x - R_tl) * (x - R_tl)));
    } else if (port === 'input') {
      x = R_tl - Math.sqrt(Math.max(0, R_tl * R_tl - (y - R_tl) * (y - R_tl)));
    }
  } else if (x > w - R_tr && y < R_tr) {
    if (port === 'top') {
      y = R_tr - Math.sqrt(Math.max(0, R_tr * R_tr - (x - (w - R_tr)) * (x - (w - R_tr))));
    } else if (port === 'output') {
      x = (w - R_tr) + Math.sqrt(Math.max(0, R_tr * R_tr - (y - R_tr) * (y - R_tr)));
    }
  } else if (x > w - R_br && y > totalH - R_br) {
    if (port === 'bottom') {
      y = (totalH - R_br) + Math.sqrt(Math.max(0, R_br * R_br - (x - (w - R_br)) * (x - (w - R_br))));
    } else if (port === 'output') {
      x = (w - R_br) + Math.sqrt(Math.max(0, R_br * R_br - (y - (totalH - R_br)) * (y - (totalH - R_br))));
    }
  } else if (x < R_bl && y > totalH - R_bl) {
    if (port === 'bottom') {
      y = (totalH - R_bl) + Math.sqrt(Math.max(0, R_bl * R_bl - (x - R_bl) * (x - R_bl)));
    } else if (port === 'input') {
      x = R_bl - Math.sqrt(Math.max(0, R_bl * R_bl - (y - (totalH - R_bl)) * (y - (totalH - R_bl))));
    }
  }

  return { x, y };
}

function getNodePortsCanvas(node: CanvasNode, showHeaders: boolean): { port: 'input' | 'output' | 'top' | 'bottom'; slot: number; x: number; y: number }[] {
  const w = Math.max(80, node.width || 180);
  const h = Math.max(60, node.height || 100);
  const headerHeight = 32;
  const verticalGap = 3;
  const hasHeader = showHeaders && node.shape !== 'circle' && w >= 80 && h >= 40;
  
  const x = node.x;
  const y = node.y;
  
  const portsList: { port: 'input' | 'output' | 'top' | 'bottom'; slot: number; x: number; y: number }[] = [];
  const handleOffset = 0;
  const radii = node.cornerRadii || [node.borderRadius ?? 8, node.borderRadius ?? 8, node.borderRadius ?? 8, node.borderRadius ?? 8];
  
  const slotsX = getSlotPositions(w);
  slotsX.forEach((slotX, si) => {
    // top
    const localTopY = (hasHeader ? headerHeight + verticalGap : 0) - handleOffset;
    const adjTop = getAdjustedLocalPos(slotX, localTopY, w, h, radii, hasHeader, 'top', node.shape);
    portsList.push({
      port: 'top',
      slot: si,
      x: x + adjTop.x,
      y: y + adjTop.y
    });

    // bottom
    const localBottomY = (hasHeader ? headerHeight + verticalGap + h + handleOffset : h + handleOffset);
    const adjBottom = getAdjustedLocalPos(slotX, localBottomY, w, h, radii, hasHeader, 'bottom', node.shape);
    portsList.push({
      port: 'bottom',
      slot: si,
      x: x + adjBottom.x,
      y: y + adjBottom.y
    });
  });
  
  const slotsY = getSlotPositions(h);
  const bodyOffset = hasHeader ? headerHeight + verticalGap : 0;
  slotsY.forEach((slotY, si) => {
    // input
    const localInputX = -handleOffset;
    const localInputY = bodyOffset + slotY;
    const adjInput = getAdjustedLocalPos(localInputX, localInputY, w, h, radii, hasHeader, 'input', node.shape);
    portsList.push({
      port: 'input',
      slot: si,
      x: x + adjInput.x,
      y: y + adjInput.y
    });

    // output
    const localOutputX = w + handleOffset;
    const localOutputY = bodyOffset + slotY;
    const adjOutput = getAdjustedLocalPos(localOutputX, localOutputY, w, h, radii, hasHeader, 'output', node.shape);
    portsList.push({
      port: 'output',
      slot: si,
      x: x + adjOutput.x,
      y: y + adjOutput.y
    });
  });
  
  return portsList;
}

function countSlotUsage(
  connections: CanvasConnection[],
  nodeId: string,
  port: 'input' | 'output' | 'top' | 'bottom'
): Record<number, number> {
  const usage: Record<number, number> = {};
  for (const c of connections) {
    if (c.from === nodeId && c.fromPort === port) {
      const slot = c.fromSlot ?? 0;
      usage[slot] = (usage[slot] || 0) + 1;
    }
    if (c.to === nodeId && c.toPort === port) {
      const slot = c.toSlot ?? 0;
      usage[slot] = (usage[slot] || 0) + 1;
    }
  }
  return usage;
}

function getBestSlot(
  connections: CanvasConnection[],
  nodeId: string,
  port: 'input' | 'output' | 'top' | 'bottom',
  _length = 180
): number {
  const usage = countSlotUsage(connections, nodeId, port);
  let best = 0;
  let bestCount = Infinity;
  for (let i = 0; i < 3; i++) {
    const cnt = usage[i] || 0;
    if (cnt < bestCount) {
      bestCount = cnt;
      best = i;
    }
  }
  return best;
}


function getOrthogonalPoints(
  cx1: number, cy1: number,
  cx2: number, cy2: number,
  fromSide: string, toSide: string,
  waypoints?: { x: number; y: number }[],
  fromSlot = 0,
  toSlot = 0
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  points.push({ x: cx1, y: cy1 });

  if (waypoints && waypoints.length > 0) {
    let curr = { x: cx1, y: cy1 };
    for (const wp of waypoints) {
      if (points.length === 1) {
        let startDir = { x: 0, y: 0 };
        if (fromSide === 'output') startDir = { x: 1, y: 0 };
        else if (fromSide === 'input') startDir = { x: -1, y: 0 };
        else if (fromSide === 'bottom') startDir = { x: 0, y: 1 };
        else if (fromSide === 'top') startDir = { x: 0, y: -1 };

        if (startDir.x !== 0) {
          points.push({ x: wp.x, y: curr.y });
        } else {
          points.push({ x: curr.x, y: wp.y });
        }
      } else {
        points.push({ x: wp.x, y: curr.y });
      }
      points.push({ x: wp.x, y: wp.y });
      curr = { x: wp.x, y: wp.y };
    }
    let endDir = { x: 0, y: 0 };
    if (toSide === 'output') endDir = { x: 1, y: 0 };
    else if (toSide === 'input') endDir = { x: -1, y: 0 };
    else if (toSide === 'bottom') endDir = { x: 0, y: 1 };
    else if (toSide === 'top') endDir = { x: 0, y: -1 };

    if (endDir.x !== 0) {
      points.push({ x: curr.x, y: cy2 });
    } else {
      points.push({ x: cx2, y: curr.y });
    }
  } else {
    let startDir = { x: 0, y: 0 };
    if (fromSide === 'output') startDir = { x: 1, y: 0 };
    else if (fromSide === 'input') startDir = { x: -1, y: 0 };
    else if (fromSide === 'bottom') startDir = { x: 0, y: 1 };
    else if (fromSide === 'top') startDir = { x: 0, y: -1 };

    let endDir = { x: 0, y: 0 };
    if (toSide === 'output') endDir = { x: 1, y: 0 };
    else if (toSide === 'input') endDir = { x: -1, y: 0 };
    else if (toSide === 'bottom') endDir = { x: 0, y: 1 };
    else if (toSide === 'top') endDir = { x: 0, y: -1 };

    const portOffset = 18;
    const slotSpacing = 5;
    const slotOffsetFrom = (fromSlot - 1) * slotSpacing;
    const slotOffsetTo = (toSlot - 1) * slotSpacing;

    const pStart = {
      x: cx1 + startDir.x * portOffset,
      y: cy1 + startDir.y * portOffset
    };

    const pEnd = {
      x: cx2 + endDir.x * portOffset,
      y: cy2 + endDir.y * portOffset
    };

    points.push(pStart);

    // 1. Horizontal exit, Vertical entry
    if (startDir.x !== 0 && endDir.y !== 0) {
      points.push({ x: pEnd.x, y: pStart.y });
      points.push(pEnd);
    }
    // 2. Vertical exit, Horizontal entry
    else if (startDir.y !== 0 && endDir.x !== 0) {
      points.push({ x: pStart.x, y: pEnd.y });
      points.push(pEnd);
    }
    // 3. Both horizontal
    else if (startDir.x !== 0 && endDir.x !== 0) {
      const isOpposing = startDir.x !== endDir.x;
      const isCorrectDirection = (cx2 - cx1) * startDir.x > 0;

      if (isOpposing && isCorrectDirection && Math.abs(cx2 - cx1) > 2 * portOffset) {
        const midX = (pStart.x + pEnd.x) / 2 + (slotOffsetFrom + slotOffsetTo) / 2;
        points.push({ x: midX, y: pStart.y });
        points.push({ x: midX, y: pEnd.y });
        points.push(pEnd);
      } else {
        const targetX = startDir.x > 0
          ? Math.max(pStart.x, pEnd.x) + portOffset + (fromSlot + toSlot - 2) * slotSpacing
          : Math.min(pStart.x, pEnd.x) - portOffset - (fromSlot + toSlot - 2) * slotSpacing;
        points.push({ x: targetX, y: pStart.y });
        points.push({ x: targetX, y: pEnd.y });
        points.push(pEnd);
      }
    }
    // 4. Both vertical
    else if (startDir.y !== 0 && endDir.y !== 0) {
      const isOpposing = startDir.y !== endDir.y;
      const isCorrectDirection = (cy2 - cy1) * startDir.y > 0;

      if (isOpposing && isCorrectDirection && Math.abs(cy2 - cy1) > 2 * portOffset) {
        const midY = (pStart.y + pEnd.y) / 2 + (slotOffsetFrom + slotOffsetTo) / 2;
        points.push({ x: pStart.x, y: midY });
        points.push({ x: pEnd.x, y: midY });
        points.push(pEnd);
      } else {
        const targetY = startDir.y > 0
          ? Math.max(pStart.y, pEnd.y) + portOffset + (fromSlot + toSlot - 2) * slotSpacing
          : Math.min(pStart.y, pEnd.y) - portOffset - (fromSlot + toSlot - 2) * slotSpacing;
        points.push({ x: pStart.x, y: targetY });
        points.push({ x: pEnd.x, y: targetY });
        points.push(pEnd);
      }
    } else {
      points.push({ x: (pStart.x + pEnd.x) / 2, y: pStart.y });
      points.push({ x: (pStart.x + pEnd.x) / 2, y: pEnd.y });
      points.push(pEnd);
    }
  }

  points.push({ x: cx2, y: cy2 });

  const uniquePoints: { x: number; y: number }[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const last = uniquePoints[uniquePoints.length - 1];
    if (Math.abs(p.x - last.x) > 0.01 || Math.abs(p.y - last.y) > 0.01) {
      uniquePoints.push(p);
    }
  }
  return uniquePoints;
}

function snapPointsToNodes(
  points: { x: number; y: number }[],
  nodes: CanvasNode[],
  excludeNodeIds: string[],
  showHeaders: boolean
): { x: number; y: number }[] {
  // Clone points to avoid mutating state directly
  const snapped = points.map(p => ({ ...p }));
  const threshold = 30; // snapping threshold in canvas pixels

  for (let i = 0; i < snapped.length - 1; i++) {
    const p1 = snapped[i];
    const p2 = snapped[i + 1];

    const isHorizontal = Math.abs(p1.y - p2.y) < 0.01;
    const isVertical = Math.abs(p1.x - p2.x) < 0.01;

    if (!isHorizontal && !isVertical) continue;

    for (const node of nodes) {
      if (excludeNodeIds.includes(node.id)) continue;

      const nodeW = Math.max(80, node.width || 180);
      const nodeH = Math.max(60, node.height || 100);
      const hasHeader = showHeaders && node.shape !== 'circle' && nodeW >= 80 && nodeH >= 40;
      const totalHeight = hasHeader ? 32 + 3 + nodeH : nodeH;

      const xMin = node.x;
      const xMax = node.x + nodeW;
      const yMin = node.y;
      const yMax = node.y + totalHeight;

      if (isHorizontal) {
        const segMinX = Math.min(p1.x, p2.x);
        const segMaxX = Math.max(p1.x, p2.x);

        if (segMaxX >= xMin - threshold && segMinX <= xMax + threshold) {
          // Check top edge
          if (Math.abs(p1.y - yMin) < threshold) {
            p1.y = yMin;
            p2.y = yMin;
          }
          // Check bottom edge
          else if (Math.abs(p1.y - yMax) < threshold) {
            p1.y = yMax;
            p2.y = yMax;
          }
        }
      } else if (isVertical) {
        const segMinY = Math.min(p1.y, p2.y);
        const segMaxY = Math.max(p1.y, p2.y);

        if (segMaxY >= yMin - threshold && segMinY <= yMax + threshold) {
          // Check left edge
          if (Math.abs(p1.x - xMin) < threshold) {
            p1.x = xMin;
            p2.x = xMin;
          }
          // Check right edge
          else if (Math.abs(p1.x - xMax) < threshold) {
            p1.x = xMax;
            p2.x = xMax;
          }
        }
      }
    }
  }

  // Ensure consecutive equal points are cleaned up or aligned if needed
  return snapped;
}

function buildOrthogonalPath(
  x1: number, y1: number,
  x2: number, y2: number,
  fromSide: string, toSide: string,
  r = 0,
  waypoints?: { x: number; y: number }[],
  fromSlot = 0,
  toSlot = 0,
  zoom = 1.0,
  panX = 0,
  panY = 0,
  nodes?: CanvasNode[],
  showHeaders?: boolean,
  isSelected?: boolean,
  excludeNodeIds?: string[]
): string {
  const cx1 = (x1 - panX) / zoom;
  const cy1 = (y1 - panY) / zoom;
  const cx2 = (x2 - panX) / zoom;
  const cy2 = (y2 - panY) / zoom;

  let canvasPoints = getOrthogonalPoints(cx1, cy1, cx2, cy2, fromSide, toSide, waypoints, fromSlot, toSlot);

  if (isSelected && nodes && nodes.length > 0) {
    canvasPoints = snapPointsToNodes(canvasPoints, nodes, excludeNodeIds || [], showHeaders || false);
  }

  const screenPoints = canvasPoints.map(p => ({
    x: p.x * zoom + panX,
    y: p.y * zoom + panY
  }));

  if (screenPoints.length < 3 || r <= 0) {
    let pathStr = `M ${screenPoints[0].x} ${screenPoints[0].y}`;
    for (let i = 1; i < screenPoints.length; i++) {
      pathStr += ` L ${screenPoints[i].x} ${screenPoints[i].y}`;
    }
    return pathStr;
  }

  let pathStr = `M ${screenPoints[0].x} ${screenPoints[0].y}`;
  const actualRadius = r * zoom;

  for (let i = 1; i < screenPoints.length - 1; i++) {
    const pPrev = screenPoints[i - 1];
    const pCurr = screenPoints[i];
    const pNext = screenPoints[i + 1];

    const d1 = { x: pPrev.x - pCurr.x, y: pPrev.y - pCurr.y };
    const d2 = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };

    const len1 = Math.sqrt(d1.x * d1.x + d1.y * d1.y);
    const len2 = Math.sqrt(d2.x * d2.x + d2.y * d2.y);

    const minLen = Math.min(len1, len2);
    const rCurrent = Math.min(actualRadius, minLen / 2);

    if (rCurrent <= 0) {
      pathStr += ` L ${pCurr.x} ${pCurr.y}`;
      continue;
    }

    const n1 = { x: d1.x / len1, y: d1.y / len1 };
    const n2 = { x: d2.x / len2, y: d2.y / len2 };

    const pA = { x: pCurr.x + n1.x * rCurrent, y: pCurr.y + n1.y * rCurrent };
    const pB = { x: pCurr.x + n2.x * rCurrent, y: pCurr.y + n2.y * rCurrent };

    pathStr += ` L ${pA.x} ${pA.y} Q ${pCurr.x} ${pCurr.y}, ${pB.x} ${pB.y}`;
  }

  pathStr += ` L ${screenPoints[screenPoints.length - 1].x} ${screenPoints[screenPoints.length - 1].y}`;
  return pathStr;
}


function buildBezierPath(
  x1: number, y1: number,
  x2: number, y2: number,
  waypoints?: { x: number; y: number }[],
  zoom = 1.0,
  panX = 0,
  panY = 0
): string {
  const screenWps = waypoints ? waypoints.map(wp => ({
    x: wp.x * zoom + panX,
    y: wp.y * zoom + panY
  })) : [];

  if (screenWps.length > 0) {
    let path = `M ${x1} ${y1}`;
    let prevX = x1;
    let prevY = y1;
    for (const wp of screenWps) {
      const dx = Math.abs(wp.x - prevX) * 0.5;
      path += ` C ${prevX + dx} ${prevY}, ${wp.x - dx} ${wp.y}, ${wp.x} ${wp.y}`;
      prevX = wp.x;
      prevY = wp.y;
    }
    const dx = Math.abs(x2 - prevX) * 0.5;
    path += ` C ${prevX + dx} ${prevY}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    return path;
  }
  const dx = Math.abs(x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

const PRESET_BG_COLORS = ['rgba(12, 20, 40, 0.75)', '#1e293b', '#0f172a', '#1e1b4b', '#111827'];
const PRESET_BORDER_COLORS = ['#2dd4e6', '#8B5CF6', '#3B82F6', '#EF4444', '#10B981'];

export const MiuniverseCanvas: React.FC<MiuniverseCanvasProps> = ({
  nodes: topNodes,
  setNodes: setTopNodes,
  connections: topConnections,
  setConnections: setTopConnections,
  workMode = 'default',
  onWorkModeChange,
  shortcutMap,
  onTextSelection: _onTextSelection,
  onDoubleClickText: _onDoubleClickText
}) => {
  const [subStack, setSubStack] = useState<SubCanvasEntry[]>([]);
  const activeNodes = subStack.length > 0 ? subStack[subStack.length - 1].nodes : topNodes;
  const activeConnections = subStack.length > 0 ? subStack[subStack.length - 1].connections : topConnections;

  const [showHeaders, setShowHeaders] = useState<boolean>(() => {
    return localStorage.getItem('miuniverse_canvas_show_headers') !== 'false';
  });

  const toggleHeaders = useCallback(() => {
    setShowHeaders(prev => {
      const next = !prev;
      localStorage.setItem('miuniverse_canvas_show_headers', String(next));
      return next;
    });
  }, []);

  const setActiveNodes = useCallback((updater: React.SetStateAction<CanvasNode[]>) => {
    if (subStack.length > 0) {
      setSubStack(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        next[next.length - 1] = {
          ...last,
          nodes: typeof updater === 'function' ? updater(last.nodes) : updater
        };
        return next;
      });
    } else {
      setTopNodes(updater);
    }
  }, [subStack.length, setTopNodes]);

  const setActiveConnections = useCallback((updater: React.SetStateAction<CanvasConnection[]>) => {
    if (subStack.length > 0) {
      setSubStack(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        next[next.length - 1] = {
          ...last,
          connections: typeof updater === 'function' ? updater(last.connections) : updater
        };
        return next;
      });
    } else {
      setTopConnections(updater);
    }
  }, [subStack.length, setTopConnections]);

  const MAX_HISTORY = 50;
  const historyRef = useRef<CanvasState[]>([]);
  const historyIndexRef = useRef(-1);

  const pushHistory = useCallback((nodes: CanvasNode[], connections: CanvasConnection[]) => {
    const snapshot: CanvasState = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      connections: JSON.parse(JSON.stringify(connections))
    };
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(snapshot);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    } else {
      historyIndexRef.current++;
    }
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current--;
    const snapshot = historyRef.current[historyIndexRef.current];
    setActiveNodes(snapshot.nodes);
    setActiveConnections(snapshot.connections);
  }, [setActiveNodes, setActiveConnections]);

  const commitChange = useCallback((newNodes: CanvasNode[], newConns: CanvasConnection[]) => {
    pushHistory(newNodes, newConns);
    setActiveNodes(newNodes);
    setActiveConnections(newConns);
  }, [pushHistory, setActiveNodes, setActiveConnections]);

  const [zoom, setZoom] = useState(1.0);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [gridStyle, setGridStyle] = useState<'dots' | 'lines' | 'empty'>('dots');

  const [isPanning, setIsPanning] = useState(false);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [activeLine, setActiveLine] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const [dragStartHandle, setDragStartHandle] = useState<{ nodeId: string; port: 'input' | 'output' | 'top' | 'bottom'; slot: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; visible: boolean } | null>(null);
  const [activeClosestPort, setActiveClosestPort] = useState<{ nodeId: string; port: 'input' | 'output' | 'top' | 'bottom'; slot: number } | null>(null);
  const [altPressed, setAltPressed] = useState(false);
  const [ctrlPressed, setCtrlPressed] = useState(false);
  const [altKeyOnlyPressed, setAltKeyOnlyPressed] = useState(false);
  const [mobileDeleteMode, setMobileDeleteMode] = useState(false);
  const longPressTimer = useRef<any>(null);

  const [customBgColors, setCustomBgColors] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('miuniverse_custom_bg_presets') || '[]');
    } catch { return []; }
  });
  const [customBorderColors, setCustomBorderColors] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('miuniverse_custom_border_presets') || '[]');
    } catch { return []; }
  });
  const [colorEditorNodeId, setColorEditorNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [defaultBorderColor, setDefaultBorderColor] = useState<string>('#8B5CF6');
  const [defaultBorderWidth, setDefaultBorderWidth] = useState<number>(1);
  const [defaultBorderStyle, setDefaultBorderStyle] = useState<'solid' | 'dashed' | 'dotted'>('solid');
  const [defaultCornerRadius, setDefaultCornerRadius] = useState<number>(8);
  const [activeSettingsBarNodeId, setActiveSettingsBarNodeId] = useState<string | null>(null);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);
  const customColorInputRef = useRef<HTMLInputElement>(null);
  const customColorType = useRef<'bg' | 'border'>('bg');
  const customColorIdx = useRef<number>(0);

  const [drawBox, setDrawBox] = useState<{
    startX: number; startY: number; currentX: number; currentY: number; active: boolean; isCircle: boolean;
    nodeType?: 'note' | 'todo' | 'nested';
  } | null>(null);

  const [newlyCreatedNodeId, setNewlyCreatedNodeId] = useState<string | null>(null);
  const [markedNodeId, setMarkedNodeId] = useState<string | null>(null);
  const lastRightClickTime = useRef<number>(0);
  const lastRightClickNodeId = useRef<string | null>(null);
  const lastMouseY = useRef<number | null>(null);
  const longPressTimeoutRef = useRef<any>(null);
  const longPressStartPos = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggered = useRef<boolean>(false);

  const [selectionBox, setSelectionBox] = useState<{
    startX: number; startY: number; currentX: number; currentY: number; active: boolean;
  } | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);

  const selectedNodeIdsRef = useRef<string[]>([]);
  const selectedConnectionIdsRef = useRef<string[]>([]);
  useEffect(() => { selectedNodeIdsRef.current = selectedNodeIds; }, [selectedNodeIds]);
  useEffect(() => { selectedConnectionIdsRef.current = selectedConnectionIds; }, [selectedConnectionIds]);

  const activeNodesRef = useRef<CanvasNode[]>([]);
  const activeConnectionsRef = useRef<CanvasConnection[]>([]);
  useEffect(() => { activeNodesRef.current = activeNodes; }, [activeNodes]);
  useEffect(() => { activeConnectionsRef.current = activeConnections; }, [activeConnections]);
  const wheelTimeoutRef = useRef<any>(null);

  const [cornerDrag, setCornerDrag] = useState<{
    nodeId: string;
    cornerIndex: number;
    startX: number;
    startY: number;
    startRadius: number;
    startWidth?: number;
    startHeight?: number;
    startNodeX?: number;
    startNodeY?: number;
  } | null>(null);
  const [selectedCorners, setSelectedCorners] = useState<{ nodeId: string; indices: number[] } | null>(null);

  const [waypointDrag, setWaypointDrag] = useState<{
    connectionId: string;
    index: number;
  } | null>(null);

  const dragOffset = useRef({ x: 0, y: 0 });
  const draggedDistanceRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const spacePressed = useRef(false);
  const xPressed = useRef(false);

  const checkShortcut = useCallback((e: KeyboardEvent, shortcutId: string): boolean => {
    if (!shortcutMap) return false;
    const shortcut = shortcutMap[shortcutId];
    if (!shortcut) return false;
    
    const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
    const ctrlMatch = !shortcut.modifiers.ctrl || e.ctrlKey || e.metaKey;
    const shiftMatch = !shortcut.modifiers.shift || e.shiftKey;
    const altMatch = !shortcut.modifiers.alt || e.altKey;
    
    return keyMatch && ctrlMatch && shiftMatch && altMatch;
  }, [shortcutMap]);

  const checkMouseShortcut = useCallback((e: MouseEvent | React.MouseEvent, shortcutId: string): boolean => {
    if (!shortcutMap) return false;
    const shortcut = shortcutMap[shortcutId];
    if (!shortcut) return false;

    const isMouse = ['left click', 'middle click', 'right click', 'mausklick', 'back button', 'forward button'].includes(shortcut.key.toLowerCase());
    if (!isMouse) return false;

    let mouseKey = 'mausklick';
    if (e.button === 0) mouseKey = 'left click';
    else if (e.button === 1) mouseKey = 'middle click';
    else if (e.button === 2) mouseKey = 'right click';
    else if (e.button === 3) mouseKey = 'back button';
    else if (e.button === 4) mouseKey = 'forward button';

    const keyMatch = mouseKey.toLowerCase() === shortcut.key.toLowerCase();
    const ctrlMatch = !shortcut.modifiers.ctrl || e.ctrlKey || e.metaKey;
    const shiftMatch = !shortcut.modifiers.shift || e.shiftKey;
    const altMatch = !shortcut.modifiers.alt || e.altKey;

    return keyMatch && ctrlMatch && shiftMatch && altMatch;
  }, [shortcutMap]);

  const isShortcutKey = useCallback((key: string, shortcutId: string): boolean => {
    if (!shortcutMap) return false;
    const shortcut = shortcutMap[shortcutId];
    if (!shortcut) return false;
    return key.toLowerCase() === shortcut.key.toLowerCase();
  }, [shortcutMap]);

  const isDeleteShortcutActive = useCallback((e: KeyboardEvent | MouseEvent | React.MouseEvent): boolean => {
    const hasX = ('key' in e) ? (e.key.toLowerCase() === 'x') : xPressed.current;
    return !!(e.shiftKey && e.ctrlKey && e.altKey && hasX);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' ||
        (document.activeElement as HTMLElement)?.getAttribute('contenteditable') === 'true';

      if ((e.code === 'Space' || isShortcutKey(e.key, 'pan')) && !isTyping) {
        spacePressed.current = true;
        if (viewportRef.current) viewportRef.current.style.cursor = 'grab';
      }

      if (e.key === 'Control') {
        setCtrlPressed(true);
      }
      if (e.key === 'Alt') {
        setAltKeyOnlyPressed(true);
      }
      if (e.key.toLowerCase() === 'x') {
        xPressed.current = true;
      }

      if (isDeleteShortcutActive(e)) {
        setAltPressed(true);
      }

      if (e.shiftKey && e.ctrlKey && e.altKey && (e.key.toLowerCase() === 'x' || xPressed.current)) {
        setAltPressed(true);
      } else if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key.toLowerCase() === 'x') {
        if (!e.shiftKey || !e.ctrlKey || !e.altKey || !xPressed.current) {
          setAltPressed(false);
        }
      }

      if (e.key !== 'Shift') {
        setNewlyCreatedNodeId(null);
      }

      // Alt shortcuts always work, even when a card is being edited
      if (e.altKey && (e.key.toLowerCase() === 'n' || e.code === 'KeyN')) {
        e.preventDefault();
        toggleHeaders();
        return;
      }

      if (checkShortcut(e, 'toggleRouting') || (e.altKey && (e.key.toLowerCase() === 'l' || e.code === 'KeyL'))) {
        e.preventDefault();
        // Blur any focused text element so the action fires cleanly
        (document.activeElement as HTMLElement)?.blur?.();
        const selectedConns = selectedConnectionIdsRef.current;
        const selectedNodes = selectedNodeIdsRef.current;

        console.log("Alt+L keydown detected. Selected connections:", selectedConns, "Selected nodes:", selectedNodes);

        if (selectedConns.length > 0) {
          const firstConn = activeConnections.find(c => selectedConns.includes(c.id));
          const targetRouting = (firstConn?.routing === 'bezier' ? 'orthogonal' : 'bezier') as 'bezier' | 'orthogonal';
          const newConns = activeConnections.map(c => {
            if (selectedConns.includes(c.id)) {
              return { ...c, routing: targetRouting };
            }
            return c;
          });
          commitChange(activeNodes, newConns);
        } else if (selectedNodes.length > 0) {
          const affectedConns = activeConnections.filter(c => selectedNodes.includes(c.from) || selectedNodes.includes(c.to));
          if (affectedConns.length > 0) {
            const targetRouting = (affectedConns[0].routing === 'bezier' ? 'orthogonal' : 'bezier') as 'bezier' | 'orthogonal';
            const newConns = activeConnections.map(c => {
              if (selectedNodes.includes(c.from) || selectedNodes.includes(c.to)) {
                return { ...c, routing: targetRouting };
              }
              return c;
            });
            commitChange(activeNodes, newConns);
          }
        }
        return;
      }

      // Global shortcuts that always work (even when typing)
      if (checkShortcut(e, 'undo')) {
        e.preventDefault();
        undo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key.toLowerCase() === 'a' || e.code === 'KeyA')) {
        e.preventDefault();
        (document.activeElement as HTMLElement)?.blur?.();
        setSelectedNodeIds(activeNodes.map(n => n.id));
        setSelectedConnectionIds(activeConnections.map(c => c.id));
        return;
      }

      if (e.key === 'Enter' && isTyping) {
        const activeEl = document.activeElement as HTMLElement;
        if (activeEl?.getAttribute('contenteditable') === 'true') {
          e.preventDefault();
          activeEl.blur();
          return;
        }
      }

      if (isTyping) return;

      if (e.key === 'Enter') {
        const selectedIds = selectedNodeIdsRef.current;
        if (selectedIds.length === 1) {
          e.preventDefault();
          const nodeId = selectedIds[0];
          let editEl = document.querySelector(`[data-nodeid="${nodeId}"] .card-title`) as HTMLElement;
          if (!editEl) {
            editEl = document.querySelector(`[data-nodeid="${nodeId}"] .card-text`) as HTMLElement;
          }
          if (editEl) {
            editEl.focus();
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(editEl);
            range.collapse(false);
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
          return;
        }
      }

      if (e.key === 'Escape') {
        const activeEl = document.activeElement as HTMLElement;
        if (activeEl && (activeEl.getAttribute('contenteditable') === 'true' || activeEl.closest('[contenteditable="true"]'))) {
          activeEl.blur();
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (subStack.length > 0) {
          exitSubCanvas();
        } else {
          setSelectedNodeIds([]);
          setSelectedConnectionIds([]);
          setMarkedNodeId(null);
          setContextMenu(null);
          setColorEditorNodeId(null);
        }
        return;
      }

      if (checkShortcut(e, 'delete') || checkShortcut(e, 'loeschen') || e.key === 'Delete' || e.key === 'Backspace') {
        const nodesToDelete = selectedNodeIdsRef.current;
        const connsToDelete = selectedConnectionIdsRef.current;
        if (nodesToDelete.length > 0 || connsToDelete.length > 0) {
          const newNodes = activeNodes.filter(n => !nodesToDelete.includes(n.id));
          const newConns = activeConnections.filter(c =>
            !connsToDelete.includes(c.id) &&
            !nodesToDelete.includes(c.from) &&
            !nodesToDelete.includes(c.to)
          );
          commitChange(newNodes, newConns);
          setSelectedNodeIds([]);
          setSelectedConnectionIds([]);
          e.preventDefault();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key.toLowerCase() === 'x') {
        if (e.key === 'Control') {
           setCtrlPressed(false);
           setActiveClosestPort(null);
        }
        if (e.key === 'Alt') {
          setAltKeyOnlyPressed(false);
        }
        if (!e.shiftKey || !e.ctrlKey || !e.altKey || !xPressed.current) {
          setAltPressed(false);
        }
      }
      if (e.code === 'Space' || isShortcutKey(e.key, 'pan')) {
        spacePressed.current = false;
        if (viewportRef.current) viewportRef.current.style.cursor = 'default';
      }
      if (e.key.toLowerCase() === 'x') {
        xPressed.current = false;
      }
    };

    const handleGlobalMouseDown = (e: MouseEvent) => {
      if (checkMouseShortcut(e, 'loeschen') || checkMouseShortcut(e, 'delete') || checkMouseShortcut(e, 'altDelete')) {
        e.preventDefault();
        e.stopPropagation();

        if (checkMouseShortcut(e, 'loeschen') || checkMouseShortcut(e, 'delete')) {
          const nodesToDelete = selectedNodeIdsRef.current;
          const connsToDelete = selectedConnectionIdsRef.current;
          if (nodesToDelete.length > 0 || connsToDelete.length > 0) {
            const newNodes = activeNodesRef.current.filter(n => !nodesToDelete.includes(n.id));
            const newConns = activeConnectionsRef.current.filter(c =>
              !connsToDelete.includes(c.id) &&
              !nodesToDelete.includes(c.from) &&
              !nodesToDelete.includes(c.to)
            );
            commitChange(newNodes, newConns);
            setSelectedNodeIds([]);
            setSelectedConnectionIds([]);
          }
        }
      }
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        if (checkMouseShortcut(e, 'loeschen') || checkMouseShortcut(e, 'delete') || checkMouseShortcut(e, 'altDelete')) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleGlobalMouseDown, true);
    window.addEventListener('mouseup', handleGlobalMouseUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleGlobalMouseDown, true);
      window.removeEventListener('mouseup', handleGlobalMouseUp, true);
    };
  }, [activeNodes, activeConnections, subStack.length, undo, commitChange, checkShortcut, isShortcutKey, isDeleteShortcutActive, checkMouseShortcut, toggleHeaders]);

  // Close context menu on outside click (left, right, or middle click outside context menu container)
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (contextMenu?.visible) {
        const menuEl = document.querySelector('.canvas-context-menu');
        if (menuEl && !menuEl.contains(e.target as Node)) {
          setContextMenu(null);
        }
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [contextMenu]);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      if (selectedNodeIds.length > 0) {
        const delta = e.deltaY < 0 ? 2 : -2;
        setActiveNodes(prev => prev.map(n => {
          if (selectedNodeIds.includes(n.id)) {
            if (n.shape === 'circle') return n;
            const radii = n.cornerRadii ?? [n.borderRadius ?? 8, n.borderRadius ?? 8, n.borderRadius ?? 8, n.borderRadius ?? 8];
            const newRadii = radii.map(r => Math.max(0, r + delta)) as [number, number, number, number];
            return { ...n, cornerRadii: newRadii, borderRadius: newRadii[0] };
          }
          return n;
        }));

        if (wheelTimeoutRef.current) {
          clearTimeout(wheelTimeoutRef.current);
        }
        wheelTimeoutRef.current = setTimeout(() => {
          pushHistory(activeNodesRef.current, activeConnectionsRef.current);
        }, 500);
      }
      return;
    }

    if (newlyCreatedNodeId) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 2 : -2;
      let updatedRadius = 8;
      setActiveNodes(prev => prev.map(n => {
        if (n.id === newlyCreatedNodeId && n.shape !== 'circle') {
          const radii = n.cornerRadii ?? [n.borderRadius ?? 5, n.borderRadius ?? 5, n.borderRadius ?? 5, n.borderRadius ?? 5];
          const newR = Math.max(0, radii[0] + delta);
          updatedRadius = newR;
          return { ...n, cornerRadii: [newR, newR, newR, newR], borderRadius: newR };
        }
        return n;
      }));
      setDefaultCornerRadius(updatedRadius);

      if (wheelTimeoutRef.current) {
        clearTimeout(wheelTimeoutRef.current);
      }
      wheelTimeoutRef.current = setTimeout(() => {
        pushHistory(activeNodesRef.current, activeConnectionsRef.current);
      }, 500);
      return;
    }

    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const scaleFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const nextZoom = Math.min(Math.max(zoom * scaleFactor, 0.1), 5.0);
    const zoomRatio = nextZoom / zoom;
    setPanX(mouseX - (mouseX - panX) * zoomRatio);
    setPanY(mouseY - (mouseY - panY) * zoomRatio);
    setZoom(nextZoom);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isContentEditable = target.getAttribute('contenteditable') === 'true' || target.closest('[contenteditable="true"]');
    if (isContentEditable || editingNodeId) {
      return;
    }

    if (colorEditorNodeId) {
      setColorEditorNodeId(null);
    }
    if (activeSettingsBarNodeId) {
      setActiveSettingsBarNodeId(null);
    }

    if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) {
        const canvasX = ((e.clientX - rect.left) - panX) / zoom;
        const canvasY = ((e.clientY - rect.top) - panY) / zoom;

        // Find the absolute closest port among all nodes
        let closestPort: { nodeId: string; port: 'input' | 'output' | 'top' | 'bottom'; slot: number; x: number; y: number } | null = null;
        let minDistance = Infinity;

        for (const node of activeNodes) {
          const ports = getNodePortsCanvas(node, showHeaders);
          for (const p of ports) {
            const dx = canvasX - p.x;
            const dy = canvasY - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDistance) {
              minDistance = dist;
              closestPort = { nodeId: node.id, port: p.port, slot: p.slot, x: p.x, y: p.y };
            }
          }
        }

        // If a port is close (within 100px), start dragging connection
        if (closestPort && minDistance < 100) {
          const viewRect = viewportRef.current?.getBoundingClientRect();
          if (viewRect) {
            const startX = closestPort.x * zoom + panX;
            const startY = closestPort.y * zoom + panY;
            setDragStartHandle({ nodeId: closestPort.nodeId, port: closestPort.port, slot: closestPort.slot });
            setActiveLine({ startX, startY, currentX: startX, currentY: startY });
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }

        // Ctrl+click on empty canvas → start selection
        setSelectionBox({ startX: canvasX, startY: canvasY, currentX: canvasX, currentY: canvasY, active: true });
        setNewlyCreatedNodeId(null);
        setMarkedNodeId(null);
        setSelectedNodeIds([]);
        setSelectedConnectionIds([]);
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    // Shift+Click drags to draw new box types (LMB=standard, RMB=todo, MMB=nested)
    if (e.shiftKey && (e.button === 0 || e.button === 1 || e.button === 2)) {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) {
        const canvasX = ((e.clientX - rect.left) - panX) / zoom;
        const canvasY = ((e.clientY - rect.top) - panY) / zoom;
        const nodeType = e.button === 2 ? 'todo' : e.button === 1 ? 'nested' : 'note';
        setDrawBox({ startX: canvasX, startY: canvasY, currentX: canvasX, currentY: canvasY, active: true, isCircle: false, nodeType });
        setNewlyCreatedNodeId(null);
        setMarkedNodeId(null);
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    if (e.button === 0) {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) {
        const canvasX = ((e.clientX - rect.left) - panX) / zoom;
        const canvasY = ((e.clientY - rect.top) - panY) / zoom;
        setSelectionBox({ startX: canvasX, startY: canvasY, currentX: canvasX, currentY: canvasY, active: true });
        setNewlyCreatedNodeId(null);
        setMarkedNodeId(null);
        setSelectedNodeIds([]);
        setSelectedConnectionIds([]);
        e.preventDefault();
      }
      return;
    }

    // Right-click = pan
    if (e.button === 2 || (e.button === 0 && spacePressed.current)) {
      setIsPanning(true);
      dragOffset.current = { x: e.clientX - panX, y: e.clientY - panY };
      if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing';
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Middle-click = context menu
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, visible: true });
      return;
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (longPressStartPos.current) {
      const dx = e.clientX - longPressStartPos.current.x;
      const dy = e.clientY - longPressStartPos.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) {
        if (longPressTimeoutRef.current) {
          clearTimeout(longPressTimeoutRef.current);
          longPressTimeoutRef.current = null;
        }
      }
    }

    const isCombo = e.shiftKey && e.ctrlKey && e.altKey && xPressed.current;
    if (isCombo !== altPressed) setAltPressed(isCombo);

    if (cornerDrag) {
      const dx = e.clientX - cornerDrag.startX;
      const dy = e.clientY - cornerDrag.startY;

      if (e.ctrlKey || ctrlPressed) {
        const node = activeNodes.find(n => n.id === cornerDrag.nodeId);
        if (node) {
          const startWidth = cornerDrag.startWidth ?? Math.max(80, node.width || 180);
          const startHeight = cornerDrag.startHeight ?? Math.max(60, node.height || 100);
          const startNodeX = cornerDrag.startNodeX ?? node.x;
          const startNodeY = cornerDrag.startNodeY ?? node.y;

          const dxCanvas = dx / zoom;
          const dyCanvas = dy / zoom;

          // Corner Index signs:
          // 0: top-left (left=-1, top=-1)
          // 1: top-right (right=1, top=-1)
          // 2: bottom-right (right=1, bottom=1)
          // 3: bottom-left (left=-1, bottom=1)
          const sX = (cornerDrag.cornerIndex === 1 || cornerDrag.cornerIndex === 2) ? 1 : -1;
          const sY = (cornerDrag.cornerIndex === 2 || cornerDrag.cornerIndex === 3) ? 1 : -1;

          const dW = dxCanvas * sX;
          const dH = dyCanvas * sY;

          let newWidth = startWidth;
          let newHeight = startHeight;
          let newX = startNodeX;
          let newY = startNodeY;

          const minWidth = 80;
          const minHeight = 60;

          if (e.shiftKey) {
            // center resize in all directions
            newWidth = Math.max(minWidth, startWidth + 2 * dW);
            newX = startNodeX - (newWidth - startWidth) / 2;
            newHeight = Math.max(minHeight, startHeight + 2 * dH);
            newY = startNodeY - (newHeight - startHeight) / 2;
          } else {
            // normal resize
            if (sX === 1) {
              newWidth = Math.max(minWidth, startWidth + dxCanvas);
            } else {
              newWidth = Math.max(minWidth, startWidth - dxCanvas);
              newX = startNodeX + (startWidth - newWidth);
            }

            if (sY === 1) {
              newHeight = Math.max(minHeight, startHeight + dyCanvas);
            } else {
              newHeight = Math.max(minHeight, startHeight - dyCanvas);
              newY = startNodeY + (startHeight - newHeight);
            }
          }

          setActiveNodes(prev => prev.map(n => {
            if (n.id !== cornerDrag.nodeId) return n;
            return {
              ...n,
              x: newX,
              y: newY,
              width: newWidth,
              height: newHeight
            };
          }));
        }
      } else {
        const dist = Math.sqrt(dx * dx + dy * dy);
        let sign = 1;
        if (cornerDrag.cornerIndex === 0) {
          sign = (dx + dy) > 0 ? 1 : -1;
        } else if (cornerDrag.cornerIndex === 1) {
          sign = (-dx + dy) > 0 ? 1 : -1;
        } else if (cornerDrag.cornerIndex === 2) {
          sign = (-dx - dy) > 0 ? 1 : -1;
        } else if (cornerDrag.cornerIndex === 3) {
          sign = (dx - dy) > 0 ? 1 : -1;
        }
        const newR = Math.max(0, cornerDrag.startRadius + sign * dist / zoom);

        setActiveNodes(prev => prev.map(n => {
          if (n.id !== cornerDrag.nodeId) return n;
          const radii: [number, number, number, number] = n.cornerRadii
            ? [...n.cornerRadii] as [number, number, number, number]
            : [n.borderRadius ?? 8, n.borderRadius ?? 8, n.borderRadius ?? 8, n.borderRadius ?? 8];

          if (selectedCorners && selectedCorners.nodeId === n.id) {
            const newRadii = [...radii] as [number, number, number, number];
            for (const idx of selectedCorners.indices) {
              newRadii[idx] = Math.max(0, newR);
            }
            return { ...n, cornerRadii: newRadii };
          }

          const newRadii = [...radii] as [number, number, number, number];
          newRadii[cornerDrag.cornerIndex] = Math.max(0, newR);
          return { ...n, cornerRadii: newRadii };
        }));
      }
      return;
    }

    if (selectionBox?.active) {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) {
        const canvasX = ((e.clientX - rect.left) - panX) / zoom;
        const canvasY = ((e.clientY - rect.top) - panY) / zoom;
        const nextBox = { ...selectionBox, currentX: canvasX, currentY: canvasY };
        setSelectionBox(nextBox);

        const xMin = Math.min(nextBox.startX, nextBox.currentX);
        const xMax = Math.max(nextBox.startX, nextBox.currentX);
        const yMin = Math.min(nextBox.startY, nextBox.currentY);
        const yMax = Math.max(nextBox.startY, nextBox.currentY);

        const intersectedNodes = activeNodes.filter(n => {
          const w = n.width || 180;
          const h = n.height || 100;
          const hasHeader = showHeaders && n.shape !== 'circle' && w >= 80 && h >= 40;
          const totalHeight = hasHeader ? h + 32 + 3 : h; // Account for 3px gap and 32px header in size
          return !(n.x + w < xMin || n.x > xMax || n.y + totalHeight < yMin || n.y > yMax);
        });
        setSelectedNodeIds(intersectedNodes.map(n => n.id));

        const intersectedConnections = activeConnections.filter(conn => {
          const fromNode = activeNodes.find(n => n.id === conn.from);
          const toNode = activeNodes.find(n => n.id === conn.to);
          if (!fromNode || !toNode) return false;

          // Hole Start- und Endpunkt im Canvas-Koordinatensystem
          const fromPosScaled = getHandlePosition(conn.from, conn.fromPort, conn.fromSlot ?? 0);
          const toPosScaled = getHandlePosition(conn.to, conn.toPort, conn.toSlot ?? 0);
          
          const fromX = (fromPosScaled.x - panX) / zoom;
          const fromY = (fromPosScaled.y - panY) / zoom;
          const toX = (toPosScaled.x - panX) / zoom;
          const toY = (toPosScaled.y - panY) / zoom;

          // Erzeuge die exakten Routing-Punkte für den Test in Canvas-Koordinaten
          const routePoints = conn.routing === 'orthogonal'
            ? getOrthogonalPoints(fromX, fromY, toX, toY, conn.fromPort, conn.toPort, conn.waypoints, conn.fromSlot ?? 0, conn.toSlot ?? 0)
            : [
                { x: fromX, y: fromY },
                ...(conn.waypoints || []),
                { x: toX, y: toY }
              ];

          // Feingranulare Segmentprüfung (Kollision zwischen Liniensegmenten und der Auswahlbox)
          for (let i = 0; i < routePoints.length - 1; i++) {
            const p1 = routePoints[i];
            const p2 = routePoints[i + 1];

            // 1. Liegt einer der Punkte direkt in der Box?
            if ((p1.x >= xMin && p1.x <= xMax && p1.y >= yMin && p1.y <= yMax) ||
                (p2.x >= xMin && p2.x <= xMax && p2.y >= yMin && p2.y <= yMax)) {
              return true;
            }

            // 2. Schneidet das Segment (p1 -> p2) die Grenzen der Box?
            // Da es sich um orthogonale Linien handelt, sind die Segmente entweder perfekt horizontal oder vertikal.
            const segMinX = Math.min(p1.x, p2.x);
            const segMaxX = Math.max(p1.x, p2.x);
            const segMinY = Math.min(p1.y, p2.y);
            const segMaxY = Math.max(p1.y, p2.y);

            // Horizontaler Segment-Check: y ist konstant
            if (Math.abs(p1.y - p2.y) < 1) {
              const y = p1.y;
              // Schneidet, wenn das y-Niveau innerhalb der Box-Höhe liegt und das Segment die x-Ausdehnung überlappt
              if (y >= yMin && y <= yMax && !(segMaxX < xMin || segMinX > xMax)) {
                return true;
              }
            }
            // Vertikaler Segment-Check: x ist konstant
            else if (Math.abs(p1.x - p2.x) < 1) {
              const x = p1.x;
              // Schneidet, wenn das x-Niveau innerhalb der Box-Breite liegt und das Segment die y-Ausdehnung überlappt
              if (x >= xMin && x <= xMax && !(segMaxY < yMin || segMinY > yMax)) {
                return true;
              }
            }
            // Für Bezier oder schräge Segmente (Fallback): Line-AABB-Overlap über Boundingbox des Segments
            else {
              if (!(segMaxX < xMin || segMinX > xMax || segMaxY < yMin || segMinY > yMax)) {
                return true;
              }
            }
          }
          return false;
        });
        setSelectedConnectionIds(intersectedConnections.map(c => c.id));
      }
      return;
    }

    if (drawBox?.active) {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) {
        const canvasX = ((e.clientX - rect.left) - panX) / zoom;
        const canvasY = ((e.clientY - rect.top) - panY) / zoom;
        setDrawBox(prev => prev ? { ...prev, currentX: canvasX, currentY: canvasY } : null);
      }
      return;
    }

    // Mouse up/down corner radius adjustment has been removed in favor of direct scroll wheel adjustments.
    lastMouseY.current = null;

    if (waypointDrag) {
      draggedDistanceRef.current += Math.abs(e.movementX) + Math.abs(e.movementY);
      const contentRect = viewportRef.current?.getBoundingClientRect();
      if (contentRect) {
        const targetX = ((e.clientX - contentRect.left) - panX) / zoom;
        const targetY = ((e.clientY - contentRect.top) - panY) / zoom;
        const snapX = Math.round(targetX / 20) * 20;
        const snapY = Math.round(targetY / 20) * 20;
        setActiveConnections(prev => prev.map(c => {
          if (c.id === waypointDrag.connectionId) {
            const wps = c.waypoints ? [...c.waypoints] : [];
            if (wps[waypointDrag.index]) {
              wps[waypointDrag.index] = { x: snapX, y: snapY };
            }
            return { ...c, waypoints: wps };
          }
          return c;
        }));
      }
      return;
    }

    if (isPanning) {
      setPanX(e.clientX - dragOffset.current.x);
      setPanY(e.clientY - dragOffset.current.y);
      return;
    }

    if (draggedNodeId) {
      const contentRect = viewportRef.current?.getBoundingClientRect();
      if (!contentRect) return;
      const targetX = Math.round(((e.clientX - contentRect.left) - panX) / zoom - dragOffset.current.x);
      const targetY = Math.round(((e.clientY - contentRect.top) - panY) / zoom - dragOffset.current.y);
      const snapX = Math.round(targetX / 20) * 20;
      const snapY = Math.round(targetY / 20) * 20;

      if (selectedNodeIds.includes(draggedNodeId) && selectedNodeIds.length > 1) {
        setActiveNodes(prev => {
          const dragNode = prev.find(n => n.id === draggedNodeId);
          if (!dragNode) return prev;
          const dx = snapX - dragNode.x;
          const dy = snapY - dragNode.y;
          return prev.map(n => selectedNodeIds.includes(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n);
        });
      } else {
        setActiveNodes(prev => prev.map(n => n.id === draggedNodeId ? { ...n, x: snapX, y: snapY } : n));
      }
      return;
    }

    if (activeLine && viewportRef.current) {
      if (viewportRef.current.style.cursor !== 'grabbing') {
        viewportRef.current.style.cursor = 'grabbing';
      }
      const rect = viewportRef.current.getBoundingClientRect();
      const curX = e.clientX - rect.left;
      const curY = e.clientY - rect.top;
      setActiveLine(prev => prev ? {
        ...prev,
        currentX: curX,
        currentY: curY
      } : null);

      if (dragStartHandle) {
        const canvasX = ((e.clientX - rect.left) - panX) / zoom;
        const canvasY = ((e.clientY - rect.top) - panY) / zoom;

        let closestPort: { nodeId: string; port: 'input' | 'output' | 'top' | 'bottom'; slot: number } | null = null;
        let minDistance = Infinity;

        for (const node of activeNodes) {
          if (node.id === dragStartHandle.nodeId) continue;
          const ports = getNodePortsCanvas(node, showHeaders);
          for (const p of ports) {
            const dx = canvasX - p.x;
            const dy = canvasY - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDistance) {
              minDistance = dist;
              closestPort = { nodeId: node.id, port: p.port, slot: p.slot };
            }
          }
        }

        if (closestPort && minDistance < 150) {
          setActiveClosestPort(closestPort);
        } else {
          setActiveClosestPort(null);
        }
      }
    }

    if (!activeLine && ctrlPressed && viewportRef.current) {
      const rect = viewportRef.current.getBoundingClientRect();
      const canvasX = ((e.clientX - rect.left) - panX) / zoom;
      const canvasY = ((e.clientY - rect.top) - panY) / zoom;

      let closestPort: { nodeId: string; port: 'input' | 'output' | 'top' | 'bottom'; slot: number } | null = null;
      let minDistance = Infinity;

      for (const node of activeNodes) {
        const ports = getNodePortsCanvas(node, showHeaders);
        for (const p of ports) {
          const dx = canvasX - p.x;
          const dy = canvasY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDistance) {
            minDistance = dist;
            closestPort = { nodeId: node.id, port: p.port, slot: p.slot };
          }
        }
      }

      if (closestPort && minDistance < 80) {
        setActiveClosestPort(closestPort);
      } else {
        setActiveClosestPort(null);
      }
    } else if (!activeLine && !ctrlPressed && activeClosestPort) {
      setActiveClosestPort(null);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
    longPressStartPos.current = null;

    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    if (waypointDrag) {
      setWaypointDrag(null);
      pushHistory(activeNodes, activeConnections);
      return;
    }

    if (cornerDrag) {
      const node = activeNodes.find(n => n.id === cornerDrag.nodeId);
      if (node && node.cornerRadii && !(e.ctrlKey || ctrlPressed)) {
        setDefaultCornerRadius(node.cornerRadii[0]);
      }
      setCornerDrag(null);
      pushHistory(activeNodes, activeConnections);
      return;
    }

    if (selectionBox?.active) {
      setSelectionBox(null);
      return;
    }

    if (drawBox?.active) {
      const x = Math.min(drawBox.startX, drawBox.currentX);
      const y = Math.min(drawBox.startY, drawBox.currentY);
      const width = Math.abs(drawBox.startX - drawBox.currentX);
      const height = Math.abs(drawBox.startY - drawBox.currentY);

      // Only create a node if the box is large enough to be intentional
      if (width > 10 && height > 10) {
        const newId = 'node_' + Date.now();
        const type = drawBox.nodeType || 'note';
        const isShiftActive = e.shiftKey;
        const cornerRadii: [number, number, number, number] = isShiftActive 
          ? [defaultCornerRadius, defaultCornerRadius, defaultCornerRadius, defaultCornerRadius] 
          : [0, 0, 0, 0];

        const newNode: CanvasNode = {
          id: newId,
          type,
          x,
          y,
          width,
          height,
          cornerRadii,
          title: type === 'todo' ? 'Todo Liste' : type === 'nested' ? 'Sub-Canvas' : 'Neue Notiz',
          content: type === 'todo' ? [] : type === 'nested' ? { nodes: [], connections: [] } : 'Inhalt...',
          color: defaultBorderColor,
          borderWidth: defaultBorderWidth,
          borderStyle: defaultBorderStyle,
          shape: 'rect'
        };
        const newNodes = [...activeNodes, newNode];
        commitChange(newNodes, activeConnections);
        setNewlyCreatedNodeId(newId);
      }
      setDrawBox(null);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (isPanning) {
      setIsPanning(false);
      if (viewportRef.current) viewportRef.current.style.cursor = spacePressed.current ? 'grab' : 'default';
    }

    if (draggedNodeId) {
      pushHistory(activeNodes, activeConnections);
    }
    setDraggedNodeId(null);

    if (activeLine && dragStartHandle) {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) {
        const canvasX = ((e.clientX - rect.left) - panX) / zoom;
        const canvasY = ((e.clientY - rect.top) - panY) / zoom;

        // Find the absolute closest port among all nodes (except the starting node)
        let closestPort: { nodeId: string; port: 'input' | 'output' | 'top' | 'bottom'; slot: number; x: number; y: number } | null = null;
        let minDistance = Infinity;

        for (const node of activeNodes) {
          if (node.id === dragStartHandle.nodeId) continue;
          const ports = getNodePortsCanvas(node, showHeaders);
          for (const p of ports) {
            const dx = canvasX - p.x;
            const dy = canvasY - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDistance) {
              minDistance = dist;
              closestPort = { nodeId: node.id, port: p.port, slot: p.slot, x: p.x, y: p.y };
            }
          }
        }

        // If the closest port is within 150px, snap to it!
        if (closestPort && minDistance < 150) {
          const newConn: CanvasConnection = {
            id: 'conn_' + Date.now(),
            from: dragStartHandle.nodeId,
            fromPort: dragStartHandle.port,
            fromSlot: dragStartHandle.slot,
            to: closestPort.nodeId,
            toPort: closestPort.port,
            toSlot: closestPort.slot,
            routing: 'orthogonal'
          };
          const newConns = [...activeConnections, newConn];
          commitChange(activeNodes, newConns);
        } else {
          // Fallback to standard drop-on-card logic
          const target = e.target as HTMLElement;
          const cardEl = target.closest('.canvas-card') as HTMLElement;
          if (cardEl) {
            const nodeId = cardEl.getAttribute('data-nodeid');
            if (nodeId && nodeId !== dragStartHandle.nodeId) {
              const cardRect = cardEl.getBoundingClientRect();
              const mx = e.clientX;
              const my = e.clientY;

              const distL = Math.abs(mx - cardRect.left);
              const distR = Math.abs(mx - cardRect.right);
              const distT = Math.abs(my - cardRect.top);
              const distB = Math.abs(my - cardRect.bottom);
              
              let port: 'input' | 'output' | 'top' | 'bottom' = 'input';
              const minDist = Math.min(distL, distR, distT, distB);
              if (minDist === distL) port = 'input';
              else if (minDist === distR) port = 'output';
              else if (minDist === distT) port = 'top';
              else if (minDist === distB) port = 'bottom';

              const targetNode = activeNodes.find(n => n.id === nodeId);
              const edgeLength = (port === 'top' || port === 'bottom') ? (targetNode?.width || 180) : (targetNode?.height || 100);
              const slot = getBestSlot(activeConnections, nodeId, port, edgeLength);
              const newConn: CanvasConnection = {
                id: 'conn_' + Date.now(),
                from: dragStartHandle.nodeId,
                fromPort: dragStartHandle.port,
                fromSlot: dragStartHandle.slot,
                to: nodeId,
                toPort: port,
                toSlot: slot,
                routing: 'orthogonal'
              };
              const newConns = [...activeConnections, newConn];
              commitChange(activeNodes, newConns);
            }
          }
        }
      }
      setActiveLine(null);
      setDragStartHandle(null);
      setActiveClosestPort(null);
      if (viewportRef.current) {
        viewportRef.current.style.cursor = spacePressed.current ? 'grab' : 'default';
      }
    }
  };

  const handleTouchStart = (_nodeId: string) => {
    longPressTimer.current = setTimeout(() => setMobileDeleteMode(true), 600);
  };
  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };
  const handleTouchMove = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const startNestedLongPress = (e: React.MouseEvent, node: CanvasNode) => {
    if (node.type !== 'nested') return;
    longPressStartPos.current = { x: e.clientX, y: e.clientY };
    longPressTriggered.current = false;
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
    }
    longPressTimeoutRef.current = setTimeout(() => {
      longPressTriggered.current = true;
      enterNestedCanvas(node);
    }, 500);
  };

  const handleCardMouseDown = (e: React.MouseEvent, node: CanvasNode) => {
    if (e.button === 0 && e.detail >= 2) {
      const target = e.target as HTMLElement;
      let field = 'content';
      let todoIndex: number | undefined = undefined;

      if (target.classList.contains('card-title')) {
        field = 'title';
      } else if (target.classList.contains('nested-title')) {
        field = 'nested-title';
      } else if (target.classList.contains('todo-item-text')) {
        field = 'todo';
        const todoItemEl = target.closest('.todo-item');
        if (todoItemEl) {
          const siblings = Array.from(todoItemEl.parentNode?.children || []);
          todoIndex = siblings.indexOf(todoItemEl);
        }
      } else if (node.type === 'nested') {
        field = 'nested-title';
      } else if (node.type === 'todo') {
        field = 'todo';
        todoIndex = 0;
      }

      const fieldStr = field + (todoIndex !== undefined ? `-${todoIndex}` : '');
      setEditingNodeId(node.id);
      setEditingField(fieldStr);

      setTimeout(() => {
        let editEl: HTMLElement | null = null;
        if (field === 'content') {
          editEl = document.querySelector(`[data-nodeid="${node.id}"] .card-text`);
        } else if (field === 'nested-title') {
          editEl = document.querySelector(`[data-nodeid="${node.id}"] .nested-title`);
        } else if (field === 'title') {
          editEl = document.querySelector(`[data-nodeid="${node.id}"] .card-title`);
        } else if (field === 'todo' && todoIndex !== undefined) {
          const todoItems = document.querySelectorAll(`[data-nodeid="${node.id}"] .todo-item-text`);
          editEl = todoItems[todoIndex] as HTMLElement;
        }

        if (editEl) {
          editEl.focus();
        }
      }, 0);
      return;
    }

    const target = e.target as HTMLElement;
    const isContentEditable = target.getAttribute('contenteditable') === 'true' || target.closest('[contenteditable="true"]');
    const isAlreadySelected = selectedNodeIds.includes(node.id);
    const isInteractive = target.closest('.node-handle') || 
                          target.closest('.corner-handle') ||
                          (!isAlreadySelected && (
                            target.closest('.delete-node-btn') || 
                            target.closest('.todo-list') || 
                            isContentEditable
                          ));

    if (node.type === 'nested' && !isInteractive && e.button === 0) {
      startNestedLongPress(e, node);
    }

    if (isDeleteShortcutActive(e)) {
      e.stopPropagation();
      e.preventDefault();
      const newNodes = activeNodes.filter(n => n.id !== node.id);
      const newConns = activeConnections.filter(c => c.from !== node.id && c.to !== node.id);
      commitChange(newNodes, newConns);
      return;
    }

    if (e.altKey) {
      setDraggedNodeId(node.id);
      const cardEl = target.closest('.canvas-card') as HTMLElement;
      if (cardEl) {
        const rect = cardEl.getBoundingClientRect();
        dragOffset.current = {
          x: (e.clientX - rect.left) / zoom,
          y: (e.clientY - rect.top) / zoom
        };
      }
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      const viewRect = viewportRef.current?.getBoundingClientRect();
      if (viewRect) {
        const ports = getNodePortsCanvas(node, showHeaders);
        const rect = viewRect;
        const canvasX = ((e.clientX - rect.left) - panX) / zoom;
        const canvasY = ((e.clientY - rect.top) - panY) / zoom;
        let closestPort = ports[0];
        let minDistance = Infinity;
        for (const p of ports) {
          const dx = canvasX - p.x;
          const dy = canvasY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDistance) {
            minDistance = dist;
            closestPort = p;
          }
        }
        const startX = closestPort.x * zoom + panX;
        const startY = closestPort.y * zoom + panY;
        setDragStartHandle({ nodeId: node.id, port: closestPort.port, slot: closestPort.slot });
        setActiveLine({ startX, startY, currentX: startX, currentY: startY });
      }
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    if (!e.ctrlKey && !e.metaKey) {
      const isRightClick = e.button === 2;
      const isAlreadySelected = selectedNodeIds.includes(node.id);

      if (isRightClick) {
        e.stopPropagation();
        e.preventDefault();

        const now = Date.now();
        const isDoubleRightClick = lastRightClickNodeId.current === node.id && (now - lastRightClickTime.current) < 300;
        lastRightClickTime.current = now;
        lastRightClickNodeId.current = node.id;

        if (isDoubleRightClick) {
          if (activeSettingsBarNodeId === node.id) {
            setActiveSettingsBarNodeId(null);
          } else {
            setActiveSettingsBarNodeId(node.id);
            setShowAdvancedSettings(false);
          }
        } else {
          if (!isAlreadySelected) {
            setSelectedNodeIds([node.id]);
            setActiveSettingsBarNodeId(null);
          }
        }
      } else {
        // Left click selection
        if (!isAlreadySelected) {
          setSelectedNodeIds([node.id]);
          setActiveSettingsBarNodeId(null);
        }
      }

      setNewlyCreatedNodeId(null);
      setMarkedNodeId(null);

      // Support dragging strictly on right click (if not on interactive things)
      if (!isInteractive && e.button === 2) {
        // If clicking on contenteditable and it's already selected, let focus happen instead of drag!
        if (isContentEditable && isAlreadySelected) {
          return;
        }

        setDraggedNodeId(node.id);
        const cardEl = target.closest('.canvas-card') as HTMLElement;
        if (cardEl) {
          const rect = cardEl.getBoundingClientRect();
          dragOffset.current = {
            x: (e.clientX - rect.left) / zoom,
            y: (e.clientY - rect.top) / zoom
          };
        }
        e.stopPropagation();
        e.preventDefault();
      }
      return;
    }
  };

  const handleNodeDragStart = (e: React.MouseEvent, node: CanvasNode) => {
    const target = e.target as HTMLElement;
    if (target.closest('.delete-node-btn') || target.closest('.node-handle') || target.closest('.todo-list') || target.closest('.corner-handle')) return;

    if (isDeleteShortcutActive(e)) {
      e.stopPropagation();
      e.preventDefault();
      const newNodes = activeNodes.filter(n => n.id !== node.id);
      const newConns = activeConnections.filter(c => c.from !== node.id && c.to !== node.id);
      commitChange(newNodes, newConns);
      return;
    }

    if (node.type === 'nested' && e.button === 0) {
      startNestedLongPress(e, node);
    }

    if (e.ctrlKey || e.metaKey) {
      const viewRect = viewportRef.current?.getBoundingClientRect();
      if (viewRect) {
        const ports = getNodePortsCanvas(node, showHeaders);
        const rect = viewRect;
        const canvasX = ((e.clientX - rect.left) - panX) / zoom;
        const canvasY = ((e.clientY - rect.top) - panY) / zoom;
        let closestPort = ports[0];
        let minDistance = Infinity;
        for (const p of ports) {
          const dx = canvasX - p.x;
          const dy = canvasY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDistance) {
            minDistance = dist;
            closestPort = p;
          }
        }
        const startX = closestPort.x * zoom + panX;
        const startY = closestPort.y * zoom + panY;
        setDragStartHandle({ nodeId: node.id, port: closestPort.port, slot: closestPort.slot });
        setActiveLine({ startX, startY, currentX: startX, currentY: startY });
      }
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    // Only allow dragging on right click
    if (e.button === 2) {
      setDraggedNodeId(node.id);
      const cardEl = target.closest('.canvas-card') as HTMLElement;
      if (cardEl) {
        const rect = cardEl.getBoundingClientRect();
        dragOffset.current = {
          x: (e.clientX - rect.left) / zoom,
          y: (e.clientY - rect.top) / zoom
        };
      }
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const handleConnectStart = (e: React.MouseEvent, nodeId: string, port: 'input' | 'output' | 'top' | 'bottom', slot: number) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const viewRect = viewportRef.current?.getBoundingClientRect();
    if (!viewRect) return;

    const startX = rect.left + rect.width / 2 - viewRect.left;
    const startY = rect.top + rect.height / 2 - viewRect.top;

    setDragStartHandle({ nodeId, port, slot });
    setActiveLine({ startX, startY, currentX: startX, currentY: startY });
  };



  const getHandlePosition = (nodeId: string, port: 'input' | 'output' | 'top' | 'bottom', slot = 0) => {
    const node = activeNodes.find(n => n.id === nodeId);
    if (!node) return { x: 0, y: 0 };
    const w = Math.max(80, node.width || 180);
    const h = Math.max(60, node.height || 100);
    
    const headerHeight = 32;
    const verticalGap = 3;
    
    const hasHeader = showHeaders && node.shape !== 'circle' && w >= 80 && h >= 40;
    
    const x = node.x;
    const y = node.y;

    let localX = 0;
    let localY = 0;

    const handleOffset = 0;

    if (port === 'top' || port === 'bottom') {
      const slots = getSlotPositions(w);
      localX = slots[slot] ?? w / 2;
      localY = port === 'top' ? -handleOffset : (hasHeader ? headerHeight + verticalGap + h + handleOffset : h + handleOffset);
    } else {
      const slots = getSlotPositions(h);
      const slotY = slots[slot] ?? h / 2;
      const bodyOffset = hasHeader ? headerHeight + verticalGap : 0;
      localX = port === 'input' ? -handleOffset : w + handleOffset;
      localY = bodyOffset + slotY;
    }

    const radii = node.cornerRadii || [node.borderRadius ?? 8, node.borderRadius ?? 8, node.borderRadius ?? 8, node.borderRadius ?? 8];
    const adjusted = getAdjustedLocalPos(localX, localY, w, h, radii, hasHeader, port, node.shape);
    localX = adjusted.x;
    localY = adjusted.y;

    return {
      x: (x + localX) * zoom + panX,
      y: (y + localY) * zoom + panY
    };
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const createNode = (type: CanvasNode['type'], shape: 'rect' | 'circle' = 'rect') => {
    if (!contextMenu) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const canvasX = ((contextMenu.x - rect.left) - panX) / zoom;
    const canvasY = ((contextMenu.y - rect.top) - panY) / zoom;
    const newNode: CanvasNode = {
      id: 'node_' + Date.now(),
      type, x: canvasX, y: canvasY,
      title: type === 'todo' ? 'Todo Liste' : type === 'folder' ? 'Neuer Ordner' : type === 'nested' ? 'Sub-Canvas' : 'Neue Notiz',
      content: type === 'todo' ? [] : 'Inhalt...',
      color: type === 'nested' ? '#06B6D4' : type === 'folder' ? '#3B82F6' : '#8B5CF6',
      shape,
      cornerRadii: shape === 'rect' ? [8, 8, 8, 8] : undefined
    };
    const newNodes = [...activeNodes, newNode];
    commitChange(newNodes, activeConnections);
    setContextMenu(null);
  };

  const enterNestedCanvas = (node: CanvasNode) => {
    if (node.type !== 'nested') return;
    const existingContent = (node.content && typeof node.content === 'object' && !Array.isArray(node.content)) ? node.content as { nodes: CanvasNode[]; connections: CanvasConnection[] } : null;
    const existingNodes: CanvasNode[] = existingContent?.nodes ?? [];
    const existingConns: CanvasConnection[] = existingContent?.connections ?? [];
    setSubStack(prev => [...prev, {
      nodeId: node.id,
      title: node.title,
      nodes: existingNodes,
      connections: existingConns
    }]);
  };

  const exitSubCanvas = useCallback(() => {
    if (subStack.length === 0) return;
    const current = subStack[subStack.length - 1];
    if (subStack.length === 1) {
      setTopNodes(prev => prev.map(n => n.id === current.nodeId
        ? { ...n, content: { nodes: current.nodes, connections: current.connections } }
        : n
      ));
      setSubStack([]);
    } else {
      setSubStack(prev => {
        const next = [...prev];
        next.pop();
        const parent = next[next.length - 1];
        next[next.length - 1] = {
          ...parent,
          nodes: parent.nodes.map(n => n.id === current.nodeId
            ? { ...n, content: { nodes: current.nodes, connections: current.connections } }
            : n
          )
        };
        return next;
      });
    }
  }, [subStack, setTopNodes]);

  const addTodoItem = (nodeId: string) => {
    setActiveNodes(prev => prev.map(n => {
      if (n.id === nodeId && Array.isArray(n.content)) {
        return { ...n, content: [...n.content, { text: 'Neues Item', done: false }] };
      }
      return n;
    }));
  };

  const toggleTodoItem = (nodeId: string, index: number) => {
    setActiveNodes(prev => prev.map(n => {
      if (n.id === nodeId && Array.isArray(n.content)) {
        const next = [...n.content];
        next[index] = { ...next[index], done: !next[index].done };
        return { ...n, content: next };
      }
      return n;
    }));
  };

  const deleteTodoItem = (nodeId: string, index: number) => {
    setActiveNodes(prev => prev.map(n => {
      if (n.id === nodeId && Array.isArray(n.content)) {
        const next = [...n.content];
        next.splice(index, 1);
        return { ...n, content: next };
      }
      return n;
    }));
  };

  const updateTodoText = (nodeId: string, index: number, text: string) => {
    setActiveNodes(prev => prev.map(n => {
      if (n.id === nodeId && Array.isArray(n.content)) {
        const next = [...n.content];
        next[index] = { ...next[index], text };
        return { ...n, content: next };
      }
      return n;
    }));
  };

  function zoomTo(scaleFactor: number, clientX: number, clientY: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const nextZoom = Math.min(Math.max(zoom * scaleFactor, 0.1), 5.0);
    const zoomRatio = nextZoom / zoom;
    setPanX(mouseX - (mouseX - panX) * zoomRatio);
    setPanY(mouseY - (mouseY - panY) * zoomRatio);
    setZoom(nextZoom);
  }

  const handlePresetColorSelect = (color: string, type: 'bg' | 'border', nodeId: string) => {
    setActiveNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      if (type === 'bg') {
        return { ...n, contentBgColor: color };
      } else {
        return { ...n, color };
      }
    }));
    pushHistory(activeNodes, activeConnections);
  };

  const handleCustomColorClick = (type: 'bg' | 'border', index: number, _nodeId: string) => {
    customColorType.current = type;
    customColorIdx.current = index;
    if (customColorInputRef.current) {
      customColorInputRef.current.click();
    }
  };

  const handleCustomColorPickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const color = e.target.value;
    if (customColorType.current === 'bg') {
      const nextPresets = [...customBgColors];
      nextPresets[customColorIdx.current] = color;
      setCustomBgColors(nextPresets);
      localStorage.setItem('miuniverse_custom_bg_presets', JSON.stringify(nextPresets));
      if (colorEditorNodeId) {
        handlePresetColorSelect(color, 'bg', colorEditorNodeId);
      }
    } else {
      const nextPresets = [...customBorderColors];
      nextPresets[customColorIdx.current] = color;
      setCustomBorderColors(nextPresets);
      localStorage.setItem('miuniverse_custom_border_presets', JSON.stringify(nextPresets));
      if (colorEditorNodeId) {
        handlePresetColorSelect(color, 'border', colorEditorNodeId);
      }
    }
  };

  const handlePresetLongPress = (type: 'bg' | 'border', index: number, nodeId: string) => {
    handleCustomColorClick(type, index, nodeId);
  };

  const handleCardDoubleClicked = (e: React.MouseEvent, node: CanvasNode) => {
    if (e.shiftKey) {
      e.stopPropagation();
      e.preventDefault();
      setColorEditorNodeId(node.id);
    } else {
      e.stopPropagation();
    }
  };

  const handleSize = scaledHandleSize(zoom);

  const getCornerHandles = (node: CanvasNode) => {
    const w = Math.max(80, node.width || 180);
    const h = Math.max(60, node.height || 100);
    const headerHeight = 32;
    const verticalGap = 3;
    const hasHeader = showHeaders && node.shape !== 'circle' && (node.width || 180) >= 80 && (node.height || 100) >= 40;
    const bodyOffset = hasHeader ? headerHeight + verticalGap : 0;
    const radii = node.cornerRadii || [node.borderRadius ?? 8, node.borderRadius ?? 8, node.borderRadius ?? 8, node.borderRadius ?? 8];

    // position on the arc midpoints (using 1 - cos(45deg) = 0.2929)
    return [
      { cx: radii[0] * 0.2929, cy: bodyOffset + radii[0] * 0.2929, index: 0 },
      { cx: w - radii[1] * 0.2929, cy: bodyOffset + radii[1] * 0.2929, index: 1 },
      { cx: w - radii[2] * 0.2929, cy: bodyOffset + h - radii[2] * 0.2929, index: 2 },
      { cx: radii[3] * 0.2929, cy: bodyOffset + h - radii[3] * 0.2929, index: 3 },
    ];
  };

  const handleCornerMouseDown = (
    e: React.MouseEvent,
    nodeId: string,
    cornerIndex: number
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const node = activeNodes.find(n => n.id === nodeId);
    if (!node) return;
    const radii = node.cornerRadii ?? [node.borderRadius ?? 8, node.borderRadius ?? 8, node.borderRadius ?? 8, node.borderRadius ?? 8];
    const w = Math.max(80, node.width || 180);
    const h = Math.max(60, node.height || 100);

    setCornerDrag({
      nodeId,
      cornerIndex,
      startX: e.clientX,
      startY: e.clientY,
      startRadius: radii[cornerIndex],
      startWidth: w,
      startHeight: h,
      startNodeX: node.x,
      startNodeY: node.y
    });

    if (e.shiftKey) {
      setSelectedCorners({ nodeId, indices: [0, 1, 2, 3] });
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedCorners(prev => {
        if (!prev || prev.nodeId !== nodeId) return { nodeId, indices: [cornerIndex] };
        const newIdx = prev.indices.includes(cornerIndex)
          ? prev.indices.filter(i => i !== cornerIndex)
          : [...prev.indices, cornerIndex];
        return { nodeId, indices: newIdx };
      });
    } else {
      setSelectedCorners({ nodeId, indices: [cornerIndex] });
    }
  };

  const toggleConnectionRouting = (connId: string) => {
    setActiveConnections(prev => prev.map(c => {
      if (c.id !== connId) return c;
      const nextRouting = c.routing === 'bezier' ? 'orthogonal' : (c.routing === 'rounded' ? 'bezier' : 'rounded');
      return { ...c, routing: nextRouting };
    }));
  };

  const buildConnectionPath = (conn: CanvasConnection) => {
    const fromPos = getHandlePosition(conn.from, conn.fromPort, conn.fromSlot ?? 0);
    const toPos = getHandlePosition(conn.to, conn.toPort, conn.toSlot ?? 0);
    if (conn.routing === 'bezier') {
      return buildBezierPath(fromPos.x, fromPos.y, toPos.x, toPos.y, conn.waypoints, zoom, panX, panY);
    }
    const radius = conn.routing === 'rounded' ? 12 : 0;
    const isSelected = selectedConnectionIds.includes(conn.id);
    return buildOrthogonalPath(
      fromPos.x, fromPos.y,
      toPos.x, toPos.y,
      conn.fromPort, conn.toPort,
      radius,
      conn.waypoints,
      conn.fromSlot ?? 0,
      conn.toSlot ?? 0,
      zoom,
      panX,
      panY,
      activeNodes,
      showHeaders,
      isSelected,
      [conn.from, conn.to]
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }} data-testid="canvas-root">
      <input
        type="color"
        ref={customColorInputRef}
        style={{ display: 'none' }}
        onChange={handleCustomColorPickerChange}
      />

      {subStack.length > 0 && (
        <div className="sub-canvas-breadcrumb">
          <button className="breadcrumb-exit-btn" onClick={() => {
            exitSubCanvas();
          }}>
            ← Zurück
          </button>
          <span className="breadcrumb-path">
            🌐 Haupt-Canvas
            {subStack.map((s, i) => (
              <span key={i}> → <strong>{s.title}</strong></span>
            ))}
          </span>
          <span className="breadcrumb-hint">ESC zum Verlassen</span>
        </div>
      )}

      <div
        ref={viewportRef}
        className={`canvas-viewport ${ctrlPressed ? 'ctrl-pressed' : ''} ${altKeyOnlyPressed && selectedConnectionIds.length > 0 ? 'alt-pin-active' : ''}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('canvas-viewport') || target.classList.contains('canvas-grid')) {
            setMobileDeleteMode(false);
            setContextMenu(null);
          }
        }}
        style={{ flex: 1 }}
      >
        <div className={`canvas-grid grid-${gridStyle}`} style={{
          backgroundPosition: `${panX}px ${panY}px`,
          backgroundSize: `${40 * zoom}px ${40 * zoom}px`
        }} />

        <svg className={`svg-connections-layer ${altPressed ? 'alt-mode-active' : ''}`}>
          {activeConnections.map(conn => {
            const isSelected = selectedConnectionIds.includes(conn.id);
            return (
              <path
                key={conn.id}
                className={`${isSelected ? 'selected-connection' : ''} ${conn.routing !== 'bezier' ? 'routing-ortho' : ''}`}
                d={buildConnectionPath(conn)}
                onMouseDown={(e) => {
                  const isSelected = selectedConnectionIds.includes(conn.id);
                  const isAlt = e.altKey || altKeyOnlyPressed;
                  if (isSelected && isAlt && e.button === 0) {
                    e.stopPropagation();
                    e.preventDefault();
                    
                    const rect = viewportRef.current?.getBoundingClientRect();
                    if (rect) {
                      const clickX = ((e.clientX - rect.left) - panX) / zoom;
                      const clickY = ((e.clientY - rect.top) - panY) / zoom;

                      const fromPos = getHandlePosition(conn.from, conn.fromPort, conn.fromSlot ?? 0);
                      const toPos = getHandlePosition(conn.to, conn.toPort, conn.toSlot ?? 0);
                      const startPt = { x: (fromPos.x - panX) / zoom, y: (fromPos.y - panY) / zoom };
                      const endPt = { x: (toPos.x - panX) / zoom, y: (toPos.y - panY) / zoom };

                      const wps = conn.waypoints ? [...conn.waypoints] : [];
                      const allPts = [startPt, ...wps, endPt];
                      
                      let bestIdx = 0;
                      let minDistance = Infinity;

                      for (let i = 0; i < allPts.length - 1; i++) {
                        const p1 = allPts[i];
                        const p2 = allPts[i + 1];
                        
                        const dx = p2.x - p1.x;
                        const dy = p2.y - p1.y;
                        const lenSq = dx * dx + dy * dy;
                        let t = 0;
                        if (lenSq > 0) {
                          t = ((clickX - p1.x) * dx + (clickY - p1.y) * dy) / lenSq;
                          t = Math.max(0, Math.min(1, t));
                        }
                        const projX = p1.x + t * dx;
                        const projY = p1.y + t * dy;
                        const dist = Math.sqrt((clickX - projX) ** 2 + (clickY - projY) ** 2);
                        
                        if (dist < minDistance) {
                          minDistance = dist;
                          bestIdx = i;
                        }
                      }

                      const newWp = { x: clickX, y: clickY };
                      const nextWps = [...wps];
                      nextWps.splice(bestIdx, 0, newWp);

                      setActiveConnections(prev => prev.map(c => c.id === conn.id ? { ...c, waypoints: nextWps } : c));
                      pushHistory(activeNodes, activeConnections);

                      draggedDistanceRef.current = 0;
                      setWaypointDrag({ connectionId: conn.id, index: bestIdx });
                    }
                  }
                }}
                onMouseEnter={(e) => {
                  const isCombo = e.shiftKey && e.ctrlKey && e.altKey && xPressed.current;
                  if (isCombo !== altPressed) setAltPressed(isCombo);
                }}
                onMouseMove={(e) => {
                  const isCombo = e.shiftKey && e.ctrlKey && e.altKey && xPressed.current;
                  if (isCombo !== altPressed) setAltPressed(isCombo);
                }}
                onDoubleClick={() => toggleConnectionRouting(conn.id)}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    e.stopPropagation();
                    const rect = viewportRef.current?.getBoundingClientRect();
                    if (rect) {
                      const clickX = ((e.clientX - rect.left) - panX) / zoom;
                      const clickY = ((e.clientY - rect.top) - panY) / zoom;
                      setActiveConnections(prev => prev.map(c => {
                        if (c.id === conn.id) {
                          const wps = c.waypoints ? [...c.waypoints] : [];
                          wps.push({ x: clickX, y: clickY });
                          return { ...c, waypoints: wps };
                        }
                        return c;
                      }));
                      pushHistory(activeNodes, activeConnections);
                    }
                  } else if ((e.shiftKey && e.ctrlKey && e.altKey && xPressed.current) || altPressed) {
                    e.stopPropagation();
                    const newConns = activeConnections.filter(c => c.id !== conn.id);
                    commitChange(activeNodes, newConns);
                  } else {
                    setSelectedConnectionIds([conn.id]);
                  }
                }}
              />
            );
          })}

          {activeLine && (
            <path
              className="active-drag"
              d={buildBezierPath(activeLine.startX, activeLine.startY, activeLine.currentX, activeLine.currentY)}
            />
          )}
        </svg>

        <div className="canvas-content-layer" style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}>
          {activeNodes.map(node => {
            const isSelected = selectedNodeIds.includes(node.id);
            const isMarked = markedNodeId === node.id;
            const nodeW = Math.max(80, node.width || 180);
            const nodeH = Math.max(60, node.height || 100);
            const slotsX = getSlotPositions(nodeW);
            const slotsY = getSlotPositions(nodeH);
            const cornerHandles = node.shape !== 'circle' ? getCornerHandles(node) : [];

            const hasHeader = showHeaders && node.shape !== 'circle' && nodeW >= 80 && nodeH >= 40;
            const customBg = (node as any).contentBgColor || 'rgba(12, 20, 40, 0.7)';
            const radii = node.cornerRadii || [node.borderRadius ?? 8, node.borderRadius ?? 8, node.borderRadius ?? 8, node.borderRadius ?? 8];

            return (
              <div
                key={node.id}
                className={`canvas-card shape-${node.shape || 'rect'} ${mobileDeleteMode ? 'delete-mode-active' : ''} ${isSelected ? 'selected' : ''} ${node.type === 'nested' ? 'nested-node' : ''} ${editingNodeId === node.id ? 'editing' : ''}`}
                data-nodeid={node.id}
                style={{
                  position: 'absolute',
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  width: `${nodeW}px`,
                  height: hasHeader ? `${32 + 3 + nodeH}px` : `${nodeH}px`,
                  border: 'none',
                  background: 'transparent',
                  backgroundColor: 'transparent',
                  backdropFilter: 'none',
                  WebkitBackdropFilter: 'none',
                  boxShadow: 'none',
                  overflow: 'visible'
                }}
                onTouchStart={() => handleTouchStart(node.id)}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchMove}
                onMouseDown={(e) => handleCardMouseDown(e, node)}
                onDoubleClick={(e) => handleCardDoubleClicked(e, node)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                {activeSettingsBarNodeId === node.id && (
                  <div className="card-settings-bar" onMouseDown={e => e.stopPropagation()}>
                    <div className="settings-bar-row">
                      <button 
                        className={`settings-gear-btn ${showAdvancedSettings ? 'active' : ''}`}
                        onClick={() => setShowAdvancedSettings(prev => !prev)}
                        title="Einstellungen"
                      >
                        ⚙️
                      </button>
                      <div className="color-presets-row">
                        {['#2dd4e6', '#8B5CF6', '#3B82F6', '#EF4444', '#10B981'].map((col, idx) => (
                          <div
                            key={`preset-${idx}`}
                            className={`settings-color-dot ${node.color === col ? 'active' : ''}`}
                            style={{ backgroundColor: col, color: col }}
                            onClick={() => {
                              setActiveNodes(prev => prev.map(n => n.id === node.id ? { ...n, color: col } : n));
                              setDefaultBorderColor(col);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                    {showAdvancedSettings && (
                      <div className="settings-advanced-panel">
                        <div className="advanced-setting-item">
                          <label>Dicke (px):</label>
                          <input 
                            type="number" 
                            min="1" 
                            max="20" 
                            value={node.borderWidth || 1} 
                            onChange={(e) => {
                              const val = Math.max(1, parseInt(e.target.value) || 1);
                              setActiveNodes(prev => prev.map(n => n.id === node.id ? { ...n, borderWidth: val } : n));
                              setDefaultBorderWidth(val);
                            }}
                          />
                        </div>
                        <div className="advanced-setting-item">
                          <label>Stil:</label>
                          <select 
                            value={node.borderStyle || 'solid'} 
                            onChange={(e) => {
                              const val = e.target.value as 'solid' | 'dashed' | 'dotted';
                              setActiveNodes(prev => prev.map(n => n.id === node.id ? { ...n, borderStyle: val } : n));
                              setDefaultBorderStyle(val);
                            }}
                          >
                            <option value="solid">Durchgehend</option>
                            <option value="dashed">Gestrichelt</option>
                            <option value="dotted">Gepunktet</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {colorEditorNodeId === node.id && (
                  <div className="floating-color-bar" style={{ bottom: 'calc(100% + 10px)' }} onMouseDown={e => e.stopPropagation()}>
                    <div className="color-bar-row">
                      <span className="color-bar-label">Füllung</span>
                      {PRESET_BG_COLORS.map((col, idx) => (
                        <div
                          key={`bg-${idx}`}
                          className={`color-preset-dot ${customBg === col ? 'active' : ''}`}
                          style={{ backgroundColor: col, color: col }}
                          onClick={() => handlePresetColorSelect(col, 'bg', node.id)}
                        />
                      ))}
                      {[0, 1].map(idx => {
                        const col = customBgColors[idx] || '#2dd4e6';
                        return (
                          <div
                            key={`cbg-${idx}`}
                            className="color-preset-dot"
                            style={{ backgroundColor: col, color: col, borderStyle: 'dashed' }}
                            onClick={() => handlePresetColorSelect(col, 'bg', node.id)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              handlePresetLongPress('bg', idx, node.id);
                            }}
                            title="Rechtsklick für Custom Color"
                          />
                        );
                      })}
                    </div>
                    <div className="color-bar-row">
                      <span className="color-bar-label">Rahmen</span>
                      {PRESET_BORDER_COLORS.map((col, idx) => (
                        <div
                          key={`border-${idx}`}
                          className={`color-preset-dot ${node.color === col ? 'active' : ''}`}
                          style={{ backgroundColor: col, color: col }}
                          onClick={() => handlePresetColorSelect(col, 'border', node.id)}
                        />
                      ))}
                      {[0, 1].map(idx => {
                        const col = customBorderColors[idx] || '#8B5CF6';
                        return (
                          <div
                            key={`cborder-${idx}`}
                            className="color-preset-dot"
                            style={{ backgroundColor: col, color: col, borderStyle: 'dashed' }}
                            onClick={() => handlePresetColorSelect(col, 'border', node.id)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              handlePresetLongPress('border', idx, node.id);
                            }}
                            title="Rechtsklick für Custom Color"
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {altPressed && (
                  <div className="alt-delete-overlay" onClick={(e) => {
                    e.stopPropagation();
                    const newNodes = activeNodes.filter(n => n.id !== node.id);
                    const newConns = activeConnections.filter(c => c.from !== node.id && c.to !== node.id);
                    commitChange(newNodes, newConns);
                  }}>✕</div>
                )}

                {slotsY.map((slotY, si) => {
                  const adjusted = getAdjustedLocalPos(0, (hasHeader ? 32 + 3 : 0) + slotY, nodeW, nodeH, radii, hasHeader, 'input', node.shape);
                  return (
                    <div
                      key={`left-${si}`}
                      className={`node-handle handle-slot ${activeClosestPort?.nodeId === node.id && activeClosestPort?.port === 'input' && activeClosestPort?.slot === si ? 'highlighted' : ''}`}
                      data-nodeid={node.id}
                      data-port="input"
                      data-slot={si}
                      style={{
                        position: 'absolute',
                        left: `${adjusted.x}px`,
                        top: `${adjusted.y}px`,
                        transform: 'translate(-50%, -50%)',
                        width: `${handleSize}px`,
                        height: `${handleSize}px`,
                      }}
                      onMouseDown={(e) => handleConnectStart(e, node.id, 'input', si)}
                    />
                  );
                })}

                {slotsY.map((slotY, si) => {
                  const adjusted = getAdjustedLocalPos(nodeW, (hasHeader ? 32 + 3 : 0) + slotY, nodeW, nodeH, radii, hasHeader, 'output', node.shape);
                  return (
                    <div
                      key={`right-${si}`}
                      className={`node-handle handle-slot ${activeClosestPort?.nodeId === node.id && activeClosestPort?.port === 'output' && activeClosestPort?.slot === si ? 'highlighted' : ''}`}
                      data-nodeid={node.id}
                      data-port="output"
                      data-slot={si}
                      style={{
                        position: 'absolute',
                        left: `${adjusted.x}px`,
                        top: `${adjusted.y}px`,
                        transform: 'translate(-50%, -50%)',
                        width: `${handleSize}px`,
                        height: `${handleSize}px`,
                      }}
                      onMouseDown={(e) => handleConnectStart(e, node.id, 'output', si)}
                    />
                  );
                })}

                {slotsX.map((slotX, si) => {
                  const adjusted = getAdjustedLocalPos(slotX, hasHeader ? 32 + 3 : 0, nodeW, nodeH, radii, hasHeader, 'top', node.shape);
                  return (
                    <div
                      key={`top-${si}`}
                      className={`node-handle handle-slot ${activeClosestPort?.nodeId === node.id && activeClosestPort?.port === 'top' && activeClosestPort?.slot === si ? 'highlighted' : ''}`}
                      data-nodeid={node.id}
                      data-port="top"
                      data-slot={si}
                      style={{
                        position: 'absolute',
                        left: `${adjusted.x}px`,
                        top: `${adjusted.y}px`,
                        transform: 'translate(-50%, -50%)',
                        width: `${handleSize}px`,
                        height: `${handleSize}px`,
                      }}
                      onMouseDown={(e) => handleConnectStart(e, node.id, 'top', si)}
                    />
                  );
                })}

                {slotsX.map((slotX, si) => {
                  const adjusted = getAdjustedLocalPos(slotX, (hasHeader ? 32 + 3 : 0) + nodeH, nodeW, nodeH, radii, hasHeader, 'bottom', node.shape);
                  return (
                    <div
                      key={`bottom-${si}`}
                      className={`node-handle handle-slot ${activeClosestPort?.nodeId === node.id && activeClosestPort?.port === 'bottom' && activeClosestPort?.slot === si ? 'highlighted' : ''}`}
                      data-nodeid={node.id}
                      data-port="bottom"
                      data-slot={si}
                      style={{
                        position: 'absolute',
                        left: `${adjusted.x}px`,
                        top: `${adjusted.y}px`,
                        transform: 'translate(-50%, -50%)',
                        width: `${handleSize}px`,
                        height: `${handleSize}px`,
                      }}
                      onMouseDown={(e) => handleConnectStart(e, node.id, 'bottom', si)}
                    />
                  );
                })}

                 {isSelected && node.shape !== 'circle' && cornerHandles.map(ch => {
                  const isCornerSelected = selectedCorners?.nodeId === node.id && selectedCorners.indices.includes(ch.index);
                  const currentRadius = Math.round(radii[ch.index]);
                  return (
                    <div
                      key={`corner-${ch.index}`}
                      className={`corner-handle corner-${ch.index} ${isCornerSelected ? 'corner-selected' : ''}`}
                      style={{
                        position: 'absolute',
                        left: `${ch.cx - 6}px`,
                        top: `${ch.cy - 6}px`,
                        width: '12px',
                        height: '12px',
                      }}
                      onMouseDown={(e) => handleCornerMouseDown(e, node.id, ch.index)}
                      title={`Ecke ${ch.index + 1} – Shift=alle, Ctrl=mehrere`}
                    >
                      {(cornerDrag && cornerDrag.nodeId === node.id) && (
                        <div className="corner-radius-tooltip">
                          {ctrlPressed ? `${nodeW}x${nodeH}px` : `${currentRadius}px`}
                        </div>
                      )}
                    </div>
                  );
                })}

                {hasHeader && (
                  <div
                    className="card-header-split-wrapper"
                    style={{
                      height: '32px',
                      background: `${node.color}33`,
                      borderColor: isSelected ? '#EF4444' : node.color,
                      borderWidth: isSelected ? `${(node.borderWidth || 1) + 1}px` : `${node.borderWidth || 1}px`,
                      borderStyle: node.borderStyle || 'solid',
                      display: 'flex',
                      alignItems: 'center',
                      paddingLeft: `${Math.max(10, radii[0] * 0.35)}px`,
                      paddingRight: `${Math.max(10, radii[1] * 0.35)}px`,
                      borderTopLeftRadius: `${radii[0]}px`,
                      borderTopRightRadius: `${radii[1]}px`,
                      borderBottomLeftRadius: '0px',
                      borderBottomRightRadius: '0px',
                      transition: 'all 0.15s ease',
                      backdropFilter: 'blur(14px)',
                      WebkitBackdropFilter: 'blur(14px)'
                    }}
                  >
                    <div
                      style={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}
                      onMouseDown={(e) => handleNodeDragStart(e, node)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
                        {node.type === 'nested' && <span className="nested-icon">⬡</span>}
                        <span
                          className="card-title"
                          contentEditable={editingNodeId === node.id && editingField === 'title'}
                          suppressContentEditableWarning
                          style={{ maxWidth: '100%' }}
                          onBlur={(e) => {
                            const title = e.currentTarget.innerText.trim();
                            setActiveNodes(prev => prev.map(n => n.id === node.id ? { ...n, title } : n));
                            setEditingNodeId(null);
                            setEditingField(null);
                          }}
                        >
                          {node.title}
                        </span>
                      </div>
                      <button className="delete-node-btn" onClick={() => {
                        const newNodes = activeNodes.filter(n => n.id !== node.id);
                        const newConns = activeConnections.filter(c => c.from !== node.id && c.to !== node.id);
                        commitChange(newNodes, newConns);
                      }}>×</button>
                    </div>
                  </div>
                )}

                <div
                  className="card-body-split-wrapper"
                  style={{
                    height: hasHeader ? `${nodeH}px` : '100%',
                    background: customBg,
                    borderColor: isSelected ? '#EF4444' : node.color,
                    borderWidth: isSelected ? `${(node.borderWidth || 1) + 1}px` : `${node.borderWidth || 1}px`,
                    borderStyle: node.borderStyle || 'solid',
                    borderTopLeftRadius: hasHeader ? '0px' : `${radii[0]}px`,
                    borderTopRightRadius: hasHeader ? '0px' : `${radii[1]}px`,
                    borderBottomLeftRadius: `${radii[3]}px`,
                    borderBottomRightRadius: `${radii[2]}px`,
                    boxShadow: isSelected
                      ? '0 0 18px rgba(239, 68, 68, 0.75), 0 10px 30px -10px rgba(0, 0, 0, 0.7)'
                      : (isMarked ? `0 0 15px ${node.color}, 0 10px 30px -10px rgba(0, 0, 0, 0.7)` : undefined),
                    overflow: 'hidden',
                    backdropFilter: 'blur(14px)',
                    WebkitBackdropFilter: 'blur(14px)'
                  }}
                >
                  <div
                    className="card-header"
                    style={{
                      display: (showHeaders && !hasHeader) ? 'flex' : 'none',
                      backgroundColor: `${node.color}22`,
                      paddingLeft: `${Math.max(10, radii[0] * 0.35)}px`,
                      paddingRight: `${Math.max(10, radii[1] * 0.35)}px`,
                    }}
                    onMouseDown={(e) => handleNodeDragStart(e, node)}
                  >
                    {node.type === 'nested' && <span className="nested-icon">⬡</span>}
                    <span
                      className="card-title"
                      contentEditable={editingNodeId === node.id && editingField === 'title'}
                      suppressContentEditableWarning
                      onBlur={(e) => {
                        const title = e.currentTarget.innerText.trim();
                        setActiveNodes(prev => prev.map(n => n.id === node.id ? { ...n, title } : n));
                        setEditingNodeId(null);
                        setEditingField(null);
                      }}
                    >
                      {node.title}
                    </span>
                    <button className="delete-node-btn" onClick={() => {
                      const newNodes = activeNodes.filter(n => n.id !== node.id);
                      const newConns = activeConnections.filter(c => c.from !== node.id && c.to !== node.id);
                      commitChange(newNodes, newConns);
                    }}>×</button>
                  </div>

                  <div 
                    className="card-body"
                    style={{
                      paddingLeft: `${Math.max(10, (hasHeader ? 0 : radii[0]) * 0.35)}px`,
                      paddingRight: `${Math.max(10, (hasHeader ? 0 : radii[1]) * 0.35)}px`,
                      paddingBottom: `${Math.max(8, radii[2] * 0.35)}px`,
                      paddingTop: hasHeader ? '8px' : `${Math.max(8, radii[0] * 0.35)}px`,
                    }}
                  >
                    {node.type === 'nested' ? (
                      <div
                        className="nested-preview"
                        onMouseDown={(e) => {
                          if (e.button === 0) {
                            e.stopPropagation();
                            startNestedLongPress(e, node);
                          }
                        }}
                      >
                        <div className="nested-preview-inner">
                          <span
                            className="nested-title"
                            contentEditable={editingNodeId === node.id && editingField === 'nested-title'}
                            suppressContentEditableWarning
                            onBlur={(e) => {
                              const title = e.currentTarget.innerText.trim();
                              setActiveNodes(prev => prev.map(n => n.id === node.id ? { ...n, title } : n));
                              setEditingNodeId(null);
                              setEditingField(null);
                            }}
                            onMouseDown={(e) => {
                              if (selectedNodeIds.includes(node.id)) {
                                e.stopPropagation();
                              }
                            }}
                          >
                            {node.title}
                          </span>
                          {Array.isArray(node.content?.nodes) && node.content.nodes.length > 0 ? (
                            <span className="nested-count">{node.content.nodes.length} Nodes darin</span>
                          ) : (
                            <span className="nested-empty">Long-Press zum Öffnen</span>
                          )}
                        </div>
                      </div>
                    ) : node.type === 'todo' ? (
                      <div className="todo-list">
                        <div className="todo-items">
                          {(node.content || []).map((item: any, idx: number) => (
                            <div key={idx} className="todo-item">
                              <input type="checkbox" checked={item.done} onChange={() => toggleTodoItem(node.id, idx)} />
                              <span
                                className={`todo-item-text ${item.done ? 'done' : ''}`}
                                contentEditable={editingNodeId === node.id && editingField === `todo-${idx}`}
                                suppressContentEditableWarning
                                onBlur={(e) => {
                                  updateTodoText(node.id, idx, e.currentTarget.innerText.trim());
                                  setEditingNodeId(null);
                                  setEditingField(null);
                                }}
                              >{item.text}</span>
                              <button className="delete-todo-item-btn" onClick={() => deleteTodoItem(node.id, idx)}>×</button>
                            </div>
                          ))}
                        </div>
                        <button className="add-todo-item-btn" onClick={() => addTodoItem(node.id)}>+ Item hinzufügen</button>
                      </div>
                    ) : (
                      <div
                        className="card-text"
                        contentEditable={editingNodeId === node.id && editingField === 'content'}
                        suppressContentEditableWarning
                        onBlur={(e) => {
                          const content = e.currentTarget.innerText;
                          setActiveNodes(prev => prev.map(n => n.id === node.id ? { ...n, content } : n));
                          setEditingNodeId(null);
                          setEditingField(null);
                        }}
                      >
                        {node.content}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {activeConnections.map(conn => {
            if (!conn.waypoints) return null;
            return conn.waypoints.map((wp, idx) => {
              const key = `wp-${conn.id}-${idx}`;
              return (
                <div
                  key={key}
                  className="waypoint-handle"
                  style={{
                    position: 'absolute',
                    left: `${wp.x}px`,
                    top: `${wp.y}px`,
                    transform: 'translate(-50%, -50%)',
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    backgroundColor: '#080d18',
                    border: '2px solid #2dd4e6',
                    cursor: 'move',
                    zIndex: 999
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if ((e.shiftKey && e.ctrlKey && e.altKey && xPressed.current) || altPressed) {
                      setActiveConnections(prev => prev.map(c => {
                        if (c.id === conn.id) {
                          const wps = c.waypoints ? c.waypoints.filter((_, i) => i !== idx) : [];
                          return { ...c, waypoints: wps };
                        }
                        return c;
                      }));
                      pushHistory(activeNodes, activeConnections);
                    } else {
                      draggedDistanceRef.current = 0;
                      setWaypointDrag({ connectionId: conn.id, index: idx });
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (draggedDistanceRef.current > 5) return;

                    const newId = 'node_' + Date.now();
                    const newNode: CanvasNode = {
                      id: newId,
                      type: 'note',
                      x: wp.x - 90,
                      y: wp.y - 50,
                      width: 180,
                      height: 100,
                      title: 'Neue Notiz',
                      content: 'Inhalt...',
                      color: '#8B5CF6',
                      shape: 'rect',
                      cornerRadii: [8, 8, 8, 8]
                    };

                    const oldConn = conn;
                    const c1: CanvasConnection = {
                      id: 'conn_' + Date.now() + '_1',
                      from: oldConn.from,
                      fromPort: oldConn.fromPort,
                      fromSlot: oldConn.fromSlot ?? 0,
                      to: newId,
                      toPort: 'input',
                      toSlot: 1,
                      routing: oldConn.routing,
                      waypoints: oldConn.waypoints ? oldConn.waypoints.slice(0, idx) : []
                    };
                    const c2: CanvasConnection = {
                      id: 'conn_' + Date.now() + '_2',
                      from: newId,
                      fromPort: 'output',
                      fromSlot: 1,
                      to: oldConn.to,
                      toPort: oldConn.toPort,
                      toSlot: oldConn.toSlot ?? 0,
                      routing: oldConn.routing,
                      waypoints: oldConn.waypoints ? oldConn.waypoints.slice(idx + 1) : []
                    };

                    const nextNodes = [...activeNodes, newNode];
                    const nextConns = activeConnections.filter(c => c.id !== oldConn.id);
                    nextConns.push(c1, c2);

                    commitChange(nextNodes, nextConns);
                  }}
                  title="Wegpunkt: Ziehen zum Verschieben. Klick um Box zu erstellen. Alt+Klick zum Löschen."
                />
              );
            });
          })}

          {drawBox?.active && (
            <div
              className={`canvas-draw-box shape-${drawBox.isCircle ? 'circle' : 'rect'}`}
              style={{
                position: 'absolute',
                left: `${Math.min(drawBox.startX, drawBox.currentX)}px`,
                top: `${Math.min(drawBox.startY, drawBox.currentY)}px`,
                width: `${drawBox.isCircle ? Math.max(Math.abs(drawBox.startX - drawBox.currentX), Math.abs(drawBox.startY - drawBox.currentY)) : Math.abs(drawBox.startX - drawBox.currentX)}px`,
                height: `${drawBox.isCircle ? Math.max(Math.abs(drawBox.startX - drawBox.currentX), Math.abs(drawBox.startY - drawBox.currentY)) : Math.abs(drawBox.startY - drawBox.currentY)}px`,
                border: '2px dashed rgba(45, 200, 220, 0.8)',
                background: 'rgba(45, 200, 220, 0.15)',
                borderRadius: drawBox.isCircle ? '50%' : '5px',
                pointerEvents: 'none',
                zIndex: 9999
              }}
            />
          )}

          {selectionBox?.active && (
            <div
              className="canvas-selection-box"
              style={{
                position: 'absolute',
                left: `${Math.min(selectionBox.startX, selectionBox.currentX)}px`,
                top: `${Math.min(selectionBox.startY, selectionBox.currentY)}px`,
                width: `${Math.abs(selectionBox.startX - selectionBox.currentX)}px`,
                height: `${Math.abs(selectionBox.startY - selectionBox.currentY)}px`,
                border: '2px dashed rgba(239, 68, 68, 0.8)',
                background: 'rgba(239, 68, 68, 0.1)',
                borderRadius: '5px',
                pointerEvents: 'none',
                zIndex: 9999
              }}
            />
          )}
        </div>

        <div className="canvas-controls-panel">
          <button onClick={() => {
            const rect = viewportRef.current?.getBoundingClientRect();
            if (rect) zoomTo(1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
          }}>+</button>
          <span className="zoom-indicator">{Math.round(zoom * 100)}%</span>
          <button onClick={() => {
            const rect = viewportRef.current?.getBoundingClientRect();
            if (rect) zoomTo(0.8, rect.left + rect.width / 2, rect.top + rect.height / 2);
          }}>−</button>
          <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.1)', margin: '0 8px' }} />
          <select className="grid-style-select" value={gridStyle} onChange={(e) => setGridStyle(e.target.value as any)}>
            <option value="dots">Punkte</option>
            <option value="lines">Mathe</option>
            <option value="empty">Leer</option>
          </select>
          <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.1)', margin: '0 8px' }} />
          <button
            className={`mode-btn ${workMode === 'default' ? 'active' : ''}`}
            title="Standard-Modus"
            onClick={() => onWorkModeChange?.('default')}
          >🎨</button>
          <button
            className={`mode-btn ${workMode === 'ue5' ? 'active' : ''}`}
            title="Unreal Engine 5 Modus"
            onClick={() => onWorkModeChange?.('ue5')}
          >🎮 UE5</button>
          <button
            className={`mode-btn ${workMode === 'appweb' ? 'active' : ''}`}
            title="App / Web Modus"
            onClick={() => onWorkModeChange?.('appweb')}
          >📱 App/Web</button>
        </div>

        {contextMenu?.visible && (
          <div
            className="canvas-context-menu"
            style={{ position: 'fixed', left: `${contextMenu.x}px`, top: `${contextMenu.y}px`, zIndex: 10000 }}
            onMouseLeave={() => setContextMenu(null)}
          >
            <div className="canvas-menu-item" onClick={() => createNode('note', 'rect')}>📝 Neue Notiz</div>
            <div className="canvas-menu-item" onClick={() => createNode('todo', 'rect')}>✅ Neues Todo</div>
            <div className="canvas-menu-item" onClick={() => createNode('note', 'circle')}>🟡 Kreis erstellen</div>
            <div className="canvas-menu-divider" />
            <div className="canvas-menu-item nested-menu-item" onClick={() => createNode('nested', 'rect')}>⬡ Sub-Canvas Box</div>
          </div>
        )}
      </div>
    </div>
  );
};
