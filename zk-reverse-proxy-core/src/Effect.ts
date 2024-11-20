export default class IO<T> {
  private value: T;
  constructor(value: T) {
    this.value = value;
  }

  static unit<K>(value: K) {
    return new IO<K>(value);
  }

  get(): T {
    return this.value;
  }

  bind<K>(fn: (value: T) => IO<K>): IO<K> {
    return fn(this.get());
  }
}
