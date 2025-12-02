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

## Framework Specifics (Remix)
- Use the `<Link>` component from `@remix-run/react` for internal navigation.