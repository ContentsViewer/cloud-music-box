import "./globals.css";
import { AppRouterCacheProvider } from '@mui/material-nextjs/v13-appRouter';
import { CssBaseline } from "@mui/material";
import { AppLayout } from "./app-layout";
import { ThemeStoreProvider } from "@/src/stores/theme-store";


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="manifest.json" />
      </head>
      <body>
        <AppRouterCacheProvider>
          <ThemeStoreProvider>
            <CssBaseline />
            <AppLayout>
              {children}
            </AppLayout>
          </ThemeStoreProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}

export const dynamic = "force-static"