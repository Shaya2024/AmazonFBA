import React from "react";
import { Box } from "@mui/material";
import ImageUploader from "./components/ImageUploader";
import Header from "./components/Header";

function App() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Header />
      <div className="App">
        <ImageUploader />
      </div>
    </Box>
  );
}

export default App;
