import { describe, expect, it } from 'vitest';
import { isToolDefinitionList, isToolResponse } from './mcp';

describe('the MCP bridge payloads (ADR-0087 §4)', () => {
  it('accepts a tool list of snake_case names with object schemas', () => {
    expect(
      isToolDefinitionList([
        { name: 'get_design', description: 'x', inputSchema: { type: 'object' } },
      ]),
    ).toBe(true);
    expect(
      isToolDefinitionList([{ name: 'Get', description: 'x', inputSchema: { type: 'object' } }]),
    ).toBe(false);
    expect(
      isToolDefinitionList([{ name: 'a', description: 'x', inputSchema: { type: 'string' } }]),
    ).toBe(false);
    expect(isToolDefinitionList({})).toBe(false);
  });

  it('accepts a result, an error, and a result with an export file', () => {
    expect(isToolResponse({ id: 1, result: { content: [{ type: 'text', text: 'ok' }] } })).toBe(
      true,
    );
    expect(
      isToolResponse({
        id: 1,
        result: { content: [{ type: 'image', data: 'AA', mimeType: 'image/png' }] },
      }),
    ).toBe(true);
    expect(isToolResponse({ id: 1, error: 'No design is open.' })).toBe(true);
    expect(
      isToolResponse({
        id: 2,
        result: { content: [] },
        file: { design: 'Box', format: 'stl', bytes: new Uint8Array([1]) },
      }),
    ).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isToolResponse({ id: '1', error: 'x' })).toBe(false);
    expect(isToolResponse({ id: 1, result: { content: [{ type: 'resource' }] } })).toBe(false);
    expect(
      isToolResponse({
        id: 1,
        result: { content: [{ type: 'image', data: 'AA', mimeType: 'image/svg+xml' }] },
      }),
    ).toBe(false);
    expect(
      isToolResponse({
        id: 1,
        result: { content: [] },
        file: { design: 'x', format: 'obj', bytes: new Uint8Array() },
      }),
    ).toBe(false);
    expect(
      isToolResponse({
        id: 1,
        result: { content: [] },
        file: { design: 'x', format: 'stl', bytes: [1] },
      }),
    ).toBe(false);
  });
});
