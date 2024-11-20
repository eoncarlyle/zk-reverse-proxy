export default class IO<T> {
  private value: T;
  constructor(value: T) {
    this.value = value;
  }

  static unit<K>(value: K) {
    return new IO<K>(value);
  }

  bind(fn: (value: T) => IO<T>): IO<T> {
    return fn(this.value);
  }
}
