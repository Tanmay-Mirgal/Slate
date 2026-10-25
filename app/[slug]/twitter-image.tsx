import { MARKETING_PAGES } from "@/lib/marketing-pages";
import Image, { alt, contentType, size } from "./opengraph-image";

// X / Twitter reads its own image tag; it shows the same card as Open Graph.
// Route config (dynamicParams) has to be declared in the file itself, so it can't be a plain re-export.
export { alt, contentType, size };
export default Image;
export const dynamicParams = false;

export function generateStaticParams() {
  return MARKETING_PAGES.map(({ slug }) => ({ slug }));
}
