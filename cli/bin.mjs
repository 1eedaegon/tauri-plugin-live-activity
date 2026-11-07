#!/usr/bin/env node
import { main } from './main.mjs';

process.exitCode = main(process.argv.slice(2));
