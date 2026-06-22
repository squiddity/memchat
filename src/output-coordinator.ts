import type readline from "node:readline/promises";

export type PromptSnapshot = {
  line: string;
  cursor: number;
};

export class CliOutputCoordinator {
  private acceptingInput = false;
  private readline: readline.Interface | undefined;

  constructor(
    private readonly stream: NodeJS.WriteStream,
    private readonly promptText = "you> ",
  ) {}

  setReadline(readlineInterface: readline.Interface): void {
    this.readline = readlineInterface;
  }

  setAcceptingInput(acceptingInput: boolean): void {
    this.acceptingInput = acceptingInput;
  }

  write(text: string): void {
    this.stream.write(text);
  }

  writeLine(text = ""): void {
    this.write(`${text}\n`);
  }

  writeAsyncBlock(text: string): void {
    if (!text) return;
    if (!this.shouldRedrawPrompt()) {
      this.stream.write(text.endsWith("\n") ? text : `${text}\n`);
      return;
    }

    const snapshot = this.snapshotPrompt();
    this.stream.write("\r\x1b[2K");
    this.stream.write(text.endsWith("\n") ? text : `${text}\n`);
    this.redrawPrompt(snapshot);
  }

  private shouldRedrawPrompt(): boolean {
    return Boolean(this.stream.isTTY && this.acceptingInput && this.readline);
  }

  private snapshotPrompt(): PromptSnapshot {
    const candidate = this.readline as unknown as Partial<PromptSnapshot> | undefined;
    return {
      line: typeof candidate?.line === "string" ? candidate.line : "",
      cursor: typeof candidate?.cursor === "number" ? candidate.cursor : candidate?.line?.length ?? 0,
    };
  }

  private redrawPrompt(snapshot: PromptSnapshot): void {
    this.stream.write(`${this.promptText}${snapshot.line}`);
    const endColumn = this.promptText.length + snapshot.line.length;
    const cursorColumn = this.promptText.length + Math.max(0, Math.min(snapshot.cursor, snapshot.line.length));
    if (cursorColumn < endColumn) this.stream.write(`\r\x1b[${cursorColumn}C`);
  }
}
