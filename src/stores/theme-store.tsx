'use client';

import { Roboto } from 'next/font/google';
import { createTheme } from '@mui/material/styles';
import { ThemeProvider } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import { themeFromImage, Theme, themeFromSourceColor, hexFromArgb } from '@material/material-color-utilities';
import { Dispatch, createContext, useContext, useReducer } from 'react';

const roboto = Roboto({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
});

interface ThemeStateProps {
  m3Theme: Theme
}

export const ThemeStateContext = createContext<ThemeStateProps>({
  m3Theme: themeFromSourceColor(0x6200EE),
});

type Action =
  | { type: "setTheme"; payload: { theme: Theme } }

export const ThemeDispatchContext = createContext<Dispatch<Action>>(() => { });

export const useThemeStore = () => {
  const state = useContext(ThemeStateContext);
  const dispatch = useContext(ThemeDispatchContext);

  const actions = {
    applyThemeFromImage: async (imageSrc: string) => {
      console.log("Applying theme from image");
      const image = document.createElement('img');
      image.src = imageSrc;
      const theme = await themeFromImage(image);
      dispatch({ type: "setTheme", payload: { theme } });
    }
  }
  return [state, actions] as const;
}

const reducer = (state: ThemeStateProps, action: Action) => {
  switch (action.type) {
    case "setTheme":
      return { ...state, m3Theme: action.payload.theme };
    default:
      return state;
  }
}

export const ThemeStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, {
    m3Theme: themeFromSourceColor(0x6200EE),
  });

  const theme = createTheme({
    palette: {
      mode: 'dark',
      primary: {
        main: hexFromArgb(state.m3Theme.schemes.dark.primary),
      },
      secondary: {
        main: hexFromArgb(state.m3Theme.schemes.dark.secondary),
      },
      background: {
        default: hexFromArgb(state.m3Theme.schemes.dark.surface),
        paper: hexFromArgb(state.m3Theme.schemes.dark.surface),
      },
      error: {
        main: hexFromArgb(state.m3Theme.schemes.dark.error),
      },
      text: {
        primary: hexFromArgb(state.m3Theme.schemes.dark.onSurface)
      }
    },
    typography: {
      fontFamily: roboto.style.fontFamily,
    },
  });
  // console.log(theme);
  console.log("ASASASA")

  return (
    <ThemeProvider theme={theme}>
      <ThemeStateContext.Provider value={state}>
        <ThemeDispatchContext.Provider value={dispatch}>
          {children}
        </ThemeDispatchContext.Provider>
      </ThemeStateContext.Provider>
    </ThemeProvider>
  );
}