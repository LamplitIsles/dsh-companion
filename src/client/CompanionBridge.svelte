<script lang="ts">
  import type { Readable } from "svelte/store";
  import Companion from "./Companion.svelte";
  import type { CompanionBridgeProps } from "./companion-bridge.js";

  let { propsStore } = $props<{ propsStore: Readable<CompanionBridgeProps> }>();
  let currentProps = $state<CompanionBridgeProps>({});
  $effect(() => {
    const unsubscribe = propsStore.subscribe((next) => { currentProps = next; });
    return unsubscribe;
  });
</script>

<Companion
  {...currentProps}
  on:advanced={() => currentProps.onAdvanced?.()}
  on:recovery={() => currentProps.onRecovery?.()}
/>
