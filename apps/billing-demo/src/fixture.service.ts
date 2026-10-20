import { Injectable, signal } from '@angular/core';

export interface RequestRecord {
  readonly id: number;
  readonly operationName: string;
  readonly query: string;
  readonly variables: Record<string, unknown>;
  readonly fields: readonly string[];
  readonly responseBytes: number;
  readonly errors: readonly string[];
}
interface Inspector {
  count: number;
  records: RequestRecord[];
}

@Injectable({ providedIn: 'root' })
export class FixtureService {
  readonly requests = signal<Inspector>({ count: 0, records: [] });
  readonly inspectorError = signal('');
  private inspectionGeneration = 0;

  async inspect(): Promise<void> {
    const generation = ++this.inspectionGeneration;
    try {
      const response = await fetch('/__fixture/requests');
      if (!response.ok) throw new Error('Request inspector unavailable.');
      const result = (await response.json()) as Inspector;
      if (generation === this.inspectionGeneration) {
        this.requests.set(result);
        this.inspectorError.set('');
      }
    } catch (error) {
      if (generation === this.inspectionGeneration)
        this.inspectorError.set(
          error instanceof Error ? error.message : 'Inspector failed.',
        );
    }
  }

  async control(body: Record<string, unknown>): Promise<void> {
    const response = await fetch('/__fixture/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(((await response.json()) as { error: string }).error);
  }
}
