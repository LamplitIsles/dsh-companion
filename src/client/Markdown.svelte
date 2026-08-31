<script lang="ts">
  import DOMPurify from "dompurify";
  import { marked } from "marked";

  export let text = "";

  $: html = DOMPurify.sanitize(marked.parse(text, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style"],
  });

  function decorateLinks(node: HTMLElement, _html: string): { update(next: string): void } {
    const apply = (): void => {
      for (const link of node.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        const target = new URL(link.href, window.location.href);
        if (target.origin === window.location.origin) continue;
        link.target = "_blank";
        link.rel = "noreferrer noopener";
      }
    };
    apply();
    return { update: apply };
  }
</script>

<div class="markdown" use:decorateLinks={html}>{@html html}</div>

<style>
  .markdown { overflow-wrap: anywhere; }
  .markdown :global(:first-child) { margin-top: 0; }
  .markdown :global(:last-child) { margin-bottom: 0; }
  .markdown :global(p) { margin: 0.45em 0; }
  .markdown :global(ul), .markdown :global(ol) { margin: 0.5em 0; padding-left: 1.35em; }
  .markdown :global(li + li) { margin-top: 0.25em; }
  .markdown :global(a) { color: inherit; font-weight: 650; text-decoration-color: color-mix(in srgb, currentColor 45%, transparent); text-underline-offset: 0.18em; }
  .markdown :global(blockquote) { border-left: 3px solid color-mix(in srgb, var(--color-primary) 55%, transparent); margin: 0.6em 0; padding-left: 0.8em; opacity: 0.82; }
  .markdown :global(code) { background: color-mix(in srgb, var(--color-base-content) 8%, transparent); border-radius: 0.4em; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 0.9em; padding: 0.12em 0.35em; }
  .markdown :global(pre) { background: color-mix(in srgb, var(--color-base-content) 8%, var(--color-base-100)); border-radius: 14px; margin: 0.65em 0; max-width: 100%; overflow-x: auto; padding: 0.85em 1em; }
  .markdown :global(pre code) { background: transparent; padding: 0; }
  .markdown :global(hr) { border: 0; border-top: 1px solid color-mix(in srgb, var(--color-base-content) 16%, transparent); margin: 0.9em 0; }
</style>
