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
  theme: Theme
}

export const ThemeStateContext = createContext<ThemeStateProps>({
  theme: themeFromSourceColor(0x6200EE),
});

type Action =
  | { type: "setTheme"; payload: { theme: Theme } }

export const ThemeDispatchContext = createContext<Dispatch<Action>>(() => { });

export const useThemeStore = () => {
  const theme = useTheme();
  const state = useContext(ThemeStateContext);
  const dispatch = useContext(ThemeDispatchContext);

  const actions = {
    applyThemeFromImage: async (imageSrc: string) => {
      const image = document.createElement('img');
      image.src = imageSrc;
      const theme = await themeFromImage(image);
      console.log("!!!", theme);
      dispatch({ type: "setTheme", payload: { theme } });
    }
  }
  return [theme, actions] as const;
}

const reducer = (state: ThemeStateProps, action: Action) => {
  switch (action.type) {
    case "setTheme":
      return { ...state, theme: action.payload.theme };
    default:
      return state;
  }
}

export const ThemeStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, {
    theme: themeFromSourceColor(0x6200EE),
  });


  const theme = createTheme({
    palette: {
      mode: 'dark',
      primary: {
        main: hexFromArgb(state.theme.schemes.dark.primary),
      },
      secondary: {
        main: hexFromArgb(state.theme.schemes.dark.secondary),
      },
      background: {
        default: hexFromArgb(state.theme.schemes.dark.surface),
        paper: hexFromArgb(state.theme.schemes.dark.surface),
      },
      error: {
        main: hexFromArgb(state.theme.schemes.dark.error),
      },
      // text: {
      //   primary: hexFromArgb(state.theme.schemes.dark.onPrimary),
      //   secondary: hexFromArgb(state.theme.schemes.dark.onSecondary),
      // },
    },
    typography: {
      fontFamily: roboto.style.fontFamily,
    },
  });
  console.log("XXX", theme);

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