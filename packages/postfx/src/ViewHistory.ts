import { Matrix4, type Camera } from 'three';

/** Reprojection history belongs to a camera, even when views share a composer. */
export class ViewHistory {
  private previous = new WeakMap<Camera, Matrix4>();

  reset(): void { this.previous = new WeakMap(); }

  sample(camera: Camera, current: Matrix4, output: Matrix4, held: boolean): void {
    let previous = this.previous.get(camera);
    if (!previous) {
      previous = current.clone();
      this.previous.set(camera, previous);
    }
    output.copy(held ? current : previous);
    previous.copy(current);
  }
}
