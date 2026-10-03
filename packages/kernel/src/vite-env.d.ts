// Vite's `?url` imports (the worker imports the .wasm this way).
declare module '*?url' {
  const url: string;
  export default url;
}

// A fixture file read in a test: Vite inlines it as a `data:` URL (`?url&inline`).
declare module '*.extrudo?url&inline' {
  const dataUrl: string;
  export default dataUrl;
}

// A bundled font read in a test (P4-03): Vite inlines it as a `data:` URL.
declare module '*.ttf?url&inline' {
  const dataUrl: string;
  export default dataUrl;
}
