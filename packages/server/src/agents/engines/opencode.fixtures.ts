export interface OpenCodeFixture {
  name: string;
  source: string;
  lines: string[];
}

export const manualWriteGuardFixture: OpenCodeFixture = {
  name: "manual-write-guard",
  source:
    "Captured manually with OpenCode 1.2.26 using a real CLI run against a disposable workdir.",
  lines: [
    JSON.stringify({
      type: "step_start",
      part: { type: "step-start" },
    }),
    JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "write",
        state: {
          status: "error",
          input: {
            content: "hello from opencode",
            filePath: "C:/repo/workdir/hello.txt",
          },
          error:
            "Error: You must read file C:/repo/workdir/hello.txt before overwriting it. Use the Read tool first",
        },
      },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { type: "step-finish", tokens: { total: 15087 } },
    }),
    JSON.stringify({
      type: "step_start",
      part: { type: "step-start" },
    }),
    JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "read",
        state: {
          status: "completed",
          input: {
            filePath: "C:/repo/workdir/hello.txt",
          },
          output:
            "<path>C:/repo/workdir/hello.txt</path>\n<type>file</type>\n<content>1: hello from opencode\n\n(End of file - total 1 lines)\n</content>",
        },
      },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { type: "step-finish", tokens: { total: 15191 } },
    }),
    JSON.stringify({
      type: "step_start",
      part: { type: "step-start" },
    }),
    JSON.stringify({
      type: "text",
      part: {
        type: "text",
        text: '\n\nThe file `hello.txt` already exists with the exact content "hello from opencode". No changes needed.',
      },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { type: "step-finish", tokens: { total: 15292 } },
    }),
  ],
};
