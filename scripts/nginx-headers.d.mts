export const HEADERS_PATH: string;
export function nginxConfig(headersText: string): { maps: string; headers: string };
export function expectedHeaders(headersText: string, path: string): string[];
