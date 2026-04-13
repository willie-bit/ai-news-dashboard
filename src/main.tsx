import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import { Video3DMapPage } from "./pages/video3d/Video3DMapPage";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/video-3d-map" element={<Video3DMapPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
