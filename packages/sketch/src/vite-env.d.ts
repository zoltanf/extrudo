// Vite's `?url` imports (the worker imports the .wasm this way).
declare module '*?url' {
  const url: string;
  export default url;
}
