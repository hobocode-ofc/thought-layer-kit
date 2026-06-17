// Minimal ambient declaration of the Pi extension API surface this package
// uses. It lets the extension typecheck without installing the full Pi runtime.
// The real types ship with @earendil-works/pi-coding-agent; validate against a
// live Pi install (see TODO.md). Shape sourced from Pi's docs/extensions.md.

declare module "@earendil-works/pi-coding-agent" {
  export interface ToolResult {
    content: Array<{ type: "text"; text: string }>;
    details?: Record<string, unknown>;
  }

  export interface ExtensionUI {
    notify(message: string, level?: "info" | "warning" | "error"): void;
  }

  export interface ExtensionContext {
    ui: ExtensionUI;
  }

  export interface ToolSpec {
    name: string;
    label?: string;
    description: string;
    // TypeBox schema (TSchema). Kept loose here to avoid a hard typebox dep in the shim.
    parameters: unknown;
    execute(
      toolCallId: string,
      params: any,
      signal?: AbortSignal,
      onUpdate?: (partial: unknown) => void,
      ctx?: ExtensionContext,
    ): Promise<ToolResult>;
  }

  export interface CommandSpec {
    description: string;
    handler: (args: string, ctx: ExtensionContext) => Promise<void>;
  }

  export interface ExtensionAPI {
    registerTool(spec: ToolSpec): void;
    registerCommand(name: string, spec: CommandSpec): void;
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void | Promise<void>): void;
  }
}
