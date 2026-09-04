<script lang="ts">
  import SvelteMarkdown, { buildUnsupportedHTML, defaultRenderers } from "@humanspeak/svelte-markdown";

  export let text = "";

  // Matches Sliqs: render Markdown tokens as Svelte nodes, never via
  // browser-parsed HTML strings. Raw HTML remains unsupported.
  const renderers = { ...defaultRenderers, html: buildUnsupportedHTML() };
</script>

<div class="markdown"><SvelteMarkdown source={text} {renderers} /></div>
