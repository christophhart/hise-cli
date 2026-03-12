#!/usr/bin/env node

import chalk from "chalk";
import { render } from "ink";
import React from "react";
import { App } from "./app.js";
import { PIPE_PREFIX, connect, discoverPipes } from "./pipe.js";

function resolvePipeName(args: string[]): string {
	let pipeName = PIPE_PREFIX;

	const pipeIndex = args.indexOf("--pipe");
	if (pipeIndex >= 0 && args[pipeIndex + 1]) {
		pipeName = args[pipeIndex + 1];
	} else if (args[0] && !args[0].startsWith("--")) {
		pipeName = args[0];
	}

	if (pipeName !== PIPE_PREFIX) {
		return pipeName;
	}

	const pipes = discoverPipes();
	if (pipes.length === 0) {
		console.error(
			chalk.red(
				"No HISE pipe instances found. Is HISE running with the REPL server enabled?"
			)
		);
		console.error(chalk.dim("Enable it via Tools > Toggle REPL Console in HISE."));
		process.exit(1);
	}

	if (pipes.length === 1) {
		return pipes[0];
	}

	if (pipes.includes(PIPE_PREFIX)) {
		return PIPE_PREFIX;
	}

	console.log(chalk.cyan("Multiple HISE instances found:"));
	for (const pipe of pipes) {
		console.log(`  ${chalk.white(pipe)}`);
	}
	console.log(chalk.dim("\nUse --pipe <name> to connect to a specific instance."));
	process.exit(1);
}

function printPipeList(): void {
	const pipes = discoverPipes();
	if (pipes.length === 0) {
		console.log(chalk.dim("No HISE pipe instances found."));
		return;
	}

	console.log(chalk.cyan("Available HISE instances:"));
	for (const pipe of pipes) {
		console.log(`  ${chalk.white(pipe)}`);
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.includes("--list")) {
		printPipeList();
		return;
	}

	const pipeName = resolvePipeName(args);

	try {
		const connection = await connect(pipeName);
		const enterAlt = "\u001b[?1049h\u001b[2J\u001b[H";
		const leaveAlt = "\u001b[?1049l";
		let restoredAltScreen = false;

		const restoreAltScreen = () => {
			if (restoredAltScreen) {
				return;
			}

			restoredAltScreen = true;
			process.stdout.write(leaveAlt);
		};

		process.once("exit", restoreAltScreen);
		process.once("SIGTERM", restoreAltScreen);
		process.once("uncaughtException", restoreAltScreen);
		process.once("unhandledRejection", restoreAltScreen);
		process.stdout.write(enterAlt);

		const instance = render(React.createElement(App, { connection, pipeName }));
		void instance.waitUntilExit().finally(() => {
			restoreAltScreen();
			process.off("exit", restoreAltScreen);
			process.off("SIGTERM", restoreAltScreen);
			process.off("uncaughtException", restoreAltScreen);
			process.off("unhandledRejection", restoreAltScreen);
		});
	} catch (error) {
		console.error(chalk.red(String(error)));
		process.exit(1);
	}
}

void main();
