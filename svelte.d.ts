declare module "*.svelte" {
  import type { ComponentType, SvelteComponent } from "svelte";
  const component: ComponentType<SvelteComponent>;
  export default component;
}

declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
