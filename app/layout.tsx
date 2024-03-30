import "./globals.css";
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/src/theme';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v13-appRouter';
import { CssBaseline } from "@mui/material";
import { AppLayout } from "./app-layout";


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>
        <AppRouterCacheProvider>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <AppLayout>
              {children}
            </AppLayout>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
