// Vite's `?url` import: QuickJS's WebAssembly as an asset of the app (`browser.ts`).
declare module '*?url' {
  const url: string;
  export default url;
}
