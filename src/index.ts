#!/usr/bin/env bun
import { run } from "./cli";

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
