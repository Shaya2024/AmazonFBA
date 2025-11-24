import React, { createContext, useContext, useState, useEffect } from "react";
import {
  ThemeProvider as MuiThemeProvider,
  createTheme,
} from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  // Get initial theme from localStorage or default to 'light'
  const [mode, setMode] = useState(() => {
    const savedMode = localStorage.getItem("themeMode");
    return savedMode || "light";
  });

  // Create MUI theme based on mode
  const theme = createTheme({
    palette: {
      mode: mode,
      ...(mode === "light"
        ? {
            // Light theme
            primary: {
              main: "#1976d2",
            },
            secondary: {
              main: "#dc004e",
            },
            background: {
              default: "#ffffff",
              paper: "#f5f5f5",
            },
          }
        : {
            // Dark theme
            primary: {
              main: "#90caf9",
            },
            secondary: {
              main: "#f48fb1",
            },
            background: {
              default: "#121212",
              paper: "#1e1e1e",
            },
          }),
    },
  });

  // Toggle theme function
  const toggleTheme = () => {
    setMode((prevMode) => {
      const newMode = prevMode === "light" ? "dark" : "light";
      localStorage.setItem("themeMode", newMode);
      return newMode;
    });
  };

  // Apply theme to document body
  useEffect(() => {
    document.body.style.backgroundColor = theme.palette.background.default;
    document.body.style.color = theme.palette.text.primary;
  }, [theme]);

  const value = {
    mode,
    theme,
    toggleTheme,
  };

  return (
    <ThemeContext.Provider value={value}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
};
