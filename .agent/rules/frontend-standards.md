---
trigger: always_on
---

# Frontend & UI Standards

## Styling Engine: Tailwind CSS v4.1
- **Version:** We are using Tailwind CSS v4.1.
- **CSS File:** The global stylesheet is located at `app/app.css`.
- **Configuration:** Do NOT look for a legacy `tailwind.config.js`. Use the modern CSS-first configuration (e.g., `@theme` blocks in `app/app.css`) where applicable.
- **Syntax:** Use modern utility classes. Avoid arbitrary values (`w-[123px]`) if a standard spacing variable exists.
- **Dark Mode:** Support dark mode by default using the `dark:` prefix.

## Component Library: shadcn/ui
- **Source of Truth:** We use `shadcn/ui` for all base components.
- **Path Alias:** Use `~/` for imports (e.g., `~/components/ui/button`).
- **Installation Protocol:**
    1.  **Check:** Before using a UI component, check if the file exists in `app/components/ui/` (imported as `~/components/ui/...`).
    2.  **Install:** If the file is missing, run: `npx shadcn@latest add [component-name]`.
    3.  **Config:** If asked by the CLI, ensure it uses `~/components` as the alias.
    4.  **Import:** Only import the component after ensuring it is installed.
- **Strict Prohibition:** NEVER attempt to manually write or scaffold the internal code of a shadcn component. Always use the CLI.
- **Customization:** Modify components via `app/app.css` variables or `tailwind` utility classes.

## Icons
- Use **Lucide React** (`lucide-react`) for all icons.
- Example: `import { Bell } from "lucide-react";`

## Framework Standards (React Router v7)

### Routing Configuration
- **Config File:** All routes must be defined in `app/routes.ts` using the `route`, `index`, and `layout` helpers.
- **Pattern:** Do not rely on file-system routing magic. Explicitly map URLs to file paths.
- **Example:**
  ```typescript
  import { type RouteConfig, index, route } from "@react-router/dev/routes";

  export default [
    index("routes/_index.tsx"),
    route("r/:roomId", "routes/r.$roomId.tsx"),
  ] satisfies RouteConfig;
  ```

### Type Safety & Data Loading
- **Auto-Generated Types:** ALWAYS use the v7 auto-generated types for props and loader arguments.
- **Import Pattern:** `import type { Route } from "./+types/[filename]";`
- **Component Definition:**
  ```typescript
  export default function MyRoute({ loaderData }: Route.ComponentProps) { ... }
  ```
- **Loader Definition:**
  ```typescript
  export async function loader({ params }: Route.LoaderArgs) { ... }
  ```
- **Return Values:** Return raw objects from loaders/actions. Do not use the deprecated `json()` wrapper.

### Meta & Headers
- **Meta Tags:** Use React 19 standard `<title>` and `<meta>` tags directly inside the JSX of the component.
- **Prohibited:** Do NOT use the legacy `export const meta` function unless absolutely necessary.

### Data Mutation
- Use `<Form>` for simple mutations that redirect.
- Use `useFetcher` for mutations that update UI in place without navigation (like "Like" buttons).
