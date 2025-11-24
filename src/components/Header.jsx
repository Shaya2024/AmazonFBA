import React from "react";
import { AppBar, Toolbar, Typography, Box } from "@mui/material";
import { useTheme } from "../contexts/ThemeContext";
import ThemeToggle from "./ThemeToggle";

const Header = () => {
  const { theme } = useTheme();

  return (
    <AppBar
      position="static"
      elevation={1}
      sx={{
        backgroundColor:
          theme.palette.mode === "dark"
            ? theme.palette.background.paper
            : theme.palette.background.default,
        borderBottom: `1px solid ${theme.palette.divider}`,
        color: theme.palette.text.primary,
      }}
    >
      <Toolbar
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          minHeight: { xs: 56, sm: 64 },
          px: { xs: 2, sm: 3 },
        }}
      >
        <Typography
          variant="h5"
          component="h1"
          sx={{
            fontWeight: 600,
            fontSize: { xs: "1.25rem", sm: "1.5rem" },
            color: theme.palette.text.primary,
          }}
        >
          FBA Box Assignment Tool
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center" }}>
          <ThemeToggle />
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default Header;
