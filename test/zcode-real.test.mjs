import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

test("zcode: verify actual bundle and global AGENTS.md loader", () => {
	const zcodeDir = "D:/zcode";
	const glmCjs = join(zcodeDir, "resources/glm/zcode.cjs");
	if (!existsSync(glmCjs)) {
		// Skip physical assertions if ZCode is not installed in the environment
		return;
	}

	const cjsCode = readFileSync(glmCjs, "utf8");

	// 1. Verify the kernel contains logic to load ~/.zcode/AGENTS.md
	assert.ok(cjsCode.includes(".zcode\",\"AGENTS.md\""), "ZCode kernel contains the ~/.zcode/AGENTS.md load path");

	// 2. Verify ContextBuilder contains customSystemPrompt logic
	assert.ok(cjsCode.includes("customSystemPrompt"), "ZCode kernel contains the customSystemPrompt property");
	assert.ok(cjsCode.includes("Custom System Prompt"), "ZCode kernel contains the Custom System Prompt injection block");

	// 3. Verify the UserPromptSubmit hook interception event exists
	assert.ok(cjsCode.includes("UserPromptSubmit"), "ZCode kernel contains the UserPromptSubmit hook event");
});
