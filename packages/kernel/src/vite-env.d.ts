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

// The P4-06 STEP fixture, a text file, read the same way.
declare module '*.step?url&inline' {
  const dataUrl: string;
  export default dataUrl;
}

// The P4-06 mesh fixtures (ADR-0066 §3): binary STL and 3MF, ASCII STL and OBJ.
declare module '*.stl?url&inline' {
  const dataUrl: string;
  export default dataUrl;
}

declare module '*.3mf?url&inline' {
  const dataUrl: string;
  export default dataUrl;
}

declare module '*.obj?url&inline' {
  const dataUrl: string;
  export default dataUrl;
}

// A bundled font read in a test (P4-03): Vite inlines it as a `data:` URL.
declare module '*.ttf?url&inline' {
  const dataUrl: string;
  export default dataUrl;
}
