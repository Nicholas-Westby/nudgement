import type { FC, PropsWithChildren } from "hono/jsx";

type LayoutProps = PropsWithChildren<{
  title: string;
  path?: string;
  description?: string;
}>;

type NavLinkProps = PropsWithChildren<{
  href: string;
  current: boolean;
}>;

const STUDIO = {
  name: "Claybank Studio",
  address: "48 Harbour Road, Victoria, British Columbia",
  phone: "(250) 555-0142",
};

const DEFAULT_DESCRIPTION = "Pottery workshops at Claybank Studio. Pick a workshop and save your spot.";

const NavLink: FC<NavLinkProps> = ({ href, current, children }) => (
  <a href={href} aria-current={current ? "page" : undefined}>
    {children}
  </a>
);

export const Layout: FC<LayoutProps> = ({ title, path = "/", description = DEFAULT_DESCRIPTION, children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} - Claybank Studio</title>
      <meta name="description" content={description} />
      <link rel="stylesheet" href="/styles/main.css" />
      <link rel="stylesheet" href="/courses.css" />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    </head>
    <body>
      <a class="skip-link" href="#main">
        Skip to main content
      </a>
      <header class="site-header">
        <a class="wordmark" href="/">
          {STUDIO.name}
        </a>
        <nav class="site-nav" aria-label="Main">
          <NavLink href="/" current={path === "/" || path.startsWith("/calendar")}>
            Calendar
          </NavLink>
          <NavLink href="/workshops/new" current={path.startsWith("/workshops/new")}>
            Create a workshop
          </NavLink>
        </nav>
      </header>
      <main id="main" class="page">
        {children}
      </main>
      <footer class="site-footer">
        <p>
          {STUDIO.name}, {STUDIO.address}
        </p>
        <p>All times are Vancouver time.</p>
        <p>Questions about a workshop? Ask at the counter or call {STUDIO.phone}.</p>
      </footer>
    </body>
  </html>
);
