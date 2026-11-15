declare module '@matterport/sdk' {
  type Vector = { x: number; y: number; z: number };
  export interface Showcase {
    Camera: { lookAt(position: Vector): Promise<void> };
    Model: { getData(): Promise<{ sweeps: { sid: string; uuid: string }[] }> };
    Sweep: { moveTo(id: string, options: { rotation: { x: number; y: number }; transition: string }): Promise<string> };
    Tag: { add(tags: { label: string; anchorPosition: Vector; stemVector: Vector }[]): Promise<string[]> };
  }
  export function setupSdk(key: string, options: {
    iframe: HTMLIFrameElement;
  }): Promise<Showcase>;
}
