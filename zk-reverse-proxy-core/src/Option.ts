export default class Option<T> {
  private constructor(private readonly value: T | null) {}

  static some<T>(value: T): Option<T> {
    return new Option(value);
  }

  static none<T>(): Option<T> {
    return new Option<T>(null);
  }

  isSome(): boolean {
    return this.value !== null;
  }

  isNone(): boolean {
    return this.value === null;
  }

  unwrap(): T {
    if (this.value === null) throw new Error("Cannot unwrap None");
    return this.value;
  }

  unwrapOr(defaultValue: T): T {
    return this.value ?? defaultValue;
  }

  map<U>(fn: (value: T) => U): Option<U> {
    return this.value === null ? Option.none() : Option.some(fn(this.value));
  }
}
