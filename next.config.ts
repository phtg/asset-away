import type { NextConfig } from "next";

const config: NextConfig = {
  // Don't auto-generate AGENTS.md into the repo.
  agentRules: false,
};

export default config;
