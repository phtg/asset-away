import type { NextConfig } from "next";

const config: NextConfig = {
  // Don't auto-generate AGENTS.md into the repo.
  agentRules: false,
  // Lets you open the dev server from another device on your home network
  // (e.g. http://192.168.2.101:3000). Add more hosts with ALLOWED_DEV_ORIGINS
  // (comma-separated hostnames, no scheme or port).
  allowedDevOrigins: [
    "192.168.*.*",
    ...(process.env.ALLOWED_DEV_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? []),
  ],
};

export default config;
