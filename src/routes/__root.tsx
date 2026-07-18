import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-panel max-w-md text-center p-10">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <p className="mt-4 text-lg">Page not found</p>
        <Link
          to="/"
          className="mt-6 inline-flex btn-crimson rounded-lg px-5 py-2.5 text-sm font-medium"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-panel max-w-md text-center p-8">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || "Try reloading the page."}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="btn-crimson rounded-lg px-4 py-2 text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Vocab to Anki — Learn English differently" },
      {
        name: "description",
        content:
          "Generate rich Anki cards via AI, dive into immersive lessons, and practice shadowing on your favorite videos.",
      },
      { property: "og:title", content: "Vocab to Anki — Learn English differently" },
      {
        property: "og:description",
        content: "AI cards, comprehensive lessons in English, video shadowing for French speakers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Vocab to Anki — Learn English differently" },
      { name: "description", content: "Generate rich Anki cards via AI, dive into immersive lessons, and practice shadowing on your favorite videos." },
      { property: "og:description", content: "Generate rich Anki cards via AI, dive into immersive lessons, and practice shadowing on your favorite videos." },
      { name: "twitter:description", content: "Generate rich Anki cards via AI, dive into immersive lessons, and practice shadowing on your favorite videos." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/9e29d3ad-0c1b-4af0-a3c3-e01e6a349301" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/9e29d3ad-0c1b-4af0-a3c3-e01e6a349301" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster theme="dark" position="top-right" richColors />
    </QueryClientProvider>
  );
}
