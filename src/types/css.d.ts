/**
 * CSS side-effect imports.
 *
 * Next.js handles the actual bundling; this declaration only exists so that
 * `tsc --noEmit` can typecheck a file that imports a stylesheet.
 */
declare module "*.css" {
  const content: string;
  export default content;
}
