export function styleThinkingText(text: string, isTTY: boolean): string {
  if (!isTTY) return text;
  return `\x1b[3m\x1b[36m${text}\x1b[39m\x1b[23m`;
}

export function resolveShowThinking(options: { explicitShow: boolean; explicitHide: boolean; envDefault: boolean }): boolean {
  if (options.explicitHide) return false;
  if (options.explicitShow) return true;
  return options.envDefault;
}

export function resolveReviewerModel(options: { explicitReviewerModel?: string; importModel?: string; disabled?: boolean }): string | undefined {
  if (options.disabled) return undefined;
  if (options.explicitReviewerModel) {
    const normalized = options.explicitReviewerModel.trim().toLowerCase();
    if (normalized === "off" || normalized === "none") return undefined;
    return options.explicitReviewerModel;
  }
  return options.importModel;
}
