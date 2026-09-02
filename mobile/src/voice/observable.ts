/**
 * The smallest observable the app's voice layer needs.
 *
 * `VoiceContext` consumes the Telnyx SDK's RxJS `BehaviorSubject`s — a
 * subscriber is handed the current value immediately and every value after it.
 * Any engine that wants to drive the same UI has to behave identically, so this
 * reproduces exactly that contract without adding an RxJS dependency.
 */

export type VoiceSubscription = { unsubscribe: () => void };

export type VoiceObservable<T> = {
  subscribe(observer: (value: T) => void): VoiceSubscription;
};

export class VoiceSubject<T> implements VoiceObservable<T> {
  private observers = new Set<(value: T) => void>();

  constructor(private current: T) {}

  get value() {
    return this.current;
  }

  subscribe(observer: (value: T) => void): VoiceSubscription {
    this.observers.add(observer);
    // BehaviorSubject semantics: the late subscriber still sees where we are.
    try {
      observer(this.current);
    } catch (error) {
      console.error('Vocivo voice observer threw on subscribe', error);
    }
    return {
      unsubscribe: () => {
        this.observers.delete(observer);
      },
    };
  }

  next(value: T) {
    // Emitting the same value again would make `waitForCallState` and the
    // lifecycle registry see a self-transition that never happened.
    if (Object.is(value, this.current)) return;
    this.current = value;
    // Copy first: an observer may unsubscribe itself while being notified.
    [...this.observers].forEach((observer) => {
      try {
        observer(value);
      } catch (error) {
        console.error('Vocivo voice observer threw', error);
      }
    });
  }

  /** Drop every observer; used when an engine shuts down. */
  complete() {
    this.observers.clear();
  }

  get observerCount() {
    return this.observers.size;
  }
}
