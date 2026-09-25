// Our own planegcs builds (builds/<name>/planegcs.js) are untyped Emscripten glue.
declare module '*/planegcs.js' {
  // biome-ignore lint/suspicious/noExplicitAny: Emscripten module factory
  const factory: (options?: Record<string, unknown>) => Promise<any>;
  export default factory;
}
