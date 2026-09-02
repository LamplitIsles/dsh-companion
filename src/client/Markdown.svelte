<script lang="ts">
  import SvelteMarkdown, { buildUnsupportedHTML, defaultRenderers } from "@humanspeak/svelte-markdown";

  export let text = "";

  // Matches Sliqs: render Markdown tokens as Svelte nodes, never via
  // browser-parsed HTML strings. Raw HTML remains unsupported.
  const renderers = { ...defaultRenderers, html: buildUnsupportedHTML() };
</script>

<div class="markdown"><SvelteMarkdown source={text} {renderers} /></div>

<style>
  .markdown { min-width: 0; max-width: 100%; overflow-x: clip; overflow-wrap: anywhere; }
  .markdown :global(:first-child) { margin-top: 0; }
  .markdown :global(:last-child) { margin-bottom: 0; }
  .markdown :global(p) { margin: 0.45em 0; }
  .markdown :global(h1), .markdown :global(h2), .markdown :global(h3), .markdown :global(h4), .markdown :global(h5), .markdown :global(h6) { margin: 0.8em 0 0.4em; font: inherit; font-weight: 750; line-height: 1.25; }
  .markdown :global(h1) { font-size: 1.35em; }
  .markdown :global(h2) { font-size: 1.2em; }
  .markdown :global(h3) { font-size: 1.1em; }
  .markdown :global(ul), .markdown :global(ol) { margin: 0.5em 0; padding-inline-start: 1.6em; list-style-position: outside; }
  .markdown :global(ul) { list-style-type: disc; }
  .markdown :global(ol) { list-style-type: decimal; }
  .markdown :global(ul ul) { list-style-type: circle; }
  .markdown :global(ul ul ul) { list-style-type: square; }
  .markdown :global(ol ol) { list-style-type: lower-alpha; }
  .markdown :global(li > ul), .markdown :global(li > ol) { margin: 0.3em 0; }
  .markdown :global(li + li) { margin-top: 0.25em; }
  .markdown :global(li:has(> input[type="checkbox"])) { list-style: none; }
  .markdown :global(input[type="checkbox"]) { accent-color: var(--color-primary); margin: 0 0.4em 0 0; vertical-align: middle; }
  .markdown :global(a) { color: inherit; font-weight: 650; text-decoration-color: color-mix(in srgb, currentColor 45%, transparent); text-underline-offset: 0.18em; }
  .markdown :global(blockquote) { border-left: 3px solid color-mix(in srgb, var(--color-primary) 55%, transparent); margin: 0.6em 0; padding-left: 0.8em; opacity: 0.82; }
  .markdown :global(code) { background: color-mix(in srgb, var(--color-base-content) 8%, transparent); border-radius: 0.4em; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 0.9em; padding: 0.12em 0.35em; }
  .markdown :global(pre) { box-sizing: border-box; background: color-mix(in srgb, var(--color-base-content) 8%, var(--color-base-100)); border-radius: 14px; margin: 0.65em 0; max-width: 100%; overflow-x: auto; padding: 0.85em 1em; }
  .markdown :global(pre code) { background: transparent; padding: 0; }
  .markdown :global(table) { display: block; width: max-content; min-width: 100%; max-width: 100%; margin: 0.65em 0; overflow-x: auto; border-collapse: collapse; }
  .markdown :global(th), .markdown :global(td) { overflow-wrap: normal; word-break: normal; border: 1px solid color-mix(in srgb, var(--color-base-content) 18%, transparent); padding: 0.4em 0.6em; text-align: left; white-space: nowrap; }
  .markdown :global(th) { background: color-mix(in srgb, var(--color-base-content) 8%, transparent); font-weight: 700; }
  .markdown :global(img) { height: auto; max-width: 100%; }
  .markdown :global(hr) { border: 0; border-top: 1px solid color-mix(in srgb, var(--color-base-content) 16%, transparent); margin: 0.9em 0; }
</style>
