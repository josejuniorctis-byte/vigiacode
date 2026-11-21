type Listener = (event: Event) => void;

/** EventSource mínimo para testar o hook/SSE sem servidor real. */
export class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: MockEventSource[] = [];

  static reset(): void {
    MockEventSource.instances = [];
  }

  static latest(): MockEventSource {
    const instance = MockEventSource.instances[MockEventSource.instances.length - 1];
    if (!instance) throw new Error('Nenhum EventSource criado');
    return instance;
  }

  readonly url: string;
  readonly withCredentials = false;
  readyState = MockEventSource.CONNECTING;
  onopen: ((this: EventSource, event: Event) => unknown) | null = null;
  onerror: ((this: EventSource, event: Event) => unknown) | null = null;
  onmessage: ((this: EventSource, event: MessageEvent) => unknown) | null = null;

  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(url: string | URL) {
    this.url = String(url);
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(typeof listener === 'function' ? listener : (event) => listener.handleEvent(event));
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    this.listeners.get(type)?.delete(listener as Listener);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return true;
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }

  open(): void {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.call(this as unknown as EventSource, new Event('open'));
  }

  fail(): void {
    this.readyState = MockEventSource.CLOSED;
    this.onerror?.call(this as unknown as EventSource, new Event('error'));
  }

  emit(type: 'change' | 'summary' | 'bindings', payload: unknown): void {
    const event = { type, data: JSON.stringify(payload) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
