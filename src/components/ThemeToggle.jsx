import React from "react";
import { Switch, FormControlLabel, Box } from "@mui/material";
import { useTheme } from "../contexts/ThemeContext";
import { Moon, Sun } from "lucide-react";

const ThemeToggle = () => {
  const { mode, toggleTheme } = useTheme();

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
      }}
    >
      <FormControlLabel
        control={
          <Switch
            checked={mode === "dark"}
            onChange={toggleTheme}
            color="primary"
          />
        }
        label={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {mode === "dark" ? (
              <Moon size={20} style={{ color: "inherit" }} />
            ) : (
              <Sun size={20} style={{ color: "inherit" }} />
            )}
          </Box>
        }
        sx={{
          "& .MuiFormControlLabel-label": {
            color: "text.primary",
          },
        }}
      />
    </Box>
  );
};

export default ThemeToggle;
