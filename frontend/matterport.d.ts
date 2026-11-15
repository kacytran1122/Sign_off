declare module '@matterport/sdk' {
  type Vector = { x: number; y: number; z: number };
  type Tag = {
    label: string;
    description?: string;
    anchorPosition: Vector;
    stemVector: Vector;
    color?: { r: number; g: number; b: number };
  };
  export interface Showcase {
    App: {
      Phase: { PLAYING: string };
      state: { waitUntil(condition: (state: { phase: string }) => boolean): Promise<{ phase: string }> };
      Feature?: { SplatPresent?: string };
      features?: { subscribe(observer: { onChanged(features: Record<string, boolean | undefined>): void }): { cancel(): void } };
    };
    Camera: {
      lookAt(position: Vector): Promise<void>;
      pose: { subscribe(callback: (pose: { position: Vector; sweep: string }) => void): { cancel(): void } };
    };
    Model: { getData(): Promise<{ sweeps: { sid: string; uuid: string }[] }> };
    Mode?: {
      Mode: { DOLLHOUSE: string; INSIDE: string };
      current: { subscribe(callback: (mode: string | null) => void): { cancel(): void } };
      moveTo(mode: string): Promise<string>;
    };
    Renderer: { getWorldPositionData(screen: { x: number; y: number }): Promise<{ position: Vector | null; floor: number }> };
    Sweep: { moveTo(id: string, options: { rotation: { x: number; y: number }; transition: string }): Promise<string> };
    Tag: { add(tags: Tag[]): Promise<string[]>; remove(...ids: string[]): Promise<string[]> };
  }
  export function setupSdk(key: string, options: {
    iframe: HTMLIFrameElement;
  }): Promise<Showcase>;
}
