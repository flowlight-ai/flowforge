"use client";

import { createContext, useContext } from "react";
import { ShellConfig } from "./types";

const defaultConfig: ShellConfig = {
  brandName: "FlowForge",
  brandShort: "FF",
  brandColor: "#ff5c5c",
  brandSubtitle: "AI Agent OS",
  version: "v0.1.0",
  navSections: [],
};

const ShellConfigContext = createContext<ShellConfig>(defaultConfig);

export function ShellConfigProvider({
  config,
  children,
}: {
  config: ShellConfig;
  children: React.ReactNode;
}) {
  return (
    <ShellConfigContext.Provider value={config}>
      {children}
    </ShellConfigContext.Provider>
  );
}

export function useShellConfig() {
  return useContext(ShellConfigContext);
}
