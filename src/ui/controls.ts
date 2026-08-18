/**
 * Reading what the player is doing, on a phone or on a desktop.
 *
 * Dragging works the same either way: wherever the drag started becomes the
 * middle, and how far it has moved since becomes how hard the ball is pushed.
 * That suits a thumb on glass and a mouse equally well, and it never depends
 * on where on the screen the player happened to touch.
 *
 * Two fingers, or the mouse wheel, change how far back the camera sits.
 */

import { ONE } from '../core/fixed';
import { Controls } from '../core/input';

/** How far the drag has to travel for a full push, in screen pixels. */
const FULL_PUSH_PIXELS = 110;

/** How much of a wheel notch counts as one step of zoom. */
const WHEEL_STEP = 0.0016;

export interface ControlReading extends Controls {
  /** True while a finger or the mouse button is down. */
  active: boolean;
  /** Where the drag started, for drawing the on-screen guide. */
  originX: number;
  originY: number;
  /** Where it is now. */
  currentX: number;
  currentY: number;
}

type ZoomListener = (change: number) => void;

/** Collects input from a surface and boils it down to steering numbers. */
export class ControlReader {
  private readonly element: HTMLElement;
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private currentX = 0;
  private currentY = 0;
  private dragging = false;

  private readonly keys = new Set<string>();
  private readonly pinch = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private zoomListeners: ZoomListener[] = [];

  /** Swaps which way dragging up and down works. */
  invertPush = false;
  /** Turned off while a menu is open. */
  enabled = true;

  constructor(element: HTMLElement) {
    this.element = element;
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
  }

  /** Called whenever the player asks for a different camera distance. */
  onZoom(listener: ZoomListener): void {
    this.zoomListeners.push(listener);
  }

  private emitZoom(change: number): void {
    for (const listener of this.zoomListeners) listener(change);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    this.pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pinch.size === 2) {
      // A second finger means the player wants to zoom, not to steer.
      this.dragging = false;
      this.pointerId = null;
      this.pinchDistance = this.pinchSpread();
      return;
    }
    if (this.pointerId !== null) return;
    this.pointerId = event.pointerId;
    this.originX = event.clientX;
    this.originY = event.clientY;
    this.currentX = event.clientX;
    this.currentY = event.clientY;
    this.dragging = true;
    try {
      // Keeps the drag alive if the finger slides off the edge of the screen.
      // A browser that refuses is not a reason to drop the whole gesture.
      this.element.setPointerCapture?.(event.pointerId);
    } catch {
      // Carry on without capture.
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.pinch.has(event.pointerId)) {
      this.pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (this.pinch.size === 2) {
      const spread = this.pinchSpread();
      if (this.pinchDistance > 0 && spread > 0) {
        this.emitZoom((this.pinchDistance - spread) * 0.006);
      }
      this.pinchDistance = spread;
      return;
    }
    if (event.pointerId !== this.pointerId) return;
    this.currentX = event.clientX;
    this.currentY = event.clientY;
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.pinch.delete(event.pointerId);
    if (this.pinch.size < 2) this.pinchDistance = 0;
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.dragging = false;
  };

  private pinchSpread(): number {
    const points = [...this.pinch.values()];
    if (points.length < 2) return 0;
    const dx = points[0].x - points[1].x;
    const dy = points[0].y - points[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    this.emitZoom(event.deltaY * WHEEL_STEP);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;
    this.keys.add(event.key.toLowerCase());
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private releaseAll = (): void => {
    this.keys.clear();
    this.pinch.clear();
    this.pointerId = null;
    this.dragging = false;
  };

  /** Lets go of any held input, used when a menu opens. */
  reset(): void {
    this.releaseAll();
  }

  /** What the player is asking for right now. */
  read(): ControlReading {
    let steer = 0;
    let push = 0;

    if (this.dragging) {
      const dx = this.currentX - this.originX;
      const dy = this.currentY - this.originY;
      steer = clampUnit(dx / FULL_PUSH_PIXELS);
      push = clampUnit(-dy / FULL_PUSH_PIXELS);
    }

    if (this.keys.has('arrowleft') || this.keys.has('a')) steer -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) steer += 1;
    if (this.keys.has('arrowup') || this.keys.has('w')) push += 1;
    if (this.keys.has('arrowdown') || this.keys.has('s')) push -= 1;

    steer = clampUnit(steer);
    push = clampUnit(this.invertPush ? -push : push);

    return {
      steer: Math.round(steer * ONE),
      push: Math.round(push * ONE),
      buttons: 0,
      active: this.dragging,
      originX: this.originX,
      originY: this.originY,
      currentX: this.currentX,
      currentY: this.currentY,
    };
  }

  /** Stops listening. */
  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerUp);
    this.element.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
  }
}

function clampUnit(value: number): number {
  return value < -1 ? -1 : value > 1 ? 1 : value;
}
