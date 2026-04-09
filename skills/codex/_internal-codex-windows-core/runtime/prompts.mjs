import process from "node:process";
import readlinePromises from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import enquirer from "enquirer";

export const { Select, Input, Confirm, Password } = enquirer;

export function isIgnorablePromptCloseError(error) {
  return error && typeof error === "object" && error.code === "ERR_USE_AFTER_CLOSE";
}

export function installPromptCloseGuards() {
  process.on("uncaughtException", (error) => {
    if (isIgnorablePromptCloseError(error)) {
      process.exitCode = 0;
      return;
    }
    console.error(`Error: ${error.message || error}`);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    if (isIgnorablePromptCloseError(reason)) {
      process.exitCode = 0;
      return;
    }
    console.error(`Error: ${reason?.message || reason}`);
    process.exit(1);
  });
}

export async function promptLine(question) {
  const rl = readlinePromises.createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

export async function promptRequired(question, errorLabel) {
  const value = await promptLine(question);
  if (!value) {
    throw new Error(errorLabel);
  }
  return value;
}

export async function promptYesNo(question, defaultValue = false) {
  const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
  const answer = (await promptLine(question + suffix)).toLowerCase();
  if (!answer) {
    return defaultValue;
  }
  if (answer === "y" || answer === "yes") {
    return true;
  }
  if (answer === "n" || answer === "no") {
    return false;
  }
  throw new Error("Please answer yes or no.");
}

export async function runPrompt(prompt) {
  try {
    return await prompt.run();
  } catch {
    return null;
  }
}

export async function promptInputPrompt(message, initial = "") {
  const value = await runPrompt(
    new Input({
      name: "value",
      message,
      initial,
    }),
  );
  if (value == null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed || null;
}

export async function promptSecretPrompt(message) {
  const value = await runPrompt(
    new Password({
      name: "value",
      message,
    }),
  );
  if (value == null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed || null;
}

export async function promptConfirmPrompt(message, initial = false) {
  const value = await runPrompt(
    new Confirm({
      name: "value",
      message,
      initial,
    }),
  );
  return value === true;
}
