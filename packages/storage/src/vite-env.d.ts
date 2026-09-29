// A fixture file read in a test: Vite inlines it as a `data:` URL (`?url&inline`).
declare module '*.extrudo?url&inline' {
  const dataUrl: string;
  export default dataUrl;
}
